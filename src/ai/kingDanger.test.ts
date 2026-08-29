/**
 * King safety must actually reach the evaluation.
 *
 * The regression this pins was silent and total: both king-safety terms were guarded by `game.turn === side`,
 * but `kingInDanger(x)` itself requires that it be x's *opponent* to move — it asks "can the mover take x's
 * king", which is only answerable then. Each guard therefore demanded the opposite of what the call demanded,
 * so both conditions were unsatisfiable and the search never valued an immediate king-capture threat at all,
 * despite king safety being the term the whole king-capture design rests on.
 *
 * A test asserting "the bonus is applied" would have passed against the broken code by never exercising it, so
 * these assert on the *difference* a live threat makes, and on the direction of the sign.
 */

import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import type { BattleType } from '../data/schema.ts';
import { squareName } from '../engine/board.ts';
import { Position } from '../engine/position.ts';
import { PokemonChess } from '../engine/variant.ts';
import type { Loadout, PokemonLoadout, Side } from '../engine/variant.ts';
import { evaluate } from './evaluate.ts';

const dex = await Dex.load();

/** Every piece gets a big, accurate Normal attack so a king capture is never refused for typing reasons. */
function gameFrom(fen: string): PokemonChess {
  const position = Position.fromFen(fen);
  const slot = {
    id: 'kd', name: 'Strike', type: 'Normal' as BattleType, category: 'Physical' as const, basePower: 150,
  };
  const loadout = new Map<number, PokemonLoadout>();
  for (const { piece } of position.allPieces()) {
    loadout.set(piece.id, {
      species: 'machamp',
      type: 'Normal',
      moves: [slot, slot, slot, slot] as NonNullable<PokemonLoadout['moves']>,
    });
  }
  return PokemonChess.create({
    dex, position, loadout: loadout as Loadout, seed: 'king-danger', rules: { critCoins: 0 },
  });
}

// Black king on a8 with a white rook directly below on a7: the rook can take the king.
const ROOK_ON_KING = 'k7/R7/8/8/8/8/8/7K w - - 0 1';
// The same material, with the rook stepped off the a-file so it attacks nothing. Same pieces on both boards, so
// every material term cancels and only king safety can move the score.
const SAFE = 'k7/8/1R6/8/8/8/8/7K w - - 0 1';

describe('kingInDanger reaches the evaluation', () => {
  it('is answerable about the waiting side, and false about the mover', () => {
    const g = gameFrom(ROOK_ON_KING);
    // The contract that the old guards got backwards: it describes the side NOT on the clock.
    expect(g.turn).toBe('white');
    expect(g.kingInDanger('white')).toBe(false); // the mover cannot capture its own king
    expect(g.kingInDanger('black')).toBe(true); // black's king is en prise to the mover
  });

  it('scores a live king threat far above any material term', () => {
    const threatened = gameFrom(ROOK_ON_KING);
    const safe = gameFrom(SAFE);
    // Same pieces on both boards, so material cancels and only king safety can differ.
    const swing = evaluate(threatened, 'white') - evaluate(safe, 'white');
    expect(swing).toBeGreaterThan(500);
  });

  it('signs the threat the same way for both sides', () => {
    const g = gameFrom(ROOK_ON_KING);
    // Good for the side about to take a king, bad for the side about to lose one.
    expect(evaluate(g, 'white')).toBeGreaterThan(0);
    expect(evaluate(g, 'black')).toBeLessThan(0);
  });

  it('never credits both sides at once', () => {
    // The two terms are mutually exclusive by construction, since they require opposite sides to be on the
    // clock. That property is what the (broken) turn guards were reaching for, so it is worth pinning.
    for (const fen of [ROOK_ON_KING, SAFE]) {
      const g = gameFrom(fen);
      const both = (['white', 'black'] as Side[]).filter((s) => g.kingInDanger(s));
      expect(both.length, `${fen} -> ${both.map(String).join(',')}`).toBeLessThanOrEqual(1);
    }
  });

  it('names a real square, so the board banner has something true to show', () => {
    const g = gameFrom(ROOK_ON_KING);
    const waiting: Side = g.turn === 'white' ? 'black' : 'white';
    expect(g.kingInDanger(waiting)).toBe(true);
    const king = g.position.allPieces().find((p) => p.piece.cls === 'king' && p.piece.side === waiting);
    expect(king, 'the endangered side should still have a king to warn about').toBeDefined();
    expect(squareName(king!.square)).toBe('a8');
  });
});
