/**
 * Held items, as multipliers the damage pipeline already has slots for.
 *
 * `rules/damage.ts` was written with `basePowerMod`, `attackerFinalMod` and `defenderFinalMod` hooks
 * defaulting to 1, precisely so items could be wired in later "by passing non-1 values, not by touching
 * the formula" — this module computes those values. Every number is the real one from the games, so a
 * player's own arithmetic is right: Life Orb is ×1.3, Choice Band ×1.5, a type plate/incense ×1.2.
 *
 * Three item behaviours do not fit a multiplier and are handled by their callers:
 *   - **survive-once** (Focus Sash) clamps a would-be-fatal blow to 1 HP while the holder is undamaged —
 *     the Clash's existing `pristine` flag is exactly this gate;
 *   - **checkup healing** (Leftovers) restores a fraction each end-of-turn;
 *   - **defensive items** (Assault Vest, Eviolite) are expressed as a defender reduction, because the
 *     pipeline requires a defender hook to be ≤ 1 — a ×1.5 defensive stat is a ×2/3 on damage.
 *
 * A curated set rather than all 536: these are the items that actually change a capture, each with a value
 * a reader can check. The remaining items are inert until the wider ISA interpreter lands.
 */

import type { BattleType } from '../data/schema.ts';

/** Items that boost one attacking type by ×1.2 (plates, incenses, and the gen-1 "type items"). */
export const TYPE_BOOST_ITEMS: Readonly<Record<string, BattleType>> = {
  charcoal: 'Fire', flameplate: 'Fire',
  mysticwater: 'Water', splashplate: 'Water',
  miracleseed: 'Grass', meadowplate: 'Grass',
  magnet: 'Electric', zapplate: 'Electric',
  blackbelt: 'Fighting', fistplate: 'Fighting',
  sharpbeak: 'Flying', skyplate: 'Flying',
  silkscarf: 'Normal',
  hardstone: 'Rock', stoneplate: 'Rock',
  spelltag: 'Ghost', spookyplate: 'Ghost',
  poisonbarb: 'Poison', toxicplate: 'Poison',
  softsand: 'Ground', earthplate: 'Ground',
  nevermeltice: 'Ice', icicleplate: 'Ice',
  twistedspoon: 'Psychic', mindplate: 'Psychic',
  silverpowder: 'Bug', insectplate: 'Bug',
  dragonfang: 'Dragon', dracoplate: 'Dragon',
  blackglasses: 'Dark', dreadplate: 'Dark',
  metalcoat: 'Steel', ironplate: 'Steel',
  pixieplate: 'Fairy',
};

const TYPE_BOOST = 1.2;

/** Items that restore a fraction of max HP at each Checkup. */
export const CHECKUP_HEAL_ITEMS: Readonly<Record<string, number>> = {
  leftovers: 1 / 16,
  blacksludge: 1 / 16, // (Poison-type only in the games; treated as plain healing here)
};

/**
 * Items whose holder pays a fraction of its max HP for attacking (Life Orb's tenth).
 *
 * The cost is what makes Life Orb a decision rather than a free 30%: it is the strongest damage item in the
 * game and it kills you slowly.
 */
export const ATTACK_COST_ITEMS: Readonly<Record<string, number>> = { lifeorb: 1 / 10 };

/** Items that punish an attacker for making contact, as a fraction of the *attacker's* max HP. */
export const CONTACT_PUNISH_ITEMS: Readonly<Record<string, number>> = { rockyhelmet: 1 / 6 };

/** Items that let their holder survive one otherwise-fatal blow at 1 HP, while undamaged. */
export const SURVIVE_ONCE_ITEMS: ReadonlySet<string> = new Set(['focussash', 'focusband']);

/** How an item changes the blow its holder is throwing. */
export interface OffensiveItemMods {
  /** Step 2 — base-power scaling (type-boost items). */
  readonly basePowerMod: number;
  /** Step 13 — attacker final multipliers (Life Orb, Choice, Expert Belt, bands). */
  readonly attackerFinalMod: number;
}

