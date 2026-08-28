/**
 * Shapes of the baked dex bundles in `src/data/generated/`.
 *
 * These files are produced by `scripts/gen-data.ts` (`npm run gen:data`) from `@pkmn/dex` and
 * `@pkmn/sim`, neither of which is ever shipped to the browser — they are tens of megabytes.
 *
 * See `docs/design/recon-data-substrate.md` for why the generator reads two sources: `@pkmn/dex`
 * strips every behaviour callback without leaving a marker, so `@pkmn/sim` is needed to recover the
 * handler fingerprint that tells us whether an entry's real behaviour is data or code.
 */

export const BATTLE_TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice',
  'Fighting', 'Poison', 'Ground', 'Flying', 'Psychic', 'Bug',
  'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
] as const;

/** The 18 types a piece can actually be. */
export type BattleType = (typeof BATTLE_TYPES)[number];

/** Every type in the chart, including Tera-only `Stellar`, which no piece may be drafted as. */
export type DexType = BattleType | 'Stellar';

export type MoveCategory = 'Physical' | 'Special' | 'Status';

/**
 * Which signals were available to determine an entry's behaviour. Recorded so that content coverage
 * is testable rather than asserted: see `signalClass` counts in the manifest.
 *
 * - `plain-damage` — no effect fields and no handlers: a pure damaging move, fully derivable.
 * - `fields`       — behaviour is declared in data fields, fully derivable.
 * - `handlers`     — behaviour exists only as code; data fields say nothing.
 * - `fields+handlers` — partially declared; code carries additional semantics.
 * - `inert`        — no fields, no handlers, and none expected (e.g. a Poké Ball).
 */
export type SignalClass = 'plain-damage' | 'fields' | 'handlers' | 'fields+handlers' | 'inert';

/** How a forme relates to its base species. */
export type FormeKind = 'base' | 'mega' | 'gmax' | 'regional' | 'cosmetic' | 'battle' | 'other';

export interface SpeciesEntry {
  /** National Dex number. Shared across all formes of a species. */
  num: number;
  id: string;
  name: string;
  /** One or two types, as in the real games. A piece is drafted with exactly one of these. */
  types: BattleType[];
  /** `[hp, atk, def, spa, spd, spe]` */
  baseStats: [number, number, number, number, number, number];
  bst: number;
  /**
   * Hard override of computed max HP, present only where the games set one.
   *
   * Shedinja is the sole species carrying this, at `1`. It matters because the level-50 HP formula would
   * otherwise give Shedinja 77 HP, and a 77-HP Wonder Guard piece is the untouchable-piece problem the
   * literal reading exists to retire (see SPEC §3.4). Absent for everyone else.
   */
  maxHP?: number;
  /** Kilograms. Resolved through the base forme for Gigantamax formes, which report 0. */
  weightkg: number;
  /** Ability ids in slot order: normal slots first, then hidden, then special. */
  abilities: string[];
  /** Subset of `abilities` that are hidden-slot. */
  hiddenAbilities: string[];
  prevo?: string;
  evos?: string[];
  evoType?: string;
  evoLevel?: number;
  evoItem?: string;
  evoMove?: string;
  evoCondition?: string;
  /** Not-fully-evolved: this species has at least one evolution. */
  nfe: boolean;
  /** Id of the base forme. Equals `id` when this *is* the base forme. */
  baseSpecies: string;
  /** `''` for the base forme, otherwise e.g. `Mega-X`, `Alola`, `Therian`. */
  forme: string;
  formeKind: FormeKind;
  /** Held item required to access this forme, e.g. `Charizardite X`. */
  requiredItem?: string;
  /** The forme this one transforms out of. */
  changesFrom?: string;
  /** Name of this species' G-Max move, if it has one. */
  canGigantamax?: string;
  /** e.g. `Legendary`, `Sub-Legendary`, `Mythical`, `Paradox`, `Restricted Legendary`. */
  tags: string[];
  gen: number;
  /** Smogon singles tier, useful as a rough power prior. */
  tier?: string;
  isNonstandard: string | null;
  /** Id to look up in `learnsets.json` — always resolved to a key that exists. */
  learnsetRef: string;
  /**
   * `[left, top]` CSS background offsets into the shared icon spritesheet, in pixels.
   *
   * Baked at build time so the client needs no sprite-resolution library. One 383 KB sheet renders
   * any Pokémon on the board, so a game's pieces cost a single request regardless of which of the
   * 1025 species were drafted. Sheet URL and icon dimensions are in the manifest.
   */
  icon: [number, number];
}

export interface MoveSecondary {
  chance?: number;
  status?: string;
  volatileStatus?: string;
  boosts?: Record<string, number>;
  self?: { boosts?: Record<string, number>; volatileStatus?: string };
}

export interface MoveEntry {
  num: number;
  id: string;
  name: string;
  type: DexType;
  category: MoveCategory;
  basePower: number;
  /** `true` means "cannot miss". */
  accuracy: number | true;
  pp: number;
  priority: number;
  /** Showdown targeting mode, e.g. `normal`, `allAdjacentFoes`, `self`, `allySide`. */
  target: string;
  flags: string[];

