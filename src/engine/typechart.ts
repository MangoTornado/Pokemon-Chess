/**
 * Type effectiveness, and the four capture outcomes it produces.
 *
 * This is the mechanical heart of Pokémon Chess. In ordinary chess a capture has one meaning; here
 * the type chart splits it into four, and that single change reprices every square on the board:
 *
 * | Multiplier | Outcome    | Consequence                                              |
 * |------------|------------|----------------------------------------------------------|
 * | `0`        | `immune`   | the capture is **illegal** — Ground cannot take Flying     |
 * | `< 1`      | `resisted` | **both** pieces are removed (mutual destruction)          |
 * | `1`        | `neutral`  | an ordinary chess capture                                 |
 * | `> 1`      | `super`    | the capture succeeds and the piece **moves again**         |
 *
 * The chart is loaded statically rather than fetched: it is about a kilobyte, and keeping the lookup
 * synchronous and side-effect-free is what allows AI search to call it millions of times.
 */

import { typechart as chart } from '../data/generated/typechart.ts';
import { BATTLE_TYPES } from '../data/schema.ts';
import type { BattleType, DexType } from '../data/schema.ts';

const TYPE_INDEX: Record<string, number> = Object.fromEntries(
  (chart.types as string[]).map((t, i) => [t, i]),
);

const MATRIX: readonly number[][] = chart.effectiveness as number[][];

/** Every type a piece may be drafted as. Excludes `Stellar`, which has no defensive profile. */
export const DRAFTABLE_TYPES: readonly BattleType[] = BATTLE_TYPES;

/**
 * Damage multiplier of `attacker` against a defender of one or more types.
 *
 * A Pokémon Chess piece carries exactly one type, so the single-type path is the hot one; the
 * multi-type form exists because some abilities and effects reason about real dual typings.
 */
export function effectiveness(attacker: DexType, defender: DexType | readonly DexType[]): number {
  const ai = TYPE_INDEX[attacker];
  if (ai === undefined) return 1;
  const row = MATRIX[ai];
  if (!row) return 1;

  if (typeof defender === 'string') {
    return row[TYPE_INDEX[defender] ?? -1] ?? 1;
  }
  let product = 1;
  for (const d of defender) {
    product *= row[TYPE_INDEX[d] ?? -1] ?? 1;
  }
  return product;
}

/** The four ways a capture attempt can resolve on type grounds. */
export type CaptureOutcome = 'immune' | 'resisted' | 'neutral' | 'super';

/** Classifies a multiplier into its capture outcome. */
export function outcomeOfMultiplier(multiplier: number): CaptureOutcome {
  if (multiplier === 0) return 'immune';
  if (multiplier < 1) return 'resisted';
  if (multiplier > 1) return 'super';
  return 'neutral';
}

/** How a capture of `defender` by `attacker` resolves, on type grounds alone. */
export function captureOutcome(
  attacker: DexType,
  defender: DexType | readonly DexType[],
): CaptureOutcome {
  return outcomeOfMultiplier(effectiveness(attacker, defender));
}

/** `true` when the type chart forbids this capture outright. */
export const isImmuneTo = (attacker: DexType, defender: DexType): boolean =>
  effectiveness(attacker, defender) === 0;

/** Types that cannot capture `defender` at all — the squares where it is untouchable. */
export function typesImmuneAgainst(defender: BattleType): BattleType[] {
  return DRAFTABLE_TYPES.filter((t) => effectiveness(t, defender) === 0);
}

/** Types `attacker` hits for extra effect, and so gets a free extra move against. */
export function typesSuperEffectiveAgainst(attacker: BattleType): BattleType[] {
  return DRAFTABLE_TYPES.filter((t) => effectiveness(attacker, t) > 1);
}

/** Types that would kill `attacker` along with themselves if it tried to capture them. */
export function typesResistedBy(attacker: BattleType): BattleType[] {
  return DRAFTABLE_TYPES.filter((t) => {
    const m = effectiveness(attacker, t);
    return m > 0 && m < 1;
  });
}

/**
 * Offensive and defensive profile of a type, precomputed for the draft UI.
 *
 * The premise of the game is that type knowledge is the edge, so the interface has to make this
 * legible without demanding the player already know all 324 interactions.
 */
export interface TypeProfile {
  type: BattleType;
  /** Types this one captures for a free extra move. */
  superEffectiveAgainst: BattleType[];
  /** Types where attempting a capture destroys both pieces. */
  resistedBy: BattleType[];
  /** Types this one cannot capture at all. */
  cannotCapture: BattleType[];
  /** Types that get a free extra move by capturing this one. */
  vulnerableTo: BattleType[];
  /** Types that destroy themselves trying to capture this one. */
  punishes: BattleType[];
  /** Types that cannot capture this one at all — the source of untouchability. */
  untouchableBy: BattleType[];
}

export function typeProfile(type: BattleType): TypeProfile {
  return {
    type,
    superEffectiveAgainst: typesSuperEffectiveAgainst(type),
    resistedBy: typesResistedBy(type),
    cannotCapture: DRAFTABLE_TYPES.filter((t) => effectiveness(type, t) === 0),
    vulnerableTo: DRAFTABLE_TYPES.filter((t) => effectiveness(t, type) > 1),
    punishes: DRAFTABLE_TYPES.filter((t) => {
      const m = effectiveness(t, type);
      return m > 0 && m < 1;
    }),
    untouchableBy: typesImmuneAgainst(type),
  };
}

/** All 18 profiles, computed once. */
export const TYPE_PROFILES: Record<BattleType, TypeProfile> = Object.fromEntries(
  DRAFTABLE_TYPES.map((t) => [t, typeProfile(t)]),
) as Record<BattleType, TypeProfile>;

/** The raw chart, for tooling and tests. */
export const TYPE_CHART = {
  types: chart.types as DexType[],
  effectiveness: MATRIX,
} as const;