const NEUTRAL: OffensiveItemMods = { basePowerMod: 1, attackerFinalMod: 1 };

/**
 * The offensive multipliers an item grants for a specific blow.
 *
 * `superEffective` is needed because Expert Belt only pays on a super-effective hit, and `category`
 * because the Choice items and the bands are split by physical/special.
 */
export function offensiveItemMods(
  item: string | undefined,
  moveType: BattleType,
  category: 'Physical' | 'Special',
  superEffective: boolean,
): OffensiveItemMods {
  if (!item) return NEUTRAL;

  const boosted = TYPE_BOOST_ITEMS[item];
  if (boosted !== undefined) {
    return { basePowerMod: boosted === moveType ? TYPE_BOOST : 1, attackerFinalMod: 1 };
  }

  switch (item) {
    case 'lifeorb':
      return { basePowerMod: 1, attackerFinalMod: 1.3 };
    case 'choiceband':
      return { basePowerMod: 1, attackerFinalMod: category === 'Physical' ? 1.5 : 1 };
    case 'choicespecs':
      return { basePowerMod: 1, attackerFinalMod: category === 'Special' ? 1.5 : 1 };
    case 'expertbelt':
      return { basePowerMod: 1, attackerFinalMod: superEffective ? 1.2 : 1 };
    case 'muscleband':
      return { basePowerMod: category === 'Physical' ? 1.1 : 1, attackerFinalMod: 1 };
    case 'wiseglasses':
      return { basePowerMod: category === 'Special' ? 1.1 : 1, attackerFinalMod: 1 };
    default:
      return NEUTRAL;
  }
}

/**
 * The damage reduction an item grants its holder as defender — always ≤ 1, as the pipeline requires.
 *
 * `nfe` gates Eviolite, which only helps a not-fully-evolved Pokémon, exactly as in the games.
 */
export function defensiveItemMod(
  item: string | undefined,
  category: 'Physical' | 'Special',
  nfe: boolean,
): number {
  if (!item) return 1;
  switch (item) {
    case 'assaultvest':
      // ×1.5 Special Defence ⇒ ×2/3 damage from special blows.
      return category === 'Special' ? 2 / 3 : 1;
    case 'eviolite':
      return nfe ? 2 / 3 : 1;
    default:
      // Anything else is not a damage reduction — Rocky Helmet, for instance, punishes contact instead
      // (see contactPunishFraction) — so it leaves the blow unchanged.
      return 1;
  }
}

/** Whether an item grants its holder a survive-once clamp (checked together with `pristine`). */
export function grantsSurviveOnce(item: string | undefined): boolean {
  return item !== undefined && SURVIVE_ONCE_ITEMS.has(item);
}

/** What attacking costs the holder of this item, as a fraction of its max HP (0 for none). */
export function attackCostFraction(item: string | undefined): number {
  return item === undefined ? 0 : ATTACK_COST_ITEMS[item] ?? 0;
}

/** What this item exacts from an attacker that makes contact, as a fraction of the attacker's max HP. */
export function contactPunishFraction(item: string | undefined): number {
  return item === undefined ? 0 : CONTACT_PUNISH_ITEMS[item] ?? 0;
}

/** The fraction of max HP an item restores at each Checkup, or 0. */
export function checkupHealFraction(item: string | undefined): number {
  return item === undefined ? 0 : CHECKUP_HEAL_ITEMS[item] ?? 0;
}

/**
 * Every item this module actually implements — the set a draft may hand out.
 *
 * Kept explicit so a test can assert each one is a real dex item and that nothing is offered that would
 * silently do nothing. Display names come from the dex (`dex.getItem(id).name`), not from here.
 */
export const IMPLEMENTED_ITEMS: readonly string[] = [
  ...Object.keys(TYPE_BOOST_ITEMS),
  ...Object.keys(CHECKUP_HEAL_ITEMS),
  ...SURVIVE_ONCE_ITEMS,
  'lifeorb', 'choiceband', 'choicespecs', 'expertbelt', 'muscleband', 'wiseglasses',
  'assaultvest', 'eviolite', 'rockyhelmet',
];
