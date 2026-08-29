import { describe, expect, it } from 'vitest';

import { Matches } from './matches.ts';
import type { EndInfo } from './matches.ts';

/** A Matches with a hand-cranked clock, so timeouts are tested without waiting. */
function harness(onEnd?: (i: EndInfo) => void) {
  let t = 0;
  let n = 0;
  const m = new Matches(() => t, () => `id${n++}`, undefined, onEnd);
  return { m, advance: (ms: number) => { t += ms; } };
}

const white = { accountId: 1, name: 'W' };
const black = { accountId: 2, name: 'B' };

/** A paired, in-progress matchmaking room. */
function paired(h: ReturnType<typeof harness>) {
  const a = h.m.enqueue(white);
  h.m.enqueue(black);
  return a.ok ? a.value.id : '';
}

describe('turn clock', () => {
  it('does not run while a room waits for an opponent', () => {
    const h = harness();
    const first = h.m.enqueue(white);
    const id = first.ok ? first.value.id : '';
    h.advance(60_000);
    const state = h.m.state(id, white.accountId);
    expect(state.ok && state.value.status).toBe('waiting');
    // Full clock intact — waiting is not thinking.
    expect(state.ok && state.value.clock.white).toBe(state.ok ? state.value.clock.black : -1);
  });

  it('debits the side on the move as time passes', () => {
    const h = harness();
    const id = paired(h);
    const before = h.m.state(id, white.accountId);
    const startWhite = before.ok ? before.value.clock.white : 0;

    h.advance(30_000);
    const after = h.m.state(id, white.accountId);
    expect(after.ok && after.value.clock.white).toBe(startWhite - 30_000);
    // Black's clock is untouched while it is not their turn.
    expect(after.ok && after.value.clock.black).toBe(before.ok ? before.value.clock.black : -1);
  });

  it('the clock switches sides when a move is made', () => {
    const h = harness();
    const id = paired(h);
    const start = h.m.state(id, white.accountId);
    const budget = start.ok ? start.value.clock.white : 0;

    h.advance(10_000);
    // Relay mode (no engine): any well-formed move appends and passes the turn.
    expect(h.m.move(id, white.accountId, 0, 1234).ok).toBe(true);
    h.advance(25_000);

    const s = h.m.state(id, white.accountId);
    // White paid exactly its own 10s and stops being charged; black is now paying its 25s.
    expect(s.ok && s.value.clock.white).toBe(budget - 10_000);
    expect(s.ok && s.value.clock.black).toBe(budget - 25_000);
  });

  it('running out of time loses the game, and the other side wins on time', () => {
    const ends: EndInfo[] = [];
    const h = harness((i) => ends.push(i));
    const id = paired(h);
    h.advance(9 * 60 * 1000); // past the per-side budget

    const s = h.m.state(id, white.accountId);
    expect(s.ok && s.value.status).toBe('over');
    expect(s.ok && s.value.outcome).toBe('black'); // white flagged
    expect(s.ok && s.value.endedBy).toBe('timeout');
    expect(s.ok && s.value.clock.white).toBe(0);
    // Ratings settle once, for the ranked (matchmaking) game.
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ winner: 'black', ranked: true });
  });

  it('a timed-out game accepts no further moves', () => {
    const h = harness();
    const id = paired(h);
    h.advance(9 * 60 * 1000);
    h.m.state(id, white.accountId); // notices the flag-fall
    expect(h.m.move(id, black.accountId, 0, 1234).ok).toBe(false);
  });

  it('records how a game ended for the other outcomes too', () => {
    const h = harness();
    const id = paired(h);
    const r = h.m.resign(id, white.accountId);
    expect(r.ok && r.value.endedBy).toBe('resign');

    const h2 = harness();
    const id2 = paired(h2);
    const o = h2.m.reportOutcome(id2, white.accountId, 'draw');
    expect(o.ok && o.value.endedBy).toBe('draw');
  });
});
