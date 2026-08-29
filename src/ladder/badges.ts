/**
 * The Kanto gym leaders and their badges — the ladder's progression spine (SPEC §17.8–17.9).
 *
 * **The loop.** Rating comes from beating real players; a gym leader is the milestone that marks each rung
 * of that climb. Reach a leader's required rating and they will accept your challenge; win and the badge is
 * yours; then go back to the queue and climb toward the next one. So the badges chart a competitive career
 * rather than forming a separate single-player corridor — which is what makes them worth having.
 *
 * A leader fields a **mono-type army**, the right shape for this game because type is the core mechanic: one
 * known set of weaknesses, so the fight is a solvable type puzzle that teaches the chart by making the
 * player use it (DIRECTION §6). The eight badges are the canon Kanto order, and "highest badge earned" is an
 * achievement a losing streak never strips (§17.8), so the case only ever grows.
 *
 * Each leader carries a compensating AI budget: a mono-type army sits at roughly a 100–150 Elo composition
 * handicap (§19.6), so the difficulty rises down the list to keep each fight a real gate rather than a
 * formality — Brock is a teaching fight, Giovanni is not.
 */

import type { BattleType } from '../data/schema.ts';

export interface GymLeader {
  /** Stable id, stored in the badge case. Never rename. */
  readonly id: string;
  readonly leader: string;
  readonly badge: string;
  readonly city: string;
  /** The single type the leader's whole army fights as. */
  readonly type: BattleType;
  /** Canon order, 1..8 — also the display order and the difficulty ramp. */
  readonly order: number;
  /** The rating this leader plays at, for the Elo update when the player wins or loses. */
  readonly rating: number;
  /**
   * The rating a player must reach before this leader will accept the challenge.
   *
   * This is what makes the ladder a loop rather than a corridor: you climb by beating *players*, and a
   * badge is the milestone that marks each rung. Brock's gate is the base rating, so a new account can earn
   * its first badge at once; Giovanni's is the Champion League floor.
   */
  readonly ratingRequired: number;
  /** AI search depth (sub-moves) — the compensating budget for the mono-type handicap. */
  readonly depth: number;
  /** How often the AI misjudges a type (0 = perfect). Falls to zero for the last gyms. */
  readonly typeBlindness: number;
  /** One line of flavour shown on the challenge card. */
  readonly taunt: string;
}

export const GYM_LEADERS: readonly GymLeader[] = [
  { id: 'boulder', leader: 'Brock', badge: 'Boulder Badge', city: 'Pewter City', type: 'Rock', order: 1, rating: 1300, ratingRequired: 1500, depth: 2, typeBlindness: 0.3, taunt: 'My rock-hard willpower is evident even in my Pokémon.' },
  { id: 'cascade', leader: 'Misty', badge: 'Cascade Badge', city: 'Cerulean City', type: 'Water', order: 2, rating: 1400, ratingRequired: 1550, depth: 2, typeBlindness: 0.2, taunt: "You're gonna fall for my tomboyish charm — and my Water Pokémon." },
  { id: 'thunder', leader: 'Lt. Surge', badge: 'Thunder Badge', city: 'Vermilion City', type: 'Electric', order: 3, rating: 1500, ratingRequired: 1600, depth: 3, typeBlindness: 0.15, taunt: "I tell you, kid, electric Pokémon saved me during the war!" },
  { id: 'rainbow', leader: 'Erika', badge: 'Rainbow Badge', city: 'Celadon City', type: 'Grass', order: 4, rating: 1580, ratingRequired: 1650, depth: 3, typeBlindness: 0.1, taunt: 'Oh… I must have dozed off. Very well — my Grass Pokémon and I accept.' },
  { id: 'soul', leader: 'Koga', badge: 'Soul Badge', city: 'Fuchsia City', type: 'Poison', order: 5, rating: 1650, ratingRequired: 1700, depth: 3, typeBlindness: 0.05, taunt: 'A ninja should be able to melt into the shadows — as should his poison.' },
  { id: 'marsh', leader: 'Sabrina', badge: 'Marsh Badge', city: 'Saffron City', type: 'Psychic', order: 6, rating: 1720, ratingRequired: 1780, depth: 3, typeBlindness: 0.02, taunt: 'I had a vision of your arrival. My Psychic power will end you.' },
  { id: 'volcano', leader: 'Blaine', badge: 'Volcano Badge', city: 'Cinnabar Island', type: 'Fire', order: 7, rating: 1800, ratingRequired: 1860, depth: 4, typeBlindness: 0, taunt: 'Hah! Hope you brought Burn Heal — my Fire Pokémon are white-hot!' },
  { id: 'earth', leader: 'Giovanni', badge: 'Earth Badge', city: 'Viridian City', type: 'Ground', order: 8, rating: 1900, ratingRequired: 1950, depth: 4, typeBlindness: 0, taunt: 'So. You have made it this far. I am the greatest — my Ground Pokémon will bury you.' },
];

export const GYM_BY_ID: ReadonlyMap<string, GymLeader> = new Map(GYM_LEADERS.map((g) => [g.id, g]));

/** The gym a player should face next: the lowest-order gym not yet beaten. Null once all eight are earned. */
export function nextGym(earned: ReadonlySet<string>): GymLeader | null {
  return GYM_LEADERS.find((g) => !earned.has(g.id)) ?? null;
}

/** The highest badge earned, for the profile chip — or null if the case is empty. */
export function highestBadge(earned: ReadonlySet<string>): GymLeader | null {
  let best: GymLeader | null = null;
  for (const g of GYM_LEADERS) if (earned.has(g.id) && (!best || g.order > best.order)) best = g;
  return best;
}

/**
 * Whether a gym will accept a challenge right now.
 *
 * Two gates, and the rating one is the important one: gyms open in canon order (you cannot skip to
 * Giovanni, which keeps each fight a fair difficulty step), *and* you must have climbed to the leader's
 * required rating first. That makes the ladder a loop — climb against real players, then take the badge
 * that marks the rung, then go back to climbing — rather than a corridor of eight AI fights.
 *
 * An already-earned gym is always open, for an unrated rematch.
 */
export function isGymUnlocked(gym: GymLeader, earned: ReadonlySet<string>, rating: number): boolean {
  if (earned.has(gym.id)) return true;
  if (nextGym(earned)?.id !== gym.id) return false;
  return rating >= gym.ratingRequired;
}

/**
 * Why the next gym is not yet available, or null if it is (or none remain).
 *
 * Returned as data rather than a string so the UI can render a progress bar toward the gate.
 */
export function gymGate(earned: ReadonlySet<string>, rating: number): { gym: GymLeader; needed: number } | null {
  const next = nextGym(earned);
  if (!next || rating >= next.ratingRequired) return null;
  return { gym: next, needed: next.ratingRequired - rating };
}
