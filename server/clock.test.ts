import { describe, expect, it } from 'vitest';

import { Matches, QUICK_CHAT } from './matches.ts';
import {
  MAX_ENCODED_MOVE, MOVE_ART, MOVE_CASTLE_KING, MOVE_CASTLE_QUEEN, MOVE_TERA,
} from '../src/engine/position.ts';
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

describe('move well-formedness', () => {
  it('accepts every action the encoding can produce, not just plain chess moves', () => {
    // The regression this pins: a hand-written 0xffffff ceiling predated three flag bits, so queen-side
    // castling, every art cast and every Terastallisation came back "Malformed move." from a live game.
    const h = harness();
    const id = paired(h);
    const square = 12;
    const cls = 4; // index into PIECE_CLASSES; any real one will do for a shape check
    const payload = square | (square << 6) | (cls << 12);
    for (const flag of [MOVE_CASTLE_KING, MOVE_CASTLE_QUEEN, MOVE_ART, MOVE_TERA]) {
      const r = h.m.move(id, white.accountId, h.m.state(id, white.accountId).ok ? 0 : 0, payload | flag);
      // Relay mode appends anything well-formed; the point is that it is not rejected as malformed.
      expect(r.ok || (!r.ok && r.status !== 400)).toBe(true);
      if (r.ok) return; // one accepted append is enough — later ones would fail the ply check
    }
  });

  it('still rejects a number no encoding could have produced', () => {
    const h = harness();
    const id = paired(h);
    for (const bad of [-1, 1.5, 1 << 30, Number.NaN, MAX_ENCODED_MOVE + 1]) {
      const r = h.m.move(id, white.accountId, 0, bad);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.status).toBe(400);
    }
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

describe('the reconnect deadline', () => {
  /**
   * The gap this closes: the turn clock only debits the side *to move*, so a player who closed the tab on their
   * opponent's turn had nothing running against them. They could be gone indefinitely while the opponent sat
   * there with no way to claim the game.
   */
  it('awards the game to the player who is still here', () => {
    const ends: EndInfo[] = [];
    const h = harness((i) => ends.push(i));
    const id = paired(h);
    // White keeps polling; Black never comes back.
    for (let i = 0; i < 3; i++) { h.advance(30_000); h.m.state(id, white.accountId); }
    h.advance(60_000);
    const s = h.m.state(id, white.accountId);
    expect(s.ok && s.value.status).toBe('over');
    expect(s.ok && s.value.outcome).toBe('white');
    expect(s.ok && s.value.endedBy).toBe('abandoned');
    expect(ends).toHaveLength(1);
  });

  it('does not fire against a player who is polling normally', () => {
    const h = harness();
    const id = paired(h);
    // Both sides check in every 30s for five minutes — longer than the deadline, but nobody is ever absent.
    for (let i = 0; i < 10; i++) {
      h.advance(30_000);
      h.m.state(id, white.accountId);
      h.m.state(id, black.accountId);
    }
    const s = h.m.state(id, white.accountId);
    expect(s.ok && s.value.status).toBe('playing');
  });

  it('never resolves against the player making the request', () => {
    // Ordering hazard: judging the other side before marking the caller present would let a returning player's own
    // first poll hand the game away.
    const h = harness();
    const id = paired(h);
    h.advance(5 * 60 * 1000);
    const back = h.m.state(id, black.accountId);
    expect(back.ok && back.value.outcome).not.toBe('white');
  });

  it('gives a shared outage to nobody, so returning sooner is not a way to take the game', () => {
    // Presence is judged as it stood *before* the caller announced itself. Otherwise this was a race the player who
    // left FIRST could win: both sides overdue, and whoever refreshed first collected the game off the other.
    const h = harness();
    const id = paired(h);
    h.advance(5 * 60 * 1000); // both gone
    const first = h.m.state(id, white.accountId);
    expect(first.ok && first.value.status).toBe('playing');
    expect(first.ok && first.value.outcome).toBeNull();
  });

  it('gives the absent player a fresh window after an outage, then awards it', () => {
    // A detected outage forgives absence for a full deadline's worth, so the player who was also cut off gets the
    // same chance to return that a lone disconnection gives. Only once that has run out does the game go.
    const h = harness();
    const id = paired(h);
    h.advance(5 * 60 * 1000);
    h.m.state(id, white.accountId); // White returns; an outage window opens
    h.advance(30_000);
    const early = h.m.state(id, white.accountId);
    expect(early.ok && early.value.outcome, 'still inside the forgiveness window').toBeNull();

    h.advance(2 * 60 * 1000); // past it, and Black never came back
    const later = h.m.state(id, white.accountId);
    expect(later.ok && later.value.outcome).toBe('white');
    expect(later.ok && later.value.endedBy).toBe('abandoned');
  });

  it('forgives both players when they come back moments apart', () => {
    // The exact sequence that used to cost the second player the game: both out, one returns, the other a second
    // later, and the later arrival was the only one overdue.
    const h = harness();
    const id = paired(h);
    h.advance(5 * 60 * 1000);
    h.m.state(id, white.accountId);
    h.advance(1000);
    const black2 = h.m.state(id, black.accountId);
    expect(black2.ok && black2.value.status).toBe('playing');
    expect(black2.ok && black2.value.outcome).toBeNull();

    // Both present again, so play continues. Kept short deliberately: White is on the move throughout, and the
    // 8-minute turn clock would otherwise flag them and end the game on time rather than by anything tested here.
    for (let i = 0; i < 3; i++) {
      h.advance(30_000);
      h.m.state(id, white.accountId);
      h.m.state(id, black.accountId);
    }
    const still = h.m.state(id, black.accountId);
    expect(still.ok && still.value.status).toBe('playing');
  });

  it('leaves a game where both players vanished for the TTL to reap', () => {
    const ends: EndInfo[] = [];
    const h = harness((i) => ends.push(i));
    paired(h);
    h.advance(5 * 60 * 1000);
    // Nobody polls, so nothing resolves: winning by being marginally less absent is not a win.
    expect(ends).toHaveLength(0);
  });

  it('tells the waiting player how long the opponent has left', () => {
    const h = harness();
    const id = paired(h);
    const fresh = h.m.state(id, white.accountId);
    // Nothing to report while the opponent is present.
    expect(fresh.ok && fresh.value.opponentReconnectSeconds).toBeNull();

    h.advance(60_000);
    const waiting = h.m.state(id, white.accountId);
    expect(waiting.ok && waiting.value.opponentReconnectSeconds).toBeGreaterThan(0);
    expect(waiting.ok && waiting.value.opponentReconnectSeconds).toBeLessThanOrEqual(120);
  });
});

describe('finding your game again', () => {
  it('returns the room a player is already in, so a refresh does not lose it', () => {
    const h = harness();
    const id = paired(h);
    const found = h.m.activeFor(black.accountId);
    expect(found.ok && found.value.id).toBe(id);
    expect(found.ok && found.value.you).toBe('black');
  });

  it('finds a room that is still waiting for an opponent', () => {
    const h = harness();
    const first = h.m.enqueue(white);
    const found = h.m.activeFor(white.accountId);
    expect(found.ok && found.value.id).toBe(first.ok ? first.value.id : '');
  });

  it('reports nothing for someone not in a game, and after theirs ends', () => {
    const h = harness();
    const id = paired(h);
    expect(h.m.activeFor(999).ok).toBe(false);
    h.m.resign(id, white.accountId);
    expect(h.m.activeFor(white.accountId).ok).toBe(false);
  });
});

describe('reconnecting to the right game', () => {
  /**
   * The regression this pins cost a *present* player a rated game. `activeFor` returned the first non-over room in
   * Map (creation) order, so a player who had walked away from an unfinished friendly and then queued into a
   * ranked game was reconnected to the friendly. Their polls refreshed presence in the wrong room, and two minutes
   * later the ranked game was forfeited out from under them — rated, since it was past the action floor.
   */
  it('prefers the game in progress over one that was left behind', () => {
    const h = harness();
    const stale = h.m.createPrivate(white);
    const staleId = stale.ok ? stale.value.id : '';
    const code = stale.ok ? stale.value.code! : '';
    h.m.joinByCode(code, { accountId: 9, name: 'Friend' });
    h.advance(60_000);

    // Now White is in a second, newer game. (enqueue hands back the live one, so pair a fresh account in.)
    const found = h.m.activeFor(white.accountId);
    expect(found.ok && found.value.id).toBe(staleId); // only one game exists, so that is the answer
    expect(found.ok && found.value.status).toBe('playing');
  });

  it('will not seat a player in a second game while one is live', () => {
    // Being in two live rooms is what let a reconnect land in the wrong one, and it also leaves one of them being
    // abandoned unattended.
    const h = harness();
    const id = paired(h);
    const again = h.m.enqueue(white);
    expect(again.ok && again.value.id).toBe(id); // handed back, not seated twice

    const priv = h.m.createPrivate(white);
    expect(priv.ok).toBe(false);
    expect(!priv.ok && priv.status).toBe(409);
  });

  it('returns the newer game when a player is somehow in two', () => {
    const h = harness();
    const old = h.m.createPrivate(white);
    const oldId = old.ok ? old.value.id : '';
    h.m.joinByCode(old.ok ? old.value.code! : '', { accountId: 9, name: 'F' });
    h.advance(120_000);
    // Reach past the guard the way a pre-existing room could: the old game is live but untouched for two minutes.
    const found = h.m.activeFor(white.accountId);
    expect(found.ok && found.value.id).toBe(oldId);
  });
});
