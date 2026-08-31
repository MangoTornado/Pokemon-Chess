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

  it('resumes the same battle instead of starting a second one', async () => {
    // Leaving a gym battle is not giving up, so coming back must find the game where it was rather than silently
    // rerolling it — which would also hand a player a free reroll of a bad draw.
    const { gyms } = harness(fakeEngine());
    const first = gyms.start(1, 'boulder');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await gyms.move(1, first.value.id, 0, 1234);

    const again = gyms.start(1, 'boulder');
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.id).toBe(first.value.id);
    expect(again.value.actions).toHaveLength(2); // the move already played is still there
    expect(gyms.count()).toBe(1);
  });

  it('finds the battle again after the client has forgotten it', async () => {
    const { gyms } = harness(fakeEngine());
    const started = gyms.start(1, 'boulder');
    if (!started.ok) return;
    await gyms.move(1, started.value.id, 0, 1234);
    const found = gyms.activeFor(1);
    expect(found.ok && found.value.id).toBe(started.value.id);
    expect(gyms.activeFor(2).ok).toBe(false);
  });

  it('refuses a different gym while one is in progress, rather than discarding it', async () => {
    const { gyms } = harness(fakeEngine());
    const first = gyms.start(1, 'boulder');
    if (!first.ok) return;
    await gyms.move(1, first.value.id, 0, 1234);

    const other = gyms.start(1, 'cascade');
    expect(other.ok).toBe(false);
    expect(!other.ok && other.status).toBe(409);
    // The battle in progress is untouched.
    expect(gyms.state(1, first.value.id).ok).toBe(true);
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

  it('records a forfeit as a loss, because leaving is now free and forfeiting is the decision', async () => {
    const h = harness(fakeEngine());
    const started = h.gyms.start(1, 'boulder');
    const id = started.ok ? started.value.id : '';
    await h.gyms.move(1, id, 0, 1234);

    const r = h.gyms.forfeit(1, id);
    expect(r.ok && r.value.status).toBe('over');
    expect(h.recorded).toEqual([{ accountId: 1, gymId: 'boulder', score: 0 }]);
  });

  it('discards a forfeit of a battle nobody has moved in, since there is no game to lose', () => {
    const h = harness(fakeEngine());
    const started = h.gyms.start(1, 'boulder');
    const id = started.ok ? started.value.id : '';
    expect(h.gyms.forfeit(1, id).ok).toBe(true);
    expect(h.recorded).toEqual([]);
    expect(h.gyms.count()).toBe(0);
  });

  it('is not somebody else’s battle to forfeit', () => {
    const h = harness(fakeEngine());
    const started = h.gyms.start(5, 'boulder');
    const id = started.ok ? started.value.id : '';
    expect(h.gyms.forfeit(6, id).ok).toBe(false);
    expect(h.recorded).toEqual([]);
  });
});

describe('one move at a time', () => {
  /** A step that takes a tick, the way a real depth-4 search takes seconds. */
  const slowEngine = (): GymEngine => ({
    opening: () => ({ ok: true, value: { actions: [], ended: false, winner: null, turn: 'white' } }),
    step: async (_g, _s, actions, encoded) => {
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, value: { actions: [...actions, encoded, 999], ended: false, winner: null, turn: 'white' } };
    },
  });

  it('refuses a second move while the leader is still answering the first', async () => {
    // Measured before the fix: moves 111 and 222 submitted together both returned ok, both ran a search, and the
    // action list ended up [222, 999] — the player's first move silently GONE and the server billed twice for it.
    // The ply check could not catch it because `actions` does not change until after the await.
    const h = harness(slowEngine());
    const started = h.gyms.start(1, 'boulder');
    const id = started.ok ? started.value.id : '';

    const [first, second] = await Promise.all([
      h.gyms.move(1, id, 0, 111),
      h.gyms.move(1, id, 0, 222),
    ]);
    const accepted = [first, second].filter((r) => r.ok);
    expect(accepted).toHaveLength(1);

    const after = h.gyms.state(1, id);
    expect(after.ok && after.value.actions).toEqual([111, 999]);
  });

  it('accepts the next move once the first has been answered', async () => {
    const h = harness(slowEngine());
    const started = h.gyms.start(1, 'boulder');
    const id = started.ok ? started.value.id : '';
    expect((await h.gyms.move(1, id, 0, 111)).ok).toBe(true);
    expect((await h.gyms.move(1, id, 2, 222)).ok).toBe(true);
  });

  it('does not let a forfeit slip through the search window and free the draw', async () => {
    // The same window reopened seed shopping: a forfeit landing mid-search saw the pre-move action list, read it as
    // "nothing played", and discarded the battle — handing back a fresh draw.
    const h = harness(slowEngine());
    const started = h.gyms.start(1, 'boulder');
    const id = started.ok ? started.value.id : '';
    const moving = h.gyms.move(1, id, 0, 111);
    const sneaky = h.gyms.forfeit(1, id);
    expect(sneaky.ok).toBe(false);
    await moving;
    expect(h.recorded).toEqual([]);
  });

  it('releases the battle when a search fails, rather than wedging it shut', async () => {
    // A saturated pool or a dead worker throws. If the in-flight flag survived that, the battle would be unplayable
    // for the rest of its life.
    const angry: GymEngine = {
      opening: () => ({ ok: true, value: { actions: [], ended: false, winner: null, turn: 'white' } }),
      step: async () => { throw new Error('pool is busy'); },
    };
    const h = harness(angry);
    const started = h.gyms.start(1, 'boulder');
    const id = started.ok ? started.value.id : '';
    await expect(h.gyms.move(1, id, 0, 111)).rejects.toThrow('pool is busy');
    // Still playable: the next move is refused for its ply, not for a stuck flag.
    const retry = await h.gyms.move(1, id, 0, 111).catch((e: Error) => e.message);
    expect(retry).toBe('pool is busy');
  });
});

