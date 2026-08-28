/**
 * Typed, cached access to the baked dex bundles.
 *
 * Loading is granular and lazy on purpose. The draft screen needs species immediately; nothing needs
 * the 445 KB learnset table until a piece's moveset is actually inspected. Splitting the loads keeps
 * time-to-first-interaction independent of total content size.
 *
 * Nothing here reaches the network — the bundles are baked at build time by `scripts/gen-data.ts`.
 */

import type {
  AbilityEntry,
  BattleType,
  DexManifest,
  ItemEntry,
  LearnsetBundle,
  MoveEntry,
  PieceRoleHint,
  SpeciesEntry,
  TypeChart,
} from './schema.ts';

// ---------------------------------------------------------------------------
// Lazy bundle loading
// ---------------------------------------------------------------------------

function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= load());
}

export const loadSpecies = once(async (): Promise<SpeciesEntry[]> => {
  const mod = await import('./generated/species.json', { with: { type: 'json' } });
  return mod.default as unknown as SpeciesEntry[];
});

export const loadMoves = once(async (): Promise<MoveEntry[]> => {
  const mod = await import('./generated/moves.json', { with: { type: 'json' } });
  return mod.default as unknown as MoveEntry[];
});

export const loadAbilities = once(async (): Promise<AbilityEntry[]> => {
  const mod = await import('./generated/abilities.json', { with: { type: 'json' } });
  return mod.default as unknown as AbilityEntry[];
});

export const loadItems = once(async (): Promise<ItemEntry[]> => {
  const mod = await import('./generated/items.json', { with: { type: 'json' } });
  return mod.default as unknown as ItemEntry[];
});

export const loadLearnsets = once(async (): Promise<LearnsetBundle> => {
  const mod = await import('./generated/learnsets.json', { with: { type: 'json' } });
  return mod.default as unknown as LearnsetBundle;
});

export const loadTypeChart = once(async (): Promise<TypeChart> => {
  const mod = await import('./generated/typechart.json', { with: { type: 'json' } });
  return mod.default as unknown as TypeChart;
});

export const loadManifest = once(async (): Promise<DexManifest> => {
  const mod = await import('./generated/manifest.json', { with: { type: 'json' } });
  return mod.default as unknown as DexManifest;
});

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

/**
 * Queryable view over the whole dex.
 *
 * Built once and shared. All lookups are O(1) map hits or precomputed arrays, because the draft UI
 * filters 1367 formes interactively and the AI evaluates positions in a tight loop.
 */
export class Dex {
  readonly species: readonly SpeciesEntry[];
  readonly moves: readonly MoveEntry[];
  readonly abilities: readonly AbilityEntry[];
  readonly items: readonly ItemEntry[];

  private readonly speciesById: Map<string, SpeciesEntry>;
  private readonly speciesByNum: Map<number, SpeciesEntry[]>;
  private readonly movesById: Map<string, MoveEntry>;
  private readonly abilitiesById: Map<string, AbilityEntry>;
  private readonly itemsById: Map<string, ItemEntry>;
  private readonly learnsets: LearnsetBundle;
  private readonly learnsetMoveIds: readonly string[];

  /** The 1025 base formes — one per National Dex number. The natural default draft pool. */
  readonly baseFormes: readonly SpeciesEntry[];

  constructor(bundles: {
    species: SpeciesEntry[];
    moves: MoveEntry[];
    abilities: AbilityEntry[];
    items: ItemEntry[];
    learnsets: LearnsetBundle;
  }) {
    this.species = bundles.species;
    this.moves = bundles.moves;
    this.abilities = bundles.abilities;
    this.items = bundles.items;
    this.learnsets = bundles.learnsets;
    this.learnsetMoveIds = bundles.learnsets.moveIds;

    this.speciesById = new Map(bundles.species.map((s) => [s.id, s]));
    this.movesById = new Map(bundles.moves.map((m) => [m.id, m]));
    this.abilitiesById = new Map(bundles.abilities.map((a) => [a.id, a]));
    this.itemsById = new Map(bundles.items.map((i) => [i.id, i]));

    this.speciesByNum = new Map();
    for (const s of bundles.species) {
      const list = this.speciesByNum.get(s.num);
      if (list) list.push(s);
      else this.speciesByNum.set(s.num, [s]);
    }

    this.baseFormes = bundles.species.filter((s) => s.formeKind === 'base');
  }

  /** Loads every bundle and builds the index. */
  static async load(): Promise<Dex> {
    const [species, moves, abilities, items, learnsets] = await Promise.all([
      loadSpecies(),
      loadMoves(),
      loadAbilities(),
      loadItems(),
      loadLearnsets(),
    ]);
    return new Dex({ species, moves, abilities, items, learnsets });
  }

  getSpecies(id: string): SpeciesEntry | undefined {
    return this.speciesById.get(id);
  }

  /** Throws rather than returning undefined, for call sites where a missing id is a bug. */
  requireSpecies(id: string): SpeciesEntry {
    const s = this.speciesById.get(id);
    if (!s) throw new Error(`unknown species: ${id}`);
    return s;
  }

  getMove(id: string): MoveEntry | undefined {
    return this.movesById.get(id);
  }

  requireMove(id: string): MoveEntry {
    const m = this.movesById.get(id);
    if (!m) throw new Error(`unknown move: ${id}`);
    return m;
  }

  getAbility(id: string): AbilityEntry | undefined {
    return this.abilitiesById.get(id);
  }

