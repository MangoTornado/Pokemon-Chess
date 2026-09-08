import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import { computeStats, isBulwark, maxHpOf, spreadKindOf, stageMultiplier } from './stats.ts';

const dex = await Dex.load();

describe('max HP', () => {
  it('matches the standard level-50 formula on a known value', () => {
    // Blissey's 362 is the value the SPEC asserts by name, and it is the real games' figure.
    expect(maxHpOf(dex.requireSpecies('blissey'))).toBe(362);
  });

  it('honours Shedinja\'s override, which is the whole point of carrying maxHP', () => {
    // The formula alone gives Shedinja 77; the override makes it 1. A 77-HP Wonder Guard piece is the
    // untouchable-piece problem the literal reading exists to retire.
    expect(maxHpOf(dex.requireSpecies('shedinja'))).toBe(1);
  });

  it('keeps HP inside the range the SPEC measured across the dex', () => {
    let min = Infinity;
    let max = -Infinity;
    for (const s of dex.baseFormes) {
      const hp = maxHpOf(s);
      min = Math.min(min, hp);
      max = Math.max(max, hp);
    }
    // 1 (Shedinja) to 362 (Blissey).
    expect(min).toBe(1);
    expect(max).toBe(362);
  });
});

describe('the spread predicate lands where a competitive player expects', () => {
  it('classes the canonical walls as Bulwark', () => {
    for (const id of [
      'blissey', 'chansey', 'shuckle', 'ferrothorn', 'skarmory', 'snorlax',
      'toxapex', 'dondozo', 'steelix', 'lapras',
    ]) {
      expect(spreadKindOf(dex.requireSpecies(id))).toBe('bulwark');
    }
  });

  it('classes the canonical attackers as Assault', () => {
    for (const id of ['garchomp', 'gengar', 'pikachu', 'magikarp']) {
      expect(spreadKindOf(dex.requireSpecies(id))).toBe('assault');
    }
  });

  it('splits the dex into two populations of comparable size, near the SPEC\'s 47% bulwark', () => {
    const bulwark = dex.baseFormes.filter((s) => spreadKindOf(s) === 'bulwark').length;
    const fraction = bulwark / dex.baseFormes.length;
    // The SPEC measured 482/1025 = 47%. Allow a band around it rather than pinning the exact count,
    // which would make the test brittle to a dex bump.
    expect(fraction).toBeGreaterThan(0.4);
    expect(fraction).toBeLessThan(0.55);
  });

  it('is a pure function of base stats and the threshold', () => {
    const shuckle = { hp: 20, atk: 10, def: 230, spa: 10, spd: 230, spe: 5 };
    expect(isBulwark(shuckle)).toBe(true);
    const chomp = { hp: 108, atk: 130, def: 95, spa: 80, spd: 85, spe: 102 };
    expect(isBulwark(chomp)).toBe(false);
    // Raising the threshold pushes borderline pieces toward Assault.
    expect(isBulwark({ hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 }, 0)).toBe(true);
    expect(isBulwark({ hp: 80, atk: 80, def: 80, spa: 80, spd: 80, spe: 80 }, 200)).toBe(false);
  });
});

describe('computed stats', () => {
  it('gives an attacker its offensive investment and a wall its defensive one', () => {
    const gengar = computeStats(dex.requireSpecies('gengar'));
    expect(gengar.kind).toBe('assault');
    // Gengar's Special Attack is its headline stat; Assault invests there and in Speed.
    expect(gengar.spa).toBeGreaterThan(gengar.def);
    expect(gengar.spe).toBeGreaterThan(150);

    const ferro = computeStats(dex.requireSpecies('ferrothorn'));
    expect(ferro.kind).toBe('bulwark');
    expect(ferro.def).toBeGreaterThan(ferro.spe);
    expect(ferro.hp).toBeGreaterThan(150);
  });

  it('reports maxHp equal to starting hp', () => {
    for (const id of ['pikachu', 'shedinja', 'blissey']) {
      const stats = computeStats(dex.requireSpecies(id));
      expect(stats.hp).toBe(stats.maxHp);
    }
  });

  it('gives Shedinja exactly 1 HP through the stat path too', () => {
    expect(computeStats(dex.requireSpecies('shedinja')).maxHp).toBe(1);
  });

  it('produces positive stats for every species in the dex', () => {
    for (const s of dex.baseFormes) {
      const stats = computeStats(s);
      for (const key of ['atk', 'def', 'spa', 'spd', 'spe'] as const) {
        expect(stats[key]).toBeGreaterThan(0);
      }
      expect(stats.maxHp).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('stat-stage multipliers', () => {
  it('matches the standard boost ladder', () => {
    expect(stageMultiplier(0)).toBe(1);
    expect(stageMultiplier(1)).toBeCloseTo(1.5, 5);
    expect(stageMultiplier(2)).toBe(2);
    expect(stageMultiplier(6)).toBe(4);
    expect(stageMultiplier(-1)).toBeCloseTo(2 / 3, 5);
    expect(stageMultiplier(-2)).toBe(0.5);
    expect(stageMultiplier(-6)).toBeCloseTo(0.25, 5);
  });

  it('clamps beyond the ends of the ladder', () => {
    expect(stageMultiplier(7)).toBe(stageMultiplier(6));
    expect(stageMultiplier(-99)).toBe(stageMultiplier(-6));
  });
});
