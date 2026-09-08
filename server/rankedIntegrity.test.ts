/**
 * Ranked progression must come from games the server can account for.
 *
 * Two endpoints were minting real progression from request bodies alone, and both are the same mistake made
 * twice: a value the client chose was treated as a fact the server had established.
 *
 * - `/outcome` let a seated player declare the winner. Measured before the fix: 1500/1500 -> 1476/1524 off one
 *   request with an empty action list, plus team XP and an encounter roll.
 * - `/api/ladder/result` took `opponentRating` straight from the body (range-checked only to [100, 4000]) and
 *   awarded a gym badge for any `gymId`, ignoring canon order and the rating gates the UI displays.
 *
 * The guiding rule these tests pin is "rate what the server can prove": a flag-fall is proved by its own clock
 * and a king capture by its own replay, so those rate freely; a resignation and a relay-mode client report
 * cannot be proved at all, so they need a real game behind them.
 */

import { describe, expect, it } from 'vitest';

import { Accounts } from './accounts.ts';
import { Db } from './db.ts';
import { Matches } from './matches.ts';
import { GYM_BY_ID } from '../src/ladder/badges.ts';

const make = () => new Accounts(new Db(':memory:'));

async function signedUp(accounts: Accounts, username: string) {
  const r = await accounts.register({ username, password: 'a-long-enough-password' });
  if (!r.ok) throw new Error('registration failed');
  return accounts.accountForToken(r.value.token)!;
}

describe('the ladder endpoint derives its own numbers', () => {
  it('refuses a result with no gym named', async () => {
    // A PvP result arrives through recordHeadToHead, driven by the server's own match state. An unnamed
    // opponent here has no legitimate source, so it is the shape the rating faucet took.
    const accounts = make();
    const id = await signedUp(accounts, 'nogym');
    const r = accounts.recordLadderResult(id, { score: 1 });
    expect(r.ok).toBe(false);
  });

  it('ignores any rating the caller tries to supply', async () => {
    const accounts = make();
    const id = await signedUp(accounts, 'inflater');
    const before = accounts.publicProfile(id)!.rating;
    // The old exploit: opponentRating 4000 for a huge Elo gain. The field is not even read now.
    const r = accounts.recordLadderResult(id, { score: 1, gymId: 'boulder', opponentRating: 4000 } as never);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The gain must match Brock's own rating (1300), so beating a weaker opponent is worth little.
    const expected = accounts.publicProfile(id)!.rating;
    expect(expected).toBeGreaterThan(before);
    expect(expected - before).toBeLessThan(20);
  });

  it('refuses a gym that is locked, so badges cannot be collected out of order', async () => {
    const accounts = make();
    const id = await signedUp(accounts, 'skipper');
    // Giovanni last, and gated well above a new account's starting rating.
    expect(GYM_BY_ID.get('earth')!.ratingRequired).toBeGreaterThan(accounts.publicProfile(id)!.rating);
    const r = accounts.recordLadderResult(id, { score: 1, gymId: 'earth' });
    expect(r.ok).toBe(false);
    expect(accounts.publicProfile(id)!.badges).toHaveLength(0);
  });

  it('cannot be looped to collect every badge', async () => {
    const accounts = make();
    const id = await signedUp(accounts, 'farmer');
    for (const gymId of [...GYM_BY_ID.keys()]) {
      for (let i = 0; i < 3; i++) accounts.recordLadderResult(id, { score: 1, gymId });
    }
    const badges = accounts.publicProfile(id)!.badges;
    // The first gym is open at the starting rating by design; the rest are gated behind real rating gains, and
    // a rematch of one already beaten moves nothing, so a loop cannot walk up the ladder.
    expect(badges.length).toBeLessThan(8);
  });

  it('still awards the first gym, which is meant to be reachable immediately', async () => {
    const accounts = make();
    const id = await signedUp(accounts, 'brockslayer');
    expect(accounts.recordLadderResult(id, { score: 1, gymId: 'boulder' }).ok).toBe(true);
    expect(accounts.publicProfile(id)!.badges).toContain('boulder');
  });
});

describe('a ranked room only settles what it can account for', () => {
  const seat = (n: number) => ({ accountId: n, name: `P${n}` });

  /** A paired matchmaking room in relay mode (no engine), with the end events captured. */
  function relayRoom() {
    const ends: { winner: string; ranked: boolean }[] = [];
    const m = new Matches(undefined, undefined, undefined, (i) => ends.push({ winner: i.winner, ranked: i.ranked }));
    const first = m.enqueue(seat(1));
    m.enqueue(seat(2));
    return { m, ends, id: first.ok ? first.value.id : '' };
  }

  it('does not rate a relay-mode client report with no game behind it', () => {
    const { m, ends, id } = relayRoom();
    expect(m.reportOutcome(id, 2, 'black').ok).toBe(true);
    expect(ends).toEqual([{ winner: 'black', ranked: false }]);
  });

  it('refuses a report on a game that is not in progress', () => {
    const { m, id } = relayRoom();
    m.reportOutcome(id, 1, 'white');
    const again = m.reportOutcome(id, 2, 'black');
    expect(again.ok).toBe(false);
    expect(!again.ok && again.status).toBe(409);
  });

  it('refuses a resignation on a game that is not in progress', () => {
    const { m, id } = relayRoom();
    m.resign(id, 1);
    const again = m.resign(id, 2);
    expect(again.ok).toBe(false);
    expect(!again.ok && again.status).toBe(409);
  });
});

describe('private rooms close when their creator leaves', () => {
  const seat = (n: number) => ({ accountId: n, name: `P${n}` });

  it('abandon closes the room and retires its join code', () => {
    const m = new Matches();
    const created = m.createPrivate(seat(1));
    const code = created.ok ? created.value.code! : '';
    const id = created.ok ? created.value.id : '';

    expect(m.abandon(id, 1)).toBe(true);
    // The bug: the code stayed live, so a friend could walk into a game its creator had left.
    expect(m.joinByCode(code, seat(2)).ok).toBe(false);
    expect(m.state(id, 1).ok).toBe(false);
  });

  it('will not let a non-creator abandon someone else’s room', () => {
    const m = new Matches();
    const created = m.createPrivate(seat(1));
    const id = created.ok ? created.value.id : '';
    expect(m.abandon(id, 99)).toBe(false);
    expect(m.state(id, 1).ok).toBe(true);
  });

  it('will not resurrect a finished room into a game that can never end', () => {
    // joinByCode had no status check, so a code could flip an 'over' room back to 'playing' while `ended`
    // stayed true — and since every ending early-returns on that flag, the game could then never end again.
    const m = new Matches();
    const created = m.createPrivate(seat(1));
    const code = created.ok ? created.value.code! : '';
    const id = created.ok ? created.value.id : '';
    m.joinByCode(code, seat(2));
    m.resign(id, 1);
    const ended = m.state(id, 1);
    expect(ended.ok && ended.value.status).toBe('over');

    const third = m.joinByCode(code, seat(3));
    expect(third.ok).toBe(false);
    const after = m.state(id, 1);
    expect(after.ok && after.value.status).toBe('over');
  });

  it('issues join codes that are not predictable from previous ones', () => {
    // The code is the only credential on a private room, so it must not come from a recoverable PRNG.
    const m = new Matches();
    const codes = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const r = m.createPrivate(seat(i + 1));
      if (r.ok && r.value.code) codes.add(r.value.code);
    }
    expect(codes.size).toBe(60);
    for (const c of codes) expect(c).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });
});
