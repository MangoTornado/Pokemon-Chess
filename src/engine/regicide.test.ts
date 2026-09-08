/**
 * Two Regicide rules the engine was getting wrong.
 *
 * Both are about the same principle: a king leaving the board decides the game, and nothing in orthodox chess
 * legality gets to override that.
 *
 * - **R4** (SPEC §12.2): a resolution that removes *both* kings is a win for the mover. It was scoring a draw,
 *   which the SPEC names as the exact failure — "A draw here would create a degenerate strategy" — because a
 *   losing player can always force one by trading kings in a MUTUAL.
 * - **R1**: capturing the enemy king wins immediately. While you were in check the move was filtered out as
 *   illegal, because taking the enemy king does not evade your own check. Online it was worse: the server
 *   validates against the same list, so a winning action came back "Illegal move."
 */

import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import type { BattleType } from '../data/schema.ts';
import { parseSquare, squareName } from './board.ts';
import { Position } from './position.ts';
import { PokemonChess } from './variant.ts';
import type { Loadout, PokemonLoadout } from './variant.ts';

const dex = await Dex.load();

/** Everyone hits hard and accurately, so a capture resolves rather than fizzling. */
function gameFrom(
  fen: string,
  spec: Record<string, { species: string; type: BattleType; bp?: number; recoil?: number }> = {},
) {
  const position = Position.fromFen(fen);
  const loadout = new Map<number, PokemonLoadout>();
  for (const { square, piece } of position.allPieces()) {
    const e = spec[squareName(square)] ?? { species: 'machamp', type: 'Normal' as BattleType };
    const slot = {
      id: 'r', name: 'Strike', type: e.type, category: 'Physical' as const, basePower: e.bp ?? 150,
      ...(e.recoil !== undefined ? { recoil: e.recoil } : {}),
    };
    loadout.set(piece.id, {
      species: e.species,
      type: e.type,
      moves: [slot, slot, slot, slot] as NonNullable<PokemonLoadout['moves']>,
    });
  }
  return PokemonChess.create({
    dex, position, loadout: loadout as Loadout, seed: 'regicide', rules: { critCoins: 0 },
  });
}

describe('R1: a capture of the enemy king is never illegal', () => {
  // White's king on h1 is in check from the black rook on a1 along the first rank; White's bishop on g7 attacks
  // the black king on h8. Orthodox chess offers only check evasions, so the winning capture was filtered away.
  const FEN = '7k/6B1/8/8/8/8/8/r6K w - - 0 1';

  it('offers the winning capture even while the mover is in check', () => {
    const g = gameFrom(FEN);
    const capture = g.legalMoves()
      .find((m) => m.move.from === parseSquare('g7') && m.move.captured?.cls === 'king');
    expect(capture, 'taking the enemy king must be offered').toBeDefined();
  });

  it('plays it, and it wins', () => {
    const g = gameFrom(FEN);
    const capture = g.legalMoves()
      .find((m) => m.move.from === parseSquare('g7') && m.move.captured?.cls === 'king')!;
    const { game, resolved } = g.play(capture.move);
    expect(resolved.kingCaptured).toBe(true);
    expect(game.result()).toMatchObject({ kind: 'win', winner: 'white' });
  });

  it('does not otherwise relax orthodox legality', () => {
    // The fix is narrow on purpose: only king captures are added. A pinned piece still cannot wander, which is the
    // wider R2 question and a design decision rather than a defect.
    const g = gameFrom(FEN);
    const moves = g.legalMoves();
    // Every non-king-capturing move offered while in check must still be a real evasion, so nothing else crept in.
    const nonWinning = moves.filter((m) => m.move.captured?.cls !== 'king' && !m.art && !m.tera);
    for (const m of nonWinning) {
      const after = g.play(m.move).game;
      const lost = after.result();
      expect(
        lost.kind === 'win' && lost.winner === 'black',
        `${squareName(m.move.from)}->${squareName(m.move.to)} should not hand White's king away`,
      ).toBe(false);
    }
  });
});

describe('R4: a resolution that removes both kings is a win for the mover', () => {
  /**
   * Two kings adjacent, each frail enough that the Clash takes both: the attacker's blow kills, and the
   * counterblow kills back. Shedinja's real 1 HP makes the outcome certain rather than luck.
   */
  const FEN = '8/8/8/3k4/3K4/8/8/8 w - - 0 1';

  it('names the mover as the winner, not a draw', () => {
    const g = gameFrom(FEN, {
      // Recoil equal to the damage dealt, so the attacker falls with its victim — the ONE way a Clash removes
      // both kings, since a defender that dies first never gets to counter.
      d4: { species: 'shedinja', type: 'Normal', recoil: 1 },
      d5: { species: 'shedinja', type: 'Normal' },
    });
    const capture = g.legalMoves().find((m) => m.move.captured?.cls === 'king');
    expect(capture, 'the kings are adjacent, so a capture must be offered').toBeDefined();

    const { game, resolved } = g.play(capture!.move);
    expect(resolved.verdict, 'both 1-HP kings should fall together').toBe('mutual');
    // Both kings are gone: two pieces were removed and neither side has a king left on the board.
    expect(resolved.removed).toHaveLength(2);
    expect(game.position.allPieces().filter((p) => p.piece.cls === 'king')).toHaveLength(0);

    // The bug: this returned { kind: 'draw', reason: 'no-legal-move' }.
    expect(game.result()).toMatchObject({ kind: 'win', winner: 'white', by: 'king-capture' });
  });

  it('reads the mover from the history, since a mutual passes the turn', () => {
    const g = gameFrom(FEN, {
      // Recoil equal to the damage dealt, so the attacker falls with its victim — the ONE way a Clash removes
      // both kings, since a defender that dies first never gets to counter.
      d4: { species: 'shedinja', type: 'Normal', recoil: 1 },
      d5: { species: 'shedinja', type: 'Normal' },
    });
    const { game } = g.play(g.legalMoves().find((m) => m.move.captured?.cls === 'king')!.move);
    // Board parity now names Black, so anything reading `turn` would award the game to the wrong side.
    expect(game.turn).toBe('black');
    expect(game.result()).toMatchObject({ winner: 'white' });
  });
});
