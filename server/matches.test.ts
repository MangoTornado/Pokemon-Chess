import { describe, expect, it } from 'vitest';

import { Matches } from './matches.ts';
import { MAX_ENCODED_MOVE } from '../src/engine/position.ts';

/** A Matches with a controllable clock and deterministic ids, so tests are not time- or luck-dependent. */
function make() {
  let t = 1000;
  let n = 0;
  const m = new Matches(() => t, () => `id${n++}`);
  return { m, tick: (ms: number) => { t += ms; }, now: () => t };
}

const alice = { accountId: 1, name: 'Alice' };
const bob = { accountId: 2, name: 'Bob' };
const carol = { accountId: 3, name: 'Carol' };

describe('matchmaking queue', () => {
  it('pairs the second player with the first', () => {
    const { m } = make();
    const first = m.enqueue(alice);
    expect(first.ok && first.value.status).toBe('waiting');
    expect(first.ok && first.value.you).toBe('white');

    const second = m.enqueue(bob);
    expect(second.ok && second.value.status).toBe('playing');
    expect(second.ok && second.value.you).toBe('black');
    expect(second.ok && second.value.white).toBe('Alice');
    expect(second.ok && second.value.black).toBe('Bob');
    // Same room for both.
    if (first.ok && second.ok) expect(second.value.id).toBe(first.value.id);
  });

  it('does not pair a player with themselves', () => {
    const { m } = make();
    const a = m.enqueue(alice);
    const b = m.enqueue(alice); // same account re-queues
    if (a.ok && b.ok) expect(a.value.id).toBe(b.value.id);
    expect(b.ok && b.value.status).toBe('waiting');
  });

  it('cancelling the queue frees the slot', () => {
    const { m } = make();
    m.enqueue(alice);
    m.cancelQueue(alice.accountId);
    const bobQ = m.enqueue(bob);
    // Bob opens a fresh waiting room rather than joining Alice's cancelled one.
    expect(bobQ.ok && bobQ.value.status).toBe('waiting');
    expect(bobQ.ok && bobQ.value.you).toBe('white');
  });
});

describe('private rooms', () => {
  it('creates a code and lets a friend join by it', () => {
    const { m } = make();
    const created = m.createPrivate(alice);
    expect(created.ok).toBe(true);
    const code = created.ok ? created.value.code! : '';
    expect(code).toMatch(/^[A-Z0-9]{6}$/);

    const joined = m.joinByCode(code.toLowerCase(), bob); // case-insensitive
    expect(joined.ok && joined.value.status).toBe('playing');
    expect(joined.ok && joined.value.you).toBe('black');
  });

  it('rejects an unknown code and a full room', () => {
    const { m } = make();
    const created = m.createPrivate(alice);
    const code = created.ok ? created.value.code! : '';
    expect(m.joinByCode('ZZZZZZ', bob).ok).toBe(false);
    m.joinByCode(code, bob);
    const third = m.joinByCode(code, carol);
    expect(third.ok).toBe(false);
    expect(!third.ok && third.status).toBe(409);
  });

  it('lets a member reconnect by code without taking a new seat', () => {
    const { m } = make();
    const created = m.createPrivate(alice);
    const code = created.ok ? created.value.code! : '';
    const rejoin = m.joinByCode(code, alice);
    expect(rejoin.ok && rejoin.value.you).toBe('white');
  });
});

describe('moves', () => {
  function playing() {
    const { m } = make();
    const created = m.createPrivate(alice);
    const id = created.ok ? created.value.id : '';
    m.joinByCode(created.ok ? created.value.code! : '', bob);
    return { m, id };
  }

  it('appends moves in order and rejects a stale ply', () => {
    const { m, id } = playing();
    expect(m.move(id, alice.accountId, 0, 1234).ok).toBe(true);
    // A second submit at ply 0 is stale (a duplicate/race).
    const stale = m.move(id, bob.accountId, 0, 5678);
    expect(stale.ok).toBe(false);
    expect(!stale.ok && stale.status).toBe(409);
    // Correct next ply appends.
    const good = m.move(id, bob.accountId, 1, 5678);
    expect(good.ok && good.value.actions.length).toBe(2);
    expect(good.ok && good.value.actions).toEqual([1234, 5678]);
  });

  it('refuses a non-member', () => {
    const { m, id } = playing();
    const res = m.move(id, carol.accountId, 0, 1);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.status).toBe(403);
  });

  it('rejects a malformed encoded move', () => {
    const { m, id } = playing();
    expect(m.move(id, alice.accountId, 0, -1).ok).toBe(false);
    // Not 0xffffff + 1: that is exactly MOVE_CASTLE_QUEEN, a real action. Bounding the encoding by hand is
    // what broke it, so the ceiling to test against is the derived one.
    expect(m.move(id, alice.accountId, 0, MAX_ENCODED_MOVE + 1).ok).toBe(false);
    expect(m.move(id, alice.accountId, 0, 1.5).ok).toBe(false);
  });

  it('resign hands the win to the other side and stops further moves', () => {
    const { m, id } = playing();
    const r = m.resign(id, alice.accountId);
    expect(r.ok && r.value.outcome).toBe('black');
    expect(r.ok && r.value.status).toBe('over');
    expect(m.move(id, bob.accountId, 0, 1).ok).toBe(false);
  });

  it('reportOutcome is idempotent — first report wins, and the second is refused', () => {
    // Relay mode (no engine), where a client report is the only way a game can end. The first one decides it;
    // a later contradicting report is now rejected outright rather than quietly ignored, so a loser cannot
    // overwrite the record and nobody has to rely on finalizeEnd's once-only guard for correctness.
    const { m, id } = playing();
    expect(m.reportOutcome(id, alice.accountId, 'white').ok).toBe(true);
    const second = m.reportOutcome(id, bob.accountId, 'black');
    expect(second.ok).toBe(false);
    expect(!second.ok && second.status).toBe(409);
    const state = m.state(id, alice.accountId);
    expect(state.ok && state.value.outcome).toBe('white');
  });
});

describe('pruning', () => {
  it('reclaims an abandoned waiting room after the queue TTL', () => {
    const { m, tick } = make();
    m.enqueue(alice);
    tick(6 * 60 * 1000); // past QUEUE_TTL_MS
    // A new enqueue prunes the stale room and opens a fresh one.
    const bobQ = m.enqueue(bob);
    expect(bobQ.ok && bobQ.value.status).toBe('waiting');
    expect(m.count()).toBe(1);
  });
});
