/**
 * The field — weather over the whole board, and hazards laid on one side of it.
 *
 * These are the effects that belong to the *battlefield* rather than to a piece, and they are what make a
 * position have weather to read and ground to fear. Both are real Pokémon systems and both land naturally
 * on a chess board:
 *
 * - **Weather** is global and timed. It scales Fire and Water damage (the pipeline's `weatherMod` hook was
 *   left for exactly this), and Sandstorm and Snow chip the pieces that do not resist them at the Checkup.
 * - **Hazards** are laid on a *band of the enemy's side* (SPEC §8.5's `FOE_ZONE`) and punish a piece that
 *   ends its move there. Spikes bite by weight of layers, Stealth Rock by the arriver's type, Toxic Spikes
 *   poison rather than damage, and Sticky Web drops Speed — which in this variant is the harshest of the
 *   four, because Speed decides who swings first.
 *
 * Kept as plain data with pure helpers, so the field is part of the replayable game state like everything
 * else: a game is still its seed plus its action list.
 */

import type { BattleType } from '../data/schema.ts';
import { effectiveness } from './typechart.ts';
import type { Side, Square } from './board.ts';

// ---------------------------------------------------------------------------
// Weather
// ---------------------------------------------------------------------------

export type WeatherKind = 'sun' | 'rain' | 'sand' | 'snow';

export const WEATHER_KINDS: readonly WeatherKind[] = ['sun', 'rain', 'sand', 'snow'];

/** How many of the setter's turns weather lasts — the games' five, which is long enough to matter. */
export const WEATHER_TURNS = 5;

export interface Weather {
  readonly kind: WeatherKind;
  /** Turns remaining; decremented at each Checkup and cleared at zero. */
  readonly turns: number;
}

export const WEATHER_LABEL: Readonly<Record<WeatherKind, string>> = {
  sun: 'Harsh sunlight', rain: 'Rain', sand: 'Sandstorm', snow: 'Snow',
};

/** Showdown's own weather ids, so a move's `weather` field maps onto ours without a lookup table per move. */
export function weatherFromMoveField(raw: string | undefined): WeatherKind | null {
  if (!raw) return null;
  switch (raw.toLowerCase()) {
    case 'sunnyday': case 'desolateland': return 'sun';
    case 'raindance': case 'primordialsea': return 'rain';
    case 'sandstorm': return 'sand';
    case 'snowscape': case 'snow': case 'hail': return 'snow';
    default: return null;
  }
}

/**
 * The damage multiplier weather applies to a move of a given type — the games' own ×1.5 / ×0.5.
 *
 * Sun strengthens Fire and weakens Water; rain does the reverse. Sand and Snow do not scale damage (their
 * bite is the Checkup chip and, in the games, a Rock/Ice defensive boost not modelled here).
 */
export function weatherDamageMod(weather: Weather | null, moveType: BattleType): number {
  if (!weather) return 1;
  if (weather.kind === 'sun') {
    if (moveType === 'Fire') return 1.5;
    if (moveType === 'Water') return 0.5;
  }
  if (weather.kind === 'rain') {
    if (moveType === 'Water') return 1.5;
    if (moveType === 'Fire') return 0.5;
  }
  return 1;
}

/** Types that shrug off a Sandstorm, exactly as in the games. */
const SAND_IMMUNE: readonly BattleType[] = ['Rock', 'Ground', 'Steel'];

/**
 * The fraction of max HP weather takes at a Checkup from a piece of this type, or 0.
 *
 * A sixteenth is the games' rate. Snow does no chip damage in gen 9 (it boosts Ice defence instead), so
 * only Sandstorm bites — and that asymmetry is itself information a player can use.
 */
export function weatherChipFraction(weather: Weather | null, type: BattleType): number {
  if (!weather || weather.kind !== 'sand') return 0;
  return SAND_IMMUNE.includes(type) ? 0 : 1 / 16;
}

/** Ages weather by one Checkup, clearing it when it runs out. */
export function tickWeather(weather: Weather | null): Weather | null {
  if (!weather) return null;
  const turns = weather.turns - 1;
  return turns <= 0 ? null : { kind: weather.kind, turns };
}

// ---------------------------------------------------------------------------
// Hazards
// ---------------------------------------------------------------------------

/**
 * Screens — a side's own defensive wards, as opposed to hazards laid on the enemy's.
 *
 * Reflect halves physical damage and Light Screen halves special damage for the side that raised it, which is
 * the games' behaviour and a genuinely different kind of art: every other art shapes the opponent's ground,
 * while a screen protects your own army.
 */
export type ScreenKind = 'reflect' | 'lightscreen';

export const SCREEN_KINDS: readonly ScreenKind[] = ['reflect', 'lightscreen'];

export const SCREEN_LABEL: Readonly<Record<ScreenKind, string>> = {
  reflect: 'Reflect', lightscreen: 'Light Screen',
};

/** How long a screen lasts, in its owner's turns — the games' five. */
export const SCREEN_TURNS = 5;

/** Showdown's `sideCondition` id → our screen, or null. */
export function screenFromSideCondition(raw: string | undefined): ScreenKind | null {
  if (!raw) return null;
  const id = raw.toLowerCase();
  return (SCREEN_KINDS as readonly string[]).includes(id) ? (id as ScreenKind) : null;
}

/** The damage multiplier a side's screens apply to a blow of this category — never above 1. */
export function screenMod(screens: SideScreens | undefined, category: 'Physical' | 'Special'): number {
  if (!screens) return 1;
  const kind: ScreenKind = category === 'Physical' ? 'reflect' : 'lightscreen';
  return (screens[kind] ?? 0) > 0 ? 0.5 : 1;
}

