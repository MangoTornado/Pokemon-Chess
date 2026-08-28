/**
 * Bakes the Pokémon dex into compact JSON bundles under `src/data/generated/`.
 *
 *   npm run gen:data
 *
 * Reads two sources deliberately:
 *   - `@pkmn/dex` for the clean declarative projection (computed `bst`, `nfe`, tidy fields).
 *   - `@pkmn/sim` for the `on*` handler fingerprint, which `@pkmn/dex` strips without leaving a
 *     marker. Without it, Rest looks like a 0-power move that does nothing. See
 *     `docs/design/recon-data-substrate.md`.
 *
 * Neither package is ever shipped to the browser; both are build-time devDependencies.
 */

import { writeFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Dex } from '@pkmn/dex';
import { Generations } from '@pkmn/data';
import { Dex as SimDex } from '@pkmn/sim';
import { Icons } from '@pkmn/img';

import { BATTLE_TYPES } from '../src/data/schema.ts';
import type {
  BattleType, DexType, ItemCategory, FormeKind, SignalClass, DexManifest,
} from '../src/data/schema.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'src', 'data', 'generated');
mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Inclusion policy — see docs/design/recon-data-substrate.md §1.
// Admits real, released content; excludes fan-made (CAP, Custom) and unreleased (Future).
// ---------------------------------------------------------------------------

const SPECIES_OK = new Set([null, 'Past', 'LGPE']);
const MOVE_OK = new Set([null, 'Past', 'LGPE', 'Unobtainable', 'Gigantamax']);
const ABILITY_OK = new Set([null, 'Past']);
const ITEM_OK = new Set([null, 'Past', 'Unobtainable']);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Any = Record<string, any>;

const HANDLER_RE = /^(on[A-Z]|.*Callback$)/;

/** `on*` handler names an entry actually implements as a function. */
function handlerNames(entry: unknown): string[] {
  if (!entry || typeof entry !== 'object') return [];
  const e = entry as Any;
  return Object.keys(e)
    .filter((k) => HANDLER_RE.test(k) && typeof e[k] === 'function')
    .sort();
}

/**
 * Drops keys whose value is undefined, null, `[]` or `{}` so bundles stay small.
 *
 * Deliberately keeps `false`. Stripping it saves almost nothing — Showdown omits most false flags
 * already — but it silently turns a schema-required `nfe: boolean` into `undefined` at runtime,
 * which is a type lie that only shows up at a `=== false` comparison far from here.
 */
function compact(obj: Any): Any {
  const out: Any = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    out[k] = v;
  }
  return out;
}

function flagList(flags: unknown): string[] {
  if (!flags || typeof flags !== 'object') return [];
  return Object.keys(flags as Any).sort();
}

/** One record per line: compact on disk, still readable in a diff. */
function writeBundle(name: string, value: unknown): void {
  const path = join(OUT_DIR, name);
  let text: string;
  if (Array.isArray(value)) {
    text = `[\n${value.map((v) => JSON.stringify(v)).join(',\n')}\n]\n`;
  } else {
    text = `${JSON.stringify(value, null, value && typeof value === 'object' && 'checks' in (value as Any) ? 2 : 0)}\n`;
  }
  writeFileSync(path, text);
  const raw = statSync(path).size;
  const gz = gzipSync(Buffer.from(text)).length;
  report.push({ name, raw, gz, records: Array.isArray(value) ? value.length : 1 });
}

const report: { name: string; raw: number; gz: number; records: number }[] = [];
const checks: string[] = [];
const problems: string[] = [];

