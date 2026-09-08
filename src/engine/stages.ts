/**
 * Stat stages — the boost/drop layer, and the most consequential effect in this variant.
 *
 * In the games a stage change is one of many modifiers. Here it is sharper than that, because the Clash
 * decides who swings first by Speed (`clash.ts`): a single −1 Speed drop can flip the whole order of an
 * exchange, turning a trade you would win into one you lose. So Icy Wind is not chip damage in Pokémon
 * Chess — it is a tempo weapon, and that is exactly the kind of depth the type layer deserves.
 *
 * Stages persist for the rest of the game rather than resetting, because there is no switching here: a
 * piece is on the board until it falls. That makes an accumulated −2 Speed a real, lasting wound, and it is
 * why the board shows stages rather than hiding them.
 *
 * The damage pipeline already reads `offensiveStage`/`defensiveStage` and `stats.ts` already has the
 * canonical multiplier table, so this module only has to hold and combine the numbers.
 */

/** The five battle stats a stage can apply to. Accuracy and evasion are not modelled (see SPEC §9). */
export type StatKey = 'atk' | 'def' | 'spa' | 'spd' | 'spe';

export const STAT_KEYS: readonly StatKey[] = ['atk', 'def', 'spa', 'spd', 'spe'];

/** Stages a piece is carrying, −6..+6 each. An absent key is stage 0, so a fresh piece stores nothing. */
export type StatStages = Readonly<Partial<Record<StatKey, number>>>;

/** The hard bounds the games use. */
export const MIN_STAGE = -6;
export const MAX_STAGE = 6;

/** Display labels, for the board and the panel. */
export const STAT_LABEL: Readonly<Record<StatKey, string>> = {
  atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Spe',
};

/** The stage for one stat, defaulting to 0. */
export function stageOf(stages: StatStages | undefined, key: StatKey): number {
  return stages?.[key] ?? 0;
}

/** Whether a piece carries any stage at all — the cheap test the UI uses before rendering markers. */
export function hasAnyStage(stages: StatStages | undefined): boolean {
  if (!stages) return false;
  return STAT_KEYS.some((k) => (stages[k] ?? 0) !== 0);
}

/**
 * Applies a set of stage changes, clamped to −6..+6.
 *
 * Unknown keys (accuracy, evasion) are ignored rather than stored, so a move that drops accuracy simply has
 * no stage effect here instead of writing state nothing reads.
 */
export function applyBoosts(current: StatStages, boosts: Readonly<Record<string, number>>): StatStages {
  const next: Partial<Record<StatKey, number>> = { ...current };
  for (const key of STAT_KEYS) {
    const delta = boosts[key];
    if (delta === undefined || delta === 0) continue;
    const combined = Math.max(MIN_STAGE, Math.min(MAX_STAGE, (next[key] ?? 0) + delta));
    if (combined === 0) delete next[key];
    else next[key] = combined;
  }
  return next;
}

/** Whether a set of boosts would change anything for a piece already at these stages (all at a bound). */
export function boostsWouldApply(current: StatStages, boosts: Readonly<Record<string, number>>): boolean {
  for (const key of STAT_KEYS) {
    const delta = boosts[key];
    if (delta === undefined || delta === 0) continue;
    const at = current[key] ?? 0;
    if (delta > 0 && at < MAX_STAGE) return true;
    if (delta < 0 && at > MIN_STAGE) return true;
  }
  return false;
}

/** A short human reading, e.g. `Spe −2, Atk +1`. Empty string when there are no stages. */
export function describeStages(stages: StatStages | undefined): string {
  if (!stages) return '';
  return STAT_KEYS
    .filter((k) => (stages[k] ?? 0) !== 0)
    .map((k) => `${STAT_LABEL[k]} ${(stages[k] ?? 0) > 0 ? '+' : '−'}${Math.abs(stages[k] ?? 0)}`)
    .join(', ');
}
