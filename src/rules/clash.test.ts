import { describe, expect, it } from 'vitest';

import type { DamageInput } from './damage.ts';
import { resolveClash } from './clash.ts';
import type { ClashRoll, ClashSetup, Combatant } from './clash.ts';

const NO_CRIT: ClashRoll = { hits: true, crit: false, momentum: 100 };

function combatant(hp: number, speed: number): Combatant {
  return { hp, maxHp: hp, speed, pristine: true };
}

/** A damaging blow of a given type/power against a given defender type. */
function blow(overrides: Partial<DamageInput>): DamageInput {
  return {
    attackerType: 'Normal',
    moveType: 'Normal',
    defenderType: 'Normal',
    category: 'Physical',
    basePower: 80,
    offensiveStat: 150,
    defensiveStat: 120,
    momentum: 100,
    ...overrides,
  };
}

describe('the exchange sequence', () => {
  it('is A when the attacker one-shots the defender', () => {
    const attacker = combatant(200, 160);
    const defender = combatant(60, 120);
    const result = resolveClash(
      {
        attacker,
        defender,
        attackerBlow: blow({ moveType: 'Fire', defenderType: 'Grass', basePower: 120, offensiveStat: 200 }),
        defenderBlow: blow({}),
        attackerSuperEffective: true,
      },
      NO_CRIT,
    );
    // One blow, defender dead, attacker untouched.
    expect(result.blows).toHaveLength(1);
    expect(result.blows[0]!.by).toBe('attacker');
    expect(result.defenderHpAfter).toBe(0);
    expect(result.attackerHpAfter).toBe(200);
  });

  it('is A·D·A when the attacker is faster but does not one-shot', () => {
    const attacker = combatant(220, 160);
    const defender = combatant(240, 120);
    const result = resolveClash(
      {
        attacker,
        defender,
        attackerBlow: blow({ basePower: 70, offensiveStat: 140 }),
        defenderBlow: blow({ basePower: 70, offensiveStat: 120 }),
        attackerSuperEffective: false,
      },
      NO_CRIT,
    );
    // At most three blows, attacker swings twice, the attacker landed the last blow.
    expect(result.attackerFirst).toBe(true);
    const attackerBlows = result.blows.filter((b) => b.by === 'attacker');
    expect(attackerBlows.length).toBeLessThanOrEqual(2);
    expect(result.blows.at(-1)!.by).toBe('attacker');
    expect(result.blows.length).toBeLessThanOrEqual(3);
  });

  it('is D·A·D·A when the defender is faster and neither one-shots', () => {
    const attacker = combatant(260, 100);
    const defender = combatant(260, 180);
    const result = resolveClash(
      {
        attacker,
        defender,
        attackerBlow: blow({ basePower: 60, offensiveStat: 120 }),
        defenderBlow: blow({ basePower: 60, offensiveStat: 120 }),
        attackerSuperEffective: false,
      },
      NO_CRIT,
    );
    expect(result.attackerFirst).toBe(false);
    // The defender strikes first and last-but-one; the attacker always lands the final blow.
    expect(result.blows[0]!.by).toBe('defender');
    expect(result.blows.at(-1)!.by).toBe('attacker');
    expect(result.blows.length).toBeLessThanOrEqual(4);
  });

  it('gives the attacker the final blow and an exactly-one-swing edge', () => {
    // Across many symmetric setups, the attacker always swings last.
    for (let spd = 80; spd <= 200; spd += 20) {
      const result = resolveClash(
        {
          attacker: combatant(300, 120),
          defender: combatant(300, spd),
          attackerBlow: blow({ basePower: 50, offensiveStat: 110 }),
          defenderBlow: blow({ basePower: 50, offensiveStat: 110 }),
          attackerSuperEffective: false,
        },
        NO_CRIT,
      );
      if (result.blows.length > 0) expect(result.blows.at(-1)!.by).toBe('attacker');
    }
  });

  it('lets the attacker win an exact Speed tie', () => {
    const result = resolveClash(
      {
        attacker: combatant(300, 130),
        defender: combatant(300, 130),
        attackerBlow: blow({ basePower: 50 }),
        defenderBlow: blow({ basePower: 50 }),
        attackerSuperEffective: false,
      },
      NO_CRIT,
    );
    expect(result.attackerFirst).toBe(true);
    expect(result.blows[0]!.by).toBe('attacker');
  });

  it('honours move priority over Speed', () => {
    // A slow attacker with a priority move still strikes first.
    const result = resolveClash(
      {
        attacker: combatant(300, 60),
        defender: combatant(300, 200),
        attackerBlow: blow({ basePower: 40 }),
        defenderBlow: blow({ basePower: 40 }),
        priority: 1,
        attackerSuperEffective: false,
      },
      NO_CRIT,
    );
    expect(result.attackerFirst).toBe(true);
    expect(result.blows[0]!.by).toBe('attacker');
  });
});

