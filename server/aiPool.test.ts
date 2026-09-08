/**
 * The thread pool that computes Gym Leader moves.
 *
 * What matters here is not throughput but the two limits: the pool must not grow past its size (or searching
 * starves the thread that accepts requests), and the queue must refuse rather than grow (or a burst of
 * challengers turns into an unbounded wait). Both are tested by exceeding them.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { AiPool, PoolBusyError, QUEUE_PER_WORKER } from './aiPool.ts';
import { GYM_BY_ID } from '../src/ladder/badges.ts';
import { difficultyFor } from './gymEngine.ts';

const BROCK = GYM_BY_ID.get('boulder')!;
const pools: AiPool[] = [];
const makePool = (size: number, queue?: number) => {
  const p = queue === undefined ? new AiPool(size) : new AiPool(size, queue);
  pools.push(p);
  return p;
};

afterAll(async () => { await Promise.all(pools.map((p) => p.close())); });

describe('the pool', () => {
  it('computes a leader move on a worker thread', async () => {
    const pool = makePool(1);
    const encoded = await pool.search(BROCK.id, 'pool-1', [], difficultyFor(BROCK), 1);
    expect(typeof encoded).toBe('number');
    expect(encoded).toBeGreaterThan(0);
  }, 60_000);

  it('agrees with an in-process search, so moving threads changes no answer', async () => {
    // The guarantee the whole design rests on: the thread is not an input to the search.
    const { localSearch } = await import('./gymEngine.ts');
    const { loadDexFromDisk } = await import('./gameDex.ts');
    const dex = await loadDexFromDisk();
    const pool = makePool(1);
    for (const plySeed of [1, 2, 5]) {
      const onThread = await pool.search(BROCK.id, 'agree-1', [], difficultyFor(BROCK), plySeed);
      const inProcess = await localSearch(dex)(BROCK.id, 'agree-1', [], difficultyFor(BROCK), plySeed);
      expect(onThread, `plySeed ${plySeed}`).toBe(inProcess);
    }
  }, 120_000);

  it('never spawns more workers than its size', async () => {
    const pool = makePool(2);
    await Promise.all([1, 2, 3, 4].map((n) => pool.search(BROCK.id, 'size-1', [], difficultyFor(BROCK), n)));
    expect(pool.stats().workers).toBeLessThanOrEqual(2);
  }, 120_000);

  it('refuses rather than queueing without bound', async () => {
    // One worker, queue of one: the third concurrent search has nowhere to go.
    const pool = makePool(1, 1);
    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((n) => pool.search(BROCK.id, 'busy-1', [], difficultyFor(BROCK), n)),
    );
    const busy = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof PoolBusyError,
    );
    expect(busy.length).toBeGreaterThan(0);
    // And the ones it accepted still answered.
    const ok = results.filter((r) => r.status === 'fulfilled');
    expect(ok.length).toBeGreaterThan(0);
  }, 120_000);

  it('reports an unknown gym as an error rather than hanging', async () => {
    const pool = makePool(1);
    await expect(pool.search('not-a-gym', 'x', [], difficultyFor(BROCK), 1)).rejects.toThrow(/unknown gym/);
  }, 60_000);

  it('keeps serving after a failed search', async () => {
    const pool = makePool(1);
    await expect(pool.search('not-a-gym', 'x', [], difficultyFor(BROCK), 1)).rejects.toThrow();
    const encoded = await pool.search(BROCK.id, 'recover-1', [], difficultyFor(BROCK), 1);
    expect(typeof encoded).toBe('number');
  }, 60_000);

  it('has a sane default queue bound', () => {
    expect(QUEUE_PER_WORKER).toBeGreaterThan(0);
  });
});
