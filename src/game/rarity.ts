/**
 * How rare a Pokémon is, read off the real data rather than invented.
 *
 * `DIRECTION.md` is explicit that rarity must be grounded in data, and the dex gives two honest signals: the
 * legendary-family **tags** (Sub-Legendary, Restricted Legendary, Mythical, Ultra Beast, Paradox) and **base
 * stat total**, whose quartiles across the 1025 base formes fall at roughly 325 / 450 / 508. So a Caterpie is
 * common because it *is* weak, and a Mewtwo is mythical because the data says it is a Restricted Legendary —
 * neither is a hand-assigned number someone can argue with.
 *
 * Rarity does two jobs: it decides what an encounter offers (a winner sees better odds than a loser), and it
 * gives the collection a long tail worth chasing. It never touches a match — ranked play is point-buy from a
 * shared pool (SPEC §17.11), so owning a Mewtwo is a completionist trophy, not an advantage.
 */

import type { SpeciesEntry } from '../data/schema.ts';

/** Rarity bands, commonest first. */
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary' | 'mythical';

export const RARITIES: readonly Rarity[] = ['common', 'uncommon', 'rare', 'legendary', 'mythical'];

export const RARITY_LABEL: Readonly<Record<Rarity, string>> = {
  common: 'Common', uncommon: 'Uncommon', rare: 'Rare', legendary: 'Legendary', mythical: 'Mythical',
};

/** A colour per band, so an encounter card reads its rarity at a glance. */
export const RARITY_COLOR: Readonly<Record<Rarity, string>> = {
  common: '#9aa4b2', uncommon: '#3fb950', rare: '#58a6ff', legendary: '#d29922', mythical: '#f778ba',
};

/** Tags that mark a species as a legendary of some kind, and which band each implies. */
const TAG_RARITY: Readonly<Record<string, Rarity>> = {
  'Mythical': 'mythical',
  'Restricted Legendary': 'mythical',
  'Sub-Legendary': 'legendary',
  'Ultra Beast': 'legendary',
  'Paradox': 'legendary',
};

/** BST cut-offs, taken from the quartiles of the real base-forme distribution. */
const UNCOMMON_BST = 400;
const RARE_BST = 500;

/** The rarity band a species falls in. */
export function rarityOf(species: SpeciesEntry): Rarity {
  // `tags` is omitted entirely for most species, so treat a missing value as "no tags".
  for (const tag of species.tags ?? []) {
    const banded = TAG_RARITY[tag];
    if (banded) return banded;
  }
  if (species.bst >= RARE_BST) return 'rare';
  if (species.bst >= UNCOMMON_BST) return 'uncommon';
  return 'common';
}

/**
 * Whether a species may ever be offered as a reward.
 *
 * Excludes the un-battleable (a species with no typing) and anything Smogon marks `Illegal`, which is how the
 * data flags formes that are not real standalone Pokémon — offering one would be a broken prize.
 */
export function isCollectable(species: SpeciesEntry): boolean {
  return species.formeKind === 'base' && species.types.length > 0 && species.tier !== 'Illegal';
}
