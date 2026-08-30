import { describe, expect, it } from 'vitest';

import { PokemonChess } from '../src/engine/variant.ts';
import { autodraft } from '../src/game/autodraft.ts';
import { loadDexFromDisk } from './gameDex.ts';
import { createEngineOps } from './gameValidator.ts';
import { Matches } from './matches.ts';
import type { EndInfo } from './matches.ts';

const dex = loadDexFromDisk();
const engine = createEngineOps(dex);
const validate = engine.validate;

/** A legal move's encoding for the side to move, from the game a seed produces. */
function firstLegal(seed: string, priorActions: number[] = []): { encoded: number; turn: 'white' | 'black' } {
  const setup = autodraft(dex, seed);
  let game = PokemonChess.create({ dex, position: setup.position, loadout: setup.loadout, seed });
  for (const a of priorActions) game = game.play(game.legalMoves().find((m) => m.move.encoded === a)!.move).game;
  const move = game.legalMoves()[0]!;
  return { encoded: move.move.encoded, turn: game.turn };
}

/** Plays `count` real, engine-validated actions into a room, alternating whoever is actually to move. */
function playPlies(
  m: { move: (id: string, accountId: number, ply: number, encoded: number) => unknown; state: (id: string, a: number) => unknown },
  id: string,
  seed: string,
  count: number,
): void {
  const actions: number[] = [];
  for (let i = 0; i < count; i++) {
    const { encoded, turn } = firstLegal(seed, actions);
    m.move(id, turn === 'white' ? 1 : 2, actions.length, encoded);
    actions.push(encoded);
  }
}

describe('server-side move validation', () => {
  it('loads the dex from disk (server path) with the full species set', () => {
    expect(dex.species.length).toBeGreaterThan(1000);
  });

  it('accepts a legal move for the side to move and reports it does not end the game', () => {
    const seed = 'mp-a';
    const { encoded } = firstLegal(seed);
    const r = validate(seed, [], encoded, 'white');
    expect(r.ok).toBe(true);
    expect(r.ok && r.ended).toBe(false);
  });

  it('rejects a move made out of turn', () => {
    const seed = 'mp-b';
    const { encoded } = firstLegal(seed);
    const r = validate(seed, [], encoded, 'black'); // white's turn at the start
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/turn/i);
  });

  it('rejects an illegal (unknown) move', () => {
    const seed = 'mp-c';
    const r = validate(seed, [], 0xffffff, 'white');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/illegal/i);
  });
});

describe('Matches with a validator (server-authoritative)', () => {
  function ranked(onEnd?: (i: EndInfo) => void) {
    const m = new Matches(undefined, undefined, engine, onEnd);
    const p1 = m.enqueue({ accountId: 1, name: 'A' });
    const p2 = m.enqueue({ accountId: 2, name: 'B' });
    const id = p1.ok ? p1.value.id : '';
    const seed = p2.ok ? p2.value.seed : '';
    return { m, id, seed };
  }

  it('accepts a legal move and rejects an illegal one over the wire', () => {
    const { m, id, seed } = ranked();
    const { encoded } = firstLegal(seed);
    expect(m.move(id, 1, 0, encoded).ok).toBe(true);        // White's legal opener
    expect(m.move(id, 1, 1, 999999).ok).toBe(false);         // White again, out of turn + illegal
    const black = firstLegal(seed, [encoded]);
    expect(m.move(id, 2, 1, black.encoded).ok).toBe(true);   // Black's legal reply
  });

  it('settles ratings once when a resignation follows a real game', () => {
    const ends: EndInfo[] = [];
    const { m, id, seed } = ranked((i) => ends.push(i));
    playPlies(m, id, seed, 10); // a resignation only rates once a game has actually been played
    m.resign(id, 2); // Black resigns → White wins
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ whiteId: 1, blackId: 2, winner: 'white', ranked: true });
    // A second end event does not fire.
    m.reportOutcome(id, 1, 'white');
    expect(ends).toHaveLength(1);
  });

  it('does not rate a resignation with no game behind it', () => {
    // The faucet this closes: two accounts queue into each other and the "loser" resigns immediately, banking
    // real Elo, team XP and two encounter rolls for nothing. The game still ends — it just ends unrated.
    const ends: EndInfo[] = [];
    const { m, id } = ranked((i) => ends.push(i));
    const r = m.resign(id, 2);
    expect(r.ok && r.value.status).toBe('over');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ winner: 'white', ranked: false });
  });

  it('ignores a client-reported outcome entirely when it can compute one', () => {
    // Before: any seated player could POST their own side as the winner on move one and the server settled
    // ratings on it (measured 1500/1500 -> 1476/1524). The server ends terminal positions itself, so the report
    // is redundant rather than merely unverified.
    const ends: EndInfo[] = [];
    const { m, id } = ranked((i) => ends.push(i));
    const r = m.reportOutcome(id, 2, 'black'); // Black claims a win, zero moves played
    expect(r.ok).toBe(true); // the honest client posts this once; it is accepted and ignored
    expect(r.ok && r.value.status).toBe('playing'); // the game is untouched
    expect(r.ok && r.value.outcome).toBeNull();
    expect(ends).toHaveLength(0); // and no rating moved
  });

  it('a private (friendly) game is not ranked', () => {
    const ends: EndInfo[] = [];
    const m = new Matches(undefined, undefined, engine, (i) => ends.push(i));
    const created = m.createPrivate({ accountId: 1, name: 'A' });
    const code = created.ok ? created.value.code! : '';
    const joined = m.joinByCode(code, { accountId: 2, name: 'B' });
    const id = joined.ok ? joined.value.id : '';
    m.resign(id, 1);
    expect(ends[0]).toMatchObject({ ranked: false });
  });
});
