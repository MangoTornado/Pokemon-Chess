/**
 * The damage pipeline — the canonical gen-9 order of operations, no invented factor at any step.
 *
 * One pure function. Every multiplier is a real number from the real games, which is the point: a Smogon
 * reader can check the arithmetic, and there is no fitted σ or fudge scalar to make a knowledgeable
 * player's own maths wrong. See SPEC §5, whose worked example (Gengar's Shadow Ball for 174 against
 * Espeon) this module reproduces exactly and the tests pin.
 *
 * Modifier ordering follows the TCG ruling in `recon-tcg.md` §11.4: attacker bonuses, then the type
 * modifier, then defender reductions, and a defender hook may only ever reduce. The ability- and
 * item-driven steps (2, 13, 14) are expressed as explicit multiplier inputs defaulting to 1, because the
 * abilities and items that populate them are compiled by a system not built yet; wiring them later is a
 * matter of passing non-1 values, not of touching this formula.
 */

import type { BattleType } from '../data/schema.ts';
import { effectiveness } from '../engine/typechart.ts';
import { stageMultiplier } from './stats.ts';

const LEVEL = 50;
/** `2 · level / 5 + 2`, which is `22` at level 50 — the level term of the damage formula. */
const LEVEL_TERM = (2 * LEVEL) / 5 + 2;

export type MoveCategory = 'Physical' | 'Special' | 'Status';

/** Everything the formula reads. Pure data; no game-state references. */
export interface DamageInput {
  readonly attackerType: BattleType;
  readonly defenderType: BattleType | readonly BattleType[];
  readonly moveType: BattleType;
  readonly category: Exclude<MoveCategory, 'Status'>;
  readonly basePower: number;
  /** Attacker's relevant offensive stat (Attack for Physical, Special Attack for Special). */
  readonly offensiveStat: number;
  /** Defender's relevant defensive stat. */
  readonly defensiveStat: number;

  /** Attacker's offensive-stat boost stage, −6..+6. */
  readonly offensiveStage?: number;
  /** Defender's defensive-stat boost stage. A crit ignores a positive one. */
  readonly defensiveStage?: number;

  /** True when the move's type is one of the attacker's types (same-type attack bonus). */
  readonly stab?: boolean;
  /** The random spread, 85..100, made public as "Momentum". */
  readonly momentum?: number;
  readonly crit?: boolean;
  /** True when the action hits more than one square (spread move); applies the ×0.75. */
  readonly spread?: boolean;
  /** True when the attacker is burned and the move is Physical (unless Guts, handled upstream). */
  readonly burned?: boolean;

  // The compiler wires these later. Default 1 = no ability/item bonus.
  /** Step 2: attacker base-power hooks (Technician, Tough Claws, plates, terrain…). */
  readonly basePowerMod?: number;
  /** Step 13: attacker final modifiers (Life Orb ×1.3, Expert Belt ×1.2…). */
  readonly attackerFinalMod?: number;
  /** Step 14: defender final modifiers — must be ≤ 1 (screens, Filter, resist berries…). */
  readonly defenderFinalMod?: number;
  /** Weather multiplier on the move's damage (sun/rain on Fire/Water). Default 1. */
  readonly weatherMod?: number;
}

/**
 * A crit multiplies by this and ignores the defender's positive defensive stages.
 *
 * Gen 6+ uses ×1.5, not the older ×2. The SPEC's worked examples assume ×1.5.
 */
export const CRIT_MULTIPLIER = 1.5;
const STAB_MULTIPLIER = 1.5;
const SPREAD_MULTIPLIER = 0.75;
const BURN_MULTIPLIER = 0.5;