function check(ok: boolean, description: string): void {
  if (ok) checks.push(description);
  else problems.push(description);
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

// ---------------------------------------------------------------------------
// Type chart
// ---------------------------------------------------------------------------

// `@pkmn/dex` exports a ModdedDex whose `mod()` signature is narrower than the interface
// `@pkmn/data` declares. The two packages are version-matched, so the cast is safe.
const gens = new Generations(Dex as never);
const gen = gens.get(9);

const allTypeNames = Dex.types.all().map((t) => t.name) as DexType[];
// Deterministic order: the 18 battle types in canonical order, then anything else (Stellar).
const chartTypes: DexType[] = [
  ...BATTLE_TYPES,
  ...allTypeNames.filter((t) => !(BATTLE_TYPES as readonly string[]).includes(t)),
];

const effectiveness: number[][] = chartTypes.map((atk) =>
  chartTypes.map((def) => {
    try {
      const t = gen.types.get(atk);
      const mult = t?.totalEffectiveness(def as never);
      return typeof mult === 'number' ? mult : 1;
    } catch {
      return 1;
    }
  }),
);

const idx = (t: DexType) => chartTypes.indexOf(t);
check(effectiveness[idx('Ground')]![idx('Flying')] === 0, 'Ground → Flying is 0× (capture forbidden)');
check(effectiveness[idx('Normal')]![idx('Ghost')] === 0, 'Normal → Ghost is 0×');
check(effectiveness[idx('Fire')]![idx('Steel')] === 2, 'Fire → Steel is 2×');
check(effectiveness[idx('Electric')]![idx('Ground')] === 0, 'Electric → Ground is 0×');
check(effectiveness[idx('Water')]![idx('Fire')] === 2, 'Water → Fire is 2×');
check(effectiveness[idx('Fighting')]![idx('Ghost')] === 0, 'Fighting → Ghost is 0×');
check(
  chartTypes.slice(0, 18).every((t) => effectiveness[idx(t)]![idx(t)] !== undefined),
  'every battle type has a complete row',
);

writeBundle('typechart.json', { types: chartTypes, effectiveness });

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

const DECLARATIVE_EFFECT_FIELDS = [
  'status', 'volatileStatus', 'boosts', 'secondaries', 'drain', 'recoil', 'heal', 'multihit',
  'ohko', 'selfdestruct', 'sideCondition', 'slotCondition', 'weather', 'terrain', 'pseudoWeather',
  'selfSwitch', 'forceSwitch', 'self', 'damage', 'breaksProtect', 'stallingMove', 'thawsTarget',
] as const;

function hasDeclarativeEffect(m: Any): boolean {
  return DECLARATIVE_EFFECT_FIELDS.some((k) => {
    const v = m[k];
    if (v === undefined || v === null || v === false) return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });
}

function signalClassFor(hasFields: boolean, handlers: string[], inertOk: boolean): SignalClass {
  if (hasFields && handlers.length) return 'fields+handlers';
  if (hasFields) return 'fields';
  if (handlers.length) return 'handlers';
  return inertOk ? 'inert' : 'plain-damage';
}

const moves = Dex.moves
  .all()
  .filter((m) => MOVE_OK.has(m.isNonstandard as string | null))
  .sort((a, b) => a.num - b.num || a.id.localeCompare(b.id))
  .map((m) => {
    const raw = m as unknown as Any;
    const handlers = handlerNames(SimDex.moves.get(m.id));
    const hasFields = hasDeclarativeEffect(raw);
    // A Status move with neither fields nor handlers carries no modelled effect at all; a damaging
    // one is simply a plain attack. Both are `plain-damage`/`inert` respectively.
    const inert = !hasFields && !handlers.length && m.category === 'Status';
    return compact({
      num: m.num,
      id: m.id,
      name: m.name,
      type: m.type,
      category: m.category,
      basePower: m.basePower,
      accuracy: m.accuracy,
      pp: m.pp,
      priority: m.priority,
      target: m.target,
      flags: flagList(raw['flags']),

      critRatio: m.critRatio !== 1 ? m.critRatio : undefined,
      willCrit: raw['willCrit'],
      multihit: raw['multihit'],
      ohko: raw['ohko'],
      selfdestruct: raw['selfdestruct'],
      drain: raw['drain'],
      recoil: raw['recoil'],
      heal: raw['heal'],
      damage: raw['damage'],

      status: raw['status'],
      volatileStatus: raw['volatileStatus'],
      boosts: raw['boosts'],
      secondaries: raw['secondaries'],
      self: raw['self'],
      selfSwitch: raw['selfSwitch'],
      forceSwitch: raw['forceSwitch'],

      sideCondition: raw['sideCondition'],
      slotCondition: raw['slotCondition'],
      weather: raw['weather'],
      terrain: raw['terrain'],
      pseudoWeather: raw['pseudoWeather'],

      breaksProtect: raw['breaksProtect'],
      stallingMove: raw['stallingMove'],
      sleepUsable: raw['sleepUsable'],
      thawsTarget: raw['thawsTarget'],
      ignoreImmunity: raw['ignoreImmunity'],
      overrideOffensiveStat: raw['overrideOffensiveStat'],
      overrideDefensiveStat: raw['overrideDefensiveStat'],

      isZ: raw['isZ'],
      isMax: raw['isMax'],

      gen: m.gen,
      isNonstandard: m.isNonstandard ?? null,
      desc: m.desc || m.shortDesc || '',
      shortDesc: m.shortDesc || m.desc || '',

      handlers,
      signalClass: signalClassFor(hasFields, handlers, inert),
    });
  });

const moveIdSet = new Set(moves.map((m) => m['id'] as string));
check(moves.length > 900, `move count ${moves.length} is in the expected range`);
check(moveIdSet.has('rest'), 'Rest is present');
check(
  (moves.find((m) => m['id'] === 'rest')!['handlers'] as string[]).length > 0,
  'Rest carries a handler fingerprint (proves @pkmn/sim was actually consulted)',
);
check(
  (moves.find((m) => m['id'] === 'tackle')!['signalClass'] as string) === 'plain-damage',
  'Tackle classifies as plain-damage',
);
check(
  (moves.find((m) => m['id'] === 'spikes')!['sideCondition'] as string) === 'spikes',
  'Spikes retains its sideCondition field',
);
writeBundle('moves.json', moves);

// ---------------------------------------------------------------------------
// Abilities
// ---------------------------------------------------------------------------

const abilities = Dex.abilities
  .all()
  .filter((a) => ABILITY_OK.has(a.isNonstandard as string | null))
  .sort((a, b) => a.num - b.num || a.id.localeCompare(b.id))
  .map((a) => {
    const raw = a as unknown as Any;
    const handlers = handlerNames(SimDex.abilities.get(a.id));
    const flags = flagList(raw['flags']);
    return compact({
      num: a.num,
      id: a.id,
      name: a.name,
      flags,
      rating: raw['rating'],
      desc: a.desc || a.shortDesc || '',
      shortDesc: a.shortDesc || a.desc || '',
      gen: a.gen,
      isNonstandard: a.isNonstandard ?? null,
      handlers,
      // An ability with no handler and no flag has nothing but prose to classify it.
      signalClass: signalClassFor(flags.length > 0, handlers, flags.length === 0),
    });
  });

check(abilities.length > 300, `ability count ${abilities.length} is in the expected range`);
check(
  (abilities.find((a) => a['id'] === 'roughskin')!['handlers'] as string[]).includes('onDamagingHit'),
  'Rough Skin fingerprints as onDamagingHit',
);
writeBundle('abilities.json', abilities);

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function itemCategory(raw: Any, handlers: string[]): ItemCategory {
  if (raw['isBerry']) return 'berry';
  if (raw['isGem']) return 'gem';
  if (raw['isPokeball']) return 'pokeball';
  if (raw['onPlate']) return 'plate';
  if (raw['onMemory']) return 'memory';
  if (raw['onDrive']) return 'drive';
  if (raw['megaStone']) return 'mega-stone';
  if (raw['zMove']) return 'z-crystal';
  return handlers.length ? 'held' : 'other';
}

const items = Dex.items
  .all()
  .filter((i) => ITEM_OK.has(i.isNonstandard as string | null))
  .sort((a, b) => a.num - b.num || a.id.localeCompare(b.id))
  .map((i) => {
    const raw = i as unknown as Any;
    const handlers = handlerNames(SimDex.items.get(i.id));
    const category = itemCategory(raw, handlers);
    return compact({
      num: i.num,
      id: i.id,
      name: i.name,
      desc: i.desc || i.shortDesc || '',
      shortDesc: i.shortDesc || i.desc || '',
      gen: i.gen,
      isNonstandard: i.isNonstandard ?? null,
      category,

      fling: raw['fling']?.basePower,
      isBerry: raw['isBerry'],
      isGem: raw['isGem'],
      isPokeball: raw['isPokeball'],
      onPlate: raw['onPlate'],
      onMemory: raw['onMemory'],
      onDrive: raw['onDrive'],
      megaStone: raw['megaStone'],
      itemUser: raw['itemUser'],
      zMove: raw['zMove'],
      zMoveType: raw['zMoveType'],
      zMoveFrom: raw['zMoveFrom'],
      naturalGift: raw['naturalGift'],
      boosts: raw['boosts'],
      forcedForme: raw['forcedForme'],

      handlers,
      signalClass: signalClassFor(
        Boolean(raw['boosts'] || raw['megaStone'] || raw['zMove'] || raw['onPlate'] || raw['naturalGift']),
        handlers,
        // Poké Balls and valuables are legitimately inert; nothing is missing.
        category === 'pokeball' || category === 'other',
      ),
    });
  });

check(items.length > 500, `item count ${items.length} is in the expected range`);
check(
  Boolean(items.find((i) => i['id'] === 'charizarditex')?.['megaStone']),
  'Charizardite X retains its megaStone mapping',
);
writeBundle('items.json', items);

// ---------------------------------------------------------------------------
// Species
// ---------------------------------------------------------------------------

const REGIONAL_FORMES = ['Alola', 'Galar', 'Hisui', 'Paldea'];

const ICON_SHEET_URL = 'https://play.pokemonshowdown.com/sprites/pokemonicons-sheet.png';
const PORTRAIT_URL_TEMPLATE = 'https://play.pokemonshowdown.com/sprites/gen5/{id}.png';

/**
 * Baking the spritesheet offset removes any runtime dependency on `@pkmn/img`.
 *
 * `(0, 0)` is the sheet's unknown-species slot, so a real species landing there means the id failed
 * to resolve and the board would silently render the wrong picture.
 */
function iconOffsetOf(id: string): [number, number] {
  const icon = Icons.getPokemon(id);
  return [icon.left ?? 0, icon.top ?? 0];
}

function formeKindFor(raw: Any): FormeKind {
  const forme = String(raw['forme'] ?? '');
  if (!forme) return 'base';
  if (forme.startsWith('Mega')) return 'mega';
  if (forme === 'Gmax' || forme.endsWith('-Gmax')) return 'gmax';
  if (raw['isCosmeticForme']) return 'cosmetic';
  if (REGIONAL_FORMES.some((r) => forme === r || forme.startsWith(`${r}-`))) return 'regional';
  if (raw['battleOnly']) return 'battle';
  return 'other';
}

const speciesRaw = Dex.species
  .all()
  .filter((s) => s.num > 0 && SPECIES_OK.has(s.isNonstandard as string | null))
  .sort((a, b) => a.num - b.num || a.id.localeCompare(b.id));

const includedSpeciesIds = new Set<string>(speciesRaw.map((s) => String(s.id)));

/** `battleOnly` may be a single name or a list. */
function parentIdsOf(raw: Any): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v) out.push(Dex.species.get(v).id);
    else if (Array.isArray(v)) for (const x of v) push(x);
  };
  push(raw['changesFrom']);
  push(raw['battleOnly']);
  const base = raw['baseSpecies'];
  if (typeof base === 'string' && base) {
    const baseId = Dex.species.get(base).id;
    if (baseId !== raw['id']) out.push(baseId);
  }
  return [...new Set(out)];
}

