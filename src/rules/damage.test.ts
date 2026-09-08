import { describe, expect, it } from 'vitest';

import { computeDamage, explainDamage } from './damage.ts';
import type { DamageInput } from './damage.ts';

/** The SPEC §5.1 worked instance: Gengar's Shadow Ball on Espeon. */
const GENGAR_SHADOW_BALL: DamageInput = {
  attackerType: 'Ghost',
  moveType: 'Ghost',
  defenderType: 'Psychic',
  category: 'Special',
  basePower: 80,
  offensiveStat: 200,
  defensiveStat: 115,
  stab: true,
  momentum: 93,
};

describe('the SPEC\'s worked example, reproduced to the number', () => {
  it('deals 174 — a one-shot against Espeon\'s 141 HP', () => {
    // Every line of this is canon arithmetic a Smogon reader can check, which is the whole point of the
    // pipeline carrying no invented factor:
    //   floor(22·80·200 / 115) = 3060 ;  floor(3060/50)+2 = 63 ;  ×0.93 = 58 ;  ×1.5 STAB = 87 ;  ×2 = 174
    expect(computeDamage(GENGAR_SHADOW_BALL)).toBe(174);
  });

  it('traces the same 174 through its ordered steps for the UI path', () => {
    const explained = explainDamage(GENGAR_SHADOW_BALL);
    expect(explained.damage).toBe(174);
    expect(explained.effectiveness).toBe(2);
    expect(explained.stab).toBe(true);
    // The base, then momentum, STAB and type — the three non-1 factors.
    const values = explained.steps.map((s) => s.value);
    expect(values[0]).toBe(63);
    expect(values).toContain(58);
    expect(values).toContain(87);
    expect(values).toContain(174);
  });
});

describe('the formula\'s shape', () => {
  const neutral: DamageInput = {
    attackerType: 'Normal',
    moveType: 'Normal',
    defenderType: 'Fire',
    category: 'Physical',
    basePower: 80,
    offensiveStat: 150,
    defensiveStat: 120,
    momentum: 100,
  };

  it('is deterministic for fixed inputs', () => {
    expect(computeDamage(neutral)).toBe(computeDamage(neutral));
  });

  it('doubles into a weakness and halves into a resistance, monotonically', () => {
    const base = computeDamage(neutral);
    const weak = computeDamage({ ...neutral, moveType: 'Water' }); // Water → Fire ×2
    const resisted = computeDamage({ ...neutral, moveType: 'Fire' }); // Fire → Fire ×0.5
    expect(weak).toBeGreaterThan(base);
    expect(resisted).toBeLessThan(base);
    // 2× is four times 0.5×, up to per-step flooring.
    expect(weak).toBeGreaterThan(resisted * 3);
  });

  it('returns 0 for a type-immune matchup, which the engine never generates as an action', () => {
    expect(computeDamage({ ...neutral, moveType: 'Normal', defenderType: 'Ghost' })).toBe(0);
    expect(computeDamage({ ...neutral, moveType: 'Ground', defenderType: 'Flying' })).toBe(0);
  });

  it('multiplies through dual types', () => {
    // Rock → Fire/Flying is 4× (super vs both).
    const quad = computeDamage({ ...neutral, moveType: 'Rock', defenderType: ['Fire', 'Flying'] });
    const single = computeDamage({ ...neutral, moveType: 'Rock', defenderType: 'Fire' });
    expect(quad).toBeGreaterThan(single);
  });

  it('applies STAB as a distinct ×1.5', () => {
    const withStab = computeDamage({ ...neutral, stab: true });
    const without = computeDamage({ ...neutral, stab: false });
    expect(withStab).toBeGreaterThan(without);
    expect(withStab).toBe(Math.floor(without * 1.5));
  });

  it('never deals less than 1 to a legal target', () => {
    const feeble = computeDamage({
      ...neutral,
      basePower: 10,
      offensiveStat: 20,
      defensiveStat: 360,
      moveType: 'Fire',
      defenderType: 'Water', // resisted, tiny attacker into a wall
    });
    expect(feeble).toBeGreaterThanOrEqual(1);
  });
});

