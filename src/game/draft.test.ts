import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import { STARTING_SQUARES } from '../engine/board.ts';
import {
  DEFAULT_DRAFT_CONFIG,
  applyPick,
  buildSlots,
  checkPick,
  clearSlot,
  finalizeDraft,
  isDraftComplete,
} from './draft.ts';

const dex = await Dex.load();

/** Convenience: fill a slot list with the given species and its first type. */
function fillAllWith(dex: Dex, speciesId: string) {
  const slots = buildSlots();
  const species = dex.requireSpecies(speciesId);
  const pick = { species: species.id, type: species.types[0]! };
  let filled = slots;
  for (let i = 0; i < filled.length; i++) filled = applyPick(filled, i, pick);
  return filled;
}

describe('slots', () => {
  it('builds 32 slots — 16 per side, one per starting square', () => {
    const slots = buildSlots();
    expect(slots).toHaveLength(32);
    const white = slots.filter((s) => s.side === 'white');
    const black = slots.filter((s) => s.side === 'black');
    expect(white).toHaveLength(16);
    expect(black).toHaveLength(16);
  });

  it('covers exactly the starting squares of a standard army, both sides', () => {
    const slots = buildSlots();
    const whiteSquares = new Set(slots.filter((s) => s.side === 'white').map((s) => s.square));
    const expected = new Set<number>();
    for (const cls of ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const) {
      for (const sq of STARTING_SQUARES.white[cls]) expected.add(sq);
    }
    expect(whiteSquares).toEqual(expected);
  });

  it('starts empty', () => {
    const slots = buildSlots();
    expect(slots.every((s) => s.picked === null)).toBe(true);
    expect(isDraftComplete(slots)).toBe(false);
  });
});

describe('valid picks', () => {
  it('accepts a species drafted as one of its real types', () => {
    // Lapras is dual-typed, which is the case the draft was designed around: Lapras taken as Water is
    // a different piece from Lapras taken as Ice.
    const slots = buildSlots();
    const lapras = dex.requireSpecies('lapras');
    expect(checkPick(dex, slots, 0, lapras, 'Water', DEFAULT_DRAFT_CONFIG)).toBeNull();
    expect(checkPick(dex, slots, 0, lapras, 'Ice', DEFAULT_DRAFT_CONFIG)).toBeNull();
  });

  it('refuses a type the species does not actually have', () => {
    const slots = buildSlots();
    const lapras = dex.requireSpecies('lapras');
    const err = checkPick(dex, slots, 0, lapras, 'Fire', DEFAULT_DRAFT_CONFIG);
    expect(err?.kind).toBe('wrong-type');
  });

  it('rejects a species outside the pool when a pool is set', () => {
    const slots = buildSlots();
    const pikachu = dex.requireSpecies('pikachu');
    const config = { ...DEFAULT_DRAFT_CONFIG, pool: ['bulbasaur', 'charmander'] };
    expect(checkPick(dex, slots, 0, pikachu, 'Electric', config)?.kind).toBe('not-in-pool');
  });

  it('admits any species when no pool is set — the sandbox default', () => {
    const slots = buildSlots();
    for (const id of ['pikachu', 'mew', 'miraidon', 'pecharunt']) {
      const species = dex.requireSpecies(id);
      const type = species.types[0]!;
      expect(checkPick(dex, slots, 0, species, type, DEFAULT_DRAFT_CONFIG)).toBeNull();
    }
  });
});

describe('duplicate handling', () => {
  it('blocks the same species on the same side by default', () => {
    // Sixteen Magikarp is a toy mode, not the default one. Casual matches let you pick your favourites,
    // but not to the point that an army is only one Pokémon.
    let slots = buildSlots();
    const pikachu = dex.requireSpecies('pikachu');
    slots = applyPick(slots, 0, { species: 'pikachu', type: 'Electric' });
    // Slot 1 is the same-side b-pawn.
    const err = checkPick(dex, slots, 1, pikachu, 'Electric', DEFAULT_DRAFT_CONFIG);
    expect(err?.kind).toBe('already-taken');
  });

  it('allows the same species on the other side by default', () => {
    // The mirror match: both armies pick Charizard, and the game becomes which player fields it better.
    let slots = buildSlots();
    const charizard = dex.requireSpecies('charizard');
    slots = applyPick(slots, 0, { species: 'charizard', type: 'Fire' });
    // Slot 16 is the black a-pawn — first pick of the other side.
    expect(checkPick(dex, slots, 16, charizard, 'Fire', DEFAULT_DRAFT_CONFIG)).toBeNull();
  });

  it('honours a competitive format banning duplicates across both sides', () => {
    let slots = buildSlots();
    const charizard = dex.requireSpecies('charizard');
    slots = applyPick(slots, 0, { species: 'charizard', type: 'Fire' });
    const config = { ...DEFAULT_DRAFT_CONFIG, allowDuplicateSpecies: false };
    const err = checkPick(dex, slots, 16, charizard, 'Fire', config);
    expect(err?.kind).toBe('already-taken');
  });

  it('honours a toy format allowing intra-side duplicates', () => {
    let slots = buildSlots();
    const magikarp = dex.requireSpecies('magikarp');
    slots = applyPick(slots, 0, { species: 'magikarp', type: 'Water' });
    const toy = { ...DEFAULT_DRAFT_CONFIG, allowIntraSideDuplicates: true };
    expect(checkPick(dex, slots, 1, magikarp, 'Water', toy)).toBeNull();
  });

  it('does not consider its own slot when checking duplicates, so changing a pick is legal', () => {
    let slots = buildSlots();
    const pikachu = dex.requireSpecies('pikachu');
    slots = applyPick(slots, 0, { species: 'pikachu', type: 'Electric' });
    // The player wants to change slot 0 to a different Pikachu type — that is still slot 0.
    expect(checkPick(dex, slots, 0, pikachu, 'Electric', DEFAULT_DRAFT_CONFIG)).toBeNull();
  });
});

describe('mutations', () => {
  it('applies a pick without mutating its input', () => {
    const before = buildSlots();
    const after = applyPick(before, 0, { species: 'pikachu', type: 'Electric' });
    expect(before[0]!.picked).toBeNull();
    expect(after[0]!.picked?.species).toBe('pikachu');
  });

  it('clears a slot for a rethink', () => {
    let slots = buildSlots();
    slots = applyPick(slots, 3, { species: 'gengar', type: 'Ghost' });
    slots = clearSlot(slots, 3);
    expect(slots[3]!.picked).toBeNull();
    expect(isDraftComplete(slots)).toBe(false);
  });
});

describe('finalization', () => {
  it('refuses to finalize a partial draft, because a match with a hole in it is nonsense', () => {
    const slots = buildSlots();
    expect(() => finalizeDraft(dex, slots)).toThrow();
  });

  it('produces a starting position and a loadout keyed by piece id', () => {
    const slots = fillAllWith(dex, 'pikachu');
    const finalized = finalizeDraft(dex, slots);
    expect(finalized.position.allPieces()).toHaveLength(32);
    expect(finalized.loadout.size).toBe(32);
    for (const [, load] of finalized.loadout) {
      expect(load.species).toBe('pikachu');
      expect(load.type).toBe('Electric');
    }
    expect(finalized.drafted).toHaveLength(32);
  });

  it('preserves the draft order in its output', () => {
    const slots = fillAllWith(dex, 'pikachu');
    const finalized = finalizeDraft(dex, slots);
    // The first entry is white's queen-side rook on a1.
    expect(finalized.drafted[0]!.square).toBe(slots[0]!.square);
    expect(finalized.drafted[0]!.side).toBe('white');
  });
});