/**
 * Union of a species' own learnset with every ancestor forme's, because Showdown stores no learnset
 * at all for battle-only formes (Charizard-Mega-X → none) and only the signature move for others
 * (Rotom-Wash → 1). See recon-data-substrate.md §4.
 */
const learnsetCache = new Map<string, Set<string>>();

async function resolveLearnset(id: string, seen = new Set<string>()): Promise<Set<string>> {
  const cached = learnsetCache.get(id);
  if (cached) return cached;
  if (seen.has(id)) return new Set();
  seen.add(id);

  const acc = new Set<string>();
  try {
    const own = await Dex.learnsets.get(id);
    for (const moveId of Object.keys(own?.learnset ?? {})) {
      if (moveIdSet.has(moveId)) acc.add(moveId);
    }
  } catch {
    // No learnset stored for this id; the parent walk below is the real source.
  }

  const raw = Dex.species.get(id) as unknown as Any;
  for (const parent of parentIdsOf(raw)) {
    for (const moveId of await resolveLearnset(parent, seen)) acc.add(moveId);
  }

  learnsetCache.set(id, acc);
  return acc;
}

const learnsetBySpecies = new Map<string, string[]>();
for (const s of speciesRaw) {
  const set = await resolveLearnset(s.id);
  learnsetBySpecies.set(s.id, [...set].sort());
}

