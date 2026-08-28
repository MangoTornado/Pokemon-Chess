/**
 * Deterministic, serialisable pseudo-random number generator.
 *
 * Pokémon Chess has randomness at its core — the d6 that decides crits and misses is the mechanic
 * that lets a worse chess player win. That makes the RNG part of *game state*, not an ambient
 * service: the same seed replayed against the same action list must reproduce the game exactly, or
 * replays, network play, and AI search all break.
 *
 * Algorithm: xoshiro128** seeded through SplitMix32. Chosen over `Math.random` (not seedable) and
 * over an LCG (visible lattice structure in low bits, which matters when we take `% 6` sixty times a
 * game). State is four 32-bit words, so a full game's RNG position serialises to 4 numbers.
 */

/** Serialisable RNG state: four 32-bit words. */
export type RngState = readonly [number, number, number, number];

/** Mixes an arbitrary 32-bit integer into a well-distributed one. */
function splitmix32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x9e3779b9) | 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

/** FNV-1a, so a human-readable seed string maps to a reproducible 32-bit integer. */
export function hashSeed(seed: string | number): number {
  if (typeof seed === 'number') return seed | 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRngState(seed: string | number): RngState {
  const next = splitmix32(hashSeed(seed));
  // Reject the all-zero state, which is a fixed point for xoshiro.
  let s: [number, number, number, number] = [next(), next(), next(), next()];
  while (s[0] === 0 && s[1] === 0 && s[2] === 0 && s[3] === 0) {
    s = [next(), next(), next(), next()];
  }
  return s;
}

const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;

/**
 * Advances the state and returns the next 32-bit output alongside the new state.
 *
 * Pure by design: callers thread the state through, which is what makes a game reducer replayable.
 * For ergonomic sequential use, see {@link Rng}.
 */
export function nextUint32(state: RngState): { value: number; state: RngState } {
  const [s0, s1, s2, s3] = state;
  const value = Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7), 9) >>> 0;

  const t = (s1 << 9) >>> 0;
  let n2 = (s2 ^ s0) >>> 0;
  let n3 = (s3 ^ s1) >>> 0;
  const n1 = (s1 ^ n2) >>> 0;
  const n0 = (s0 ^ n3) >>> 0;
  n2 = (n2 ^ t) >>> 0;
  n3 = rotl(n3, 11);

  return { value, state: [n0, n1, n2, n3] };
}

/**
 * Mutable cursor over an {@link RngState}.
 *
 * Convenience wrapper for the common case of "roll several times while resolving one action". Snapshot
 * with {@link Rng.state} and store it back into game state when the action completes.
 */
export class Rng {
  private current: RngState;

  constructor(seedOrState: string | number | RngState) {
    this.current = Array.isArray(seedOrState)
      ? (seedOrState as RngState)
      : createRngState(seedOrState as string | number);
  }

  /** Current state — store this in game state to make the game replayable. */
  get state(): RngState {
    return this.current;
  }

  /** Next raw 32-bit value. */
  uint32(): number {
    const { value, state } = nextUint32(this.current);
    this.current = state;
    return value;
  }

  /** Uniform float in `[0, 1)`, with 32 bits of resolution. */
  float(): number {
    return this.uint32() / 0x1_0000_0000;
  }

  /**
   * Uniform integer in `[0, bound)`, free of modulo bias.
   *
   * Bias matters here: a naive `uint32() % 6` favours the low faces, and a d6 that is not fair
   * undermines the one mechanic the whole design leans on. Uses Lemire's rejection method.
   */
  below(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0) {
      throw new RangeError(`bound must be a positive integer, got ${bound}`);
    }
    // Reject the tail that would wrap unevenly.
    const threshold = (0x1_0000_0000 % bound) >>> 0;
    let value = this.uint32();
    while (value < threshold) value = this.uint32();
    return value % bound;
  }

  /** Rolls a die with `sides` faces, returning `1..sides`. */
  roll(sides: number): number {
    return this.below(sides) + 1;
  }

  /** Rolls a standard six-sided die: `1` is a miss, `6` is a critical hit. */
  d6(): number {
    return this.roll(6);
  }

  /** True with probability `chance`, expressed as a percentage in `[0, 100]`. */
  chance(percent: number): boolean {
    if (percent <= 0) return false;
    if (percent >= 100) return true;
    return this.below(100) < percent;
  }

  /** Uniform choice from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('cannot pick from an empty array');
    return items[this.below(items.length)]!;
  }

  /** Returns a new array in uniformly random order (Fisher–Yates). Does not mutate the input. */
  shuffled<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.below(i + 1);
      const a = out[i]!;
      out[i] = out[j]!;
      out[j] = a;
    }
    return out;
  }

  /** Independent generator derived from this one, for a sub-system that must not perturb this stream. */
  fork(label: string): Rng {
    return new Rng(createRngState(hashSeed(label) ^ this.uint32()));
  }
}
