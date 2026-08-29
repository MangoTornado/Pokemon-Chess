/**
 * Choosing a held item at draft time.
 *
 * `rules/items.ts` says what an item *does*; this says who should hold one, which is a draft decision and
 * so lives with the draft. The choices are role-shaped, the way a human team-builder would pick: a bulky
 * king wants to stay alive, a frail attacker wants a Focus Sash, an unevolved piece wants its Eviolite,
 * and a heavy hitter wants the item that turns a near-miss into a knockout.
 *
 * Deterministic given the seed, like everything else in the draft, so an army reproduces exactly.
 */

import type { BattleType, SpeciesEntry } from '../data/schema.ts';
import type { PieceClass } from '../engine/board.ts';
import type { Rng } from '../engine/rng.ts';
import { TYPE_BOOST_ITEMS } from '../rules/items.ts';

/** The type-boost item for a declared type, if one exists (Charcoal for Fire, and so on). */
function typeItemFor(type: BattleType): string | undefined {
  for (const [item, boosted] of Object.entries(TYPE_BOOST_ITEMS)) {
    if (boosted === type) return item;
  }
  return undefined;
}

/**
 * Picks a held item for a drafted piece.
 *
 * Order of preference is deliberate: Eviolite for anything not fully evolved (it is the strongest item in
 * the game for those, and it makes the evolution layer legible), then a role-appropriate offensive or
 * defensive item, with a type-boost item as the broad fallback so almost every piece holds something real.
 */
export function pickHeldItem(species: SpeciesEntry, cls: PieceClass, type: BattleType, rng: Rng): string | undefined {
  // An unevolved Pokémon holding Eviolite is the single most characteristic item choice in the games.
  if (species.nfe) return 'eviolite';

  // baseStats is [hp, atk, def, spa, spd, spe].
  const physical = species.baseStats[1] >= species.baseStats[3];

  switch (cls) {
    case 'king':
      // The king must survive; Leftovers is slow, reliable healing and never a liability.
      return 'leftovers';
    case 'queen':
      // The queen makes the most attacks, so raw damage is worth the most on it.
      return rng.chance(50) ? 'lifeorb' : physical ? 'choiceband' : 'choicespecs';
    case 'rook':
      return rng.chance(50) ? 'assaultvest' : 'expertbelt';
    case 'bishop':
    case 'knight':
      return rng.chance(50) ? 'expertbelt' : physical ? 'muscleband' : 'wiseglasses';
    case 'pawn': {
      // A frail pawn benefits most from surviving one hit; otherwise sharpen its own type.
      if (rng.chance(40)) return 'focussash';
      return typeItemFor(type) ?? 'leftovers';
    }
  }
}
