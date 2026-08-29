/**
 * The Clash — how a capture resolves, and the only place an outcome is decided.
 *
 * A Clash is a bounded exchange of blows. Blows alternate in Speed order, and the exchange ends the
 * moment a piece faints or the attacker has swung twice — whichever comes first. That produces exactly
 * two sequences: attacker-first `A · D · A` (three blows), or defender-first `D · A · D · A` (four). The
 * attacker always lands the final blow and its edge is exactly one swing, which is what makes initiating
 * correct by default — a thing chess requires.
 *
 * This replaces the σ fudge that a battle-sim design needs to compress a 4–6 turn battle into one chess
 * action: two swings at the real damage numbers reproduce a single inflated blow almost exactly, in canon
 * units, with nothing invented. See SPEC §4.
 *
 * Pure and deterministic: the randomness (accuracy, momentum, crit) is drawn by the caller and passed in,
 * so the same inputs always produce the same Clash, which is what replay, server validation and AI search
 * require. Survive-once clamps (Focus Sash) are wired; the remaining ability/item hooks (thorns, recoil)
 * compose onto the same `blow` step as they arrive.
 */

import { computeDamage } from './damage.ts';
import type { DamageInput } from './damage.ts';

/** A combatant in a Clash. Damage is tracked by mutating `hp` on a copy the caller owns. */
export interface Combatant {
  hp: number;
  readonly maxHp: number;
  readonly speed: number;
  /** True until this piece has taken any damage — gates survive-once effects like Focus Sash. */
  pristine: boolean;
  /**
   * True when a held item (Focus Sash) should clamp an otherwise-fatal blow to 1 HP.
   *
   * Honoured only if the holder entered the Clash `pristine` — a Sash saves a Pokémon at full health and is
   * spent by any prior damage — and only once per Clash.
   */
  readonly surviveOnce?: boolean;
}

/**
 * The randomness for one Clash, drawn once by the caller before resolution.
 *
 * Accuracy is resolved up front and per action, because the square must be able to say "this can miss"
 * before the player commits — a miss may cost tempo but, per the design, never a piece by surprise.
 */
export interface ClashRoll {
  /** False when the attacker's move misses; the Clash becomes a REPEL with no damage. */
  readonly hits: boolean;
  /** The attacker's first-swing critical hit. */
  readonly crit: boolean;
  /** Momentum, 85..100 — the games' own damage roll, made public. */
  readonly momentum: number;
}

/** How a resolved Clash is classified. Maps onto the video's four outcomes plus the failed assault. */
export type ClashVerdict =
  /** Defender removed, attacker survives, it was super-effective → attacker takes the square and moves again. */
  | 'advantage'
  /** Defender removed, attacker survives → ordinary capture, attacker takes the square. */
  | 'capture'
  /** Both removed → the square is left empty. */
  | 'mutual'
  /** Attacker removed, defender survives wounded → the defender holds the square. */
  | 'rout'
  /** Neither removed → the attacker returns to origin; both keep their damage. */
  | 'repel';

export interface BlowRecord {
  readonly by: 'attacker' | 'defender';
  readonly damage: number;
  readonly crit: boolean;
  /** Defender HP (for an attacker blow) or attacker HP (for a defender blow) after the blow. */
  readonly targetHpAfter: number;
}

export interface ClashResult {
  readonly verdict: ClashVerdict;
  readonly blows: readonly BlowRecord[];
  readonly attackerHpAfter: number;
  readonly defenderHpAfter: number;
  /** Only an `advantage` grants the bonus move. */
  readonly grantsBonus: boolean;
  /** True when the attacker moved first, i.e. was faster or had priority. */
  readonly attackerFirst: boolean;
}

/**
 * How the attacker and defender hit each other in a Clash.
 *
 * The defender always counters with its own slot-0 (its declared type), because a Clash is a melee
 * exchange — the defender is not choosing coverage, it is hitting back with what it is. The caller
 * supplies both damage inputs already parameterised (types, stats, STAB); this module only sequences the
 * blows and reads the resulting HP.
 */
export interface ClashSetup {
  readonly attacker: Combatant;
  readonly defender: Combatant;
  /** The attacker's blow. `crit` and `momentum` are overwritten from the roll per swing. */
  readonly attackerBlow: DamageInput;
  /** The defender's counterblow. */
  readonly defenderBlow: DamageInput;
  /**
   * The attacker's move priority. Positive means it strikes first regardless of Speed; a negative-priority
   * move (Avalanche, Focus Punch) means it strikes last. Zero uses Speed, attacker winning exact ties.
   */
  readonly priority?: number;
  /** True when the defender cannot act this exchange (asleep, paralyzed, flinched). It only takes blows. */
  readonly defenderIncapacitated?: boolean;
  /** Whether the attacker's move was super-effective, which distinguishes `advantage` from `capture`. */
  readonly attackerSuperEffective: boolean;
}

