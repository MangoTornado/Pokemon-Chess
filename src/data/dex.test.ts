import { describe, expect, it } from 'vitest';

import { Dex, loadManifest } from './dex.ts';

const dex = await Dex.load();

describe('coverage of the real dex', () => {
  it('carries every National Dex number from Bulbasaur to Pecharunt', () => {
    const nums = new Set(dex.species.map((s) => s.num));
    expect(nums.size).toBe(1025);
    expect(dex.baseFormes).toHaveLength(1025);
    expect(dex.getSpecies('bulbasaur')?.num).toBe(1);
    expect(dex.getSpecies('pecharunt')?.num).toBe(1025);
    // No gaps in the range.
    for (let n = 1; n <= 1025; n++) expect(nums.has(n)).toBe(true);
  });

  it('carries the alternate formes too, not just base species', () => {
    expect(dex.species.length).toBeGreaterThan(1300);
    expect(dex.getSpecies('charizardmegax')?.formeKind).toBe('mega');
    expect(dex.getSpecies('raichualola')?.formeKind).toBe('regional');
    expect(dex.getSpecies('venusaurgmax')?.formeKind).toBe('gmax');
  });

  it('carries all moves, abilities and items', () => {
    expect(dex.moves.length).toBe(950);
    expect(dex.abilities.length).toBe(311);
    expect(dex.items.length).toBe(536);
  });

  it('reports its own provenance and passed invariants', async () => {
    const manifest = await loadManifest();
    expect(manifest.counts['speciesDexNumbers']).toBe(1025);
    expect(manifest.checks.length).toBeGreaterThan(20);
    expect(manifest.sources['@pkmn/sim']).toBeTruthy();
    expect(manifest.sprites.iconSheetUrl).toMatch(/pokemonicons-sheet\.png$/);
  });

  it('bakes a distinct spritesheet icon for every forme, so the board needs one request', () => {
    // (0, 0) is the sheet's unknown-species slot: landing there renders the wrong picture silently.
    for (const s of dex.species) {
      expect(s.icon).toHaveLength(2);
      expect(s.icon[0] === 0 && s.icon[1] === 0).toBe(false);
    }
    const distinct = new Set(dex.species.map((s) => s.icon.join(',')));
    expect(distinct.size).toBeGreaterThan(1300);
  });
});

