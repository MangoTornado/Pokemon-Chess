/**
 * Battle stats for a piece, derived from its species' base stats.
 *
 * Every piece is a level-50 Pokémon with perfect IVs and one of two EV spreads. The spread is chosen
 * from the species' own stat line rather than applied uniformly, because a universal all-out-attacker
 * build would make Blissey and Shuckle max-Speed sweepers — systematic, and thematically wrong, which
 * `DIRECTION.md` classes as a defect. See SPEC §3.3.
 *
 * A bulky species gets the Bulwark spread (HP and its better defence maxed); everything else gets Assault
 * (its better offence and Speed maxed). Both are real competitive builds, not inventions, and both are
 * narrow enough that a player can hold the resulting HP and Speed ranges in their head.
 *
 * Pure and level-parameterised, so the batch simulator can re-fit the bulk threshold and the AI can
 * compute a piece's stats without touching game state.
 */

import type { SpeciesEntry } from '../data/schema.ts';

/** The six stats, in Showdown's canonical order. */
export interface StatSpread {
  hp: number;
  atk: number;
  def: number;
  spa: number;
  spd: number;
  spe: number;
}

/** Which EV spread a piece uses. */
export type SpreadKind = 'assault' | 'bulwark';

const LEVEL = 50;
const IV = 31;
const MAX_EVS_PER_STAT = 252;
const SMALL_EVS = 4;
/** A boosting nature multiplies one stat by this. */
const NATURE_BOOST = 1.1;

/**
 * Whether a species is bulky enough to earn the Bulwark spread.
 *
 * The threshold `+60` is a `format` parameter that the batch simulator re-fits (SPEC §15.8); the shape —
 * total bulk versus best offence plus Speed — is what lands every named piece where a competitive player
 * expects. Measured: Blissey, Chansey, Shuckle, Ferrothorn, Skarmory, Snorlax, Toxapex, Dondozo, Steelix
 * and Lapras are Bulwark; Garchomp, Gengar, Pikachu and Magikarp are Assault.
 */
export function isBulwark(base: StatSpread, threshold = 60): boolean {
  return base.hp + base.def + base.spd >= Math.max(base.atk, base.spa) + base.spe + threshold;
}

export function spreadKindOf(species: SpeciesEntry, threshold = 60): SpreadKind {
  return isBulwark(baseSpreadOf(species), threshold) ? 'bulwark' : 'assault';
}

function baseSpreadOf(species: SpeciesEntry): StatSpread {
  const [hp, atk, def, spa, spd, spe] = species.baseStats;
  return { hp, atk, def, spa, spd, spe };
}

/** Standard level-50 HP formula. Shedinja's `maxHP` override short-circuits it (see SPEC §3.4). */
export function maxHpOf(species: SpeciesEntry, level = LEVEL): number {
  if (species.maxHP !== undefined) return species.maxHP;
  const base = species.baseStats[0];
  // A base-1-HP species (Shedinja without the override) would still get the standard formula here; the
  // override is what makes it 1. The `+ 10` and `+ level` are the HP-specific tail of the formula.
  return Math.floor(((2 * base + IV + Math.floor(MAX_EVS_PER_STAT / 4)) * level) / 100) + level + 10;
}

/** The standard formula for a non-HP stat, before nature. */
function rawStat(base: number, evs: number, level = LEVEL): number {
  return Math.floor(((2 * base + IV + Math.floor(evs / 4)) * level) / 100) + 5;
}

function applyNature(value: number, boosted: boolean): number {
  return boosted ? Math.floor(value * NATURE_BOOST) : value;
}

/**
 * The EV allocation and boosted stat for a spread.
 *
 * Assault maxes the higher of Attack/Special Attack and Speed; Bulwark maxes HP and the higher of
 * Defense/Special Defense. The nature boosts whichever offensive or defensive stat the spread invested in.
 */
interface Allocation {
  evs: StatSpread;
  /** Which non-HP stat the nature boosts. */
  boosted: keyof StatSpread;
}

function allocate(base: StatSpread, kind: SpreadKind): Allocation {
  const zero: StatSpread = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  if (kind === 'assault') {
    const offence: keyof StatSpread = base.atk >= base.spa ? 'atk' : 'spa';
    return {
      evs: { ...zero, [offence]: MAX_EVS_PER_STAT, spe: MAX_EVS_PER_STAT, hp: SMALL_EVS },
      boosted: offence,
    };
  }
  const defence: keyof StatSpread = base.def >= base.spd ? 'def' : 'spd';
  return {
    evs: { ...zero, hp: MAX_EVS_PER_STAT, [defence]: MAX_EVS_PER_STAT, spe: SMALL_EVS },
    boosted: defence,
  };
}

/** A piece's full stat line, ready for the damage pipeline. */
export interface PieceStats extends StatSpread {
  readonly kind: SpreadKind;
  readonly maxHp: number;
}

/**
 * Computes a piece's level-50 stats.
 *
 * `maxHp` and `hp` are the same value here — the starting HP — because damage is tracked separately on
 * the live piece; this returns the ceiling.
 */
export function computeStats(species: SpeciesEntry, threshold = 60, level = LEVEL): PieceStats {
  const base = baseSpreadOf(species);
  const kind: SpreadKind = isBulwark(base, threshold) ? 'bulwark' : 'assault';
  const { evs, boosted } = allocate(base, kind);
  const maxHp = maxHpOf(species, level);

  const stat = (key: Exclude<keyof StatSpread, 'hp'>) =>
    applyNature(rawStat(base[key], evs[key], level), boosted === key);

  return {
    kind,
    maxHp,
    hp: maxHp,
    atk: stat('atk'),
    def: stat('def'),
    spa: stat('spa'),
    spd: stat('spd'),
    spe: stat('spe'),
  };
}

/** Stage multipliers for the standard −6..+6 boost ladder. */
const STAGE_NUMERATOR = [2, 2, 2, 2, 2, 2, 2, 3, 4, 5, 6, 7, 8] as const;
const STAGE_DENOMINATOR = [8, 7, 6, 5, 4, 3, 2, 2, 2, 2, 2, 2, 2] as const;

/**
 * Multiplier for a stat at a given boost stage, clamped to −6..+6.
 *
 * Standard for Attack/Defense/etc.: +1 is ×1.5, +2 is ×2, and so on; −1 is ×2/3. Accuracy and evasion use
 * a different table not modelled here.
 */
export function stageMultiplier(stage: number): number {
  const clamped = Math.max(-6, Math.min(6, Math.trunc(stage)));
  const index = clamped + 6;
  return STAGE_NUMERATOR[index]! / STAGE_DENOMINATOR[index]!;
}