/** Damage as an integer, minimum 1 (0 only when the move is type-immune, which is never generated). */
export function computeDamage(input: DamageInput): number {
  const eff = effectiveness(input.moveType, input.defenderType);
  if (eff === 0) return 0;

  const crit = input.crit ?? false;
  const offStage = input.offensiveStage ?? 0;
  const defStage = input.defensiveStage ?? 0;

  // A crit ignores a defensive boost but keeps a defensive drop, and mirrors for the attacker's own
  // offensive drop, exactly as the games do.
  const effectiveOffStage = crit ? Math.max(0, offStage) : offStage;
  const effectiveDefStage = crit ? Math.min(0, defStage) : defStage;

  const bp = Math.max(1, Math.floor(input.basePower * (input.basePowerMod ?? 1)));
  const atk = Math.floor(input.offensiveStat * stageMultiplier(effectiveOffStage));
  const def = Math.max(1, Math.floor(input.defensiveStat * stageMultiplier(effectiveDefStage)));

  // Step 5: the base-damage core.
  let damage = Math.floor(Math.floor((LEVEL_TERM * bp * atk) / def) / 50) + 2;

  // Steps 6–14 are ordered multipliers, each floored, matching the SPEC's worked arithmetic.
  const mul = (factor: number) => {
    damage = Math.floor(damage * factor);
  };

  if (input.spread) mul(SPREAD_MULTIPLIER);
  if ((input.weatherMod ?? 1) !== 1) mul(input.weatherMod ?? 1);
  if (crit) mul(CRIT_MULTIPLIER);
  mul((input.momentum ?? 100) / 100);
  if (input.stab) mul(STAB_MULTIPLIER);
  mul(eff);
  if (input.burned && input.category === 'Physical') mul(BURN_MULTIPLIER);
  if ((input.attackerFinalMod ?? 1) !== 1) mul(input.attackerFinalMod ?? 1);
  // Defender hooks may only reduce; clamp to ≤ 1 so a mis-wired bonus can never inflate damage.
  const defMod = Math.min(1, input.defenderFinalMod ?? 1);
  if (defMod !== 1) mul(defMod);

  return Math.max(1, damage);
}

/** One ordered step of the modifier trace, for the UI. */
export interface DamageStep {
  readonly label: string;
  readonly value: number;
}

export interface DamageExplanation {
  readonly damage: number;
  readonly effectiveness: number;
  readonly crit: boolean;
  readonly stab: boolean;
  readonly steps: readonly DamageStep[];
}

/**
 * Damage with the ordered trace, for the UI only.
 *
 * A lint boundary keeps `src/ai/**` from importing this: allocating a step array on the hottest path in
 * the program is how `recon-tech.md`'s measured GC spikes come back during deep search. The AI calls
 * {@link computeDamage}.
 */
export function explainDamage(input: DamageInput): DamageExplanation {
  const eff = effectiveness(input.moveType, input.defenderType);
  const steps: DamageStep[] = [];
  if (eff === 0) {
    return { damage: 0, effectiveness: 0, crit: false, stab: false, steps };
  }

  const crit = input.crit ?? false;
  const offStage = input.offensiveStage ?? 0;
  const defStage = input.defensiveStage ?? 0;
  const effectiveOffStage = crit ? Math.max(0, offStage) : offStage;
  const effectiveDefStage = crit ? Math.min(0, defStage) : defStage;

  const bp = Math.max(1, Math.floor(input.basePower * (input.basePowerMod ?? 1)));
  const atk = Math.floor(input.offensiveStat * stageMultiplier(effectiveOffStage));
  const def = Math.max(1, Math.floor(input.defensiveStat * stageMultiplier(effectiveDefStage)));

  let damage = Math.floor(Math.floor((LEVEL_TERM * bp * atk) / def) / 50) + 2;
  steps.push({ label: `base (BP ${bp}, ${atk} vs ${def})`, value: damage });

  const step = (label: string, factor: number) => {
    if (factor === 1) return;
    damage = Math.floor(damage * factor);
    steps.push({ label, value: damage });
  };

  step('spread ×0.75', input.spread ? SPREAD_MULTIPLIER : 1);
  step(`weather ×${input.weatherMod ?? 1}`, input.weatherMod ?? 1);
  step('critical hit ×1.5', crit ? CRIT_MULTIPLIER : 1);
  step(`momentum ×${(input.momentum ?? 100) / 100}`, (input.momentum ?? 100) / 100);
  step('STAB ×1.5', input.stab ? STAB_MULTIPLIER : 1);
  step(`type ×${eff}`, eff);
  step('burn ×0.5', input.burned && input.category === 'Physical' ? BURN_MULTIPLIER : 1);
  step(`item/ability ×${input.attackerFinalMod ?? 1}`, input.attackerFinalMod ?? 1);
  step(`defender ×${Math.min(1, input.defenderFinalMod ?? 1)}`, Math.min(1, input.defenderFinalMod ?? 1));

  damage = Math.max(1, damage);
  return { damage, effectiveness: eff, crit, stab: input.stab ?? false, steps };
}