const MAX_ATTACKER_SWINGS = 2;

/**
 * Resolves a Clash, mutating the `hp` and `pristine` of the two combatants the caller passes.
 *
 * The caller owns the `Combatant` objects and is expected to have cloned them from live pieces, so this
 * can mutate freely without touching game state.
 */
export function resolveClash(setup: ClashSetup, roll: ClashRoll): ClashResult {
  const { attacker, defender } = setup;
  const blows: BlowRecord[] = [];

  // A miss is a REPEL: the attacker returns to origin, no one is hurt, the square said so beforehand.
  if (!roll.hits) {
    return {
      verdict: 'repel',
      blows,
      attackerHpAfter: attacker.hp,
      defenderHpAfter: defender.hp,
      grantsBonus: false,
      attackerFirst: true,
    };
  }

  const attackerFirst =
    (setup.priority ?? 0) > 0 ||
    ((setup.priority ?? 0) === 0 && attacker.speed >= defender.speed);

  let swings = 0;

  /**
   * Whether a survive-once item (Focus Sash) protects each side, decided once from the state *entering*
   * the Clash.
   *
   * It holds for the whole exchange rather than for a single blow, and that is deliberate: a Clash is one
   * capture action from the player's point of view, and the attacker swings up to twice within it, so a
   * per-blow clamp would let the second swing undo the save and read as the item not working. "Cannot be
   * knocked out from full health" is the legible rule and the SPEC's CLAMP-to-1 (§13). The holder is left
   * on 1 HP, so it is no longer pristine and the next capture attempt finishes it.
   */
  const sashed = {
    attacker: attacker.surviveOnce === true && attacker.pristine,
    defender: defender.surviveOnce === true && defender.pristine,
  };

  /** Applies a blow, clamping to 1 HP instead of removing a protected target. */
  const land = (target: Combatant, who: 'attacker' | 'defender', damage: number): void => {
    target.hp = sashed[who] && damage >= target.hp ? 1 : Math.max(0, target.hp - damage);
    target.pristine = false;
  };

  const attackerSwing = (): boolean => {
    swings += 1;
    const crit = roll.crit && swings === 1;
    const dmg = computeDamage({ ...setup.attackerBlow, crit, momentum: roll.momentum });
    land(defender, 'defender', dmg);
    blows.push({ by: 'attacker', damage: dmg, crit, targetHpAfter: defender.hp });
    return defender.hp <= 0 || swings >= MAX_ATTACKER_SWINGS;
  };

  const defenderSwing = (): boolean => {
    if (setup.defenderIncapacitated) return false;
    // The defender never crits on the counter and takes the attacker's momentum band too.
    const dmg = computeDamage({ ...setup.defenderBlow, crit: false, momentum: roll.momentum });
    land(attacker, 'attacker', dmg);
    blows.push({ by: 'defender', damage: dmg, crit: false, targetHpAfter: attacker.hp });
    return attacker.hp <= 0;
  };

  // The exchange: alternate in order, attacker's swing count is the cap, either faint ends it.
  const order: ('attacker' | 'defender')[] = attackerFirst
    ? ['attacker', 'defender']
    : ['defender', 'attacker'];

  outer: for (;;) {
    for (const who of order) {
      if (who === 'attacker') {
        if (attackerSwing()) break outer;
      } else {
        if (defenderSwing()) break outer;
      }
    }
    // A full pass with the attacker not yet at its swing cap and no faint: loop again. In practice the
    // cap or a faint always ends it, but the guard makes non-termination structurally impossible.
    if (swings >= MAX_ATTACKER_SWINGS) break;
  }

  const dDead = defender.hp <= 0;
  const aDead = attacker.hp <= 0;

  let verdict: ClashVerdict;
  if (dDead && !aDead) verdict = setup.attackerSuperEffective ? 'advantage' : 'capture';
  else if (dDead && aDead) verdict = 'mutual';
  else if (!dDead && aDead) verdict = 'rout';
  else verdict = 'repel';

  return {
    verdict,
    blows,
    attackerHpAfter: attacker.hp,
    defenderHpAfter: defender.hp,
    grantsBonus: verdict === 'advantage',
    attackerFirst,
  };
}