const species = speciesRaw.map((s) => {
  const raw = s as unknown as Any;
  const abilitySlots = (raw['abilities'] ?? {}) as Record<string, string>;
  const abilityIds: string[] = [];
  const hidden: string[] = [];
  for (const slot of ['0', '1', 'H', 'S']) {
    const name = abilitySlots[slot];
    if (!name) continue;
    const id = Dex.abilities.get(name).id;
    if (!id) continue;
    abilityIds.push(id);
    if (slot === 'H') hidden.push(id);
  }

  // Gigantamax formes report weightkg 0; fall back to the base forme.
  let weight = Number(raw['weightkg'] ?? 0);
  if (!weight) {
    const base = Dex.species.get(String(raw['baseSpecies'] ?? '')) as unknown as Any;
    weight = Number(base?.['weightkg'] ?? 0) || 0.1;
  }

  const evos = (raw['evos'] ?? []).map((n: string) => Dex.species.get(n).id).filter(Boolean);
  const prevo = raw['prevo'] ? Dex.species.get(String(raw['prevo'])).id : undefined;

  return compact({
    num: s.num,
    id: s.id,
    name: s.name,
    types: s.types.filter((t) => (BATTLE_TYPES as readonly string[]).includes(t)) as BattleType[],
    baseStats: [
      s.baseStats.hp, s.baseStats.atk, s.baseStats.def,
      s.baseStats.spa, s.baseStats.spd, s.baseStats.spe,
    ],
    bst: s.bst,
    maxHP: raw['maxHP'],
    weightkg: weight,
    abilities: abilityIds,
    hiddenAbilities: hidden,
    prevo,
    evos,
    evoType: raw['evoType'],
    evoLevel: raw['evoLevel'],
    evoItem: raw['evoItem'] ? Dex.items.get(String(raw['evoItem'])).id : undefined,
    evoMove: raw['evoMove'] ? Dex.moves.get(String(raw['evoMove'])).id : undefined,
    evoCondition: raw['evoCondition'],
    nfe: Boolean(raw['nfe']),
    baseSpecies: Dex.species.get(String(raw['baseSpecies'] ?? s.name)).id,
    forme: String(raw['forme'] ?? ''),
    formeKind: formeKindFor({ ...raw, id: s.id }),
    requiredItem: raw['requiredItem'] ? Dex.items.get(String(raw['requiredItem'])).id : undefined,
    changesFrom: raw['changesFrom'] ? Dex.species.get(String(raw['changesFrom'])).id : undefined,
    canGigantamax: raw['canGigantamax'],
    tags: raw['tags'] ?? [],
    gen: s.gen,
    tier: raw['tier'],
    isNonstandard: s.isNonstandard ?? null,
    learnsetRef: s.id,
    icon: iconOffsetOf(s.id),
  });
});

