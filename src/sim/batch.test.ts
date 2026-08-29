import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import type { Difficulty } from '../ai/search.ts';
import { runBatch } from './batch.ts';

const dex = await Dex.load();

const SIGHTED: Difficulty = { name: 'Sighted', depth: 1, typeBlindness: 0 };
const BLIND: Difficulty = { name: 'Blind', depth: 1, typeBlindness: 0.85 };

/**
 * A simulation budget, not a unit-test one.
 *
 * Each of these plays five or six complete games, so the file needs seconds rather than the 5 ms-to-ms scale
 * vitest's 5 s default is sized for. It used to fit by luck; the game has since grown deeper (more actions per
 * turn, so longer games), the file drifted to ~8-10 s of test time, and whichever test happened to be slowest
 * on a given run tipped over the default — a coin-flip failure in about half of runs, which is worse than an
 * honest failure because it reads as noise. The assertions here are bookkeeping invariants and do not depend on
 * how long a game runs, so the fix is the budget, not the sample.
 */
describe('batch simulator', { timeout: 60_000 }, () => {
  it('aggregates outcomes that sum to the game count', () => {
    const report = runBatch(dex, { games: 6, white: SIGHTED, black: SIGHTED, seed: 'sum', maxPlies: 200 });
    expect(report.whiteWins + report.blackWins + report.draws).toBe(6);
    expect(report.games).toBe(6);
    expect(report.avgPlies).toBeGreaterThan(0);
    expect(report.whiteScore).toBeGreaterThanOrEqual(0);
    expect(report.whiteScore).toBeLessThanOrEqual(1);
  });

  it('is perfectly reproducible for a given config and seed', () => {
    const cfg = { games: 5, white: SIGHTED, black: BLIND, seed: 'repro', maxPlies: 200 } as const;
    const a = runBatch(dex, cfg);
    const b = runBatch(dex, cfg);
    expect(a).toEqual(b);
  });

  it('reports progress once per game', () => {
    let calls = 0;
    let lastDone = 0;
    runBatch(dex, { games: 4, white: SIGHTED, black: SIGHTED, seed: 'prog', maxPlies: 120 }, (done, total) => {
      calls += 1;
      lastDone = done;
      expect(total).toBe(4);
    });
    expect(calls).toBe(4);
    expect(lastDone).toBe(4);
  });
});
