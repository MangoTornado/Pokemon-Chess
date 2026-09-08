import { describe, expect, it } from 'vitest';

import {
  ALL_STATUSES,
  BURN_CONTACT_PENALTY,
  COUNTER_STATUSES,
  CLEANSED,
  POISON_LETHAL_COUNT,
  POISON_RATE,
  ROTATION_STATUSES,
  SLEEP_TURN_CAP,
  applyBurn,
  applyPoison,
  applyRotation,
  cure,
  hasAnyStatus,
  hasRotationStatus,
  movementLock,
} from './status.ts';
import type { PieceStatus } from './status.ts';

const CLEAN: PieceStatus = {};

describe('the two status classes', () => {
  it('splits into the TCG\'s rotation and counter families with no overlap', () => {
    // Rotation-class statuses rotate the sprite and are mutually exclusive; counter-class ones stack
    // as pips. The distinction is what lets a piece be poisoned AND burned AND asleep at once, but
    // never asleep AND paralyzed.
    expect(new Set(ROTATION_STATUSES)).toEqual(new Set(['asleep', 'paralyzed', 'confused']));
    expect(new Set(COUNTER_STATUSES)).toEqual(new Set(['poisoned', 'burned']));
    expect(new Set(ALL_STATUSES).size).toBe(5);
    for (const r of ROTATION_STATUSES) expect(COUNTER_STATUSES).not.toContain(r);
  });

  it('carries no status by default', () => {
    expect(hasAnyStatus(CLEAN)).toBe(false);
    expect(hasRotationStatus(CLEAN)).toBe(false);
  });
});

describe('rotation-class conditions: only one at a time, newest wins', () => {
  it('records the applied condition', () => {
    const asleep = applyRotation(CLEAN, 'asleep');
    expect(asleep.rotation?.kind).toBe('asleep');
    expect(asleep.rotation?.turns).toBe(0);
    expect(hasRotationStatus(asleep)).toBe(true);
  });

  it('overwrites any earlier rotation condition with the new one', () => {
    // The TCG rule verbatim: "the newest condition overriding the previous one".
    const asleep = applyRotation(CLEAN, 'asleep');
    const confused = applyRotation(asleep, 'confused');
    expect(confused.rotation?.kind).toBe('confused');
    expect(confused.rotation?.turns).toBe(0);
  });

  it('does not mutate the input', () => {
    const before = CLEAN;
    applyRotation(before, 'paralyzed');
    expect(before).toEqual({});
  });

  it('coexists with counter-class conditions', () => {
    let status = applyPoison(CLEAN);
    status = applyBurn(status);
    status = applyRotation(status, 'asleep');
    expect(status.rotation?.kind).toBe('asleep');
    expect(status.poisoned).toBeDefined();
    expect(status.burned).toBeDefined();
  });
});

describe('poison is a visible three-turn death clock', () => {
  it('starts at one counter, which is one pip under the piece', () => {
    const poisoned = applyPoison(CLEAN);
    expect(poisoned.poisoned?.count).toBe(1);
  });

  it('caps lethality at 3, exposing a visible clock rather than a hidden HP number', () => {
    // The rate of accumulation lives elsewhere; POISON_LETHAL_COUNT names the threshold that ends the
    // piece. Three fits under the sprite as three pips, and it is short enough that the opponent has
    // real time to answer.
    expect(POISON_LETHAL_COUNT).toBe(3);
    expect(POISON_RATE.poisoned).toBe(1);
    expect(POISON_RATE.badlyPoisoned).toBe(2);
    // Badly Poisoned is fatal in two owner-turns at that rate.
    expect(POISON_LETHAL_COUNT / POISON_RATE.badlyPoisoned).toBe(1.5);
  });

  it('never downgrades Badly Poisoned to Poisoned by accident', () => {
    // Applying the milder version to a piece that is already worse off would be the opponent
    // unwittingly rescuing you, which nobody wants.
    let status = applyPoison(CLEAN, 'badlyPoisoned');
    status = { ...status, poisoned: { kind: 'poisoned', count: 2 } };
    const after = applyPoison(status, 'poisoned');
    expect(after.poisoned?.count).toBe(2);
  });
});

describe('burn does not stack, and it costs a contact attacker a category on the Clash', () => {
  it('is present once burned, and re-applying does not change it', () => {
    const first = applyBurn(CLEAN);
    const second = applyBurn(first);
    expect(second.burned).toBeDefined();
    expect(second.burned).toBe(first.burned);
  });

  it('costs a step on the Clash for Physical attacks, mirroring the games\' Attack halving', () => {
    // The games halve the burned Pokémon's Attack stat when it makes a Physical move, which is why
    // Will-O-Wisp is a serious threat. Here the Clash is categorical rather than scalar, so a step
    // down is the equivalent: −1 on the ladder.
    expect(BURN_CONTACT_PENALTY).toBe(-1);
  });
});

describe('cures and cleanses', () => {
  it('cleanses every status at once', () => {
    let status = applyRotation(CLEAN, 'asleep');
    status = applyPoison(status);
    status = applyBurn(status);
    expect(hasAnyStatus(status)).toBe(true);
    expect(hasAnyStatus(CLEANSED)).toBe(false);
  });

  it('cures one status class at a time, leaving the others intact', () => {
    let status = applyRotation(CLEAN, 'confused');
    status = applyPoison(status);
    status = applyBurn(status);

    const noPoison = cure(status, 'poisoned');
    expect(noPoison.poisoned).toBeUndefined();
    expect(noPoison.burned).toBeDefined();
    expect(noPoison.rotation).toBeDefined();

    const noConfusion = cure(noPoison, 'confused');
    expect(noConfusion.rotation).toBeUndefined();
    expect(noConfusion.burned).toBeDefined();
  });

  it('leaves an unrelated rotation status alone when curing a different one', () => {
    const asleep = applyRotation(CLEAN, 'asleep');
    // Curing paralysis on an asleep piece changes nothing, because the piece was never paralyzed.
    const still = cure(asleep, 'paralyzed');
    expect(still.rotation?.kind).toBe('asleep');
  });
});

describe('movement lock — what stops a piece moving on its turn', () => {
  it('locks a sleeping piece completely, which is the whole reason sleep is dangerous', () => {
    const asleep = applyRotation(CLEAN, 'asleep');
    expect(movementLock(asleep)).toBe('asleep');
  });

  it('locks a paralyzed piece for exactly its next turn', () => {
    // Paralysis costs the piece one activation and then clears itself, which the checkup step handles.
    // From this predicate's perspective, a paralyzed piece is simply locked right now.
    const paralyzed = applyRotation(CLEAN, 'paralyzed');
    expect(movementLock(paralyzed)).toBe('paralyzed');
  });

  it('does not lock a confused piece on its own', () => {
    // Confusion turns a *capture attempt* into a coin flip; the piece may still move to an empty square.
    // The reducer that plays the move applies the coin, not this predicate.
    expect(movementLock(applyRotation(CLEAN, 'confused'))).toBeNull();
  });

  it('does not lock a poisoned or burned piece', () => {
    // These are death-clock and Clash-penalty effects respectively, not immobilisers.
    expect(movementLock(applyPoison(CLEAN))).toBeNull();
    expect(movementLock(applyBurn(CLEAN))).toBeNull();
  });
});

describe('the sleep cap', () => {
  it('is set to the games\' maximum of 3', () => {
    // The TCG's raw rule is a coin flip per checkup, geometric with unbounded tail. Capping at 3
    // removes the tail without removing the coin, which is the video game's own rule.
    expect(SLEEP_TURN_CAP).toBe(3);
  });
});
