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
  resolveKit,
} from './draft.ts';
import { IMPLEMENTED_ITEMS } from '../rules/items.ts';
import { isTransformItem, megaStoneFor, zCrystalType } from './transform.ts';
import { autodraft } from './autodraft.ts';
import { candidateArts } from './arts.ts';

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

describe('the drafted kit', () => {
  it('hands a hand-drafted piece the same layers an auto-drafted one gets', () => {
    // The gap this closes: a draft used to emit only species and type, so a hand-built army fought with no
    // ability, no held item and no Tera type while a generated one had all three.
    const finalized = finalizeDraft(dex, fillAllWith(dex, 'garchomp'));
    for (const [, load] of finalized.loadout) {
      expect(load.ability).toBeTruthy();
      expect(load.item).toBeTruthy();
      expect(load.teraType).toBeTruthy();
    }
  });

  it('only ever hands out an ability the species actually has and an item the rules implement', () => {
    const species = dex.requireSpecies('garchomp');
    const finalized = finalizeDraft(dex, fillAllWith(dex, 'garchomp'));
    for (const [, load] of finalized.loadout) {
      expect(species.abilities).toContain(load.ability);
      // Either an item with a combat effect, or one of the transformation items (a mega stone, a Z-crystal).
      expect(IMPLEMENTED_ITEMS.includes(load.item!) || isTransformItem(dex, load.item!)).toBe(true);
    }
  });

  it('never Teras into the type the piece already fights as, which would be a wasted turn', () => {
    for (const id of ['garchomp', 'charizard', 'pikachu']) {
      const finalized = finalizeDraft(dex, fillAllWith(dex, id));
      for (const [, load] of finalized.loadout) {
        if (load.teraType) expect(load.teraType).not.toBe(load.type);
      }
    }
  });

  it("carries the player's own choices through untouched, and only fills the rest", () => {
    let slots = fillAllWith(dex, 'garchomp');
    slots = applyPick(slots, 0, {
      species: 'garchomp', type: 'Dragon', ability: 'roughskin', item: 'lifeorb', teraType: 'Steel',
    });
    const finalized = finalizeDraft(dex, slots);
    const first = finalized.loadout.get(finalized.position.pieceAt(slots[0]!.square)!.id)!;
    expect(first).toMatchObject({ ability: 'roughskin', item: 'lifeorb', teraType: 'Steel' });

    // A neighbouring slot the player left alone still gets a resolved kit rather than nothing.
    const second = finalized.loadout.get(finalized.position.pieceAt(slots[1]!.square)!.id)!;
    expect(second.item).toBeTruthy();
    expect(second.item).not.toBe('lifeorb'); // resolved, not inherited from the edited slot
  });

  it('resolves the same kit the draft screen previews, so what you see is what you field', () => {
    // The draft screen calls resolveKit to show a piece's kit before committing; finalizeDraft must agree,
    // or the preview would be a lie.
    const slots = fillAllWith(dex, 'gengar');
    const finalized = finalizeDraft(dex, slots);
    for (const slot of slots) {
      const previewed = resolveKit(dex, slot, slot.picked!);
      const fielded = finalized.loadout.get(finalized.position.pieceAt(slot.square)!.id)!;
      expect(fielded).toEqual(previewed);
    }
  });

  it('hands the auto-draft exactly one transformation item per side, not one per capable piece', () => {
    // The bug this pins cost the game its damage. A mega stone and a Z-crystal do nothing turn to turn, so
    // every one handed out *replaces* a Life Orb or a Choice Band with dead weight. Giving 70% of mega-capable
    // pieces a stone nearly doubled average game length in self-play (224 plies to 426) because nothing could
    // be finished. A side can spend one transformation, so it gets one such item.
    for (const seed of ['grant-a', 'grant-b', 'grant-c']) {
      const { position, loadout } = autodraft(dex, seed);
      const perSide: Record<string, number> = { white: 0, black: 0 };
      for (const { piece } of position.allPieces()) {
        const item = loadout.get(piece.id)?.item;
        if (item && isTransformItem(dex, item)) perSide[piece.side] = (perSide[piece.side] ?? 0) + 1;
      }
      expect(perSide.white, seed).toBeLessThanOrEqual(1);
      expect(perSide.black, seed).toBeLessThanOrEqual(1);
    }
  });

  it('gives that item to a piece that can actually use it', () => {
    const { position, loadout } = autodraft(dex, 'grant-usable');
    for (const { piece } of position.allPieces()) {
      const entry = loadout.get(piece.id)!;
      if (!entry.item || !isTransformItem(dex, entry.item)) continue;
      const species = dex.requireSpecies(entry.species);
      const stone = megaStoneFor(dex, species);
      // Either it is this species' own stone, or a crystal matching the type it fights as.
      const usable = entry.item === stone?.id || zCrystalType(dex, entry.item) === entry.type;
      expect(usable, `${species.name} holding ${entry.item}`).toBe(true);
    }
  });

  it('is deterministic in the seed, so the same draft reproduces the same army', () => {
    const slots = fillAllWith(dex, 'lucario');
    const a = finalizeDraft(dex, slots, 'seed-a');
    const b = finalizeDraft(dex, slots, 'seed-a');
    const c = finalizeDraft(dex, slots, 'seed-b');
    expect([...a.loadout.values()]).toEqual([...b.loadout.values()]);
    // A different seed varies the kit somewhere — otherwise the seed would be decoration.
    expect([...a.loadout.values()]).not.toEqual([...c.loadout.values()]);
  });

  it('offers every art a species can cast, and picks one of them', () => {
    // Ferrothorn is the clearest case: it can lay Spikes, set Stealth Rock, or raise a screen, and which one
    // it does is a genuinely different piece.
    const arts = candidateArts(dex, 'ferrothorn');
    expect(arts.length).toBeGreaterThan(1);
    expect(arts.map((a) => a.id)).toContain('spikes');
    // No duplicates, and every entry really changes field state.
    expect(new Set(arts.map((a) => a.id)).size).toBe(arts.length);

    const finalized = finalizeDraft(dex, fillAllWith(dex, 'ferrothorn'));
    for (const [, load] of finalized.loadout) {
      expect(arts.map((a) => a.id)).toContain(load.art!.id);
    }
  });

  it('leaves the art absent for a species that knows no field move at all', () => {
    // Most Pokémon know none, and an absent art is the honest answer rather than a placeholder.
    const arts = candidateArts(dex, 'magikarp');
    expect(arts).toHaveLength(0);
    const finalized = finalizeDraft(dex, fillAllWith(dex, 'magikarp'));
    for (const [, load] of finalized.loadout) expect(load.art).toBeUndefined();
  });

  it('gives pieces on different squares different kits, so an army is not 16 clones', () => {
    const finalized = finalizeDraft(dex, fillAllWith(dex, 'blaziken'));
    const items = new Set([...finalized.loadout.values()].map((l) => l.item));
    expect(items.size).toBeGreaterThan(1);
  });
});