describe('species lookups', () => {
  it('finds species by id and throws on a typo rather than returning undefined', () => {
    expect(dex.requireSpecies('pikachu').name).toBe('Pikachu');
    expect(() => dex.requireSpecies('pikachoo')).toThrow(/unknown species/);
  });

  it('groups formes under one dex number', () => {
    const formes = dex.formesOf(6);
    const names = formes.map((f) => f.name);
    expect(names).toContain('Charizard');
    expect(names).toContain('Charizard-Mega-X');
    expect(names).toContain('Charizard-Mega-Y');
    expect(formes.every((f) => f.num === 6)).toBe(true);
  });

  it('resolves a forme back to its base', () => {
    const megaX = dex.requireSpecies('charizardmegax');
    expect(dex.baseFormeOf(megaX).id).toBe('charizard');
    // A base forme resolves to itself.
    const pikachu = dex.requireSpecies('pikachu');
    expect(dex.baseFormeOf(pikachu).id).toBe('pikachu');
  });

  it('gives every species at least one type and at least one ability', () => {
    for (const s of dex.species) {
      expect(s.types.length).toBeGreaterThanOrEqual(1);
      expect(s.types.length).toBeLessThanOrEqual(2);
      expect(s.abilities.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('resolves ability ids to real abilities for every species', () => {
    for (const s of dex.species) {
      expect(dex.abilitiesOf(s).length).toBe(s.abilities.length);
    }
  });

  it('filters by type', () => {
    const ghosts = dex.speciesOfType('Ghost');
    expect(ghosts.some((s) => s.id === 'gengar')).toBe(true);
    expect(ghosts.every((s) => s.types.includes('Ghost'))).toBe(true);
    // Every one of the 18 types has candidates, so no draft slot can be impossible to fill.
    for (const t of [
      'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
      'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
    ] as const) {
      expect(dex.speciesOfType(t).length).toBeGreaterThan(10);
    }
  });
});

describe('the one-type-per-piece draft choice', () => {
  it('offers a dual-typed species both of its types', () => {
    // Exactly the decision the video agonised over: "is this a water type or an ice type?"
    const lapras = dex.requireSpecies('lapras');
    expect(dex.draftableTypesOf(lapras)).toEqual(['Water', 'Ice']);
  });

  it('offers a single-typed species only the one', () => {
    expect(dex.draftableTypesOf(dex.requireSpecies('pikachu'))).toEqual(['Electric']);
  });
});

describe('learnsets', () => {
  it('never leaves a species with no moves at all', () => {
    for (const s of dex.species) {
      expect(dex.learnsetIdsOf(s.id).length).toBeGreaterThan(0);
    }
  });

  it('resolves every learnset id to a real move', () => {
    for (const s of dex.species) {
      const ids = dex.learnsetIdsOf(s.id);
      expect(dex.learnsetOf(s.id).length).toBe(ids.length);
    }
  });

  it('inherits a full learnset onto battle-only formes', () => {
    // Showdown stores no learnset for these, so a naive loader gives them zero moves.
    expect(dex.learnsetIdsOf('charizardmegax').length).toBeGreaterThan(100);
    expect(dex.learnsetIdsOf('landorustherian').length).toBeGreaterThan(50);
    expect(dex.learnsetIdsOf('charizardmegax')).toContain('flamethrower');
  });

  it('unions a forme\'s signature move with its base learnset', () => {
    // Rotom-Wash stores exactly one move of its own; the rest must come from base Rotom.
    const rotomWash = dex.learnsetIdsOf('rotomwash');
    expect(rotomWash.length).toBeGreaterThan(50);
    expect(rotomWash).toContain('hydropump');
    expect(rotomWash).toContain('thundershock');
  });

  it('respects the famously tiny movesets rather than inventing moves', () => {
    expect(dex.learnsetIdsOf('ditto')).toEqual(['transform']);
    expect(dex.learnsetIdsOf('unown')).toEqual(['hiddenpower']);
    expect(dex.learnsetIdsOf('magikarp').length).toBeLessThan(10);
    expect(dex.learnsetIdsOf('magikarp')).toContain('splash');
  });

  it('gives a versatile species a large moveset', () => {
    expect(dex.learnsetIdsOf('mew').length).toBeGreaterThan(200);
  });
});

describe('evolution, which drives pawn promotion', () => {
  it('walks a three-stage line from the base stage', () => {
    const line = dex.evolutionLineOf(dex.requireSpecies('charmeleon')).map((s) => s.id);
    expect(line).toEqual(['charmander', 'charmeleon', 'charizard']);
  });

  it('includes branching evolutions', () => {
    const eeveeLine = dex.evolutionLineOf(dex.requireSpecies('eevee')).map((s) => s.id);
    expect(eeveeLine[0]).toBe('eevee');
    expect(eeveeLine).toContain('vaporeon');
    expect(eeveeLine).toContain('umbreon');
    expect(eeveeLine).toContain('sylveon');
    expect(eeveeLine.length).toBeGreaterThanOrEqual(9);
  });

  it('handles a species with no evolutions', () => {
    expect(dex.evolutionLineOf(dex.requireSpecies('ditto')).map((s) => s.id)).toEqual(['ditto']);
  });

  it('terminates on every species in the dex', () => {
    // Guards against a cycle in the evolution graph hanging the promotion UI.
    for (const s of dex.baseFormes) {
      expect(dex.evolutionLineOf(s).length).toBeGreaterThan(0);
    }
  });

  it('marks not-fully-evolved species, which is what a pawn is', () => {
    expect(dex.requireSpecies('charmander').nfe).toBe(true);
    expect(dex.requireSpecies('charizard').nfe).toBe(false);
  });
});

describe('mega evolution', () => {
  it('links a species to its stone and the forme it unlocks', () => {
    const charizard = dex.requireSpecies('charizard');
    const stones = dex.megaStonesFor(charizard).map((i) => i.id);
    expect(stones).toContain('charizarditex');
    expect(stones).toContain('charizarditey');

    const formes = dex.itemFormesOf(charizard).map((f) => f.id);
    expect(formes).toContain('charizardmegax');
    expect(formes).toContain('charizardmegay');
  });

  it('finds no stone for a species that has no mega', () => {
    expect(dex.megaStonesFor(dex.requireSpecies('bidoof'))).toHaveLength(0);
  });
});

describe('role affinity hints for the draft UI', () => {
  it('scores a special attacker highest as a bishop', () => {
    const alakazam = dex.roleAffinity(dex.requireSpecies('alakazam'));
    expect(alakazam.bishop).toBeGreaterThan(alakazam.rook);
  });

  it('scores a physical wall highest as a rook', () => {
    const shuckle = dex.roleAffinity(dex.requireSpecies('shuckle'));
    expect(shuckle.rook).toBeGreaterThan(shuckle.bishop);
  });

  it('scores a weak early-stage species highest as a pawn', () => {
    const caterpie = dex.roleAffinity(dex.requireSpecies('caterpie'));
    const mewtwo = dex.roleAffinity(dex.requireSpecies('mewtwo'));
    expect(caterpie.pawn).toBeGreaterThan(mewtwo.pawn);
    expect(mewtwo.queen).toBeGreaterThan(caterpie.queen);
  });

  it('keeps every score inside 0..1 for every species', () => {
    for (const s of dex.species) {
      for (const score of Object.values(dex.roleAffinity(s))) {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(1);
      }
    }
  });
});
