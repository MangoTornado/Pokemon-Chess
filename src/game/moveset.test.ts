import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import { buildMoveset } from './moveset.ts';

const dex = await Dex.load();

describe('moveset auto-picker', () => {
  it('always produces exactly four slots', () => {
    for (const id of ['gengar', 'garchomp', 'blissey', 'magikarp', 'ditto', 'pikachu']) {
      const s = dex.requireSpecies(id);
      const kit = buildMoveset(dex, s, s.types[0]!, 'seed');
      expect(kit).toHaveLength(4);
    }
  });

  it('makes slot 0 a same-type move (STAB melee) when the learnset has one', () => {
    const chomp = dex.requireSpecies('garchomp');
    const kit = buildMoveset(dex, chomp, 'Dragon', 'seed');
    expect(kit[0].type).toBe('Dragon');
  });

  it('gives a piece coverage — more than one attacking type where the learnset allows', () => {
    // A wide movepool like Garchomp should yield several distinct attacking types.
    const chomp = dex.requireSpecies('garchomp');
    const kit = buildMoveset(dex, chomp, 'Dragon', 'seed');
    const distinctTypes = new Set(kit.map((s) => s.type));
    expect(distinctTypes.size).toBeGreaterThan(1);
  });

  it('is deterministic for a fixed species, type and seed', () => {
    const g = dex.requireSpecies('gengar');
    expect(buildMoveset(dex, g, 'Ghost', 'x')).toEqual(buildMoveset(dex, g, 'Ghost', 'x'));
  });

  it('falls back to Struggle for a species with no same-type damaging move', () => {
    // Ditto knows only Transform (a status move), so slot 0 has no real damaging option.
    const ditto = dex.requireSpecies('ditto');
    const kit = buildMoveset(dex, ditto, 'Normal', 'seed');
    expect(kit[0].id).toBe('struggle');
  });

  it('gives every base-forme species a usable four-slot kit', () => {
    for (const s of dex.baseFormes) {
      const kit = buildMoveset(dex, s, s.types[0]!, 'seed');
      expect(kit).toHaveLength(4);
      for (const slot of kit) expect(slot.basePower).toBeGreaterThan(0);
    }
  });
});