const dexNums = new Set(species.map((s) => s['num'] as number));
const baseFormes = species.filter((s) => s['formeKind'] === 'base');

check(dexNums.size === 1025, `exactly 1025 distinct dex numbers present (got ${dexNums.size})`);
check(baseFormes.length === 1025, `exactly 1025 base formes present (got ${baseFormes.length})`);
check(
  species.every((s) => (s['types'] as string[]).length >= 1),
  'every species has at least one battle type',
);
check(
  species.every((s) => (s['abilities'] as string[] | undefined)?.length ?? 0 > 0),
  'every species has at least one ability',
);
check(
  species.every((s) => (s['weightkg'] as number) > 0),
  'every species has a non-zero weight (Gigantamax fallback applied)',
);
const maxHpOverrides = species.filter((s) => s['maxHP'] !== undefined);
check(
  maxHpOverrides.length === 1 && maxHpOverrides[0]!['id'] === 'shedinja' && maxHpOverrides[0]!['maxHP'] === 1,
  'Shedinja is the only maxHP override, at 1 (guards the untouchable-piece problem)',
);

const megaX = species.find((s) => s['id'] === 'charizardmegax')!;
check(
  (learnsetBySpecies.get('charizardmegax')?.length ?? 0) > 100,
  `Charizard-Mega-X inherits a full learnset (${learnsetBySpecies.get('charizardmegax')?.length ?? 0} moves)`,
);
check(megaX['requiredItem'] === 'charizarditex', 'Charizard-Mega-X requires Charizardite X');
check(
  (learnsetBySpecies.get('rotomwash')?.length ?? 0) > 50,
  `Rotom-Wash unions base Rotom's learnset (${learnsetBySpecies.get('rotomwash')?.length ?? 0} moves)`,
);
check(
  (learnsetBySpecies.get('landorustherian')?.length ?? 0) > 50,
  `Landorus-Therian inherits a learnset (${learnsetBySpecies.get('landorustherian')?.length ?? 0} moves)`,
);
check(
  [...learnsetBySpecies.values()].every((l) => l.length > 0),
  'every species resolves to a non-empty learnset',
);

