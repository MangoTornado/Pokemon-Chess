/**
 * A game must be able to end.
 *
 * Chess has two backstops against an endless game — the fifty-move rule and threefold repetition — and in this
 * variant *neither can ever fire*. `withTurnReturned` and `withPieceRemoved` both reset `ply`, and every action
 * that is not a plain quiet move routes through one of them: repel, rout, mutual, a redirected attack, an art cast,
 * all four transformations, and every bonus move. So `ply` and `halfmoveClock` sit pinned at zero.
 *
 * Measured before this rule existed: sixty consecutive art casts left `ply = 0`, `halfmoveClock = 0`,
 * `repetitionCount() = 1` and the game still `playing`. With Leftovers healing, such a loop does not even end by
 * attrition. So the game counts its own actions instead.
 */

import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import { autodraft } from '../game/autodraft.ts';
import { PokemonChess, ACTION_DRAW_LIMIT } from './variant.ts';

const dex = await Dex.load();

const fresh = (seed = 'progress') => {
  const setup = autodraft(dex, seed);
  return PokemonChess.create({ dex, ...setup, seed });
};

describe('the chess backstops really are dead here', () => {
  it('leaves ply and the halfmove clock pinned at zero across non-move actions', () => {
    let g = fresh();
    let acted = 0;
    for (let i = 0; i < 40; i++) {
      const art = g.legalMoves().find((m) => m.art);
      if (!art) break;
      g = g.play(art.move).game;
      acted += 1;
    }
    expect(acted, 'the fixture needs art casts to exercise this').toBeGreaterThan(10);
    expect(g.position.halfmoveClock).toBe(0);
    expect(g.position.repetitionCount()).toBe(1);
    // Which is exactly why a rule that counts actions is needed.
    expect(g.result().kind).toBe('playing');
  });
});

describe('the no-progress draw', () => {
  it('ends a game that keeps acting without ever making progress', () => {
    let g = fresh();
    let actions = 0;
    while (actions < ACTION_DRAW_LIMIT * 2) {
      const result = g.result();
      if (result.kind !== 'playing') {
        expect(result).toMatchObject({ kind: 'draw', reason: 'no-progress' });
        return;
      }
      const moves = g.legalMoves();
      if (moves.length === 0) break;
      // Deliberately avoid progress: prefer an art, then any non-capturing move.
      const stall = moves.find((m) => m.art)
        ?? moves.find((m) => !m.move.captured && m.move.cls !== 'pawn')
        ?? moves[0]!;
      g = g.play(stall.move).game;
      actions += 1;
    }
    expect.fail(`no draw after ${actions} progress-free actions`);
  });

  it('is reset by a capture, so an ordinary game never trips it', () => {
    // The counter must measure stalling, not length. A game that keeps removing pieces is making progress however
    // long it runs.
    let g = fresh('resets');
    let captures = 0;
    for (let i = 0; i < 200; i++) {
      const result = g.result();
      if (result.kind !== 'playing') {
        // Whatever ended it, it must not be the stall rule while captures were still happening.
        if (result.kind === 'draw') expect(result.reason).not.toBe('no-progress');
        break;
      }
      const moves = g.legalMoves();
      if (moves.length === 0) break;
      const capture = moves.find((m) => m.move.captured);
      const chosen = capture ?? moves[0]!;
      if (capture) captures += 1;
      g = g.play(chosen.move).game;
    }
    expect(captures, 'the fixture should have made real progress').toBeGreaterThan(3);
  });

  it('counts actions rather than plies, so a bonus-move chain cannot hide from it', () => {
    // A bonus move returns the turn without advancing ply, which is how the chess counters were escaped. Every
    // action increments this one.
    let g = fresh();
    const before = g.result();
    expect(before.kind).toBe('playing');
    let acted = 0;
    for (let i = 0; i < ACTION_DRAW_LIMIT + 5; i++) {
      const moves = g.legalMoves();
      if (moves.length === 0) break;
      const stall = moves.find((m) => m.art) ?? moves.find((m) => !m.move.captured) ?? moves[0]!;
      g = g.play(stall.move).game;
      acted += 1;
      if (g.result().kind !== 'playing') break;
    }
    expect(acted).toBeLessThanOrEqual(ACTION_DRAW_LIMIT + 1);
    expect(g.result().kind).toBe('draw');
  });
});
