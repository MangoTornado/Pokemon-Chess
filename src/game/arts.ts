/**
 * Arts — the field moves a piece can cast instead of moving.
 *
 * A capture uses one of the four damaging slots (`moveset.ts`); a piece's *art* is the one status move it
 * knows that changes the battlefield rather than a target: a weather setter, or a hazard layer. Giving each
 * piece at most one keeps the decision legible — "this Pokémon can call the rain" — and keeps the action
 * list short, while still drawing entirely from the species' real learnset, so a Politoed setting rain and
 * a Ferrothorn laying Spikes are both authentic.
 *
 * Chosen deterministically from the species and seed, like the rest of the draft.
 */

import type { Dex } from '../data/dex.ts';
import type { MoveEntry } from '../data/schema.ts';
import { hazardFromSideCondition, weatherFromMoveField } from '../engine/field.ts';
import type { HazardKind, WeatherKind } from '../engine/field.ts';
import { Rng } from '../engine/rng.ts';

/** What casting an art does. */
export type ArtEffect =
  | { readonly kind: 'weather'; readonly weather: WeatherKind }
  | { readonly kind: 'hazard'; readonly hazard: HazardKind };

/** A castable field move: what it is called, and what it does. */
export interface Art {
  readonly id: string;
  readonly name: string;
  readonly effect: ArtEffect;
}

/** Reads a move as an art, or null if it changes no field state. */
export function artOfMove(move: MoveEntry): Art | null {
  const weather = weatherFromMoveField(move.weather);
  if (weather) return { id: move.id, name: move.name, effect: { kind: 'weather', weather } };
  const hazard = hazardFromSideCondition(move.sideCondition);
  if (hazard) return { id: move.id, name: move.name, effect: { kind: 'hazard', hazard } };
  return null;
}

/**
 * The art a piece fights with, or null if its species knows no field move.
 *
 * Most Pokémon know none, and that is the point: a rain team is built, not stumbled into, so the pieces that
 * *can* shape the field are a real asset in the draft. A hazard layer is preferred over a weather setter
 * when a species knows both, because hazards are the more positional (and so more chess-like) of the two.
 */
export function pickArt(dex: Dex, speciesId: string, seed: string | number): Art | null {
  const candidates = dex
    .learnsetOf(speciesId)
    .filter((m) => m.category === 'Status')
    .map(artOfMove)
    .filter((a): a is Art => a !== null);
  if (candidates.length === 0) return null;

  const hazards = candidates.filter((a) => a.effect.kind === 'hazard');
  const pool = hazards.length > 0 ? hazards : candidates;
  return new Rng(`art:${seed}:${speciesId}`).pick(pool);
}
