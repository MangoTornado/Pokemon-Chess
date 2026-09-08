import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import { CHOICE_COUNT, PITY_THRESHOLD, rollEncounter, satisfiesPity } from './encounters.ts';
import { RARITIES, isCollectable, rarityOf } from './rarity.ts';
import type { Rarity } from './rarity.ts';

const dex = await Dex.load();

const rarityOfId = (id: string): Rarity => rarityOf(dex.requireSpecies(id));

describe('rarity is read off the data', () => {
  it('bands the legendary families by their real tags', () => {
    expect(rarityOfId('mewtwo')).toBe('mythical');       // Restricted Legendary
    expect(rarityOfId('mew')).toBe('mythical');          // Mythical
    expect(rarityOfId('articuno')).toBe('legendary');    // Sub-Legendary
  });

  it('bands ordinary Pokémon by base stat total', () => {
    expect(rarityOfId('caterpie')).toBe('common');       // bst 195
    expect(rarityOfId('charizard')).toBe('rare');        // bst 534
    // A mid-range fully-evolved Pokémon lands between the two.
    expect(['uncommon', 'rare']).toContain(rarityOfId('raichu'));
  });

  it('excludes what should never be a prize', () => {
    // Every collectable is a base forme with a real typing.
    for (const species of dex.baseFormes.filter(isCollectable).slice(0, 200)) {
      expect(species.types.length).toBeGreaterThan(0);
      expect(species.tier).not.toBe('Illegal');
    }
  });

  it('every collectable species falls in exactly one band', () => {
    for (const species of dex.baseFormes.filter(isCollectable)) {
      expect(RARITIES).toContain(rarityOf(species));
    }
  });
});

describe('encounters scale with the result', () => {
  it('offers more choices for a win than a draw, and fewest for a loss', () => {
    expect(CHOICE_COUNT.win).toBeGreaterThan(CHOICE_COUNT.draw);
    expect(CHOICE_COUNT.draw).toBeGreaterThan(CHOICE_COUNT.loss);
    expect(rollEncounter(dex, 'win', 's').choices).toHaveLength(CHOICE_COUNT.win);
    expect(rollEncounter(dex, 'draw', 's').choices).toHaveLength(CHOICE_COUNT.draw);
    expect(rollEncounter(dex, 'loss', 's').choices).toHaveLength(CHOICE_COUNT.loss);
  });

  it('a loss still offers something — losing should not stall a collection', () => {
    for (let i = 0; i < 20; i++) {
      expect(rollEncounter(dex, 'loss', `l${i}`).choices.length).toBeGreaterThan(0);
    }
  });

  it('a win offers better Pokémon than a loss, over a fair sample', () => {
    const score = (outcome: 'win' | 'loss') => {
      let total = 0;
      let count = 0;
      for (let i = 0; i < 300; i++) {
        for (const id of rollEncounter(dex, outcome, `${outcome}-${i}`).choices) {
          total += RARITIES.indexOf(rarityOfId(id));
          count += 1;
        }
      }
      return total / count;
    };
    // Mean rarity index: strictly higher for wins. Deterministic, since every roll is seeded.
    expect(score('win')).toBeGreaterThan(score('loss'));
  });

  it('only a win can reach the top bands', () => {
    const bandsSeen = (outcome: 'win' | 'draw' | 'loss') => {
      const seen = new Set<Rarity>();
      for (let i = 0; i < 400; i++) {
        for (const id of rollEncounter(dex, outcome, `${outcome}-b${i}`).choices) seen.add(rarityOfId(id));
      }
      return seen;
    };
    expect(bandsSeen('win').has('legendary')).toBe(true);
    expect(bandsSeen('loss').has('legendary')).toBe(false);
    expect(bandsSeen('loss').has('mythical')).toBe(false);
  });

  it('never offers the same species twice in one encounter', () => {
    for (let i = 0; i < 100; i++) {
      const { choices } = rollEncounter(dex, 'win', `dup-${i}`);
      expect(new Set(choices).size).toBe(choices.length);
    }
  });

  it('offers only real, collectable species', () => {
    for (let i = 0; i < 60; i++) {
      for (const id of rollEncounter(dex, 'win', `real-${i}`).choices) {
        const species = dex.getSpecies(id);
        expect(species, `${id} should exist`).toBeDefined();
        expect(isCollectable(species!)).toBe(true);
      }
    }
  });

  it('is reproducible for a seed, and different across seeds', () => {
    expect(rollEncounter(dex, 'win', 'same').choices).toEqual(rollEncounter(dex, 'win', 'same').choices);
    const a = rollEncounter(dex, 'win', 'seed-a').choices;
    const b = rollEncounter(dex, 'win', 'seed-b').choices;
    expect(a).not.toEqual(b);
  });
});

describe('the pity counter keeps the long tail reachable', () => {
  it('forces a rare once the threshold is reached, even on a loss', () => {
    const unlucky = rollEncounter(dex, 'loss', 'pity', PITY_THRESHOLD);
    expect(unlucky.pity).toBe(true);
    expect(satisfiesPity(dex, unlucky.choices)).toBe(true);
  });

  it('does not fire below the threshold', () => {
    expect(rollEncounter(dex, 'loss', 'nopity', PITY_THRESHOLD - 1).pity).toBe(false);
  });

  it('reports whether an offer resets the counter', () => {
    expect(satisfiesPity(dex, ['mewtwo'])).toBe(true);
    expect(satisfiesPity(dex, ['caterpie'])).toBe(false);
    expect(satisfiesPity(dex, [])).toBe(false);
    // An unknown id is simply not rare, rather than throwing.
    expect(satisfiesPity(dex, ['nosuchmon'])).toBe(false);
  });
});
