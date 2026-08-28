import { describe, expect, it } from 'vitest';

import { Rng, createRngState, hashSeed, nextUint32 } from './rng.ts';

describe('determinism, which replays and network play depend on', () => {
  it('produces an identical stream from the same seed', () => {
    const a = new Rng('pikachu');
    const b = new Rng('pikachu');
    const left = Array.from({ length: 500 }, () => a.uint32());
    const right = Array.from({ length: 500 }, () => b.uint32());
    expect(left).toEqual(right);
  });

  it('produces different streams from different seeds', () => {
    const a = Array.from({ length: 50 }, (_, i) => new Rng(`seed-${i}`).uint32());
    expect(new Set(a).size).toBe(50);
  });

  it('accepts numeric and string seeds alike', () => {
    expect(new Rng(12345).uint32()).toBe(new Rng(12345).uint32());
    expect(hashSeed('abc')).toBe(hashSeed('abc'));
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'));
  });

  it('resumes mid-game from a serialised state', () => {
    const original = new Rng('gengar');
    for (let i = 0; i < 17; i++) original.uint32();

    // A saved game stores four numbers; JSON round-tripping must not perturb the stream.
    const saved = JSON.parse(JSON.stringify(original.state));
    const resumed = new Rng(saved);
    const expected = Array.from({ length: 20 }, () => original.uint32());
    const actual = Array.from({ length: 20 }, () => resumed.uint32());
    expect(actual).toEqual(expected);
  });

  it('advances purely, so a reducer can thread state without mutation', () => {
    const state = createRngState('lapras');
    const first = nextUint32(state);
    const again = nextUint32(state);
    expect(again.value).toBe(first.value);
    expect(again.state).toEqual(first.state);
    expect(nextUint32(first.state).value).not.toBe(first.value);
  });

  it('never settles into the all-zero fixed point', () => {
    for (let i = 0; i < 200; i++) {
      const s = createRngState(i);
      expect(s.some((word) => word !== 0)).toBe(true);
    }
  });

  it('emits unsigned 32-bit integers', () => {
    const rng = new Rng('bounds');
    for (let i = 0; i < 1000; i++) {
      const v = rng.uint32();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe('the d6, which is the mechanic the design leans on hardest', () => {
  it('only ever rolls 1 through 6', () => {
    const rng = new Rng('dice');
    for (let i = 0; i < 10_000; i++) {
      const roll = rng.d6();
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(6);
      expect(Number.isInteger(roll)).toBe(true);
    }
  });

  it('is fair: 60k rolls stay within tolerance on every face', () => {
    // A biased die would quietly tilt the whole game, so this is worth asserting numerically.
    const rng = new Rng('fairness');
    const rolls = 60_000;
    const counts = new Array<number>(7).fill(0);
    for (let i = 0; i < rolls; i++) counts[rng.d6()]! += 1;

    const expected = rolls / 6;
    for (let face = 1; face <= 6; face++) {
      // ~3.5 sigma for this sample size.
      expect(Math.abs(counts[face]! - expected)).toBeLessThan(expected * 0.05);
    }

    // Chi-square with 5 degrees of freedom: 20.5 is roughly p = 0.001.
    const chiSquare = counts
      .slice(1)
      .reduce((sum, observed) => sum + (observed - expected) ** 2 / expected, 0);
    expect(chiSquare).toBeLessThan(20.5);
  });

  it('shows no low-face bias, which a naive modulo would introduce', () => {
    // 2^32 % 6 == 4, so an unguarded `% 6` over-samples faces 1-4. Check the halves balance.
    const rng = new Rng('modulo-bias');
    let low = 0;
    let high = 0;
    for (let i = 0; i < 120_000; i++) {
      const roll = rng.d6();
      if (roll <= 3) low++;
      else high++;
    }
    expect(Math.abs(low - high)).toBeLessThan(120_000 * 0.01);
  });

  it('supports other dice sizes and rejects nonsense bounds', () => {
    const rng = new Rng('dice-sizes');
    for (const sides of [2, 3, 20, 100]) {
      const roll = rng.roll(sides);
      expect(roll).toBeGreaterThanOrEqual(1);
      expect(roll).toBeLessThanOrEqual(sides);
    }
    expect(() => rng.below(0)).toThrow(RangeError);
    expect(() => rng.below(-1)).toThrow(RangeError);
    expect(() => rng.below(1.5)).toThrow(RangeError);
    expect(rng.below(1)).toBe(0);
  });
});

describe('derived helpers', () => {
  it('keeps floats in [0, 1)', () => {
    const rng = new Rng('floats');
    for (let i = 0; i < 5000; i++) {
      const f = rng.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('treats 0% and 100% as certainties without consuming surprises', () => {
    const rng = new Rng('chance');
    expect(rng.chance(0)).toBe(false);
    expect(rng.chance(100)).toBe(true);
    expect(rng.chance(-5)).toBe(false);
    expect(rng.chance(150)).toBe(true);
  });

  it('hits a 30% chance about 30% of the time', () => {
    const rng = new Rng('secondary-effect');
    let hits = 0;
    for (let i = 0; i < 40_000; i++) if (rng.chance(30)) hits++;
    expect(hits / 40_000).toBeCloseTo(0.3, 2);
  });

  it('picks from an array and refuses an empty one', () => {
    const rng = new Rng('pick');
    const items = ['a', 'b', 'c'] as const;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(rng.pick(items));
    expect(seen).toEqual(new Set(items));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('shuffles without mutating the input or losing elements', () => {
    const rng = new Rng('draft-order');
    const source = Object.freeze(Array.from({ length: 30 }, (_, i) => i));
    const shuffled = rng.shuffled(source);
    expect(shuffled).not.toBe(source);
    expect(source).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(shuffled.slice().sort((a, b) => a - b)).toEqual([...source]);
    expect(shuffled).not.toEqual([...source]);
  });

  it('shuffles roughly uniformly', () => {
    // Each element should reach every position sometimes; a broken Fisher-Yates pins element 0.
    const rng = new Rng('uniformity');
    const positions = new Map<number, Set<number>>();
    for (let trial = 0; trial < 400; trial++) {
      const shuffled = rng.shuffled([0, 1, 2, 3, 4]);
      shuffled.forEach((value, index) => {
        if (!positions.has(value)) positions.set(value, new Set());
        positions.get(value)!.add(index);
      });
    }
    for (const seen of positions.values()) expect(seen.size).toBe(5);
  });

  it('forks an independent stream that does not disturb the parent', () => {
    const parent = new Rng('parent');
    const checkpoint = parent.state;

    const forked = parent.fork('animation-jitter');
    const forkedValues = Array.from({ length: 10 }, () => forked.uint32());

    // The fork consumed one value from the parent, and is not simply a copy of it.
    const replay = new Rng(checkpoint);
    replay.uint32();
    expect(Array.from({ length: 10 }, () => replay.uint32())).not.toEqual(forkedValues);
    expect(parent.fork('animation-jitter').uint32()).not.toBe(forkedValues[0]);
  });
});