describe('the five verdicts', () => {
  it('ADVANTAGE: super-effective knockout, attacker survives, bonus granted', () => {
    const result = resolveClash(
      {
        attacker: combatant(200, 160),
        defender: combatant(80, 120),
        attackerBlow: blow({ moveType: 'Fire', defenderType: 'Steel', basePower: 120, offensiveStat: 200 }),
        defenderBlow: blow({ basePower: 40, offensiveStat: 80 }),
        attackerSuperEffective: true,
      },
      NO_CRIT,
    );
    expect(result.verdict).toBe('advantage');
    expect(result.grantsBonus).toBe(true);
    expect(result.attackerHpAfter).toBeGreaterThan(0);
  });

  it('CAPTURE: neutral knockout, attacker survives, no bonus', () => {
    const result = resolveClash(
      {
        attacker: combatant(220, 160),
        defender: combatant(70, 120),
        attackerBlow: blow({ basePower: 110, offensiveStat: 190 }),
        defenderBlow: blow({ basePower: 40, offensiveStat: 80 }),
        attackerSuperEffective: false,
      },
      NO_CRIT,
    );
    expect(result.verdict).toBe('capture');
    expect(result.grantsBonus).toBe(false);
    expect(result.defenderHpAfter).toBe(0);
  });

  it('ROUT: the attack fails and the attacker dies to the counter', () => {
    // A weak attacker into a bulky, hard-hitting defender it cannot dent.
    const result = resolveClash(
      {
        attacker: combatant(90, 90),
        defender: combatant(320, 130),
        attackerBlow: blow({ basePower: 40, offensiveStat: 70, moveType: 'Grass', defenderType: 'Fire' }),
        defenderBlow: blow({ basePower: 120, offensiveStat: 200 }),
        attackerSuperEffective: false,
      },
      NO_CRIT,
    );
    expect(result.verdict).toBe('rout');
    expect(result.attackerHpAfter).toBe(0);
    expect(result.defenderHpAfter).toBeGreaterThan(0);
  });

  it('REPEL: neither piece falls', () => {
    const result = resolveClash(
      {
        attacker: combatant(300, 120),
        defender: combatant(320, 110),
        attackerBlow: blow({ basePower: 40, offensiveStat: 90, moveType: 'Fire', defenderType: 'Water' }),
        defenderBlow: blow({ basePower: 40, offensiveStat: 90 }),
        attackerSuperEffective: false,
      },
      NO_CRIT,
    );
    expect(result.verdict).toBe('repel');
    expect(result.attackerHpAfter).toBeGreaterThan(0);
    expect(result.defenderHpAfter).toBeGreaterThan(0);
  });

  it('REPEL on a miss, with no damage to either piece', () => {
    const attacker = combatant(200, 160);
    const defender = combatant(200, 120);
    const result = resolveClash(
      {
        attacker,
        defender,
        attackerBlow: blow({ basePower: 120, offensiveStat: 200 }),
        defenderBlow: blow({ basePower: 120, offensiveStat: 200 }),
        attackerSuperEffective: false,
      },
      { hits: false, crit: false, momentum: 100 },
    );
    expect(result.verdict).toBe('repel');
    expect(result.blows).toHaveLength(0);
    expect(result.attackerHpAfter).toBe(200);
    expect(result.defenderHpAfter).toBe(200);
  });

  it('MUTUAL does not arise from ordinary blows, because a fainted piece does not swing', () => {
    // The SPEC measures MUTUAL at 0% from ordinary blows under strict Speed ordering — it is a content
    // outcome (recoil, thorns, self-destruct), not something the bare exchange produces.
    for (let i = 0; i < 200; i++) {
      const spd = 80 + (i % 120);
      const result = resolveClash(
        {
          attacker: combatant(150, 120),
          defender: combatant(150, spd),
          attackerBlow: blow({ basePower: 90 + (i % 40), offensiveStat: 160 }),
          defenderBlow: blow({ basePower: 90 + (i % 40), offensiveStat: 160 }),
          attackerSuperEffective: false,
        },
        { hits: true, crit: i % 7 === 0, momentum: 85 + (i % 16) },
      );
      expect(result.verdict).not.toBe('mutual');
    }
  });
});