// Referential integrity across bundles.
const abilityIdSet = new Set(abilities.map((a) => a['id'] as string));
const itemIdSet = new Set(items.map((i) => i['id'] as string));
const danglingAbilities = species.flatMap((s) =>
  (s['abilities'] as string[]).filter((a) => !abilityIdSet.has(a)),
);
const danglingItems = species
  .map((s) => s['requiredItem'] as string | undefined)
  .filter((i): i is string => typeof i === 'string' && !itemIdSet.has(i));
check(danglingAbilities.length === 0, `no species references a missing ability (${danglingAbilities.length} dangling)`);
check(danglingItems.length === 0, `no species references a missing item (${danglingItems.length} dangling)`);
check(
  species.every((s) => includedSpeciesIds.has(s['baseSpecies'] as string)),
  'every baseSpecies reference resolves inside the bundle',
);

// Bulbasaur legitimately sits at (-40, 0); only the unknown-species slot is (0, 0).
const fallbackIcons = species.filter((s) => {
  const [left, top] = s['icon'] as [number, number];
  return left === 0 && top === 0;
});
check(
  fallbackIcons.length === 0,
  `every species resolves to a real spritesheet icon (${fallbackIcons.length} fell back)`,
);
check(
  new Set(species.map((s) => (s['icon'] as number[]).join(','))).size > 1300,
  'icon offsets are distinct per forme rather than collapsing onto one slot',
);

writeBundle('species.json', species);