  getItem(id: string): ItemEntry | undefined {
    return this.itemsById.get(id);
  }

  /** Every forme sharing a National Dex number, base forme first. */
  formesOf(num: number): readonly SpeciesEntry[] {
    return this.speciesByNum.get(num) ?? [];
  }

  /** The base forme a species belongs to. */
  baseFormeOf(species: SpeciesEntry): SpeciesEntry {
    return this.speciesById.get(species.baseSpecies) ?? species;
  }

  /**
   * Move ids a species can legally learn, unioned across formes at build time.
   *
   * Never empty — but legitimately tiny for a few species. Ditto knows only Transform and Unown only
   * Hidden Power, which is authentic rather than a data fault, so callers must handle small sets.
   */
  learnsetIdsOf(speciesId: string): string[] {
    const indices = this.learnsets.species[speciesId];
    if (!indices) return [];
    return indices.map((i) => this.learnsetMoveIds[i]!).filter(Boolean);
  }

  /** Resolved move entries a species can learn. */
  learnsetOf(speciesId: string): MoveEntry[] {
    return this.learnsetIdsOf(speciesId)
      .map((id) => this.movesById.get(id))
      .filter((m): m is MoveEntry => Boolean(m));
  }

  /** Ability entries a species can have, in slot order. */
  abilitiesOf(species: SpeciesEntry): AbilityEntry[] {
    return species.abilities
      .map((id) => this.abilitiesById.get(id))
      .filter((a): a is AbilityEntry => Boolean(a));
  }

  /** All species that have `type` among their real typings. */
  speciesOfType(type: BattleType, pool: readonly SpeciesEntry[] = this.baseFormes): SpeciesEntry[] {
    return pool.filter((s) => s.types.includes(type));
  }

  /**
   * Types a species may be drafted as — exactly its real typing.
   *
   * A piece carries one type in Pokémon Chess, so a dual-typed species is a draft *choice*: Lapras
   * can be taken as Water or as Ice, and that decision changes what it can and cannot capture.
   */
  draftableTypesOf(species: SpeciesEntry): readonly BattleType[] {
    return species.types;
  }

  /** Item entries that unlock a Mega forme of this species. */
  megaStonesFor(species: SpeciesEntry): ItemEntry[] {
    const baseName = this.baseFormeOf(species).name;
    return this.items.filter((i) => i.megaStone && Object.hasOwn(i.megaStone, baseName));
  }

  /** Formes reachable from this one by holding an item (Mega Evolution and equivalents). */
  itemFormesOf(species: SpeciesEntry): SpeciesEntry[] {
    return this.formesOf(species.num).filter(
      (f) => f.requiredItem && f.changesFrom === species.id,
    );
  }

  /** What this species evolves into, as entries. */
  evolutionsOf(species: SpeciesEntry): SpeciesEntry[] {
    return (species.evos ?? [])
      .map((id) => this.speciesById.get(id))
      .filter((s): s is SpeciesEntry => Boolean(s));
  }

  /** What this species evolved from, if anything. */
  preEvolutionOf(species: SpeciesEntry): SpeciesEntry | undefined {
    return species.prevo ? this.speciesById.get(species.prevo) : undefined;
  }

  /**
   * Walks the full evolution line a species belongs to, earliest stage first.
   *
   * Pawn promotion is reskinned as evolution, so the line is what determines what a pawn may become.
   */
  evolutionLineOf(species: SpeciesEntry): SpeciesEntry[] {
    let root = species;
    const guard = new Set<string>([root.id]);
    for (;;) {
      const prev = this.preEvolutionOf(root);
      if (!prev || guard.has(prev.id)) break;
      guard.add(prev.id);
      root = prev;
    }

    const line: SpeciesEntry[] = [];
    const visit = (s: SpeciesEntry) => {
      line.push(s);
      for (const next of this.evolutionsOf(s)) {
        if (!line.some((x) => x.id === next.id)) visit(next);
      }
    };
    visit(root);
    return line;
  }

  /**
   * How well a species' stat spread matches each chess role, as a 0–1 score.
   *
   * The video assigned roles by vibe: bishops were "magically special attacking" Pokémon, rooks were
   * "physically defensive bulky" ones, knights were Pokémon you can ride. Only the first two are
   * legible in the data, so this scores those honestly and leaves the rest neutral rather than
   * pretending otherwise. Advisory only — a suggestion in the draft UI, never a restriction.
   */
  roleAffinity(species: SpeciesEntry): PieceRoleHint {
    const [hp, atk, def, spa, spd, spe] = species.baseStats;
    const total = Math.max(1, hp + atk + def + spa + spd + spe);
    const physicalBulk = (hp + def) / total;
    const specialOffence = spa / total;
    const physicalOffence = atk / total;
    const speed = spe / total;

    const clamp = (n: number) => Math.max(0, Math.min(1, n));
    // Scaled so a typical specialist lands near 0.7 rather than compressing everything mid-range.
    return {
      bishop: clamp(specialOffence * 3.4),
      rook: clamp(physicalBulk * 2.4),
      // The video picked knights by rideability, which no stat captures. Speed plus physical
      // offence is the closest honest proxy for a fast, tricky attacker.
      knight: clamp((speed + physicalOffence) * 1.7),
      queen: clamp((species.bst - 400) / 300),
      pawn: clamp(1 - (species.bst - 200) / 400),
      king: clamp((hp + def + spd) / total * 2.2),
    };
  }
}

/** Shared instance, so the whole app indexes the dex once. */
export const getDex = once(() => Dex.load());