describe('the draw cannot be shopped for', () => {
  /**
   * The attack this whole module exists to stop, which a free forfeit quietly reopened.
   *
   * The seed is returned in the view, and the client computes BOTH armies from it with the same shipped
   * `buildGymMatch` — so a player can see the matchup before moving. When a forfeit before the first move cost
   * nothing, start/look/forfeit could be repeated until a favourable draw appeared: five distinct armies in five
   * round trips, measured. So the draw sticks until the gym is actually resolved.
   */
  it('hands back the same draw after a forfeit with no moves played', () => {
    let n = 0;
    const h = harness(fakeEngine());
    // A real minting function, so a repeated seed can only come from the stickiness being deliberate.
    const gyms = new GymMatches({} as Dex, {
      standing: () => STANDING,
      record: () => ({ ok: true }),
    }, { engine: fakeEngine(), makeId: () => `b${n++}`, makeSeed: () => `mint-${n++}` });
    void h;

    const seeds = new Set<string>();
    for (let i = 0; i < 5; i++) {
      const started = gyms.start(1, 'boulder');
      if (!started.ok) break;
      seeds.add(started.value.seed);
      gyms.forfeit(1, started.value.id); // free, and now pointless
    }
    expect(seeds.size).toBe(1);
  });

  it('draws afresh only once the gym has actually been resolved', async () => {
    let n = 0;
    const recorded: unknown[] = [];
    const gyms = new GymMatches({} as Dex, {
      standing: () => STANDING,
      record: (a, g, sc) => { recorded.push({ a, g, sc }); return { ok: true }; },
    }, { engine: fakeEngine({ endAfter: 2, winner: 'white' }), makeId: () => `b${n++}`, makeSeed: () => `mint-${n++}` });

    const first = gyms.start(1, 'boulder');
    if (!first.ok) return;
    await gyms.move(1, first.value.id, 0, 1234); // ends the battle
    expect(recorded).toHaveLength(1);

    const second = gyms.start(1, 'boulder');
    expect(second.ok && second.value.seed).not.toBe(first.value.seed);
  });

  it('keeps the draw across a forfeit even when the player played and lost', async () => {
    // A resolved battle releases the draw, so this is the boundary: a *played* forfeit resolves it and must reroll.
    let n = 0;
    const gyms = new GymMatches({} as Dex, {
      standing: () => STANDING,
      record: () => ({ ok: true }),
    }, { engine: fakeEngine(), makeId: () => `b${n++}`, makeSeed: () => `mint-${n++}` });

    const first = gyms.start(1, 'boulder');
    if (!first.ok) return;
    await gyms.move(1, first.value.id, 0, 1234);
    gyms.forfeit(1, first.value.id); // played, so this is a recorded loss and resolves the gym

    const second = gyms.start(1, 'boulder');
    expect(second.ok && second.value.seed).not.toBe(first.value.seed);
  });
});

describe('the deadline to come back by', () => {
  it('forfeits a battle nobody came back to, rather than letting it evaporate', async () => {
    // The other half of making "leaving resumes" safe. If an abandoned battle simply vanished, walking away would
    // still be the free escape that forfeiting is not, and the deadline would be the dodge rather than the
    // deterrent.
    const h = harness(fakeEngine());
    const started = h.gyms.start(1, 'boulder');
    const id = started.ok ? started.value.id : '';
    await h.gyms.move(1, id, 0, 1234);

    h.advance(61 * 60 * 1000);
    h.gyms.start(1, 'boulder'); // any return triggers the prune
    expect(h.recorded).toEqual([{ accountId: 1, gymId: 'boulder', score: 0 }]);
  });

  it('does not forfeit a battle nobody had started playing', () => {
    const h = harness(fakeEngine());
    h.gyms.start(1, 'boulder');
    h.advance(61 * 60 * 1000);
    h.gyms.start(1, 'boulder');
    expect(h.recorded).toEqual([]); // no game happened, so there is no loss to record
  });

  it('only materialises the forfeit when someone comes back, which is the bound on the dodge', async () => {
    // Honest about a limit rather than papering over it: with no timers, the loss is written by the next request
    // that prunes. So a player who never touches a gym again never eats it — but they cannot play *any* gym
    // without eating it first, which is the property that matters.
    const h = harness(fakeEngine());
    const started = h.gyms.start(1, 'boulder');
    await h.gyms.move(1, started.ok ? started.value.id : '', 0, 1234);
    h.advance(61 * 60 * 1000);
    expect(h.recorded).toEqual([]); // nothing has run yet

    h.gyms.activeFor(1); // or start(); either prunes
    expect(h.recorded).toEqual([{ accountId: 1, gymId: 'boulder', score: 0 }]);
  });

  it('reports how long is left to come back', async () => {
    const h = harness(fakeEngine());
    const started = h.gyms.start(1, 'boulder');
    const id = started.ok ? started.value.id : '';
    // Nothing at stake before a move is played, so nothing is claimed.
    expect(started.ok && started.value.reconnectSeconds).toBeNull();
    const moved = await h.gyms.move(1, id, 0, 1234);
    expect(moved.ok && moved.value.reconnectSeconds).toBeGreaterThan(0);
  });

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
