import { describe, expect, it } from 'vitest';

import { Matches, QUICK_CHAT } from './matches.ts';
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

describe('quick chat', () => {
  it('says a phrase by index and records who said it', () => {
    const h = harness();
    const id = paired(h);
    const r = h.m.say(id, white.accountId, 0);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.chat).toHaveLength(1);
    expect(r.ok && r.value.chat[0]).toMatchObject({ side: 'white', name: 'W', phrase: 0 });
  });

  it('refuses anything outside the fixed vocabulary', () => {
    const h = harness();
    const id = paired(h);
    expect(h.m.say(id, white.accountId, -1).ok).toBe(false);
    expect(h.m.say(id, white.accountId, QUICK_CHAT.length).ok).toBe(false);
    expect(h.m.say(id, white.accountId, 'nice try' as unknown as number).ok).toBe(false);
  });

  it('refuses a non-member', () => {
    const h = harness();
    const id = paired(h);
    const r = h.m.say(id, 999, 0);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(403);
  });

  it('rate-limits, so a closed vocabulary still cannot be spammed', () => {
    const h = harness();
    const id = paired(h);
    expect(h.m.say(id, white.accountId, 0).ok).toBe(true);
    const tooSoon = h.m.say(id, white.accountId, 1);
    expect(tooSoon.ok).toBe(false);
    expect(!tooSoon.ok && tooSoon.status).toBe(429);

    // The other player is not blocked by their opponent's cooldown.
    expect(h.m.say(id, black.accountId, 1).ok).toBe(true);
    // And after the cooldown, White may speak again.
    h.advance(4000);
    expect(h.m.say(id, white.accountId, 2).ok).toBe(true);
  });

  it('keeps only recent history, so a long game cannot grow unbounded', () => {
    const h = harness();
    const id = paired(h);
    for (let i = 0; i < 40; i++) {
      h.advance(4000);
      h.m.say(id, i % 2 === 0 ? white.accountId : black.accountId, i % QUICK_CHAT.length);
    }
    const state = h.m.state(id, white.accountId);
    expect(state.ok && state.value.chat.length).toBeLessThanOrEqual(20);
  });
});
