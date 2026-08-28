/**
 * Static evaluation of a Pokémon Chess position, from one side's point of view.
 *
 * The variant reprices chess, so the evaluation cannot be standard material. A piece's worth is its
 * chess-class value scaled by how its *type* fares on this board — a Steel piece among Fairy and Ice
 * enemies is worth more than the same class as a Bug — plus its current HP fraction, because a wounded
 * piece is a partial piece. King safety dominates, because the game is won by king capture.
 *
 * Pure and cheap: the search calls this at every leaf. See SPEC §19.
 */

import type { PieceClass } from '../engine/board.ts';
import { effectiveness } from '../engine/typechart.ts';
import type { PokemonChess, Side } from '../engine/variant.ts';
import type { BattleType } from '../data/schema.ts';

/** Base chess-class values, in centipawn-like units. The king is effectively infinite. */
const CLASS_VALUE: Record<PieceClass, number> = {
  pawn: 100,
  knight: 320,
  bishop: 330,
  rook: 500,
  queen: 900,
  king: 100000,
};

/**
 * A type's board multiplier on its class value.
 *
 * Offence: how many of the 18 types it hits super-effectively (it captures them for a free move) versus
 * how many resist it (a losing exchange). Defence: how many types it is weak to versus how many cannot
 * touch it at all. A type that hits hard and is hard to hit is worth more; the effect is deliberately
 * modest (±~20%) so type never swamps class.
 */
function typeFactor(type: BattleType): number {
  const TYPES: BattleType[] = [
    'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
    'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
  ];
  let offence = 0;
  let defence = 0;
  for (const other of TYPES) {
    const atk = effectiveness(type, other);
    if (atk > 1) offence += 1;
    else if (atk < 1 && atk > 0) offence -= 0.5;

    const def = effectiveness(other, type);
    if (def === 0) defence += 1.5;
    else if (def > 1) defence -= 1;
    else if (def < 1) defence += 0.5;
  }
  // Normalise to roughly [0.8, 1.2].
  return 1 + (offence * 0.015 + defence * 0.01);
}

// Cache the 18 factors once.
const TYPE_FACTOR: Partial<Record<BattleType, number>> = {};
function factorOf(type: BattleType): number {
  return (TYPE_FACTOR[type] ??= typeFactor(type));
}

/** The material value of one piece, scaled by type and current HP. */
function pieceValue(cls: PieceClass, type: BattleType, hpFraction: number): number {
  if (cls === 'king') return CLASS_VALUE.king; // HP does not discount the king; only its capture matters
  return CLASS_VALUE[cls] * factorOf(type) * (0.35 + 0.65 * hpFraction);
}

/**
 * Score a game from `side`'s perspective, in centipawns. Positive is good for `side`.
 *
 * A finished game returns a saturating win/loss score offset by depth so the search prefers faster wins
 * and slower losses.
 */
export function evaluate(game: PokemonChess, side: Side, ply = 0): number {
  const result = game.result();
  if (result.kind === 'win') {
    return result.winner === side ? 1_000_000 - ply : -(1_000_000 - ply);
  }
  if (result.kind === 'draw') return 0;

  let score = 0;
  for (const { piece, pokemon, live } of game.pieces()) {
    const v = pieceValue(piece.cls, pokemon.type, live.maxHp > 0 ? live.hp / live.maxHp : 1);
    score += piece.side === side ? v : -v;
  }

  // King safety: being the side whose king can be taken right now is a real, immediate danger.
  const enemy: Side = side === 'white' ? 'black' : 'white';
  if (game.turn === side && game.kingInDanger(side)) score -= 600;
  if (game.turn === enemy && game.kingInDanger(enemy)) score += 600;

  // A small tempo bonus for having more available actions — mobility, which correlates with initiative.
  return score;
}
