/**
 * Choosing a piece's Tera type at draft time.
 *
 * Terastallisation is the most consequential transformation this game can have, because it changes the one
 * thing everything else is priced against: type. A Tera'd piece resists different attacks, is weak to
 * different attacks, and gains STAB on a different move — so a well-chosen Tera type is a card the player
 * holds for the exact moment the matchup turns against them.
 *
 * The choice is made the way a real team-builder makes it: **turn your best coverage move into STAB**. A
 * Charizard drafted as Fire whose best coverage is Flying Teras into Flying and suddenly hits harder with
 * the move it was already carrying. Failing that (a piece with no useful coverage), a dual-typed species
 * Teras into its other real type, which is a purely defensive shift and still a genuine option.
 */

import type { BattleType, SpeciesEntry } from '../data/schema.ts';
import type { Moveset } from './moveset.ts';

/**
 * The Tera type for a drafted piece, or undefined if it has no meaningful one.
 *
 * `declared` is the type it fights as normally; a Tera into the same type would be a wasted turn, so it is
 * never returned.
 */
export function pickTeraType(
  species: SpeciesEntry,
  declared: BattleType,
  moveset: Moveset,
): BattleType | undefined {
  // Prefer the strongest coverage slot whose type differs from the declared one: Tera turns it into STAB.
  const coverage = [...moveset]
    .slice(1)
    .filter((slot) => slot.type !== declared)
    .sort((a, b) => b.basePower - a.basePower)[0];
  if (coverage) return coverage.type;

  // Otherwise a dual-typed species can still shift defensively into its other type.
  const other = species.types.find((t) => t !== declared);
  return other;
}
