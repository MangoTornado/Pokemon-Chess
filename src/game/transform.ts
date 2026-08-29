/**
 * The four transformations, and the one budget they share.
 *
 * Terastallisation shipped first because it is only a type change. These three are the rest, and they are
 * grouped here because of a rule the games have that turns out to be the whole design: **you get one gimmick
 * per battle.** Mega Evolution, Z-Moves, Dynamax and Terastallisation are generation-exclusive and mutually
 * exclusive, so a side never has two. Reproducing that gives a side one decision, made once, that cannot be
 * taken back — which is worth far more on a board than four independent buttons would be.
 *
 * What each one is, and why it lands differently on a chess board:
 *
 * - **Mega Evolution** genuinely swaps species. New base stats, a new ability, and for ten of the 47 formes a
 *   new type pair — Charizard-Mega-X trades Flying for Dragon, which rewrites every matchup it is in.
 *   Permanent, so it is the transformation you spend early. This is the forme-swap plumbing that kept the
 *   whole group waiting: a piece has to be able to *become a different Pokémon* mid-game.
 * - **Dynamax** doubles HP for three turns. It changes no stats and no types, so its whole effect is
 *   positional: for three turns a piece cannot be traded off, which is exactly long enough to force a line
 *   open. The most chess-like of the three.
 * - **A Z-Move** changes nothing about the piece at all — it is one attack at enormous power, once. It was
 *   grouped with the other two in the plan, but it never needed the forme plumbing; it needed a budget and a
 *   power table.
 *
 * Every gate here is read from real data: a mega stone's own `megaStone` mapping, a Z-crystal's own
 * `zMoveType`, and the species table's `changesFrom`. Nothing is listed by hand.
 */

import type { Dex } from '../data/dex.ts';
import type { BattleType, ItemEntry, SpeciesEntry } from '../data/schema.ts';
import type { Moveset } from './moveset.ts';

/** The transformations a side can spend its single use on. */
export type TransformKind = 'tera' | 'mega' | 'dynamax' | 'zpower';

export const TRANSFORM_LABEL: Readonly<Record<TransformKind, string>> = {
  tera: 'Terastallise',
  mega: 'Mega Evolve',
  dynamax: 'Dynamax',
  zpower: 'Z-Power',
};

/** How long a Dynamax lasts, in its owner's turns — the games' three. */
export const DYNAMAX_TURNS = 3;

/** What Dynamax does to HP: the games' doubling, applied to current and maximum alike. */
export const DYNAMAX_HP_MULTIPLIER = 2;

/**
 * The mega forme a species reaches with a given held item, or null.
 *
 * Read off the stone rather than a table of our own: each mega stone carries a one-entry `megaStone` map from
 * the base forme's name to the mega forme's, so holding the wrong stone simply does not match.
 */
export function megaFormeFor(dex: Dex, species: SpeciesEntry, item: string | undefined): SpeciesEntry | null {
  if (!item) return null;
  const stone = dex.getItem(item);
  const mapping = stone?.megaStone;
  if (!mapping) return null;
  const targetName = mapping[species.name];
  if (!targetName) return null;
  const target = dex.getSpecies(toId(targetName));
  // Guard the round trip: a stone naming a forme the species table does not have is data drift, not a mega.
  return target && target.changesFrom !== undefined ? target : null;
}

/**
 * The mega stone for a species, if one exists — what the draft offers a mega-capable piece.
 *
 * Uses the dex's own `megaStonesFor`, which resolves through the base forme, and takes the first: only
 * Charizard and Mewtwo have two stones, and offering both is a draft decision the kit picker can surface
 * separately rather than something this needs to choose between.
 */
export function megaStoneFor(dex: Dex, species: SpeciesEntry): ItemEntry | null {
  return dex.megaStonesFor(species)[0] ?? null;
}

/**
 * The type a piece fights as after Mega Evolving, given the type it was fighting as.
 *
 * A piece declares one type, and a mega forme may not have it any more — Charizard drafted as Flying Megas
 * into X and finds itself Fire/Dragon. Keeping Flying would be a type the piece no longer has, so it falls to
 * the forme's first type. A declared type the forme kept is left alone, because the player chose it.
 */
export function megaBattleType(forme: SpeciesEntry, declared: BattleType): BattleType {
  if (forme.types.includes(declared)) return declared;
  return forme.types[0] ?? declared;
}

/** Whether an item is a Z-crystal, and the type it powers up. */
export function zCrystalType(dex: Dex, item: string | undefined): BattleType | null {
  if (!item) return null;
  const entry = dex.getItem(item);
  if (!entry?.zMove || !entry.zMoveType) return null;
  return entry.zMoveType as BattleType;
}

/** The Z-crystal for a type — the one a piece of that type would carry. */
export function zCrystalFor(dex: Dex, type: BattleType): ItemEntry | null {
  return dex.zCrystalsFor(type)[0] ?? null;
}

/**
 * The moveset slot a Z-crystal would power up, or null if the piece has no move of the crystal's type.
 *
 * The crystals' own text is the rule: "If holder has a Fire move, this item allows it to use a Fire Z-Move."
 * So a mismatched crystal is dead weight, exactly as in the games.
 */
export function zSlotFor(dex: Dex, item: string | undefined, moveset: Moveset): number | null {
  const type = zCrystalType(dex, item);
  if (!type) return null;
  let best: number | null = null;
  for (let i = 0; i < moveset.length; i++) {
    const slot = moveset[i];
    if (!slot || slot.type !== type) continue;
    if (best === null || slot.basePower > moveset[best]!.basePower) best = i;
  }
  return best;
}

/**
 * The base power a move becomes as a Z-Move — the games' own conversion table (gen 7).
 *
 * A flat multiplier would be the easy choice and the wrong one: the real table compresses hard at the top, so
 * a 40-power move gains far more than a 140-power one and a Z-Move is not simply "your best move, doubled".
 * That compression is why Z-Power is worth spending on a piece with weak moves.
 */
export function zBasePower(basePower: number): number {
  if (basePower <= 55) return 100;
  if (basePower <= 65) return 120;
  if (basePower <= 75) return 140;
  if (basePower <= 85) return 160;
  if (basePower <= 95) return 175;
  if (basePower <= 100) return 180;
  if (basePower <= 110) return 185;
  if (basePower <= 125) return 190;
  if (basePower <= 130) return 195;
  return 200;
}

/**
 * Whether an item does something through the transformation system rather than through `rules/items.ts`.
 *
 * A mega stone and a Z-crystal have no turn-to-turn combat effect, so they are absent from
 * `IMPLEMENTED_ITEMS` — but they are very much implemented, just here. Anything a draft hands out has to
 * satisfy one predicate or the other, and a test that checks only the first would call these dead weight.
 */
export function isTransformItem(dex: Dex, item: string): boolean {
  const entry = dex.getItem(item);
  if (!entry) return false;
  return entry.megaStone !== undefined || (entry.zMove === true && entry.zMoveType !== undefined);
}

/** Showdown's id form: lowercase, alphanumerics only. */
function toId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}
