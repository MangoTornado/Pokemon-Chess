/**
 * A Gym Leader match: the player's drafted army against a mono-type army (SPEC §17.9).
 *
 * The leader's whole team is one type, which is the point — a mono-type army has a single, legible set of
 * weaknesses, so the fight is a type puzzle the player solves by using the chart. Because a mono-type army
 * is measurably weaker at equal search (§19.6), the leader is given a compensating AI budget elsewhere; the
 * army itself is drafted to be as strong as one type allows, filling each chess role with the best-fitting
 * species of that type.
 */

import type { Dex } from '../data/dex.ts';
import type { BattleType, SpeciesEntry } from '../data/schema.ts';
import { PIECE_CLASSES, STARTING_SQUARES } from '../engine/board.ts';
import type { PieceClass, Side } from '../engine/board.ts';
import { Rng } from '../engine/rng.ts';
import type { Loadout, PokemonLoadout } from '../engine/variant.ts';
import { autodraft } from './autodraft.ts';

/** Base-stat-total bands per role — the same shape as the ordinary draft, so a gym pawn is not a legendary. */
function inBand(species: SpeciesEntry, cls: PieceClass): boolean {
  if (cls === 'pawn') return species.bst <= 430;
  if (cls === 'queen') return species.bst >= 500;
  if (cls === 'king') return species.bst >= 470;
  return species.bst >= 360 && species.bst <= 610;
}

/**
 * Picks the best mono-type species for a role, by role affinity, avoiding repeats.
 *
 * Falls back to the whole type pool if a band runs dry (a type with few high-BST species still fields a
 * king), so the draft never fails for a legal type.
 */
function pickTyped(dex: Dex, pool: readonly SpeciesEntry[], cls: PieceClass, rng: Rng, taken: Set<string>): SpeciesEntry {
  const available = pool.filter((s) => !taken.has(s.id));
  const banded = available.filter((s) => inBand(s, cls));
  const source = banded.length >= 2 ? banded : available.length > 0 ? available : pool;
  const ranked = [...source]
    .map((s) => ({ s, score: dex.roleAffinity(s)[cls] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 24)
    .map((c) => c.s);
  const chosen = ranked.length > 0 ? rng.pick(ranked) : pool[0]!;
  taken.add(chosen.id);
  return chosen;
}

export interface LadderMatch {
  readonly position: import('../engine/position.ts').Position;
  readonly loadout: Loadout;
}

/**
 * Builds a match where the player (White) fields an ordinary drafted army and the leader (Black) fields a
 * mono-type army of `leaderType`.
 *
 * The player's side is auto-drafted here for a quick challenge; a later step can hand in a collection-drafted
 * army instead — the shape is the same, so nothing downstream changes.
 */
export function buildGymMatch(dex: Dex, leaderType: BattleType, seed: string | number): LadderMatch {
  // Start from a normal draft: this gives the player (White) a full, varied army and a valid position.
  const base = autodraft(dex, `gym:${leaderType}:${seed}`);
  const loadout = new Map<number, PokemonLoadout>(base.loadout);

  const rng = new Rng(`gym-leader:${leaderType}:${seed}`);
  const pool = dex.speciesOfType(leaderType);
  const taken = new Set<string>();

  // Overwrite every Black piece with a mono-type pick declared as the leader's type.
  const black: Side = 'black';
  for (const cls of PIECE_CLASSES) {
    for (const square of STARTING_SQUARES[black][cls]) {
      const piece = base.position.pieceAt(square);
      if (!piece) continue;
      const species = pickTyped(dex, pool, cls, rng, taken);
      const ability = species.abilities[0];
      loadout.set(piece.id, ability ? { species: species.id, type: leaderType, ability } : { species: species.id, type: leaderType });
    }
  }

  return { position: base.position, loadout };
}