/** Turns remaining on each of a side's screens. An absent key means no screen. */
export type SideScreens = Readonly<Partial<Record<ScreenKind, number>>>;

/** Ages a side's screens by one of its turns, dropping any that expire. */
export function tickScreens(screens: SideScreens): SideScreens {
  const next: Partial<Record<ScreenKind, number>> = {};
  for (const kind of SCREEN_KINDS) {
    const left = (screens[kind] ?? 0) - 1;
    if (left > 0) next[kind] = left;
  }
  return next;
}

export type HazardKind = 'spikes' | 'stealthrock' | 'toxicspikes' | 'stickyweb';

export const HAZARD_KINDS: readonly HazardKind[] = ['spikes', 'stealthrock', 'toxicspikes', 'stickyweb'];

export const HAZARD_LABEL: Readonly<Record<HazardKind, string>> = {
  spikes: 'Spikes', stealthrock: 'Stealth Rock', toxicspikes: 'Toxic Spikes', stickyweb: 'Sticky Web',
};

/** How many layers of each hazard may stack, following the games. */
export const HAZARD_MAX_LAYERS: Readonly<Record<HazardKind, number>> = {
  spikes: 3, stealthrock: 1, toxicspikes: 2, stickyweb: 1,
};

/** Showdown's `sideCondition` id → our hazard, or null for a condition we do not model. */
export function hazardFromSideCondition(raw: string | undefined): HazardKind | null {
  if (!raw) return null;
  const id = raw.toLowerCase();
  return (HAZARD_KINDS as readonly string[]).includes(id) ? (id as HazardKind) : null;
}

/** Layers of each hazard on one square. An absent key is zero layers. */
export type SquareHazards = Readonly<Partial<Record<HazardKind, number>>>;

/**
 * Hazards on the board, keyed by square.
 *
 * Keyed by square rather than by side because a chess board has geography: a hazard band sits on specific
 * squares, and a piece is punished for standing *there*, which is a spatial decision a player can play
 * around — the whole point of putting hazards on a board rather than on a team.
 */
export type Hazards = ReadonlyMap<Square, SquareHazards>;

/** Adds a layer of a hazard to a square, respecting the per-hazard cap. Returns the square's new layers. */
export function addHazardLayer(current: SquareHazards, kind: HazardKind): SquareHazards {
  const at = current[kind] ?? 0;
  if (at >= HAZARD_MAX_LAYERS[kind]) return current;
  return { ...current, [kind]: at + 1 };
}

/**
 * What a piece suffers on arriving at a hazardous square.
 *
 * Damage is a fraction of max HP, following the games: Spikes 1/8, 1/6, 1/4 by layers; Stealth Rock
 * 1/8 scaled by the Rock matchup against the arriver, so a Flying piece takes a quarter and a Steel one a
 * thirty-second — the same type reasoning the rest of the game runs on. Toxic Spikes poisons instead of
 * damaging, and Sticky Web drops Speed.
 */
export interface HazardToll {
  /** Fraction of max HP to take, 0 for none. */
  readonly damageFraction: number;
  /** A status mark to apply, or null. */
  readonly status: string | null;
  /** Stage changes to apply, or null. */
  readonly boosts: Readonly<Record<string, number>> | null;
}

const SPIKES_FRACTION = [0, 1 / 8, 1 / 6, 1 / 4] as const;

export function hazardToll(hazards: SquareHazards | undefined, arriverType: BattleType): HazardToll {
  if (!hazards) return { damageFraction: 0, status: null, boosts: null };

  let damageFraction = 0;

  const spikes = hazards.spikes ?? 0;
  if (spikes > 0) damageFraction += SPIKES_FRACTION[Math.min(spikes, 3)]!;

  if ((hazards.stealthrock ?? 0) > 0) {
    // The arriver's own type decides how much the rocks hurt — 1/8 at neutral, doubling per weakness.
    damageFraction += (1 / 8) * effectiveness('Rock', arriverType);
  }

  const toxic = hazards.toxicspikes ?? 0;
  const status = toxic >= 2 ? 'badly-poisoned' : toxic === 1 ? 'poisoned' : null;
  const boosts = (hazards.stickyweb ?? 0) > 0 ? { spe: -1 } : null;

  return { damageFraction, status, boosts };
}

/**
 * The band a hazard is laid on: three squares of the enemy's third rank, on the caster's file ±1.
 *
 * SPEC §8.5's `FOE_ZONE`. Rank 5 (index) when White casts and rank 2 when Black casts — the enemy's third
 * rank counted from their own back rank — clamped at the a- and h-files so a cast near an edge still lays
 * three squares' worth of intent rather than silently losing one.
 */
export function hazardZone(caster: Side, casterFile: number): Square[] {
  const rank = caster === 'white' ? 5 : 2;
  const first = Math.max(0, Math.min(5, casterFile - 1));
  return [first, first + 1, first + 2].map((file) => rank * 8 + file);
}

// ---------------------------------------------------------------------------
// The field as one value
// ---------------------------------------------------------------------------

export interface Field {
  readonly weather: Weather | null;
  readonly hazards: Hazards;
  /** Each side's own screens. */
  readonly screens: Readonly<Record<Side, SideScreens>>;
}

export const EMPTY_FIELD: Field = {
  weather: null,
  hazards: new Map(),
  screens: { white: {}, black: {} },
};

/** Whether a field has anything on it at all — the cheap test the UI uses before rendering. */
export function fieldIsEmpty(field: Field): boolean {
  return field.weather === null
    && field.hazards.size === 0
    && Object.keys(field.screens.white).length === 0
    && Object.keys(field.screens.black).length === 0;
}