// ---------------------------------------------------------------------------
// Learnsets — move-id indices keep this to a fraction of the naive size.
// ---------------------------------------------------------------------------

const moveIds = [...moveIdSet].sort();
const moveIndex = new Map(moveIds.map((id, i) => [id, i]));
const learnsetOut: Record<string, number[]> = {};
for (const [speciesId, list] of learnsetBySpecies) {
  learnsetOut[speciesId] = list.map((m) => moveIndex.get(m)!).sort((a, b) => a - b);
}
const learnsetSizes = Object.values(learnsetOut).map((l) => l.length);
writeBundle('learnsets.json', { moveIds, species: learnsetOut });

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

function tallySignals(entries: Any[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) {
    const k = String(e['signalClass']);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  devDependencies: Record<string, string>;
};

const manifest: DexManifest = {
  generatedBy: 'scripts/gen-data.ts',
  sources: {
    '@pkmn/dex': pkg.devDependencies['@pkmn/dex'] ?? 'unknown',
    '@pkmn/data': pkg.devDependencies['@pkmn/data'] ?? 'unknown',
    '@pkmn/sim': pkg.devDependencies['@pkmn/sim'] ?? 'unknown',
  },
  inclusionPolicy: {
    species: [...SPECIES_OK].map(String),
    moves: [...MOVE_OK].map(String),
    abilities: [...ABILITY_OK].map(String),
    items: [...ITEM_OK].map(String),
  },
  counts: {
    speciesFormes: species.length,
    speciesDexNumbers: dexNums.size,
    speciesBaseFormes: baseFormes.length,
    moves: moves.length,
    abilities: abilities.length,
    items: items.length,
    types: chartTypes.length,
    battleTypes: BATTLE_TYPES.length,
    learnsetMinMoves: Math.min(...learnsetSizes),
    learnsetMedianMoves: learnsetSizes.sort((a, b) => a - b)[Math.floor(learnsetSizes.length / 2)]!,
    learnsetMaxMoves: Math.max(...learnsetSizes),
  },
  signalClasses: {
    moves: tallySignals(moves),
    abilities: tallySignals(abilities),
    items: tallySignals(items),
  },
  sprites: {
    iconSheetUrl: ICON_SHEET_URL,
    iconWidth: 40,
    iconHeight: 30,
    portraitUrlTemplate: PORTRAIT_URL_TEMPLATE,
  },
  checks,
};

writeBundle('manifest.json', manifest);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log('\nPokémon Chess — dex bundle generated\n');
console.log('  file                 records        raw       gzip');
console.log('  ------------------------------------------------------');
let totalRaw = 0;
let totalGz = 0;
for (const r of report.sort((a, b) => b.gz - a.gz)) {
  totalRaw += r.raw;
  totalGz += r.gz;
  console.log(`  ${r.name.padEnd(18)} ${String(r.records).padStart(7)} ${kb(r.raw).padStart(10)} ${kb(r.gz).padStart(10)}`);
}
console.log('  ------------------------------------------------------');
console.log(`  ${'TOTAL'.padEnd(18)} ${''.padStart(7)} ${kb(totalRaw).padStart(10)} ${kb(totalGz).padStart(10)}`);

console.log('\n  counts:');
for (const [k, v] of Object.entries(manifest.counts)) console.log(`    ${k.padEnd(22)} ${v}`);

console.log('\n  signal classes (how each entry\'s behaviour is knowable):');
for (const [entity, tally] of Object.entries(manifest.signalClasses)) {
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  const parts = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}=${v} (${((100 * v) / total).toFixed(0)}%)`);
  console.log(`    ${entity.padEnd(10)} ${parts.join('  ')}`);
}

console.log(`\n  invariants passed: ${checks.length}`);
for (const c of checks) console.log(`    ✓ ${c}`);

if (problems.length) {
  console.error(`\n  INVARIANTS FAILED: ${problems.length}`);
  for (const p of problems) console.error(`    ✗ ${p}`);
  process.exit(1);
}
console.log('');
