/**
 * The three remaining Clash mechanics: move priority, multi-hit, and screens.
 *
 * Priority matters more here than in the games, because swinging first is often the whole exchange. Multi-hit
 * matters because it interacts with the survive-once clamp. Screens matter because they are the only art that
 * protects your own army rather than shaping the opponent's ground.
 */

import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import type { BattleType } from '../data/schema.ts';
import { resolveClash } from './clash.ts';
import { SCREEN_TURNS, screenMod, screenFromSideCondition, tickScreens } from '../engine/field.ts';
import { artOfMove } from '../game/arts.ts';

const dex = await Dex.load();

const BLOW = {
  attackerType: 'Normal' as BattleType, defenderType: 'Normal' as BattleType, moveType: 'Normal' as BattleType,
  category: 'Physical' as const, basePower: 100, offensiveStat: 200, defensiveStat: 150,
};
const WEAK = { ...BLOW, basePower: 10, offensiveStat: 40, defensiveStat: 400 };

function clash(extra: Record<string, unknown> = {}, attackerSpeed = 100, defenderSpeed = 200) {
  const attacker = { hp: 400, maxHp: 400, speed: attackerSpeed, pristine: true };
  const defender = { hp: 400, maxHp: 400, speed: defenderSpeed, pristine: true };
  return resolveClash(
    { attacker, defender, attackerBlow: BLOW, defenderBlow: WEAK, attackerSuperEffective: false, ...extra },
    { hits: true, crit: false, momentum: 100 },
  );
}

describe('move priority', () => {
  it('lets a slower attacker strike first', () => {
    // Slower by Speed, so it would normally swing second.
    expect(clash().attackerFirst).toBe(false);
    // Positive priority overrides Speed entirely.
    expect(clash({ priority: 1 }).attackerFirst).toBe(true);
  });

  it('negative priority gives up the first swing even when faster', () => {
    expect(clash({}, 300, 100).attackerFirst).toBe(true);
    expect(clash({ priority: -4 }, 300, 100).attackerFirst).toBe(false);
  });

  it('is read off the real move data', () => {
    expect(dex.requireMove('quickattack').priority).toBe(1);
    expect(dex.requireMove('avalanche').priority).toBe(-4);
    expect(dex.requireMove('tackle').priority).toBe(0);
  });
});

describe('multi-hit moves', () => {
  it('divides its power across strikes rather than multiplying it', () => {
    const single = clash();
    const double = clash({ attackerHits: 2 });
    const own = (r: ReturnType<typeof clash>) => r.blows.filter((b) => b.by === 'attacker');

    expect(own(double).length).toBeGreaterThan(own(single).length);
    // Each strike is smaller than the undivided blow.
    expect(own(double)[0]!.damage).toBeLessThan(own(single)[0]!.damage);
    // And the total is close to the same, not doubled.
    const total = (r: ReturnType<typeof clash>) => own(r).reduce((a, b) => a + b.damage, 0);
    expect(total(double)).toBeLessThanOrEqual(total(single) + own(double).length);
  });

  it('breaks a Focus Sash that a single blow cannot', () => {
    const withSash = (hits?: number) => {
      const attacker = { hp: 400, maxHp: 400, speed: 300, pristine: true };
      const defender = { hp: 20, maxHp: 400, speed: 1, pristine: true, surviveOnce: true };
      return resolveClash(
        {
          attacker, defender, attackerBlow: BLOW, defenderBlow: WEAK, attackerSuperEffective: false,
          ...(hits !== undefined ? { attackerHits: hits } : {}),
        },
        { hits: true, crit: false, momentum: 100 },
      );
    };
    // One big blow is clamped to 1 HP and the clamp holds for the exchange.
    expect(withSash().defenderHpAfter).toBe(1);
    // Several small strikes: the first spends the clamp, a later one finishes it.
    expect(withSash(3).defenderHpAfter).toBe(0);
  });

  it('only the first strike of the first swing can crit', () => {
    const attacker = { hp: 400, maxHp: 400, speed: 300, pristine: true };
    const defender = { hp: 4000, maxHp: 4000, speed: 1, pristine: true };
    const r = resolveClash(
      { attacker, defender, attackerBlow: BLOW, defenderBlow: WEAK, attackerSuperEffective: false, attackerHits: 3 },
      { hits: true, crit: true, momentum: 100 },
    );
    const crits = r.blows.filter((b) => b.crit);
    expect(crits).toHaveLength(1);
  });

  it('is read off the real move data', () => {
    expect(dex.requireMove('doublekick').multihit).toBe(2);
    expect(dex.requireMove('bulletseed').multihit).toEqual([2, 5]);
    expect(dex.requireMove('tackle').multihit).toBeUndefined();
  });
});

describe('screens', () => {
  it('Reflect halves physical damage and Light Screen halves special', () => {
    expect(screenMod({ reflect: 5 }, 'Physical')).toBe(0.5);
    expect(screenMod({ reflect: 5 }, 'Special')).toBe(1);
    expect(screenMod({ lightscreen: 5 }, 'Special')).toBe(0.5);
    expect(screenMod({ lightscreen: 5 }, 'Physical')).toBe(1);
    expect(screenMod(undefined, 'Physical')).toBe(1);
    expect(screenMod({}, 'Physical')).toBe(1);
  });

  it('never increases damage, as the defender hook requires', () => {
    for (const category of ['Physical', 'Special'] as const) {
      expect(screenMod({ reflect: 5, lightscreen: 5 }, category)).toBeLessThanOrEqual(1);
    }
  });

  it('ages out and then lapses', () => {
    let screens = { reflect: 2, lightscreen: 1 };
    const once = tickScreens(screens);
    expect(once.reflect).toBe(1);
    expect(once.lightscreen).toBeUndefined(); // expired
    expect(tickScreens(once)).toEqual({});
  });

  it('reads Reflect and Light Screen as arts off the real moves', () => {
    expect(screenFromSideCondition('reflect')).toBe('reflect');
    expect(screenFromSideCondition('spikes')).toBeNull();
    expect(artOfMove(dex.requireMove('reflect'))).toMatchObject({ effect: { kind: 'screen', screen: 'reflect' } });
    expect(artOfMove(dex.requireMove('lightscreen'))).toMatchObject({
      effect: { kind: 'screen', screen: 'lightscreen' },
    });
    expect(SCREEN_TURNS).toBeGreaterThan(0);
  });

  it('halves damage in a real Clash', () => {
    const plain = clash();
    // The engine folds a screen into the blow's defenderFinalMod, so that is the path to prove.
    const shielded = resolveClash(
      {
        attacker: { hp: 400, maxHp: 400, speed: 300, pristine: true },
        defender: { hp: 400, maxHp: 400, speed: 1, pristine: true },
        attackerBlow: { ...BLOW, defenderFinalMod: 0.5 },
        defenderBlow: WEAK,
        attackerSuperEffective: false,
      },
      { hits: true, crit: false, momentum: 100 },
    );
    const first = (r: ReturnType<typeof clash>) => r.blows.find((b) => b.by === 'attacker')!.damage;
    expect(first(shielded)).toBeLessThan(first(plain));
  });
});
