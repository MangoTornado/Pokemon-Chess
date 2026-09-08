/**
 * Redirection — when a piece other than the one you attacked answers for it.
 *
 * This is the last of the games' mechanics with no home in the Clash, and the reason is structural rather
 * than incidental: a Clash is an exchange between exactly two pieces, so redirection needs a *third* piece to
 * be able to step into it. That is why it is handled here, before a Clash begins, by choosing who the
 * defender actually is — the Clash itself never learns that a substitution happened.
 *
 * On a board it becomes something chess already understands: a bodyguard. Two sources, both real:
 *
 * - **A drawn type** (Lightning Rod, Storm Drain). These two abilities' own text says they *draw* moves of a
 *   type to themselves, and they already grant immunity to it (`abilities.ts`), so an attack they intercept is
 *   absorbed outright — no damage to anyone, and the drawer's Sp. Atk rises. A standing threat that quietly
 *   makes a whole type unplayable in its neighbourhood.
 * - **A cast guard** (Follow Me, Rage Powder, Spotlight). A piece spends its turn volunteering, and until its
 *   side moves again, attacks on the allies around it are answered by *it* instead. That is a real defensive
 *   move in chess terms: it lets you shield a piece you could not otherwise defend, at the cost of a tempo and
 *   of standing in the way yourself.
 *
 * A guard fights the Clash in the target's place, so the attacker can be routed by a piece it never attacked
 * — but it also gains no ground when it wins, because the square it attacked was never actually contested.
 * That asymmetry is the point: redirection trades material for position.
 */

import type { BattleType } from '../data/schema.ts';

/**
 * Abilities that pull an attack aimed at a *neighbour* onto their bearer.
 *
 * Deliberately just these two. Plenty of abilities grant a type immunity (`ABILITY_IMMUNE_TYPE` lists eleven),
 * but immunity only says "this does not hurt me"; drawing says "this comes to me instead", and only Lightning
 * Rod and Storm Drain claim that in the games. Widening the set would invent behaviour rather than model it.
 */
export const ABILITY_DRAWS_TYPE: Readonly<Record<string, BattleType>> = {
  lightningrod: 'Electric',
  stormdrain: 'Water',
};

/** What a successful draw grants its bearer — the games' +1 Sp. Atk for both. */
export const DRAW_BOOST: Readonly<Record<string, number>> = { spa: 1 };

/** The type an ability draws, or null if it draws nothing. */
export function abilityDraws(ability: string | undefined): BattleType | null {
  if (ability === undefined) return null;
  return ABILITY_DRAWS_TYPE[ability] ?? null;
}

/**
 * The `volatileStatus` ids that make a move a guard cast.
 *
 * Read off the move data rather than listed by name: each of these three moves' whole function is to become
 * the target of everything aimed at its allies, which is what `artOfMove` needs to recognise.
 */
export const GUARD_VOLATILES: ReadonlySet<string> = new Set(['followme', 'ragepowder', 'spotlight']);

/** Whether a move's volatile marks it as a guard cast. */
export function guardFromVolatile(raw: string | undefined): boolean {
  return raw !== undefined && GUARD_VOLATILES.has(raw.toLowerCase());
}

/**
 * How long a cast guard holds.
 *
 * One round: it covers the opponent's reply and then lapses, exactly as Follow Me does in the games, where it
 * lasts for the turn it was used. Longer would make a single tempo buy a permanent shield.
 */
export const GUARD_TURNS = 1;

/** Why a Clash is being fought by someone other than the piece that was attacked. */
export type InterceptKind =
  /** An ability drew the attack: it is absorbed outright, and the drawer's Sp. Atk rises. */
  | 'draw'
  /** A cast guard is answering for its neighbour: a real Clash, against the guard. */
  | 'guard';

/** Who is answering for the attacked piece, and why. */
export interface Interception {
  readonly pieceId: number;
  readonly square: number;
  readonly kind: InterceptKind;
  /** The ability that drew it, for a `draw`. */
  readonly ability?: string;
}

/** The label the board and the log use for an interception. */
export function interceptLabel(kind: InterceptKind): string {
  return kind === 'draw' ? 'drew the attack' : 'took the hit';
}
