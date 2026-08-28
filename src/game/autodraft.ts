/**
 * Deterministic army drafting.
 *
 * A placeholder for the real draft, which is a designed strategic phase rather than a dice roll — but a
 * placeholder with real teeth, because everything downstream needs armies: the playable board, the
 * tutorial, the sandbox, and the batch simulator that will test the balance claims.
 *
 * Seeded throughout, so a surprising army can be reproduced and shared, and so a simulation run is
 * repeatable.
 */

import type { Dex } from '../data/dex.ts';
import type { BattleType, SpeciesEntry } from '../data/schema.ts';
import { PIECE_CLASSES, STARTING_SQUARES } from '../engine/board.ts';
import type { PieceClass, Side } from '../engine/board.ts';
import { Position } from '../engine/position.ts';
import { Rng } from '../engine/rng.ts';
import type { Loadout, PokemonLoadout } from '../engine/variant.ts';

/**
 * How wide a net to cast when picking for a role.
 *
 * Narrow enough that a rook is recognisably bulky and a bishop recognisably a special attacker, wide
 * enough that two games do not look the same.
 */
const CANDIDATE_POOL = 60;

/** Base-stat-total bands per role, so a pawn is not a legendary and a queen is not a Caterpie. */
function isEligible(species: SpeciesEntry, cls: PieceClass): boolean {
  if (cls === 'pawn') return species.bst <= 420;
  if (cls === 'queen') return species.bst >= 520;
  if (cls === 'king') return species.bst >= 480;
  return species.bst >= 380 && species.bst <= 600;
}

function pickForRole(dex: Dex, cls: PieceClass, rng: Rng, taken: Set<string>): SpeciesEntry {
  const available = dex.baseFormes.filter((s) => !taken.has(s.id) && s.types.length > 0);
  const eligible = available.filter((s) => isEligible(s, cls));

  // Fall back to the whole pool rather than failing if a band runs dry.
  const candidates = (eligible.length >= 20 ? eligible : available)
    .map((s) => ({ species: s, score: dex.roleAffinity(s)[cls] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, CANDIDATE_POOL)
    .map((c) => c.species);

  const chosen = rng.pick(candidates);
  taken.add(chosen.id);
  return chosen;
}

export interface DraftedPiece {
  readonly side: Side;
  readonly cls: PieceClass;
  readonly square: number;
  readonly species: SpeciesEntry;
  readonly type: BattleType;
}

export interface DraftResult {
  readonly position: Position;
  readonly loadout: Loadout;
  /** Everything drafted, for a team-sheet view. */
  readonly drafted: readonly DraftedPiece[];
}

/**
 * Drafts two full armies onto a standard starting position.
 *
 * A dual-typed species is a genuine choice rather than a coin flip in the real draft — Lapras as Water is
 * a different piece from Lapras as Ice. Here it is chosen at random, which is exactly the decision the
 * player will make for themselves later.
 */
export function autodraft(dex: Dex, seed: string | number): DraftResult {
  const rng = new Rng(seed);
  const position = Position.fromStartingPosition();
  const taken = new Set<string>();
  const loadout = new Map<number, PokemonLoadout>();
  const drafted: DraftedPiece[] = [];

  for (const side of ['white', 'black'] as const) {
    for (const cls of PIECE_CLASSES) {
      for (const square of STARTING_SQUARES[side][cls]) {
        const species = pickForRole(dex, cls, rng, taken);
        const type = rng.pick(species.types);
        const piece = position.pieceAt(square);
        if (!piece) throw new Error(`expected a ${side} ${cls} on square ${square}`);
        loadout.set(piece.id, { species: species.id, type });
        drafted.push({ side, cls, square, species, type });
      }
    }
  }

  return { position, loadout, drafted };
}
