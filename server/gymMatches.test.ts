/**
 * The lifecycle around a server-refereed gym battle.
 *
 * `gymEngine.test.ts` covers the rules of play — that the leader's moves are the server's own, that a fabricated
 * action list is refused, that turn ownership is read from the game rather than ply parity. This covers the state
 * around them: who may start a battle, what a stale or replayed request does, and how a result reaches the ladder
 * exactly once.
 *
 * The engine is faked here, deliberately. A real leader search costs 36 ms at Brock and seconds at Giovanni, so a
 * lifecycle suite built on the real one would either be slow or would quietly only ever test the shallow gyms.
 */

import { describe, expect, it, vi } from 'vitest';

import { GymMatches } from './gymMatches.ts';
import type { GymAccountOps } from './gymMatches.ts';
import type { GymEngine, StepResult } from './gymEngine.ts';
import type { Dex } from '../src/data/dex.ts';

/** A stand-in engine whose games end when told to, so the lifecycle can be driven in a millisecond. */
function fakeEngine(script: { endAfter?: number; winner?: 'white' | 'black' | 'draw' } = {}): GymEngine {
  return {
    opening: () => ({ ok: true, value: { actions: [], ended: false, winner: null, turn: 'white' } }),
    step: async (_gymId, _seed, actions, encoded): Promise<StepResult> => {
      // The player's move, then one leader reply — the shape the real engine produces.
      const next = [...actions, encoded, 9_999];
      const ended = script.endAfter !== undefined && next.length >= script.endAfter;
      return {
        ok: true,
        value: {
          actions: next,
          ended,
          winner: ended ? (script.winner ?? 'white') : null,
          turn: 'white',
        },
      };
    },
  };
}

const STANDING = { rating: 1500, badges: [] as readonly string[] };

function harness(engine: GymEngine, standing: GymAccountOps['standing'] = () => STANDING) {
  const recorded: { accountId: number; gymId: string; score: number }[] = [];
  const accounts: GymAccountOps = {
    standing,
    record: (accountId, gymId, score) => { recorded.push({ accountId, gymId, score }); return { ok: true }; },
  };
  let t = 1_000_000;
  // A counter, not a clock-derived string: two battles opened in the same tick must still get distinct ids, or
  // the second silently overwrites the first in the map and the test proves nothing.
  let n = 0;
  const gyms = new GymMatches({} as Dex, accounts, {
    engine,
    clock: () => t,
    makeId: () => `battle-${n++}`,
    makeSeed: () => 'fixed-seed',
  });
  return { gyms, recorded, advance: (ms: number) => { t += ms; } };
}

describe('starting a battle', () => {
  it('issues the seed itself, so a client cannot shop for a favourable draw', () => {
    // The seed decides BOTH armies, so a client that chose it could grid-search offline for one whose own
    // autodrafted army stomps the leader. Note `start` takes no seed at all — there is no parameter to lie in.
    const { gyms } = harness(fakeEngine());
    const r = gyms.start(1, 'boulder');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.seed).toContain('fixed-seed');
    expect(r.value.you).toBe('white');
    expect(r.value.turn).toBe('white');
    expect(r.value.actions).toEqual([]);
  });

  it('refuses a gym that is locked, before a single move is played', () => {
    // Order is the point: the old endpoint checked the gate when *recording*, so a locked gym could be played and
    // only then refused. Refusing at the start means it is never begun.
    const { gyms } = harness(fakeEngine());
    const r = gyms.start(1, 'earth');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(403);
  });

  it('refuses an unknown gym and an account with no profile', () => {
    const { gyms } = harness(fakeEngine());
    expect(gyms.start(1, 'not-a-gym').ok).toBe(false);
    expect(gyms.start(1, 42 as unknown as string).ok).toBe(false);
    const { gyms: noProfile } = harness(fakeEngine(), () => null);
    expect(noProfile.start(1, 'boulder').ok).toBe(false);
  });

  it('keeps one battle per account, so a second challenge abandons the first', () => {
    const { gyms } = harness(fakeEngine());
    const first = gyms.start(1, 'boulder');
    const second = gyms.start(1, 'boulder');
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(gyms.count()).toBe(1);
    expect(gyms.state(1, first.value.id).ok).toBe(false); // the old one is gone
    expect(gyms.state(1, second.value.id).ok).toBe(true);
  });
});