  critRatio?: number;
  willCrit?: boolean;
  /** Fixed hit count, or `[min, max]`. */
  multihit?: number | [number, number];
  ohko?: boolean | string;
  selfdestruct?: string;
  /** `[numerator, denominator]` of damage dealt, healed to the user. */
  drain?: [number, number];
  /** `[numerator, denominator]` of damage dealt, taken by the user. */
  recoil?: [number, number];
  /** `[numerator, denominator]` of max HP healed. */
  heal?: [number, number];
  /** Fixed damage, or `'level'`. */
  damage?: number | string;

  status?: string;
  volatileStatus?: string;
  boosts?: Record<string, number>;
  secondaries?: MoveSecondary[];
  self?: MoveSecondary;
  selfSwitch?: boolean | string;
  forceSwitch?: boolean;

  sideCondition?: string;
  slotCondition?: string;
  weather?: string;
  terrain?: string;
  pseudoWeather?: string;

  breaksProtect?: boolean;
  stallingMove?: boolean;
  sleepUsable?: boolean;
  thawsTarget?: boolean;
  ignoreImmunity?: boolean | Record<string, boolean>;
  overrideOffensiveStat?: string;
  overrideDefensiveStat?: string;

  isZ?: boolean | string;
  isMax?: boolean | string;

  gen: number;
  isNonstandard: string | null;
  desc: string;
  shortDesc: string;

  /** `on*` handler names this move defines in `@pkmn/sim`. Empty means behaviour is data-only. */
  handlers: string[];
  signalClass: SignalClass;
}

export interface AbilityEntry {
  num: number;
  id: string;
  name: string;
  flags: string[];
  /** Smogon's competitive usefulness rating, roughly -1..5. A rough power prior. */
  rating?: number;
  desc: string;
  shortDesc: string;
  gen: number;
  isNonstandard: string | null;
  handlers: string[];
  signalClass: SignalClass;
}

/** Coarse partition of the item pool, derived from Showdown's taxonomy booleans. */
export type ItemCategory =
  | 'berry' | 'gem' | 'pokeball' | 'plate' | 'memory' | 'drive'
  | 'mega-stone' | 'z-crystal' | 'held' | 'other';

export interface ItemEntry {
  num: number;
  id: string;
  name: string;
  desc: string;
  shortDesc: string;
  gen: number;
  isNonstandard: string | null;
  category: ItemCategory;

  /** Base power when thrown with Fling. */
  fling?: number;
  isBerry?: boolean;
  isGem?: boolean;
  isPokeball?: boolean;
  /** Type this Plate/Memory/Drive confers. */
  onPlate?: string;
  onMemory?: string;
  onDrive?: string;
  /** Map of base species name to the Mega forme this stone unlocks. */
  megaStone?: Record<string, string>;
  /** Species names that can use this item at all. */
  itemUser?: string[];
  zMove?: string | boolean;
  zMoveType?: string;
  zMoveFrom?: string;
  naturalGift?: { basePower: number; type: string };
  boosts?: Record<string, number>;
  forcedForme?: string;

  handlers: string[];
  signalClass: SignalClass;
}

export interface TypeChart {
  /** Index order for both axes of `effectiveness`. */
  types: DexType[];
  /**
   * `effectiveness[attackerIndex][defenderIndex]` — one of `0, 0.5, 1, 2`.
   *
   * Single-type only. A dual-type multiplier is the product of the two lookups, which is how
   * `0.25` and `4` arise; a piece in Pokémon Chess has one type, so the single-type table is the
   * primary lookup.
   */
  effectiveness: number[][];
}

export interface LearnsetBundle {
  /** Move ids. `species` values index into this array. */
  moveIds: string[];
  /** Species id → indices into `moveIds`. Unions inherited formes; see the recon doc. */
  species: Record<string, number[]>;
}

/**
 * Advisory 0–1 scores for how well a species suits each chess role.
 *
 * Advisory only. The video drafted by feel — bishops were "magically special attacking" Pokémon,
 * rooks "physically defensive bulky" ones — and any Pokémon must remain draftable into any role, so
 * this exists to sort and suggest in the draft UI, never to restrict.
 */
export type PieceRoleHint = Record<'pawn' | 'knight' | 'bishop' | 'rook' | 'queen' | 'king', number>;

export interface DexManifest {
  generatedBy: string;
  sources: Record<string, string>;
  /** Which `isNonstandard` values were admitted, per entity. */
  inclusionPolicy: Record<string, string[]>;
  counts: Record<string, number>;
  /** Count of entries per `SignalClass`, per entity — the auditable coverage baseline. */
  signalClasses: Record<string, Record<string, number>>;
  /** Where the baked icon offsets point, and how large each icon is. */
  sprites: {
    iconSheetUrl: string;
    iconWidth: number;
    iconHeight: number;
    /** Template for a larger still portrait; `{id}` is the species id. */
    portraitUrlTemplate: string;
  };
  /** Invariants the generator asserted at build time. */
  checks: string[];
}
