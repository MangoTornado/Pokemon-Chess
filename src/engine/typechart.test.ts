import { describe, expect, it } from 'vitest';

import {
  DRAFTABLE_TYPES,
  TYPE_CHART,
  TYPE_PROFILES,
  captureOutcome,
  effectiveness,
  isImmuneTo,
  outcomeOfMultiplier,
  typeProfile,
  typesImmuneAgainst,
  typesResistedBy,
  typesSuperEffectiveAgainst,
} from './typechart.ts';

describe('the chart itself', () => {
  it('draws from the canonical Gen 6+ chart: 8 immunities, 51 super-effective, 61 resisted', () => {
    const tally: Record<string, number> = {};
    for (const a of DRAFTABLE_TYPES) {
      for (const d of DRAFTABLE_TYPES) {
        const m = effectiveness(a, d);
        tally[String(m)] = (tally[String(m)] ?? 0) + 1;
      }
    }
    expect(tally).toEqual({ '0': 8, '0.5': 61, '1': 204, '2': 51 });
  });

  it('offers exactly 18 draftable types, excluding Tera-only Stellar', () => {
    expect(DRAFTABLE_TYPES).toHaveLength(18);
    expect(DRAFTABLE_TYPES).not.toContain('Stellar');
    // Stellar is still in the raw chart, so effects that reference it resolve rather than throw.
    expect(TYPE_CHART.types).toContain('Stellar');
  });

  it('lists precisely the eight real immunities', () => {
    const immunities: string[] = [];
    for (const a of DRAFTABLE_TYPES) {
      for (const d of DRAFTABLE_TYPES) {
        if (effectiveness(a, d) === 0) immunities.push(`${a}->${d}`);
      }
    }
    expect(immunities.sort()).toEqual(
      [
        'Dragon->Fairy',
        'Electric->Ground',
        'Fighting->Ghost',
        'Ghost->Normal',
        'Ground->Flying',
        'Normal->Ghost',
        'Poison->Steel',
        'Psychic->Dark',
      ].sort(),
    );
  });

  it('never produces a multiplier outside {0, 0.5, 1, 2} for single types', () => {
    for (const a of DRAFTABLE_TYPES) {
      for (const d of DRAFTABLE_TYPES) {
        expect([0, 0.5, 1, 2]).toContain(effectiveness(a, d));
      }
    }
  });

  it('treats an unknown type as neutral rather than throwing', () => {
    // Effects can name types that no piece can be; resolving to 1 keeps the engine total.
    expect(effectiveness('Fire', 'Stellar')).toBe(1);
    expect(effectiveness('Stellar', 'Fire')).toBe(1);
  });
});

describe('capture outcomes as the video defines them', () => {
  it('classifies each multiplier into the right consequence', () => {
    expect(outcomeOfMultiplier(0)).toBe('immune');
    expect(outcomeOfMultiplier(0.25)).toBe('resisted');
    expect(outcomeOfMultiplier(0.5)).toBe('resisted');
    expect(outcomeOfMultiplier(1)).toBe('neutral');
    expect(outcomeOfMultiplier(2)).toBe('super');
    expect(outcomeOfMultiplier(4)).toBe('super');
  });

  // Every case below is a claim made on camera in the source video, so these double as a check that
  // we built the game the concept actually describes.
  it.each([
    ['Ground', 'Flying', 'immune', 'ground doesn\'t affect flying — you can\'t take it at all'],
    ['Normal', 'Ghost', 'immune', 'Normal is not nice to Ghost'],
    ['Rock', 'Flying', 'super', 'you throw the rock up at the bird'],
    ['Fire', 'Bug', 'super', 'if your fire kills my bug you get to go again'],
    ['Fire', 'Steel', 'super', 'Knight takes Magnemite, super effective'],
    ['Water', 'Fire', 'super', 'water is super effective against fire'],
    ['Poison', 'Grass', 'super', 'Poison\'s good on grass'],
    ['Steel', 'Fairy', 'super', 'take your fairy with my Steel type'],
    ['Ground', 'Bug', 'resisted', 'ground resists bug'],
    ['Electric', 'Grass', 'resisted', 'Electric\'s not very effective against Grass'],
    ['Ice', 'Fairy', 'neutral', 'ice takes fairy, yep'],
  ] as const)('%s capturing %s is %s (%s)', (attacker, defender, expected, _quote) => {
    expect(captureOutcome(attacker, defender)).toBe(expected);
  });

  it('multiplies through dual types, which is the only way 4× and 0.25× arise', () => {
    expect(effectiveness('Electric', ['Water', 'Flying'])).toBe(4);
    expect(captureOutcome('Electric', ['Water', 'Flying'])).toBe('super');
    expect(effectiveness('Grass', ['Fire', 'Flying'])).toBe(0.25);
    expect(captureOutcome('Grass', ['Fire', 'Flying'])).toBe('resisted');
  });

  it('lets a single immunity in a dual typing veto the whole capture', () => {
    expect(effectiveness('Ground', ['Flying', 'Steel'])).toBe(0);
    expect(captureOutcome('Ground', ['Flying', 'Steel'])).toBe('immune');
  });
});

describe('immunity, the source of untouchable pieces', () => {
  it('makes a Flying piece untouchable by Ground and nothing else', () => {
    expect(typesImmuneAgainst('Flying')).toEqual(['Ground']);
    expect(isImmuneTo('Ground', 'Flying')).toBe(true);
    expect(isImmuneTo('Rock', 'Flying')).toBe(false);
  });

  it('gives Ghost and Normal a mutual standoff', () => {
    expect(isImmuneTo('Normal', 'Ghost')).toBe(true);
    expect(isImmuneTo('Ghost', 'Normal')).toBe(true);
  });

  it('leaves every type capturable by someone, so no piece is absolutely safe', () => {
    for (const t of DRAFTABLE_TYPES) {
      expect(typesImmuneAgainst(t).length).toBeLessThan(DRAFTABLE_TYPES.length);
    }
  });
});

describe('type profiles for the draft interface', () => {
  it('describes both sides of a type', () => {
    const ground = typeProfile('Ground');
    expect(ground.superEffectiveAgainst.sort()).toEqual(
      ['Electric', 'Fire', 'Poison', 'Rock', 'Steel'].sort(),
    );
    expect(ground.cannotCapture).toEqual(['Flying']);
    expect(ground.vulnerableTo.sort()).toEqual(['Grass', 'Ice', 'Water'].sort());
  });

  it('keeps offence and defence consistent between two types', () => {
    for (const a of DRAFTABLE_TYPES) {
      for (const d of DRAFTABLE_TYPES) {
        const m = effectiveness(a, d);
        expect(TYPE_PROFILES[a].superEffectiveAgainst.includes(d)).toBe(m > 1);
        expect(TYPE_PROFILES[d].vulnerableTo.includes(a)).toBe(m > 1);
        expect(TYPE_PROFILES[a].cannotCapture.includes(d)).toBe(m === 0);
        expect(TYPE_PROFILES[d].untouchableBy.includes(a)).toBe(m === 0);
      }
    }
  });

  it('precomputes a profile for all 18 types', () => {
    expect(Object.keys(TYPE_PROFILES)).toHaveLength(18);
  });

  it('finds no type that is super-effective against everything or resisted by nothing', () => {
    // If one existed the draft would collapse onto it, so this is a balance guardrail.
    for (const t of DRAFTABLE_TYPES) {
      expect(typesSuperEffectiveAgainst(t).length).toBeLessThanOrEqual(6);
      expect(typesResistedBy(t).length).toBeGreaterThan(0);
    }
  });
});
