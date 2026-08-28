# Recon: the data substrate — what is and is not machine-readable

**Status: authoritative.** Every number here was measured directly against `@pkmn/dex@0.10.11` and
`@pkmn/sim@0.10.11` on this machine. Where this document contradicts `BRIEF.md` section 3 or any other
recon doc, **this document wins** — the brief's counts were raw totals that included fan-made and
unreleased content.

This exists because the single biggest risk to the project is the content-coverage claim ("all moves,
items and abilities make sense"). That claim stands or falls on what the dataset actually exposes.

## 1. Inclusion policy: what "all content" means

`isNonstandard` partitions the dex. The values found, with counts:

| Entity | `null` | `Past` | `LGPE` | `Unobtainable` | `Gigantamax` | `Future` | `CAP` | `Custom` |
|---|---|---|---|---|---|---|---|---|
| Species | 911 | 454 | 2 | – | – | 49 | 82 | 19 |
| Moves | 685 | 207 | 13 | 12 | 33 | 1 | 3 | – |
| Abilities | 310 | 1 | – | – | – | 6 | 3 | – |
| Items | 249 | 284 | – | 3 | – | 45 | 2 | – |

**Policy adopted:** include real, released Pokémon content; exclude fan-made (`CAP` = Smogon's
Create-A-Pokémon, `Custom`) and not-yet-real (`Future`).

- **Species:** `num > 0 && isNonstandard ∈ {null, Past, LGPE}`
- **Moves:** `isNonstandard ∈ {null, Past, LGPE, Unobtainable, Gigantamax}`
- **Abilities:** `isNonstandard ∈ {null, Past}`
- **Items:** `isNonstandard ∈ {null, Past, Unobtainable}`

**These are the real coverage targets — use these numbers, not the brief's:**

| Entity | Target count | Note |
|---|---|---|
| Species formes | **1367** | covering exactly **1025 distinct dex numbers**, i.e. all of Gens 1–9 |
| Base formes | **1025** | exactly one per dex number — the natural "all the Pokémon" set |
| Moves | **950** | |
| Abilities | **311** | |
| Items | **536** | |
| Types | **19** | 18 battle types + `Stellar` (Tera-only) |

Of the 1367 formes, 342 are alternates: 48 Mega, 32 Gigantamax, 37 cosmetic-only, rest regional/battle formes.

## 2. The core problem: `@pkmn/dex` silently drops all behaviour code

`@pkmn/dex` is the *declarative* projection of the Showdown dataset. It **strips every callback
function**, and it does so without leaving a marker. This is a trap, because the resulting objects look
complete:

```
Dex.moves.get('rest').status      // undefined  — Rest does not appear to inflict sleep
Dex.moves.get('rest').onHit       // undefined  — no trace that behaviour was removed
Dex.moves.get('bellydrum').boosts // undefined  — Belly Drum does not appear to boost anything
```

Measured on `@pkmn/dex`: **2 of 954 moves** retain any callback-shaped key, and those two are only the
leftover *number* `onDamagePriority`. For abilities and items, all that survives is the name, `flags`,
ordering hints (`onResidualOrder`, `onBasePowerPriority`), a handful of taxonomy booleans, and prose.

**Consequence:** a content system built on `@pkmn/dex` alone would silently mis-handle every
callback-implemented effect — and would have no way to *know* it was doing so. Rest becomes a 0-power
Psychic status move that does nothing. Belly Drum becomes inert. This is the failure mode to avoid.

## 3. The unlock: `@pkmn/sim` retains the real handlers *and their source text*

`@pkmn/sim@0.10.11` (45 MB unpacked, build-time devDependency only — never shipped to the client) loads
the same entries with live functions attached, and `String(fn)` yields the implementation:

```
SimDex.abilities.get('roughskin').onDamagingHit
// onDamagingHit(damage, target, source, move) {
//     if (this.checkMoveMakesContact(move, source, target, true)) {
//         this.damage(source.baseMaxhp / 8, source, target);
//     }
// }
```

This gives **three independent, machine-readable signals per entity**:

1. **Declarative fields** — `type, category, basePower, accuracy, target, flags, status, volatileStatus,
   boosts, secondaries, drain, recoil, multihit, ohko, selfdestruct, sideCondition, weather, terrain,
   pseudoWeather, selfSwitch, forceSwitch, …`
2. **Handler fingerprint** — the *set* of `on*` handler names an entry defines. This is a strong
   structural classifier: `onDamagingHit` ⇒ punishes the attacker; `onStart` ⇒ fires on arrival;
   `onModifyType` ⇒ changes move typing; `onFoeTrapPokemon` ⇒ restricts opponent movement.
3. **Handler source text** — the exact implementation, ~142 KB total across all abilities
   (min 65 chars, median 377, max 3819). Small enough to review or process wholesale.

Plus **prose** (`desc` / `shortDesc`), which is complete and authoritative for every entity and is the
universal backstop.

### Measured signal coverage

**Moves (950):**

| Class | Count | % | Meaning |
|---|---|---|---|
| Declarative fields only | 474 | 49.9% | fully derivable from data |
| Neither fields nor handlers | 161 | 16.9% | 160 are plain damage moves — trivially derivable |
| **Derivable from data alone** | **635** | **66.8%** | |
| Handlers only | 222 | 23.4% | behaviour is code |
| Both fields and handlers | 93 | 9.8% | partially derivable, code adds semantics |
| **Need source/prose-informed curation** | **315** | **33.2%** | |

**Abilities (311):** 305 of 320 raw entries define real handlers. Only **8** have neither a handler nor a
flag — `No Ability, Ball Fetch, Corrosion, Dancer, Early Bird, Honey Gather, Run Away, Stall`. There are
137 distinct handler signatures, and they cluster into usable archetypes:

| Count | Signature | Natural board-effect archetype |
|---|---|---|
| 26 | `onDamagingHit` | punish the capturer |
| 25 | `onStart` | on-arrival effect |
| 14 | `(none)` | prose-only — must be hand-classified |
| 11 | `onBasePower` | capture-strength modifier |
| 10 | `onResidual` | end-of-turn effect |
| 10 | `onModifyAtk`+`onModifySpA` | offensive modifier |
| 9 | `onTryHit` | may negate an incoming capture |
| 9 | `onModifyMove` | alters the attack itself |
| 7 | `onSourceModifyDamage` | damage reduction |
| 6 | `onTryBoost` | immunity to stat drops |
| 5 | `onBasePower`+`onModifyType` | type-changing |
| 5 | `onModifySpe` | movement/speed |
| 4 | `onSourceAfterFaint` | triggers on ally death |
| 3 | `onFoeMaybeTrapPokemon`+`onFoeTrapPokemon` | trapping — restricts enemy movement |

**Items (536):** 257 have no handlers at all — largely inert content. Taxonomy booleans are available and
partition the set usefully: berry 77, megaStone 47, plate 34, pokeball 28, gem 18, Z-crystal 18,
memory 17, drive 4, other 293. Top handler signatures: `onTakeItem` 71 (steal/knock-off interaction),
`onBasePower` 31, `onBasePower+onTakeItem` 23, `onEat+onUpdate` 22 (healing berries),
`onEat+onSourceModifyDamage` 18 (resist berries), `onSourceTryPrimaryHit` 18.

### Caveat: the fingerprint is not total

Some behaviour lives in the *battle engine*, not on the entry. **Levitate is the worked example**: it has
no handlers in `@pkmn/sim` either — Ground immunity is special-cased inside the engine's immunity check.
14 abilities have an empty signature. So:

> The handler fingerprint is a high-quality classifier for ~95% of abilities and ~2/3 of moves, but it is
> **not** a complete oracle. Prose is the only universal signal, and a curated override layer plus a
> total fallback remain mandatory.

## 4. Learnsets: forme inheritance must be resolved manually

`learnsets.get(id)` returns **nothing** for battle-only and many alternate formes, and returns
*partial* data for others. Measured:

| Species | Own learnset size |
|---|---|
| `charizard` | 129 |
| `charizardmegax` | **none** |
| `deoxysattack` | **none** |
| `landorustherian` | **none** |
| `rotomwash` | **1** (its signature move only) |
| `pikachualola` | 86 |
| `urshifurapidstrike` | 72 |

So the correct resolution is a **union walk**, not a fallback:

```
learnset(species) = own learnset
                  ∪ learnset(changesFrom ?? battleOnly ?? baseSpecies)   // recursive, cycle-guarded
```

`rotomwash` proves union is required rather than "own if present else parent" — it needs base Rotom's
moves *plus* its own Hydro Pump. Failing to do this would give Charizard-Mega-X zero legal moves and
Rotom-Wash exactly one.

## 5. Other field-level gotchas found

- **Gigantamax formes have `weightkg: 0`** (e.g. `venusaurgmax`). Any weight-based logic must fall back
  to the base forme's weight.
- **No `heightm` and no `color`** on species in this build — do not design visuals around them.
  `weightkg` *is* present and reliable (except Gmax, above).
- Mega/forme relationships are fully described: `requiredItem` (`Charizardite X`), `changesFrom`,
  `battleOnly`, and on the item side `megaStone: {Charizard: "Charizard-Mega-X"}` and
  `itemUser: ["Charizard"]`. Mega Evolution is therefore implementable from data.
- Evolution is fully described: `prevo`, `evos[]`, `evoType`, `evoLevel`, `evoItem`, `evoCondition`.
  Pawn-promotion-as-evolution can be driven straight off these fields.
- `Stellar` is a real 19th type in the chart; it is Tera-only. Decide explicitly whether it exists in
  Pokémon Chess (recommendation: exclude from drafting, since a piece has one type and Stellar has no
  defensive profile).

## 6. Sprite assets — measured sizes

All fetched and byte-counted on this machine. `@pkmn/img@0.3.4` resolves every URL and offset below.

| Asset | Size | Covers |
|---|---|---|
| `pokemonicons-sheet.png` | **383 KB, one request** | **every** Pokémon, 40×30 icons, via CSS background offsets |
| `itemicons-sheet.png` | 87 KB, one request | every item, 24×24 |
| Type badge, e.g. `types/Fire.png` | **178 bytes** | one per type — 18 badges cost ~3 KB total |
| `gen5/{id}.png` still | **~970 bytes avg** | 96×96 pixel art; **32 drafted Pokémon ≈ 31 KB total** |
| `ani/{id}.gif` animated | ~85 KB avg | **32 drafted Pokémon ≈ 2.7 MB** |
| PokéAPI official artwork | ~200 KB each | high-res, viable only for a single detail view |

`Icons.getPokemon(id)` returns ready-made CSS (`background: url(sheet) -40px -60px; image-rendering: pixelated`).
The spritesheet is the decisive find: **one 383 KB request renders a board of any 32 Pokémon out of the
full 1025**, with no per-species loading at all.

Caveat found: `Sprites.getPokemon(id, {gen: 'ani'})` silently falls back to a static `gen5` PNG for
species that have no animated sprite — Miraidon and Pecharunt both resolve to `gen5/*.png`. Animation
availability is therefore per-species and must be treated as optional, never assumed.

Recommended tiering, on these numbers:

1. **Board pieces** — the icon spritesheet. One request, instant, covers everything.
2. **Draft screen and captures** — `gen5` stills, lazily loaded for the ~32 drafted species (31 KB).
3. **Animated GIFs** — opt-in setting, or fetched only for the piece currently acting. Never by default.
4. **Official artwork** — a single detail/inspect view only.

Licensing reality: Pokémon sprites and names are Nintendo/Creatures/GAME FREAK intellectual property.
Hotlinking Showdown's CDN avoids redistributing them in this repository, and the repo should carry a
clear non-affiliation notice. Do not vendor sprite files into version control without deciding this
deliberately.

## 7. What this means for the design — required implications

1. **Build the data pipeline on `@pkmn/sim`, not `@pkmn/dex`,** or on both. Extracting the handler
   fingerprint is cheap and it is the difference between a content system that knows what it does not
   know and one that silently produces inert content.
2. **Emit an explicit `coverage` classification per entity** into the generated bundle: which signal
   determined its board effect (`derived-fields` / `derived-fingerprint` / `curated` / `fallback`). This
   makes the "all content makes sense" claim *auditable by a test* rather than asserted. A test that
   asserts every one of the 950 moves / 311 abilities / 536 items resolves to a non-fallback-or-
   deliberately-fallback effect is the single most valuable test in the project.
3. **The curated set has a measured floor.** 315 moves have code-implemented semantics and 14 abilities
   have no fingerprint at all. A design claiming "only ~40 curated overrides" is not credible for
   faithfulness; a design should plan for curation on the order of a few hundred entries, made tractable
   by clustering identical handler signatures and by the fact that total ability handler source is only
   142 KB.
4. **Never ship `@pkmn/sim` or `@pkmn/dex` to the browser.** Both are tens of megabytes. They are
   build-time inputs that produce a compact baked bundle.