describe('critical hits', () => {
  const setup: DamageInput = {
    attackerType: 'Fire',
    moveType: 'Fire',
    defenderType: 'Grass',
    category: 'Special',
    basePower: 90,
    offensiveStat: 180,
    defensiveStat: 120,
    momentum: 100,
    stab: true,
  };

  it('multiplies by 1.5', () => {
    const normal = computeDamage(setup);
    const crit = computeDamage({ ...setup, crit: true });
    expect(crit).toBeGreaterThan(normal);
  });

  it('ignores the defender\'s positive defensive boost but not its drop', () => {
    const boostedDefender = { ...setup, defensiveStage: 2 };
    // Without a crit, a +2 defence roughly halves damage.
    const throughBoost = computeDamage(boostedDefender);
    // A crit ignores that +2, so it hits as if the defence were unboosted — more than the non-crit.
    const critThroughBoost = computeDamage({ ...boostedDefender, crit: true });
    expect(critThroughBoost).toBeGreaterThan(throughBoost * 1.5);

    // A defensive DROP still helps the attacker even on a crit.
    const droppedDefender = { ...setup, defensiveStage: -2 };
    expect(computeDamage({ ...droppedDefender, crit: true })).toBeGreaterThan(computeDamage(setup));
  });
});

describe('momentum, the games\' own random factor made public', () => {
  const setup: DamageInput = {
    attackerType: 'Water',
    moveType: 'Water',
    defenderType: 'Fire',
    category: 'Special',
    basePower: 90,
    offensiveStat: 160,
    defensiveStat: 120,
    stab: true,
  };

  it('spans the 85–100 band, with the low roll below the high roll', () => {
    const low = computeDamage({ ...setup, momentum: 85 });
    const high = computeDamage({ ...setup, momentum: 100 });
    expect(low).toBeLessThan(high);
    // The band is ±~15%, never a swing that changes a two-shot into a five-shot.
    expect(low / high).toBeGreaterThan(0.8);
  });
});

describe('stat stages and modifiers', () => {
  const setup: DamageInput = {
    attackerType: 'Dragon',
    moveType: 'Dragon',
    defenderType: 'Dragon',
    category: 'Physical',
    basePower: 100,
    offensiveStat: 180,
    defensiveStat: 130,
    momentum: 100,
    stab: true,
  };

  it('raises damage with an offensive boost and lowers it with a defensive one', () => {
    expect(computeDamage({ ...setup, offensiveStage: 2 })).toBeGreaterThan(computeDamage(setup));
    expect(computeDamage({ ...setup, defensiveStage: 2 })).toBeLessThan(computeDamage(setup));
  });

  it('halves a physical move under burn, and leaves a special move alone', () => {
    const physical = computeDamage({ ...setup, burned: true });
    expect(physical).toBeLessThan(computeDamage(setup));
    const special = computeDamage({ ...setup, category: 'Special', burned: true });
    expect(special).toBe(computeDamage({ ...setup, category: 'Special' }));
  });

  it('cuts spread-move damage below single-target', () => {
    expect(computeDamage({ ...setup, spread: true })).toBeLessThan(computeDamage(setup));
  });

  it('never lets a defender modifier increase damage, even if mis-wired above 1', () => {
    const inflated = computeDamage({ ...setup, defenderFinalMod: 2 });
    expect(inflated).toBe(computeDamage(setup));
    const reduced = computeDamage({ ...setup, defenderFinalMod: 0.5 });
    expect(reduced).toBeLessThan(computeDamage(setup));
  });

  it('applies attacker item/ability multipliers', () => {
    expect(computeDamage({ ...setup, attackerFinalMod: 1.3 })).toBeGreaterThan(computeDamage(setup));
  });
});