describe('playing a move', () => {
  const open = () => {
    const h = harness(fakeEngine());
    const started = h.gyms.start(1, 'boulder');
    return { ...h, id: started.ok ? started.value.id : '' };
  };

  it('returns the leader’s reply along with the player’s move', async () => {
    const { gyms, id } = open();
    const r = await gyms.move(1, id, 0, 1234);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.actions).toEqual([1234, 9_999]);
  });

  it('refuses a stale or replayed ply, so a retry cannot buy a second leader search', async () => {
    // The concurrency guard matters more here than for PvP: every accepted move costs the server a real search.
    const { gyms, id } = open();
    expect((await gyms.move(1, id, 0, 1234)).ok).toBe(true);
    const replayed = await gyms.move(1, id, 0, 1234);
    expect(replayed.ok).toBe(false);
    expect(!replayed.ok && replayed.status).toBe(409);
  });

  it('refuses a malformed encoding', async () => {
    const { gyms, id } = open();
    for (const bad of [-1, 1.5, 2 ** 30]) {
      const r = await gyms.move(1, id, 0, bad);
      expect(r.ok, `${bad}`).toBe(false);
    }
  });

  it('will not let one account touch another’s battle, and does not confirm it exists', async () => {
    const { gyms, id } = open();
    const other = await gyms.move(2, id, 0, 1234);
    expect(other.ok).toBe(false);
    // 404 rather than 403: a different answer would confirm the id is real.
    expect(!other.ok && other.status).toBe(404);
    expect(gyms.state(2, id).ok).toBe(false);
  });

  it('refuses moves once the battle is over', async () => {
    const h = harness(fakeEngine({ endAfter: 2, winner: 'white' }));
    const started = h.gyms.start(1, 'boulder');
    const id = started.ok ? started.value.id : '';
    expect((await h.gyms.move(1, id, 0, 1234)).ok).toBe(true);
    const after = await h.gyms.move(1, id, 2, 1234);
    expect(after.ok).toBe(false);
    expect(!after.ok && after.status).toBe(409);
  });
});

describe('recording the result', () => {
  const finish = async (winner: 'white' | 'black' | 'draw') => {
    const h = harness(fakeEngine({ endAfter: 2, winner }));
    const started = h.gyms.start(1, 'boulder');
    const id = started.ok ? started.value.id : '';
    const r = await h.gyms.move(1, id, 0, 1234);
    return { ...h, id, view: r.ok ? r.value : null };
  };

  it('scores the engine’s verdict, not anybody’s claim', async () => {
    expect((await finish('white')).recorded).toEqual([{ accountId: 1, gymId: 'boulder', score: 1 }]);
    expect((await finish('black')).recorded).toEqual([{ accountId: 1, gymId: 'boulder', score: 0 }]);
    expect((await finish('draw')).recorded).toEqual([{ accountId: 1, gymId: 'boulder', score: 0.5 }]);
  });

  it('settles exactly once, however many times the end is reached', async () => {
    const { gyms, recorded, id } = await finish('white');
    await gyms.move(1, id, 2, 1234);
    await gyms.move(1, id, 2, 1234);
    expect(recorded).toHaveLength(1);
  });

  it('reports the outcome on the battle so the client can show it', async () => {
    const { view } = await finish('white');
    expect(view?.status).toBe('over');
    expect(view?.outcome).toBe('white');
  });

  it('records nothing for an abandoned battle', async () => {
    const { gyms, recorded, id } = (() => {
      const h = harness(fakeEngine());
      const started = h.gyms.start(1, 'boulder');
      return { ...h, id: started.ok ? started.value.id : '' };
    })();
    await gyms.move(1, id, 0, 1234);
    expect(gyms.abandon(1, id)).toBe(true);
    expect(recorded).toEqual([]);
    expect(gyms.count()).toBe(0);
    // And not somebody else's to abandon.
    const again = harness(fakeEngine());
    const other = again.gyms.start(5, 'boulder');
    expect(again.gyms.abandon(6, other.ok ? other.value.id : '')).toBe(false);
  });
});

describe('housekeeping', () => {
  it('reclaims an idle battle so a walked-away game does not sit in memory forever', () => {
    const { gyms, advance } = harness(fakeEngine());
    gyms.start(1, 'boulder');
    expect(gyms.count()).toBe(1);
    advance(61 * 60 * 1000);
    gyms.start(2, 'boulder'); // start() prunes
    expect(gyms.count()).toBe(1);
  });

  it('never asks the engine for a move it was not owed', async () => {
    // A guard against paying for a search on a request that should have been refused outright.
    const engine = fakeEngine();
    const spy = vi.spyOn(engine, 'step');
    const h = harness(engine);
    const started = h.gyms.start(1, 'boulder');
    const id = started.ok ? started.value.id : '';
    await h.gyms.move(1, id, 99, 1234); // stale ply
    await h.gyms.move(2, id, 0, 1234); // not their battle
    await h.gyms.move(1, id, 0, -5); // malformed
    expect(spy).not.toHaveBeenCalled();
  });
});
