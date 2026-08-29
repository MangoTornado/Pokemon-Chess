/**
 * En passant against a board where pieces can die outside a move.
 *
 * Ordinary chess never has to think about this: the pawn that creates an en passant square cannot leave before
 * the single turn in which it can be captured. The Pokémon layer breaks that assumption, because it removes
 * pieces *between* moves — Sandstorm chip, poison, a hazard on arrival — so a pawn can double-push and then
 * die at the Checkup, leaving a target square behind it with nothing to capture.
 *
 * Found by fuzzing (seed fz177 at ply 56, immediately after a Sandstorm cast): the generator offered an
 * en passant capture of an empty square, and reading the victim's identity back gave the empty-square
 * sentinel, which crashed the variant layer with "no Pokémon assigned to piece -1".
 */

import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import { autodraft } from '../game/autodraft.ts';
import { Position } from './position.ts';
import { parseSquare } from './board.ts';
import { PokemonChess } from './variant.ts';
import { Rng } from './rng.ts';

const dex = await Dex.load();

describe('an en passant target whose pawn dies', () => {
  it('is dropped when the pawn is removed outside a move', () => {
    // White pawn on c2 pushes to c4, so c3 becomes an en passant target for the black pawn on b4.
    const pushed = Position.fromFen('4k3/8/8/8/1p6/8/2P5/4K3 w - - 0 1')
      .withMove(Position.fromFen('4k3/8/8/8/1p6/8/2P5/4K3 w - - 0 1')
        .generateMoves()
        .find((m) => m.from === parseSquare('c2') && m.to === parseSquare('c4'))!);
    expect(pushed.epSquare).toBe(parseSquare('c3'));
    expect(pushed.generateMoves().some((m) => m.isEnPassant)).toBe(true);

    // Now the pushed pawn dies where it stands, the way weather or poison kills it at a Checkup.
    const chipped = pushed.withPieceRemoved(parseSquare('c4'));
    expect(chipped.epSquare).toBeNull();
    expect(chipped.generateMoves().some((m) => m.isEnPassant)).toBe(false);
  });

  it('survives the removal of an unrelated piece', () => {
    const base = Position.fromFen('4k3/7r/8/8/1p6/8/2P5/4K3 w - - 0 1');
    const pushed = base.withMove(
      base.generateMoves().find((m) => m.from === parseSquare('c2') && m.to === parseSquare('c4'))!,
    );
    expect(pushed.epSquare).toBe(parseSquare('c3'));
    // A rook dying somewhere else has nothing to do with the en passant target.
    const after = pushed.withPieceRemoved(parseSquare('h7'));
    expect(after.epSquare).toBe(parseSquare('c3'));
    expect(after.generateMoves().some((m) => m.isEnPassant)).toBe(true);
  });

  it('never offers a capture whose victim is not on the board', () => {
    // The invariant the crash violated, checked across many random games rather than one position: every
    // capture the generator emits must name a piece that actually exists.
    for (let s = 0; s < 12; s++) {
      const seed = `ep-fuzz-${s}`;
      const setup = autodraft(dex, seed);
      let game = PokemonChess.create({ dex, ...setup, seed });
      const rng = new Rng(seed);
      for (let ply = 0; ply < 90; ply++) {
        for (const raw of game.position.generateMoves()) {
          const described = game.position.describeMove(raw.encoded);
          if (described.captured) {
            expect(described.captured.id, `${seed} ply ${ply}`).toBeGreaterThanOrEqual(0);
          }
        }
        const moves = game.legalMoves();
        if (moves.length === 0) break;
        const played = game.play(moves[rng.below(moves.length)]!.move);
        game = played.game;
        if (played.resolved.kingCaptured) break;
      }
    }
  });
});
