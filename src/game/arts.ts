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
import { hazardFromSideCondition, screenFromSideCondition, weatherFromMoveField } from '../engine/field.ts';
import type { HazardKind, ScreenKind, WeatherKind } from '../engine/field.ts';
import { Rng } from '../engine/rng.ts';

/** What casting an art does. */
export type ArtEffect =
  | { readonly kind: 'weather'; readonly weather: WeatherKind }
  | { readonly kind: 'hazard'; readonly hazard: HazardKind }
  | { readonly kind: 'screen'; readonly screen: ScreenKind };

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
  const screen = screenFromSideCondition(move.sideCondition);
  if (screen) return { id: move.id, name: move.name, effect: { kind: 'screen', screen } };
  return null;
}

/**
 * The art a piece fights with, or null if its species knows no field move.
 *
 * Most Pokémon know none, and that is the point: a rain team is built, not stumbled into, so the pieces that
 * *can* shape the field are a real asset in the draft. A hazard layer is preferred over a weather setter or a
 * screen when a species knows several, because hazards are the most positional — and so the most chess-like.
 */
export function pickArt(dex: Dex, speciesId: string, seed: string | number): Art | null {
  const candidates = candidateArts(dex, speciesId);
  if (candidates.length === 0) return null;

  const hazards = candidates.filter((a) => a.effect.kind === 'hazard');
  const pool = hazards.length > 0 ? hazards : candidates;
  return new Rng(`art:${seed}:${speciesId}`).pick(pool);
}

/**
 * Every art a species could cast — the choices a drafting player gets to make between.
 *
 * {@link pickArt} takes one of these for you; a Ferrothorn that can lay Spikes, set Stealth Rock *or* raise
 * Light Screen is three different pieces, and which one it is should be the player's call. Sorted by name so
 * the same species always offers its arts in the same order.
 */
export function candidateArts(dex: Dex, speciesId: string): Art[] {
  const seen = new Set<string>();
  const arts: Art[] = [];
  for (const move of dex.learnsetOf(speciesId)) {
    if (move.category !== 'Status') continue;
    const art = artOfMove(move);
    if (!art || seen.has(art.id)) continue;
    seen.add(art.id);
    arts.push(art);
  }
  return arts.sort((a, b) => a.name.localeCompare(b.name));
}