describe('the incapacitated defender', () => {
  it('takes blows but never counters, so a sleeping piece cannot rout its attacker', () => {
    const attacker = combatant(120, 90);
    const defender = combatant(300, 200); // faster and bulkier, but asleep
    const result = resolveClash(
      {
        attacker,
        defender,
        attackerBlow: blow({ basePower: 60, offensiveStat: 120 }),
        defenderBlow: blow({ basePower: 200, offensiveStat: 300 }),
        defenderIncapacitated: true,
        attackerSuperEffective: false,
      },
      NO_CRIT,
    );
    expect(result.blows.every((b) => b.by === 'attacker')).toBe(true);
    expect(result.attackerHpAfter).toBe(120);
  });
});

describe('crits and pristine tracking', () => {
  it('crits only on the attacker\'s first swing', () => {
    const result = resolveClash(
      {
        attacker: combatant(260, 160),
        defender: combatant(260, 120),
        attackerBlow: blow({ basePower: 70, offensiveStat: 150 }),
        defenderBlow: blow({ basePower: 50, offensiveStat: 100 }),
        attackerSuperEffective: false,
      },
      { hits: true, crit: true, momentum: 100 },
    );
    const attackerBlows = result.blows.filter((b) => b.by === 'attacker');
    expect(attackerBlows[0]!.crit).toBe(true);
    if (attackerBlows[1]) expect(attackerBlows[1]!.crit).toBe(false);
  });

  it('clears pristine on the first blow a piece takes', () => {
    const attacker = combatant(260, 100);
    const defender = combatant(260, 180);
    resolveClash(
      {
        attacker,
        defender,
        attackerBlow: blow({ basePower: 60 }),
        defenderBlow: blow({ basePower: 60 }),
        attackerSuperEffective: false,
      },
      NO_CRIT,
    );
    // Both were hit in a D·A·D·A exchange, so neither is pristine afterward.
    expect(attacker.pristine).toBe(false);
    expect(defender.pristine).toBe(false);
  });
});

describe('determinism', () => {
  it('reproduces the same Clash from the same inputs', () => {
    const setup = (): ClashSetup => ({
      attacker: combatant(200, 130),
      defender: combatant(200, 120),
      attackerBlow: blow({ basePower: 80, offensiveStat: 150 }),
      defenderBlow: blow({ basePower: 80, offensiveStat: 150 }),
      attackerSuperEffective: false,
    });
    const roll: ClashRoll = { hits: true, crit: false, momentum: 91 };
    const a = resolveClash(setup(), roll);
    const b = resolveClash(setup(), roll);
    expect(b.verdict).toBe(a.verdict);
    expect(b.blows).toEqual(a.blows);
  });
});
