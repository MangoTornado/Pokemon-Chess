/**
 * Ability-granted type immunities — the first tranche of abilities that actually fire in a capture.
 *
 * The type chart already makes some captures illegal (Ground cannot touch Flying); abilities extend that
 * to individuals. A Bronzong with Levitate cannot be caught by a Ground piece at all, and a Jolteon with
 * Volt Absorb shrugs off Electric — which is exactly the kind of type-deepening the design is about, and
 * it composes with the board's existing "untouchable" affordance because it simply zeroes a matchup.
 *
 * A curated table rather than executing the content compiler: these immunities are few, well-defined, and
 * high-value, so a small verified map is the honest choice — the broader ISA interpreter (stat stages,
 * weather, hazards, damage multipliers, items) remains the larger frontier tracked in STATUS.
 */

import type { BattleType } from '../data/schema.ts';

/** Abilities that make their bearer wholly immune to one attacking type. */
export const ABILITY_IMMUNE_TYPE: Readonly<Record<string, BattleType>> = {
  levitate: 'Ground',
  eartheater: 'Ground',
  voltabsorb: 'Electric',
  lightningrod: 'Electric',
  motordrive: 'Electric',
  waterabsorb: 'Water',
  stormdrain: 'Water',
  dryskin: 'Water',
  flashfire: 'Fire',
  wellbakedbody: 'Fire',
  sapsipper: 'Grass',
};

/** Wonder Guard: only super-effective hits land at all. Handled specially where matchups are scored. */
export const WONDER_GUARD = 'wonderguard';

/** Whether a defender's ability makes it immune to an attack of `moveType`. */
export function abilityGrantsImmunity(ability: string | undefined, moveType: BattleType): boolean {
  return ability !== undefined && ABILITY_IMMUNE_TYPE[ability] === moveType;
}

/** The human-readable ability name for a reason string (title-cased fallback from the id). */
export function abilityLabel(ability: string): string {
  const named: Record<string, string> = {
    levitate: 'Levitate', eartheater: 'Earth Eater', voltabsorb: 'Volt Absorb', lightningrod: 'Lightning Rod',
    motordrive: 'Motor Drive', waterabsorb: 'Water Absorb', stormdrain: 'Storm Drain', dryskin: 'Dry Skin',
    flashfire: 'Flash Fire', wellbakedbody: 'Well-Baked Body', sapsipper: 'Sap Sipper', wonderguard: 'Wonder Guard',
  };
  return named[ability] ?? ability;
}
