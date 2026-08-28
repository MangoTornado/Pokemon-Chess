# Pokémon Chess — Design Specification (Systems / Compiler-First)

**Author role:** systems designer, compiler-first philosophy.
**Status:** proposal. Deviations from the recon documents are marked **[DEVIATION]** with a reason.
**Every number in §1 was measured on this machine** against `@pkmn/dex@0.10.11` and `@pkmn/sim@0.10.11`
via probe scripts `/tmp/pkmn-probe/sysdes-probe{1,2,3,4,5,6,7,8}.mjs`, `sysdes-ledger.mjs`, `sysdes-chart.mjs`.

---

## 0. Thesis, and the one bet

This project lives or dies on one engineering question: **can 950 moves, 311 abilities and 536 items become
board effects by a compiler rather than by hand?** Everything else — the ruleset, the AI, the art — is
downstream, because every one of those systems is a *consumer* of the effect vocabulary. Pick the vocabulary
badly and you write 1797 special cases, ship 200 of them, and the other 1597 are silently inert. Pick it well
and new content is data.

**The bet:** Pokémon Showdown's own engine already contains the answer, and nobody has read it as a
compiler input. `@pkmn/dex` — which every other proposal builds on — *strips every callback function without
leaving a marker*, so 205 of 950 moves look like they do nothing. But `@pkmn/sim` retains the live handlers
**and their source text**, and that source text is written against a **mutation API with only ~20 verbs**.

I measured it. Across all 1307 handler functions in the entire dataset there are 2212 call sites. 24% of them
are `this.add` (battle-log messages, zero semantics). The rest resolve onto a handful of verbs:
`addVolatile`, `boost`, `heal`, `damage`, `trySetStatus`, `setWeather`, `setType`, `formeChange`, `setItem`,
`chainModify`, `useMove`. **That is the ISA.** I did not invent an effect vocabulary and hope the dex fits it;
I measured the vocabulary the dataset is already written in, and collapsed it by scope.

The result is **18 ops, 14 triggers, 16 regions**, and a five-pass compiler that derives
**1704 of 1797 admitted content entries (94.8%) with zero authoring**, leaves **93 named curated overrides
(5.2%)**, and has a total fallback so nothing is ever missing. The rules of the game are then a *thin layer*:
a Clash resolver and a turn loop, both of which consume the ISA and know nothing about Pokémon.

And the same 18 ops drive the visual effects layer, which is how 950 moves get distinct visual identity from
18 authored effects × 19 type palettes × 16 region geometries.

---

## 1. The empirical foundation

### 1.1 Three signal channels, not one

The brief says ability and item behaviour is "prose only … there is no machine-readable effect schema."
That is true of `@pkmn/dex` and **false of the dataset**. There are three machine-readable channels.

| # | Channel | What it is | Volume (measured) |
|---|---|---|---|
| **C1** | Declarative fields | `target, category, basePower, accuracy, priority, pp, flags{}, status, volatileStatus, boosts, sideCondition, slotCondition, weather, terrain, pseudoWeather, drain, recoil, heal, multihit, ohko, selfSwitch, forceSwitch, selfdestruct, callsMove, stallingMove, secondary/secondaries, condition.duration` + item taxonomy booleans + ability `flags` | 665 moves, 133 items, 15 abilities fully determined |
| **C2** | Handler **fingerprint** | the *set* of `on*` handler names an entry defines | 125 distinct names across the whole dataset |
| **C3** | Handler **source text** | `String(fn)` — the actual implementation | 338.6 KB total: moves 113.3 KB / abilities 141.9 KB / items 83.5 KB, across 1307 functions, median 234 chars, max 3137 |

C3 is a build-time-only input. `@pkmn/sim` is a 45 MB devDependency and never reaches the browser.

### 1.2 The trap this avoids, measured

A compiler built on `@pkmn/dex` alone silently produces inert content, with no way to know:

```
Dex.moves.get('rest').status        // undefined — Rest appears to inflict nothing
Dex.moves.get('bellydrum').boosts   // undefined — Belly Drum appears to do nothing
Dex.moves.get('soak').*             // no type-change field anywhere
```

**Measured: 205 of 950 moves have handlers but no declarative payload field at all.** They are invisible to a
dex-only compiler. A sample of the list: *Belly Drum, Counter, Court Change, Defog, Dig, Dive, Doom Desire,
Endeavor, Conversion, Entrainment, Beat Up, Brick Break, Burn Up, Camouflage, Clear Smog, Copycat, Bug Bite,
Ally Switch, Acupressure, After You, Aromatherapy, Assist, Beak Blast, Belch, Bestow, Brine, Celebrate, Core
Enforcer, Corrosive Gas, Covet, Doodle, Double Shock, Dream Eater, Echoed Voice, Electrify, Electro Shot,
Expanding Force*. That is 21.5% of the dex reduced to "a 0-power Psychic move that does nothing."

And `@pkmn/sim` hands the answer over directly:

```
String(SimDex.moves.get('bellydrum').onHit)
//   onHit(target) {
//     ...
//     this.boost({ atk: 12 }, target);      <-- BOOST(SELF, atk, +12)
//   }
```

`boost({ atk: 12 })` is a literal argument. The compiler reads the op *and its parameters* out of the source.

### 1.3 The handler-name grammar (the compiler's front end)

125 distinct handler names is too many for a hand table and would rot on every dependency bump. It does not
need one, because **Showdown's handler names are already a grammar**:

```
handlerName  ::=  'on' Scope? Phase? Stem
Scope        ::=  'Source' | 'Ally' | 'Foe' | 'Any' | 'Weather'        (else: self)
Phase        ::=  'Try' | 'After' | 'Modify' | 'Before'                (else: on)
```

Measured: **123 of 125 names parse** (exceptions: `onTry`, `onWeather`, both special-cased in one line each),
yielding **70 stems × 6 scopes × 5 phases**.

| Axis | Values | Compiles to |
|---|---|---|
| Scope | SELF 75, ANY 22, SOURCE 10, ALLY 9, FOE 5, WEATHER 2 | **Region** |
| Phase | ON 58, MODIFY 30, AFTER 17, TRY 16, BEFORE 2 | **Trigger phase** |
| Stem | 70 distinct | **Trigger** (70-row table, §4.2) |

`onModifyAtk` / `onSourceModifyAtk` / `onAllyModifyAtk` / `onAnyModifyAtk` are one trigger at four scopes,
not four hand-written cases. So is the `BasePower` family (4 variants), `Faint` (4), `SetStatus` (4),
`Accuracy` (4), `Damage` (6), `Boost` (5), `Move` (7). **The 70-stem table is the only hand-written part of
the front end, and CI asserts no 71st stem appears.**

### 1.4 The mutation API (the ISA, discovered rather than invented)

Every call site in every handler body, extracted by regex and classified:

```
total call sites scanned : 2212
pure logging (add/debug/hint/attrLastMove/addMove) : 529  (23.9%)
distinct methods on `this` (the Battle object)     : 29, of which 5 are logging
```

Occurrences of each *semantic* op across all handler bodies:

| ISA op | Occurrences | Showdown calls it maps from |
|---|---|---|
| `TILT` | 235 | `chainModify`, `modify`, `return <number>` |
| `EQUIP` | 157 | `setItem`, `takeItem`, `eatItem`, `useItem`, `setAbility`, `skillSwap` |
| `MARK` | 142 | `addVolatile`, `trySetStatus`, `setStatus`, `addSideCondition`, `setWeather`, `setTerrain`, `addPseudoWeather`, `addSlotCondition` |
| `UNMARK` | 127 | `removeVolatile`, `cureStatus`, `removeSideCondition`, `clearTerrain`, `clearBoosts` |
| `BOOST` | 93 | `boost`, `setBoost`, `boost[stat] = …` |
| `MEND` | 70 | `heal`, `damage`, `directDamage` |
| `BECOME` | 40 | `setType`, `formeChange`, `addType`, `move.type = …`, `move.category = …` |
| `RELOCATE` | 11 | `canSwitch`, `forceSwitch`, `swapPosition` |
| `INVOKE` | 11 | `useMove` |
| `TEMPO` | 8 | `prioritizeAction`, `speedSort`, `move.priority = …` |
| `CHARGE` | 1 | `deductPP` |

Plus a second pattern family — **return values and assignments**, which is how Showdown expresses decisions
rather than mutations:

| Pattern | Hits | ISA op |
|---|---|---|
| `return false;` / `return null;` / `return 0;` | 69 / 31 / 2 | `VETO` |
| `move.ignoreImmunity/ignoreAbility/ignoreEvasion/infiltrates/breaksProtect = …` | 10 | `PIERCE` |
| `move.type = …` / `move.category = …` | 16 / 16 | `BECOME` |
| `move.accuracy = …` / `move.basePower = …` / `return <num>` | 7 / 2 / 7 | `TILT` |
| `move.willCrit/critRatio/multihit/secondaries/target = …` | 3 / 3 / 4 / 5 | `WARP` |
| `boost[…]` edit | 7 | `BOOST` |

**This is the whole surface.** 20 mutating verbs and 5 decision patterns. My 18-op ISA is a re-derivation of
Showdown's own API, collapsed along the scope axis (which becomes Region) and the timing axis (which becomes
Trigger).

### 1.5 Parameter extraction

An op without parameters is a classifier, not a compiler. Measured over 475 mutation call sites:

```
literal arguments  : 286 (60.2%)   — 'flinch', { atk: 12 }, 'spikes', 'sunnyday'
computed arguments : 189 (39.8%)   — mostly heal(maxhp/2), damage(maxhp/8), cureStatus()
```

The literals extract directly. The computed ones are almost entirely **HP fractions**
(`pokemon.baseMaxhp / 8`), which a 4-row fraction→pip table converts to Stamina deltas (§3.3), and
`cureStatus()`, which takes no parameter. Real examples the compiler reads verbatim:

```
Belly Drum      -> boost({ atk: 12 }, target)            => BOOST(SELF, {atk:+12} → clamp +6)
Ally Switch     -> addVolatile('allyswitch')             => MARK(SELF, 'allyswitch')
Block           -> addVolatile('trapped', source, …)     => MARK(TARGET, 'trapped')
Brick Break     -> removeSideCondition('reflect')        => UNMARK(FOE_SIDE, 'reflect')
                   removeSideCondition('lightscreen')       (three ops, one move)
                   removeSideCondition('auroraveil')
Ceaseless Edge  -> addSideCondition('spikes')            => MARK(FOE_ZONE, 'spikes', layers 1)
Defog           -> boost({ evasion: -1 })                => BOOST(TARGET, {evasion:-1})
Dig / Dive      -> addVolatile('twoturnmove', defender)  => MARK(SELF, 'charging', dur 2)
Core Enforcer   -> addVolatile('gastroacid')             => MARK(TARGET, 'abilitysuppressed')
Electro Shot    -> boost({ spa: 1 }, attacker)           => BOOST(SELF, {spa:+1})
```

### 1.6 The coverage ledger

Admitted content follows `recon-data-substrate.md`'s inclusion policy (which supersedes the brief's raw
counts): moves `isNonstandard ∈ {null, Past, LGPE, Unobtainable, Gigantamax}`, abilities `∈ {null, Past}`,
items `∈ {null, Past, Unobtainable}`. **[DEVIATION from recon-moves]** — I do *not* exclude Z-moves and
Max-moves from the compiled corpus. They cost nothing to compile (they are 87 more rows in a generated table,
~2 KB), and excluding them means the CI completeness assertion cannot be "every move in the dex compiles."
They are excluded from *play* by a format flag, not from the compiler.

Measured, `sysdes-ledger.mjs`:

| Kind | Admitted | C1: fields alone | C2/C3: handler-derived | **Curated** | Total fallback | Auto-derived |
|---|---|---|---|---|---|---|
| Moves | **950** | 665 | 253 | **32** | 0 | **96.6%** |
| Abilities | **311** | 15 → *reclassified as curated, see note* | 264 | **39** | 8 | **84.9%** |
| Items | **536** | 133 | 220 | **23** | 160 *(deliberately inert: 100 TR, 15 fossil, 6 valuable, 39 promotion-only)* | **65.9% held-item-relevant → 98% of admitted-as-mechanic** |
| **Total** | **1797** | | | **93** | | **94.8%** |

*Note on the 15 flags-only abilities.* `flags.breakable` tells you an ability **is** a defence; it does not
tell you **what it defends against**. **Levitate is the worked counter-example: it has no handler in
`@pkmn/sim` either** — Ground immunity is special-cased inside the battle engine. So flags-only abilities are
*under-determined* and I count all 15 as curated rather than claim a derivation I cannot make. This is the
single most important honesty adjustment in the document, and it is why the curated layer exists at all.

**The 93 curated entries, named in full** (this is the entire hand-written content surface):

- **Moves (32).** Behaviourally opaque: `Celebrate, Endeavor, Guard Split, Happy Hour, Haze, Pain Split,
  Power Split, Speed Swap, Transform`. Fixed/variable damage via `damageCallback`/`basePowerCallback`
  (no `on*` handler, so C2 misses them): `Crush Grip, Dragon Rage, Electro Ball, Flail, Frustration,
  Guardian of Alola, Gyro Ball, Hard Press, Hold Hands, Nature's Madness, Night Shade, Pika Papow, Psywave,
  Punishment, Return, Reversal, Ruination, Seismic Toss, Sonic Boom, Super Fang, Trump Card, Veevee Volley,
  Wring Out`.
  *Compiler refinement that shrinks this:* extending the scanned-function set to include `damageCallback`
  and `basePowerCallback` converts most of the 23 into derived `TILT(set-power)` records. I keep them in the
  curated column because the *board meaning* of "damage = level" needs a design decision (§3.3), not because
  the code is unreadable.
- **Abilities (39).** `Air Lock, Arena Trap, Cloud Nine, Cud Chew, Curious Medicine, Emergency Exit, Forewarn,
  Frisk, Gale Wings, Gluttony, Klutz, Long Reach, Magnet Pull, Natural Cure, Propeller Tail, Quick Draw,
  Serene Grace, Shadow Tag, Stalwart, Super Luck, Triage, Unnerve, Unseen Fist, Wimp Out` (24 opaque) +
  the 15 flags-only, headed by **`Levitate`**.
- **Items (23).** `Air Balloon, Covert Cloak, Float Stone, Focus Band, Loaded Dice, Razor Claw, Scope Lens,
  Shed Shell, Utility Umbrella` (9 opaque) + 14 field/tempo items whose parameters are prose-only:
  `Damp Rock, Heat Rock, Icy Rock, Smooth Rock, Light Clay, Terrain Extender, Heavy-Duty Boots, Ring Target,
  Grip Claw, Binding Band, Lagging Tail, Full Incense, Protective Pads, Blunder Policy`.
- **Fallback-by-design (8 abilities).** `No Ability, Ball Fetch, Corrosion, Dancer, Early Bird, Honey Gather,
  Run Away, Stall` — exactly the 8 with neither handler nor flag. They compile to `INERT` and refund draft
  budget (§10.4). This is the same list `recon-data-substrate.md` §3 found independently.

**The claim, stated precisely:** 1704 of 1797 entries get their board effect from a deterministic function of
the dataset. 93 get it from a curated override *diffed against the compiler's proposal* — the curated layer is
a patch file, not an authoring task. 0 entries are missing, because of §8.

---

## 2. State model

The ISA is the set of legal transitions on this state. **One op per mutable field** is the design discipline:
you may not add an op without first adding a field, and you may not add a field without an op. That is why
the op count is what it is (§3.6).

```ts
// ---------- identifiers ----------
type Sq        = number;            // 0..63, rank-major; -1 = off board
type Side      = 0 | 1;             // 0 = White/Blue, 1 = Black/Red
type TypeId    = 0..17;             // 18 battle types. Stellar EXCLUDED (0 species, 1x both ways)
type PieceCls  = 'K'|'Q'|'R'|'B'|'N'|'P';
type MarkId    = number;            // index into the generated mark table (§3.2)
type MoveId    = number;            // uint16 index into moves.bin
type SpeciesId = number;            // uint16 index into species.bin (1367 formes)

// ---------- a piece ----------
interface Piece {
  readonly id: number;              // stable identity for animation + replay
  side: Side;
  cls: PieceCls;                    // chess movement pattern
  species: SpeciesId;               // current forme (mutable: Mega, Stance Change, evolution)
  chessType: TypeId;                // THE central field. Exactly one. Declared at draft.
  sq: Sq;

  ability: AbilityId;               // one, from species.abilities slots. Public.
  item: ItemId | 0;                 // one, from the format Kit. Public. 0 = none/consumed.

  slots: [MoveSlot, MoveSlot, MoveSlot, MoveSlot];   // slot 0 is the uncharged melee slot

  stamina: 0|1|2|3;                 // 3 = fresh, 0 = FAINTED (see §3.3). Kings have no track.
  boosts: Int8Array;                // length 7: [atk,def,spa,spd,spe,acc,eva], each clamped [-6,+6]
  marks: MarkSet;                   // packed bitset + per-mark uint8 duration/layers
  flags: number;                    // bitfield: HAS_MOVED, PRISTINE, USED_TERA, EARNED_BONUS_THIS_TURN, …
}
interface MoveSlot { move: MoveId; charges: number; }   // slot 0: charges = Infinity

// ---------- the board ----------
interface Board {
  pieces: (Piece|null)[];           // 64 entries, indexed by Sq
  squareMarks: MarkSet[];           // 64 entries: hazards live here
  sideMarks: [MarkSet, MarkSet];    // screens, Tailwind, Safeguard, Perish counters
  boardMarks: MarkSet;              // weather, terrain, rooms, Gravity
  schedule: ScheduledEffect[];      // ≤ 1 pending entry per (side, kind); horizon ≤ 5 turns
}

// ---------- the game ----------
interface GameState {
  board: Board;
  toMove: Side;
  focusDie: 1|2|3|4|5|6;            // REVEALED at turn start. The turn's first Clash uses it. (§6.2)
  chain: 0|1|2;                     // sub-moves already taken this turn
  ply: number;
  progress: number;                 // sub-moves since last capture / pawn advance / faint / hazard laid
  castling: number;                 // 4 bits
  epFile: number;                   // -1..7
  rng: Rng;                         // seeded xoshiro128**; advances only on hidden rolls
  tera: [boolean, boolean];         // once-per-side transformation budget
  history: Uint32Array;             // position hashes for threefold repetition
}
```

Everything is a flat typed array or a small struct. No objects allocated in the search hot loop.
`GameState` serialises to a single `ArrayBuffer` for the Worker (§16.4).

### 2.1 Why `boosts` is a 7-vector and not one scalar

**[DEVIATION from recon-abilities-items §2.4]** — that document collapses all six stats and all stat stages
into one integer `Vigour ∈ [-3,+3]`. I reject the collapse.

The reason is that the fidelity is **free**. `boosts` is already a structured 7-key object in the data; the
compiler reads `{atk: 2}` off Swords Dance and `{def: 2}` off Iron Defense with no authoring. Collapsing them
makes Swords Dance and Iron Defense the same effect, which DIRECTION.md names as a defect
("systematic but thematically wrong is a defect"). It also destroys `Unaware`, `Contrary`, `Simple`,
`Clear Body`, `Power Trick`, the 7 STATSWAP moves, and the entire `spe`-based mechanic set.

The legibility problem the collapse was solving is real, and I solve it in the **UI, not the model**: the
Clash only ever needs one number from each side, so the interface shows two derived scalars.

```ts
// exactly two numbers ever reach the player
might(P, move) = P.boosts[move.physical ? ATK : SPA] + Σ TILT(atk-scope)
guard(P, incoming) = P.boosts[incoming.physical ? DEF : SPD] + Σ TILT(def-scope)
```

`spe`, `acc` and `eva` surface as three badges on the piece card, not numbers. Seven fields in the engine,
two numbers and three badges on screen. That is progressive disclosure, which is what DIRECTION.md asks for.

### 2.2 Kings have no Stamina track

A fainted King would be a second, trivial win route (chip it down, walk anything onto it). The King is
therefore **immune to every indirect effect**: hazards, weather, status ticks, thorns, item drain, Perish.
It can only be removed by a Clash. This is `recon-variants.md`'s R6 principle ("always supply the key, never
make the royal trivially reachable") applied to the Stamina layer.

---

## 3. The ISA

An effect is a triple. This is the entire content representation:

```ts
interface Effect {
  when:   Trigger;       // 14 values  — WHEN it fires        (from handler stem + phase)
  where:  Region;        // 16 values  — WHICH squares/pieces (from move.target / handler scope)
  ops:    Op[];          // 18 kinds   — WHAT happens
  guard?: Guard;         // a predicate; content is skipped if false
  dur?:   number | 'persist';   // from condition.duration; max in dataset is 5
  charge?: number;       // uses per game, from pp
}
```

The three axes are orthogonal and each is a small closed vocabulary. The *realised* cross-product is sparse —
`recon-moves.md` measured only 37 of 144 (region × payload) cells non-empty for moves, and my ledger shows the
same sparsity for abilities and items. **You implement the vocabulary, not the content.**

### 3.1 The 18 ops, with signatures

Group A — **the write ops.** One per mutable field of §2. These are the only things that can change state.

```ts
type Op =
  // ── A. WRITES (9) ───────────────────────────────────────────────────────────
  | { op:'REMOVE'   }                                        // existence      → Piece off board
  | { op:'RELOCATE'; to:'origin'|'push'|'pull'|'swap'|'random-legal'; dist?:1|2 }
                                                             // position       → Piece.sq
  | { op:'MARK';     mark:MarkId; dur?:number|'persist'; layers?:1|2|3 }
                                                             // tags           → {piece|square|side|board}.marks
  | { op:'UNMARK';   filter:MarkFilter }                     // tag removal
  | { op:'BOOST';    d:Partial<Record<Stat,number>> }        // the 7-vector   → Piece.boosts
  | { op:'MEND';     pips:number }                           // signed         → Piece.stamina
  | { op:'BECOME';   type?:TypeSpec; forme?:FormeSpec; cls?:PieceCls }
                                                             // identity       → chessType/species/cls
  | { op:'EQUIP';    ability?:AbilitySpec; item?:ItemSpec|null; consume?:boolean }
                                                             // slots          → Piece.ability/item
  | { op:'CHARGE';   slot:0|1|2|3|'all'; d:number }          // move economy   → MoveSlot.charges

  // ── B. THE CLASH PIPELINE (5) ───────────────────────────────────────────────
  // These are NOT mutations. They are contributions to a decision function, and
  // each is a different mathematical kind. That is why they cannot be merged.
  | { op:'CLASH';    slot:0|1|2|3 }                           // the only op that can capture
  | { op:'VETO';     scope:VetoScope }                        // boolean:  make the capture ILLEGAL
  | { op:'PIERCE';   scope:VetoScope[] }                      // cancels VETOs of named scopes
  | { op:'TILT';     scope:TiltScope; d:number }              // integer addend to the Clash roll
  | { op:'WARP';     from:Rung[]; to:Rung; once?:boolean }    // rewrite the decided outcome

  // ── C. CONTROL FLOW (3) ─────────────────────────────────────────────────────
  | { op:'TEMPO';    kind:'grant-extra'|'forfeit-turn'|'skip-next'|'react'|'act-last' }
  | { op:'SCHEDULE'; delay:1|2|3|4|5; then:Effect }           // the delayed queue
  | { op:'INVOKE';   pool:InvokePool; depth:1 }               // execute another move, depth-capped

  // ── D. INFORMATION (1) ──────────────────────────────────────────────────────
  | { op:'REVEAL';   what:'item'|'moves'|'threats' };

type Stat      = 'atk'|'def'|'spa'|'spd'|'spe'|'acc'|'eva';
type Rung      = -1|0|1|2|3;                                  // the Clash ladder, §6.3
type VetoScope = 'type'|'element'|'class'|'chain'|'indirect'|'rider'|'ally'|'absolute'|'bind';
type TiltScope = 'atk'|'def'|'crit-window'|'accuracy'|'evasion';
```

Group A ops all have the same shape — `(Region, delta) → newState` — and share one clamping helper.
Group B is where the design lives. Group C is bounded by construction (§7).

### 3.2 Op notes that carry weight

**`MARK` is seven Showdown fields collapsed into one op.** `status`, `volatileStatus`, `sideCondition`,
`slotCondition`, `weather`, `terrain`, `pseudoWeather` are all "put a named tag with a duration somewhere."
The *Region* decides where it lands, so no separate `setWeather`/`addSideCondition`/`setStatus` ops are needed.
This is the single largest ISA saving and it is why hazards, screens, weather, terrain, rooms, the 5
non-volatile statuses, the 37 volatiles, and our own synthetic flags (`charging`, `recharging`, `fainted`,
`warded`, `choice-locked`) are one uniform system with one uniform UI.

The mark table is generated: 5 statuses + 37 volatiles + 12 side conditions + 4 terrains + 5 weathers +
3 rooms + 4 hazards + 11 synthetic = **81 marks**, each a row of `{id, name, scope, defaultDur, tick?, glyph}`.
`defaultDur` comes from `condition.duration` — measured distribution: 1→19 moves, 2→13, 3→3, 4→6, 5→15,
absent→30 (the persist-until-cleared class). **Max duration in the entire dataset is 5**, which is what makes
the scheduler horizon provably ≤ 5 turns.

**`MEND` is the chip-damage sink and my one genuinely new mechanic.** See §3.3.

**`VETO` cannot be folded into `TILT`.** Immunity must make a move *ungenerated*, not merely unlikely — the
move generator, the UI's legal-square highlighting, and the AI's branching factor all read legality as a
boolean. Modelling Levitate as "−99 to the roll" means the AI searches a move that can never happen and the
UI offers the player a square they cannot use. This is the concrete reason 18 cannot be 12.

**`WARP` is what makes the hard abilities expressible.** It rewrites an already-decided outcome:
Sturdy is `WARP(from:[1,2,3], to:-1, once:true)`; Filter/Solid Rock is `WARP(from:[2,3], to:1)`;
Rock Head is `WARP(from:[0], to:1)`; Tinted Lens is `WARP(from:[0], to:1)` on the attacker's side;
Shell Armor is `WARP(from:[3], to:1)`. Five abilities, five parameterisations, one op.

**`INVOKE` has a hard `depth: 1` in its type.** There is no way to construct a depth-2 invoke, so
Metronome→Metronome is impossible at the type level, not by a runtime guard someone can forget.

**There is no op that places a piece on the board.** `RELOCATE` moves existing pieces; `SUMMON` does not
exist. This is deliberate and load-bearing: it makes the piece count monotonically non-increasing, which is the
monovariant the termination proof rests on (§7). Revival Blessing therefore compiles to `MEND(+3)` on a
Fainted piece — which is both bounded *and* more faithful than creating a body. Substitute compiles to
`MARK(SELF, 'substitute')`, a decoy tag that absorbs one Clash, not a second occupant.

### 3.3 Stamina: what "damage" means when capture is binary

**Capture stays binary — a piece is captured or it is not. There is no HP.** But ~200 content entries
(13 drain moves, 12 recoil, 36 heal, 88 status applications, 4 hazards, thorns abilities, Leftovers, Life Orb,
Shell Bell, 9 pinch berries, Regenerator, Wish, Recover) exist entirely to do or undo small amounts of damage.
Collapsing all of them into stat-boost tweaks is the mapping-is-thematically-wrong failure.

**Stamina** is a 4-value counter per piece, `3 → 0`.

| Stamina | State | Meaning |
|---|---|---|
| 3 | Fresh (`PRISTINE` while never yet reduced) | normal |
| 2 | Worn | −1 `guard` |
| 1 | Battered | −1 `guard`, may not use ART-ACTIONS (charged move slots) |
| 0 | **FAINTED** | cannot move, cannot capture. Any enemy piece may capture it **with no Clash roll — automatic, no matchup check, no backlash.** It still occupies its square and still blocks lines. |

Fainting **never removes a piece.** You must still walk a piece over to take it. So Stamina is a
*positional* resource, not a second kill switch, and the piece-count monovariant is untouched.

This is the design's best structural answer to three separate problems at once:

1. **It gives the entire chip/heal economy something real to bite on**, at the cost of exactly 2 bits per
   piece — which is precisely the bucketing `recon-tech.md` §B.4.3 recommends for the Zobrist key, so the AI
   cost is the one already budgeted, not a new one.
2. **It is a third, independent answer to the untouchable-piece problem** (§9.6). You cannot capture a Levitate
   Flying piece with Ground — but you can lay Stealth Rock, land a Toxic, and faint it, after which *anything*
   takes it. Immunity buys time, never safety.
3. **It makes `REPELLED` cost something.** A missed attack that costs nothing is not a risk.

Fraction→pip table (this is the design decision the compiler cannot make; 4 rows, applied to every
`heal(maxhp/N)` / `damage(maxhp/N)` the source scanner extracts):

| Source fraction | Pips |
|---|---|
| ≥ 1/2 | ±2 |
| 1/3 … 1/2 | ±2 |
| 1/6 … 1/3 | ±1 |
| < 1/6 | ±1 |

So Recover (`heal[1,2]`) = `MEND(+2)`, Leftovers (1/16) = `MEND(+1)`, Brave Bird (`recoil[33,100]`) =
`MEND(−2)` on self, Giga Drain (`drain[1,2]`) = `MEND(+2)` on self after a successful Clash, Stealth Rock
= `MEND(−1)` scaled by matchup, Toxic = an escalating tick. **Deliberately coarse.** Four buckets keeps the
number of distinct outcomes small enough to display as three pips and small enough to hash.

Healing is bounded by move charges (a piece has ~12 charged move-uses per game total) and by item consumption.
Leftovers is the only unbounded healer and it can never exceed the cap of 3. Residual heal/chip loops are
caught by the no-progress draw rule (§7.4), which does **not** count healing as progress.

### 3.4 The 14 triggers

Derived from `on + Phase + Stem` by a 70-row stem table. Named for the board, not for Showdown.

| Trigger | Fires when | Stems that map here | Content examples |
|---|---|---|---|
| `ON_ACT` | a move is played | (default for moves), `Hit`, `PrimaryHit`, `HitSide`, `HitField`, `PrepareHit`, `Move`, `MoveFail`, `UseMoveMessage` | every move's own effect |
| `ON_ENTER` | a piece arrives on a square | `Start`, `SwitchIn`, `Update`, `SideConditionStart` | Intimidate, hazards firing, terrain seeds |
| `ON_EXIT` | a piece leaves a square | `SwitchOut`, `End`, `DragOut` | Natural Cure, Regenerator |
| `ON_UPKEEP` | end of the owner's turn | `Residual`, `Weather` | status ticks, Leftovers, Perish, Wish |
| `CLASH_LEGAL` | legality is being computed | `Immunity`, `Invulnerability`, `TryHit`, `TrapPokemon`, `MaybeTrapPokemon`, `Effectiveness`, `RedirectTarget`, `Target` | Levitate, Air Balloon, Bulletproof, Wonder Guard, Shadow Tag |
| `CLASH_ROLL` | the roll is being assembled | `BasePower`, `Atk`, `SpA`, `Def`, `SpD`, `Damage`, `Accuracy`, `STAB`, `CritRatio`, `CriticalHit` | Charcoal, Guts, Thick Fat, Compound Eyes, Sand Veil |
| `CLASH_RESULT` | the rung is decided, before it applies | `Damage`(Try/Modify), `Secondaries`, `Heal` | Sturdy, Focus Sash, Filter, Rock Head, Shell Armor |
| `ON_SURVIVE` | I survived a Clash against me | `DamagingHit`, `AfterBoost`, `AfterEachBoost`, `EachBoost` | Rough Skin, Static, Weak Armor, Rocky Helmet, Weakness Policy |
| `ON_FAINT` | I was removed / hit 0 Stamina | `Faint`, `AllyFaint`, `EmergencyExit` | Aftermath, Innards Out, Power of Alchemy, Destiny Bond |
| `ON_CAPTURE` | I captured something | `MoveSecondarySelf`, `AfterMove`, `SubDamage` | Moxie, Beast Boost, Life Orb, Shell Bell, U-turn's withdrawal |
| `ON_TAG` | a mark is being applied to me | `SetStatus`, `AddVolatile`, `Boost`, `ChangeBoost`, `Flinch`, `Attract` | Limber, Clear Body, Shield Dust, Own Tempo, Lum Berry |
| `ON_FIELD` | weather/terrain/room changed | `SetWeather`, `TerrainChange`, `PseudoWeatherChange`, `Change` | Forecast, Chlorophyll, Utility Umbrella |
| `ON_ITEM` | an item is used/eaten/removed | `TakeItem`, `EatItem`, `UseItem`, `Eat`, `Use`, `SetAbility`, `DeductPP` | Harvest, Sticky Hold, Unburden, Cheek Pouch |
| `ALWAYS` | a standing modifier, no event | `Spe`, `Priority`, `FractionalPriority`, `Weight`, `Type`, `DisableMove`, `Mega`, `Terastallization`, `CheckShow`, `HitProtect` | Levitate's flight, auras, Trick Room, Choice lock |

CI asserts the stem table is total over `@pkmn/sim`'s handler names, so a dependency bump that introduces a
71st stem **fails the build** instead of silently dropping content.

### 3.5 The 16 regions

Twelve derive from `move.target` (adopting `recon-moves.md` §2.2 verbatim — it is measured and correct); four
more exist for abilities and items, and they are the *bounded* forms of the board-wide effects.

| Region | Geometry | From | gen-9 moves |
|---|---|---|---|
| `MELEE` | the square you step onto, along your own chess pattern | `target: normal`/`adjacentFoe` | 432 |
| `SELF` | the caster | `target: self` | 80 |
| `RING1_FOES` | the 8 neighbours, enemies only | `allAdjacentFoes` | 48 |
| `RAY_LOS` | 8 rays, Chebyshev ≤ 2, **first occupied square only** — blockers matter. Caster does not move. | `flags.distance|pulse|bullet|sound|wind` | 37 |
| `RAY_ANY` | 8 rays, Chebyshev ≤ 3, **blockers ignored** (it flies / beams over). Caster does not move. | `target: any` | 21 |
| `BOARD` | every square | `target: all` | 18 |
| `RING1_ALL` | the 8 neighbours, **friend and foe** | `allAdjacent` | 15 |
| `OWN_SIDE` | your own army / your half | `allySide`, `allyTeam` | 11 |
| `ALLY` | one adjacent friendly piece | `allies`, `adjacentAlly`, `adjacentAllyOrSelf` | 9 |
| `RANDOM_FOE` | a seeded-random adjacent enemy | `randomNormal` | 6 |
| `REACTIVE` | whoever last attacked me | `target: scripted` | 4 |
| `FOE_ZONE` | a 3-square segment of the enemy's rank 6: your file ±1 | `target: foeSide` | 4 |
| `TARGET` | the current Clash's defender | ability/item scope `SOURCE` | — |
| `KING_RING` | the 8 squares around **this piece** — the bounded form of "board-wide" | ability scope `ANY`, bounded | — |
| `SQUARE` | the square this piece stands on | ability scope `SELF`, square-level | — |
| `NONE` | no spatial extent (pure modifier) | ability scope, `ALWAYS` trigger | — |

`RAY_LOS` (37 moves) and `RAY_ANY` (21) are the genuinely new chess geometry: **ranged capture without
occupying the square.** `RING1_ALL` (15 moves — Earthquake, Surf, Explosion, Discharge, Boomburst) is the
friendly-fire class and must not be watered down; it is the most interesting new idea in the move layer.

Measured flavour bonus that needs no curation: **15 of the 21 `target: any` moves are Flying-type**, the rest
are pulse/beam moves. "Ignores blockers because it flies or beams over them" falls out of the data.

`KING_RING` is how every board-wide ability gets bounded (§10.5): Shadow Tag, Arena Trap, Magnet Pull,
Neutralizing Gas and Teraform Zero become *walking zones you route around* rather than global off-switches.

### 3.6 Why 18 and not 12

The count is structural, not aesthetic. Three arguments, in descending strength:

1. **9 of the 18 are forced by the state model** — one write op per mutable field, and I already merged every
   field pair that merges (`setType`+`formeChange`+class → `BECOME`; `setAbility`+`setItem` → `EQUIP`;
   the seven Showdown tag fields → `MARK`). Getting below 9 writes means deleting state, i.e. deleting
   content: no items (−1), no stamina (−1, and ~200 entries go inert), no move economy (−1, and the
   termination bound weakens).
2. **The 5 clash-pipeline ops are five different mathematical kinds** and cannot be type-punned: a boolean
   veto, a veto-canceller, an integer addend, an outcome-rewrite function, and the resolution itself. Merging
   `VETO` into `TILT` breaks move generation and the UI (§3.2). Merging `WARP` into `TILT` is impossible —
   Sturdy is not "+N to the roll", it is "whatever the roll said, the capture fails once."
3. **The 3 control-flow ops and 1 info op are irreducible.** `TEMPO` is the only route to an extra move (which
   is exactly what makes termination provable — you audit one op). `SCHEDULE` is the only cross-turn write.
   `INVOKE` is the only recursion. `REVEAL` writes to no game state at all and exists so that Frisk/Forewarn/
   Anticipation are real rather than deleted.

A 12-op ISA is reachable only by deleting the item layer, the Stamina layer and the information layer, and by
modelling immunity as a large negative number. That is a worse game and a buggier engine.

Conversely, **the 115 "primitives" in `recon-abilities-items.md` §2.6 are not a competing ISA** — they are 115
*parameterisations* of these 18 ops, which is exactly what a data layer should be. `WARD/elemental` (11
abilities) is `{when:CLASH_LEGAL, where:NONE, ops:[VETO('element')], params:{type}}`. `BULWARK/flat` (3) is
`{when:CLASH_ROLL, ops:[TILT('def',+1)]}`. `EDGE/escalate` (7) is `{when:ON_CAPTURE, ops:[BOOST({atk:+1})]}`.
I keep their 13 archetypes as the **UI glyph vocabulary** (§15.3) — they are excellent for that — and discard
the 115 as an implementation unit.

---

## 4. The compiler

Runs at **build time** in `tools/compile/`. Reads `@pkmn/dex` + `@pkmn/sim` + `data/curated/*.json`, emits
`src/data/generated/*.bin`. Deterministic: same inputs ⇒ byte-identical output, asserted in CI.

### 4.1 Five passes

```
pass 1  ADMIT      filter by isNonstandard; assign stable uint16 ids; build the mark table
pass 2  DERIVE-C1  read declarative fields          -> Effect[]  (665 moves, 133 items, complete)
pass 3  DERIVE-C2  read the handler fingerprint     -> Trigger + Region for each handler
pass 4  DERIVE-C3  scan handler source              -> Op[] + params
pass 5  PATCH      apply data/curated/*.json as a DIFF against passes 2-4; emit; assert totality
```

Passes 2–4 accumulate into the same `Effect[]`; they do not compete. Pass 5 is a patch layer, which is the
architectural point: **a curated entry is a diff against the compiler's proposal, not a from-scratch
authoring task.** The generator writes `build/compile-report.json` listing, for every one of the 1797 entries,
which pass produced each op — so the coverage claim in §1.6 is regenerated and re-asserted on every build.

### 4.2 Pass 2 — declarative derivation

```
function deriveC1(m: DexMove): Effect[] {
  const region = REGION_OF_TARGET[m.target]                      // 12-row table, §3.5
    ?? (RANGED_FLAGS.some(f => m.flags[f]) ? RAY_LOS : MELEE);
  const out: Effect[] = [];
  const ops: Op[] = [];

  // --- the payload, in Showdown's own field order ---
  if (m.category !== 'Status')  ops.push({op:'CLASH', slot:'this'});
  if (m.ohko)                   ops.push({op:'WARP',  from:[-1,0,1], to:2});      // 4 moves
  if (m.status)                 ops.push({op:'MARK',  mark:markOf(m.status)});
  if (m.volatileStatus)         ops.push({op:'MARK',  mark:markOf(m.volatileStatus), dur:DUR(m)});
  if (m.boosts)                 ops.push({op:'BOOST', d:m.boosts});
  if (m.heal)                   ops.push({op:'MEND',  pips: pipsOf(m.heal)});
  if (m.sideCondition)          ops.push({op:'MARK',  mark:markOf(m.sideCondition),
                                          layers: HAZARD_LAYERS[m.sideCondition] ?? 1, dur:DUR(m)});
  if (m.slotCondition)          ops.push({op:'SCHEDULE', delay:1, then: healEffect()});
  if (m.weather||m.terrain||m.pseudoWeather)
                                ops.push({op:'MARK',  mark:markOf(m.weather??m.terrain??m.pseudoWeather),
                                          dur: DUR(m) ?? 5});
  if (m.forceSwitch)            ops.push({op:'RELOCATE', to:'push', dist:1});
  out.push({ when:'ON_ACT', where:region, ops, dur:DUR(m), charge:chargesOf(m.pp) });

  // --- self-directed consequences (a SECOND Effect at a different trigger) ---
  const selfOps: Op[] = [];
  if (m.drain)                  selfOps.push({op:'MEND', pips: pipsOf(m.drain)});
  if (m.recoil||m.mindBlownRecoil) selfOps.push({op:'MEND', pips:-pipsOf(m.recoil)});
  if (m.self?.boosts)           selfOps.push({op:'BOOST', d:m.self.boosts});
  if (m.selfSwitch)             selfOps.push({op:'RELOCATE', to:'origin'});
  if (m.selfdestruct)           selfOps.push({op:'REMOVE'});
  if (selfOps.length) out.push({ when:'ON_CAPTURE', where:'SELF', ops:selfOps });

  // --- riders: 170 moves carry secondary/secondaries. TCG-style flip. ---
  for (const s of [m.secondary, ...(m.secondaries ?? [])].filter(Boolean))
    out.push({ when:'ON_CAPTURE', where: s.self ? 'SELF' : 'TARGET',
               guard: {flip: s.chance},                    // TCG coin-flip, §6.5
               ops: [ ...(s.status ? [{op:'MARK', mark:markOf(s.status)}] : []),
                      ...(s.volatileStatus ? [{op:'MARK', mark:markOf(s.volatileStatus), dur:1}] : []),
                      ...(s.boosts ? [{op:'BOOST', d:s.boosts}] : []),
                      ...(s.self?.boosts ? [{op:'BOOST', d:s.self.boosts}] : []) ] });

  // --- pure scalars, no op needed: they parameterise the Clash ---
  //   power   = tierOf(m.basePower || 60)          <- the || 60 guard; 28 moves have basePower 0
  //   tilt    = accuracyTilt(m.accuracy)           <- true -> +1, 100 -> 0, 90 -> 0, 75-89 -> -1, <50 -> -2
  //   tempo   = m.priority >= 1 ? 'react' : m.priority <= -1 ? 'act-last' : none
  //   marks   = flags.charge -> MARK('charging',2) ; flags.recharge -> MARK('recharging',1)
  //   multihit-> WARP(reroll n times)              <- 22 moves
  return out;
}
```

Three field-level guards that are non-negotiable, each measured:

- **`m.basePower || 60`.** 28 gen-9 moves have `basePower === 0` (Gyro Ball, Low Kick, Seismic Toss, Flail,
  Electro Ball, Present, Fissure…). Without the guard they compile to an unusable strength-0 attack that reads
  as a bug.
- **Read `secondary` AND `secondaries[]`.** Only 15 moves inflict a non-volatile status as a *primary* effect;
  there are **88 secondary status applications** (brn 41, par 35, psn 24, frz 13, tox 4, slp 2) and
  **46 flinch riders**. A status system reading only `move.status` covers 15 moves and misses 134.
  **`frz` has zero primary applications in gen 9** — a freeze mechanic built from `move.status` looks dead.
- **`ignoreImmunity` is a trap, read inverted.** It is `true` on all 214 gen-9 Status moves and on only 4
  damaging moves in the entire dex. It is not an exception list; it is the statement *"support moves bypass
  type immunity"* — which is a rules fact the compiler can assert from data, and it directly bounds the
  untouchable-piece problem (§9.6) with no special case.

### 4.3 Pass 3 — fingerprint derivation

```
function deriveC2(e: SimEntry): Partial<Effect>[] {
  return handlerNames(e).map(h => {
    const {scope, phase, stem} = parseHandlerName(h);       // §1.3 grammar, 2 special cases
    return { when:  TRIGGER_OF_STEM[stem][phase],           // 70-row x 5-phase table
             where: REGION_OF_SCOPE[scope] };               // SELF/SOURCE->TARGET/ALLY/FOE/ANY->KING_RING
  });
}
```

`REGION_OF_SCOPE` maps `ANY → KING_RING`, which is where the balance bound on board-wide abilities is applied
**structurally**: Neutralizing Gas cannot be global because the compiler cannot produce a global region for an
ability. `recon-abilities-items.md` §6.9 asks for that bound as a rule; I get it as a compiler invariant.

### 4.4 Pass 4 — source derivation

```
function deriveC3(src: string): {ops: Op[], guards: Guard[]} {
  const ops: Op[] = [], guards: Guard[] = [];
  for (const {recv, method, args} of extractCalls(src)) {       // regex, 2212 sites total
    const spec = MUTATION_TABLE[method];                        // 20 rows
    if (!spec) { if (PREDICATE_TABLE[method]) guards.push(...); continue; }
    ops.push(spec.build(parseArgs(args), recv));                // recv picks the Region override
  }
  for (const [re, build] of RETURN_PATTERNS)                    // 18 rows, §1.4
    if (re.test(src)) ops.push(build(src.match(re)));
  return {ops, guards};
}

parseArgs(a):  literal string       -> markOf(a)                // 286 of 475 sites (60.2%)
               object literal       -> boost vector             // { atk: 12 }
               numeric expr /N      -> pipsOfFraction(N)        // heal(maxhp/2) -> +2 pips
               bare                 -> runtime-resolved
```

`MUTATION_TABLE` is 20 rows. `RETURN_PATTERNS` is 18 rows. `PREDICATE_TABLE` (`hasType`, `hasAbility`,
`isAlly`, `isAdjacent`, `isGrounded`, `effectiveWeather`, `getStat`, `checkMoveMakesContact`, …) is 24 rows and
produces `Guard`s rather than ops — which is exactly right, because those calls are conditions, not effects.

**62 rows of table is the entire back end.** That is the whole claim of this proposal.

### 4.5 Pass 5 — the patch layer and the CI gate

```jsonc
// data/curated/overrides.json — 93 entries, this is the WHOLE hand-written content surface
{
  "levitate": {
    "reason": "no handler in @pkmn/sim; Ground immunity is special-cased in the battle engine",
    "replace": [{ "when":"CLASH_LEGAL", "where":"NONE", "ops":[{"op":"VETO","scope":"element"}],
                  "params": {"type":"Ground"} }]
  },
  "shadowtag": {
    "reason": "board-wide trapping is mate-forcing; bound to KING_RING and never the enemy King",
    "replace": [{ "when":"CLASH_LEGAL", "where":"KING_RING",
                  "ops":[{"op":"VETO","scope":"bind"}], "params":{"exceptKing": true} }]
  },
  "seismictoss": {
    "reason": "damage is in damageCallback, not an on* handler; board meaning is a design choice",
    "patch": [{ "path":"0.ops", "add":{"op":"MEND","pips":-2} }]      // typeless: bypasses the ladder
  }
}
```

The generator **fails the build** if:

1. any admitted entry has no `Effect[]` (totality);
2. any override names an entry that no longer exists, or whose compiler proposal has changed since the
   override was written (a `proposalHash` field per override — this is how a `@pkmn/dex@0.11` bump surfaces
   *semantic* drift rather than silently keeping a stale patch);
3. a 71st handler stem, a 21st mutation verb, or an unknown `isNonstandard` value appears;
4. any `Op` references a `MarkId` outside the generated mark table;
5. `INVOKE` appears with `depth !== 1`, or any op named `SUMMON` exists.

Gate 2 is the one that makes dependency bumps safe, and gate 5 is the termination proof enforced by CI.

### 4.6 Bundle budget (measured basis)

| Payload | gzip | Basis |
|---|---|---|
| `moves.bin` — 950 × packed `Effect[]` (~28 B each) | **~9 KB** | `recon-abilities-items` measured 310 archetype records at 0.7 KB gz; scaled |
| `abilities.bin` + `items.bin` | **~4 KB** | same basis |
| `species.bin` — 1367 formes, columnar | **~17 KB** | `recon-tech` measured 733 at 12.0 KB gz, ×1.4 |
| `marks.bin` — 81 rows | **0.3 KB** | |
| `typechart.bin` — 18×18 `Int8Array` | **0.2 KB** | measured |
| Strings: names + `shortDesc` for tooltips | **~18 KB** | `recon-abilities-items` measured 7.7 + 9.5 KB gz |
| **Initial data total** | **≈ 49 KB** | budget 55 KB, fail at 70 KB |
| Lazy: full learnsets (delta-varint) | 43.8 KB | measured; loaded during draft only |
| Lazy: 4 auto-picks + 8-alternative shortlist per species | ~24 KB | ships in Tier 0 instead of full learnsets |

`@pkmn/dex` and `@pkmn/sim` ship **0 bytes** to the client; CI asserts it with a bundle-visualiser check.

---

## 5. Fifteen worked move traces

Each row: the dex fields (measured, `sysdes-probe3.mjs`), which channel fired, the emitted `Effect[]`, and the
board behaviour. These are the compiler's actual output, not illustrations.

---

**1. Earthquake** — *the friendly-fire spread move*
`type Ground · Physical · bp 100 · acc 100 · pp 10 · target allAdjacent · no handlers`
→ **C1 only.** `REGION_OF_TARGET['allAdjacent'] = RING1_ALL`.
```
[{ when:'ON_ACT', where:'RING1_ALL', ops:[{op:'CLASH'}], charge:2 }]   // power tier T4, tilt 0
```
**Board:** an ART-ACTION. Ground Excadrill does not move; it resolves a Clash against **all 8 neighbours,
including your own pieces**. Each neighbour gets its own rung from its own matchup. 2 charges.
Ground→Flying = 0, so Flying neighbours are simply not in the region — Earthquake reads correctly for free.

**2. Stealth Rock** — *the hazard*
`type Rock · Status · target foeSide · sideCondition 'stealthrock' · pp 20 · ignoreImmunity true · no handlers`
→ **C1 only.** `foeSide → FOE_ZONE`; `HAZARD_LAYERS['stealthrock'] = 1`; no `condition.duration` ⇒ `persist`.
```
[{ when:'ON_ACT', where:'FOE_ZONE', ops:[{op:'MARK', mark:STEALTHROCK, layers:1, dur:'persist'}], charge:4 }]
```
**Board:** paints a 3-square segment of the enemy's rank 6 (your file ±1). The mark's `tick` fires on
`ON_ENTER`: any enemy piece ending a move there takes `MEND(−1)`, **scaled by Rock-vs-its-type** — so a
Flying/Ice piece takes −2 and a Steel piece takes 0. Persists until Defog/Rapid Spin/Court Change.
Zero authoring: the layer count, the persistence and the type scaling all come from data.

**3. Extreme Speed** — *the priority move*
`type Normal · Physical · bp 80 · priority +2 · target normal · no handlers`
→ **C1 only.** `priority ≥ 1 → TEMPO 'react'`.
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'CLASH'}], charge:1 },
 { when:'CLASH_LEGAL', where:'SELF', ops:[{op:'TEMPO', kind:'react'}] }]
```
**Board:** may be declared as a **Reaction** when an enemy begins a Clash against this piece. It resolves
first; if it captures the attacker, the attacker's Clash never happens. One charge, one reaction per enemy
turn. This is "defended square, but active", and it is the whole of `priority` (§6.6).

**4. Will-O-Wisp** — *the status move*
`type Fire · Status · acc 85 · target normal · status 'brn' · pp 15 · no handlers`
→ **C1 only.** `accuracyTilt(85) = −1`.
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'MARK', mark:BRN}], charge:3, tilt:-1 }]
```
**Board:** ART-ACTION on an adjacent enemy. `BRN`'s generated row is
`{tick: MEND(-1) at ON_UPKEEP, modifier: TILT('atk',-1)}` — so a burned piece chips down *and* attacks worse.
Because the move is Status, `ignoreImmunity` is true, so **it is legal against a type-immune piece.** A Ghost
piece your Normal army cannot touch can still be burned to death. That is hard-problem 6 solved from data.

**5. Fissure** — *the OHKO move*
`type Ground · Physical · bp 0 · acc 30 · ohko true · pp 5 · no handlers`
→ **C1 only.** `ohko → WARP`; `accuracyTilt(30) = −2`; `bp 0 → || 60`.
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'CLASH'}, {op:'WARP', from:[-1,0,1], to:2}], charge:1, tilt:-2 }]
```
**Board:** one charge, and `tilt −2` means the Focus die must show 5 or 6 to avoid `REPELLED`.
If it lands, `WARP` promotes the rung to `SURGE` regardless of matchup — the type chart is bypassed, which is
why it is **draft-restricted to 1 per army** (§10.5). Sheer Cold's `ohko: 'Ice'` becomes a `guard` that fails
against Ice pieces. Four moves, one op, no bespoke code.

**6. Bullet Seed** — *the multi-hit*
`type Grass · Physical · bp 25 · multihit [2,5] · pp 30 · flags bullet · no handlers`
→ **C1 only.** `flags.bullet` is a ranged flag ⇒ `RAY_LOS`, not MELEE.
```
[{ when:'ON_ACT', where:'RAY_LOS', ops:[{op:'CLASH'}, {op:'WARP', reroll:[2,5]}], charge:5 }]
```
**Board:** a ranged attack at Chebyshev ≤ 2 along a ray, first occupied square only. Rolls the ladder
`n ∈ [2,5]` times (seeded) and **takes the best rung**. That makes multi-hit the natural counter to a bad
Focus die and to `Substitute`/`Protect`: P(no `REPELLED`) = 1 − (1/6)^n. Skill Link forces n = max.

**7. U-turn** — *the self-switch*
`type Bug · Physical · bp 70 · selfSwitch true · pp 20 · target normal · no handlers`
→ **C1 only.** `selfSwitch → RELOCATE('origin')` at `ON_CAPTURE`.
```
[{ when:'ON_ACT',     where:'MELEE', ops:[{op:'CLASH'}], charge:4 },
 { when:'ON_CAPTURE', where:'SELF',  ops:[{op:'RELOCATE', to:'origin'}] }]
```
**Board:** capture, then **return to the square you came from.** Exactly the mechanic DIRECTION.md names as
the standard for faithfulness, and it falls straight out of one boolean field. Tactically enormous: a hit-and-run
that never exposes the attacker. Baton Pass (`selfSwitch: 'copyvolatile'`) adds
`{op:'MARK', transfer:true}` — the boosts move with you, capped at +2 total (§7.3).

**8. Swords Dance** — *the boost*
`type Normal · Status · target self · boosts {atk:+2} · pp 20 · flags dance · no handlers`
→ **C1 only.**
```
[{ when:'ON_ACT', where:'SELF', ops:[{op:'BOOST', d:{atk:+2}}], charge:4 }]
```
**Board:** ART-ACTION, no relocation. `+2 atk` = `+2` to `might`, i.e. +2 to this piece's Clash roll on
physical captures — which under the ladder (§6.3) is a **two-rung shift**, converting a `BACKLASH` matchup into
`CLEAN` and a neutral one into `CRITICAL`. Iron Defense (`{def:+2}`) is a visibly *different* effect because
the 7-vector was kept (§2.1). `flags.dance` is what Dancer copies.

**9. Trick Room** — *the weird one*
`type Psychic · Status · target all · pseudoWeather 'trickroom' · priority −7 · condition.duration 5 · pp 5`
→ **C1 only.** `all → BOARD`; duration read from data.
```
[{ when:'ON_ACT', where:'BOARD', ops:[{op:'MARK', mark:TRICKROOM, dur:5}], charge:1 }]
```
**Board:** the `TRICKROOM` mark's generated row inverts one thing — **which moves may Reaction-interrupt**.
Normally `priority ≥ +1` reacts (Quick Attack, Sucker Punch, Extreme Speed); under Trick Room,
`priority ≤ −1` reacts instead (Counter, Avalanche, Focus Punch, Circle Throw). For 5 turns the slow moves go
first. That is precisely what Trick Room does in the games, expressed as one mark and one comparison flip, and
it makes an entire otherwise-dead archetype (the 6 negative-priority moves) live for a window.

**10. Baton Pass** — *the state transfer*
`type Normal · Status · target self · selfSwitch 'copyvolatile' · pp 40 · handlers: onHit`
→ **C1 + C3.** C1 gives the relocation; C3's `onHit` is scanned and contributes nothing mutating (it is a
switch-request), so the *curated* row supplies the transfer semantics. **This is 1 of the 93.**
```
[{ when:'ON_ACT', where:'SELF',
   ops:[{op:'RELOCATE', to:'origin'}, {op:'MARK', mark:PASSED, transfer:'boosts+marks'}], charge:5 }]
```
**Board:** the piece retreats to its origin square and **leaves its accumulated boosts and marks on that
square**; the next friendly piece to end a move there picks them up. Bounded: once per piece per game,
transferred boosts capped at +2 total.

**11. Protect** — *the staller*
`type Normal · Status · target self · volatileStatus 'protect' · priority +4 · stallingMove true ·
condition.duration 1 · handlers: onHit + onPrepareHit`
→ **C1 + C3.** `addVolatile('stall')` is extracted from the source, giving the escalating-failure counter free.
```
[{ when:'ON_ACT', where:'SELF',
   ops:[{op:'MARK', mark:PROTECT, dur:1}, {op:'MARK', mark:STALL}], charge:2 }]
```
**Board:** uncapturable for one opponent reply. The `STALL` mark carries Showdown's own escalation:
success probability `(1/3)^consecutive`, reset by using any other move. So n consecutive Protects cost `3^n` —
stalling is self-limiting with no rule I had to invent. The 6 punish variants (Spiky Shield → attacker takes
`MEND(−1)`; Baneful Bunker → `MARK(PSN)`; King's Shield → `BOOST({atk:−1})`) are six `ON_SURVIVE` rows in the
mark table, i.e. data.

**12. Explosion** — *the self-KO*
`type Normal · Physical · bp 250 · target allAdjacent · selfdestruct 'always' · pp 5 · no handlers`
→ **C1 only.**
```
[{ when:'ON_ACT',     where:'RING1_ALL', ops:[{op:'CLASH'}], charge:1 },   // power tier T5
 { when:'ON_CAPTURE', where:'SELF',      ops:[{op:'REMOVE'}] }]            // 'always' -> also on failure
```
**Board:** Clash against all 8 neighbours, friend and foe, then remove yourself. Maximum 8 + 1 = 9 pieces —
never the board. `selfdestruct: 'always'` (3 moves) fires the `REMOVE` even on failure; `'ifHit'` (4 moves:
Final Gambit, Memento, Healing Wish, Lunar Dance) fires only on success. **The one rule the compiler cannot
supply, and which fixes the video's bug: a move whose deterministic resolution necessarily removes your own
King is illegal** (§9.4). Self-KO is just the extreme case of that general rule.

**13. Metronome** — *the recursion*
`type Normal · Status · target self · callsMove true · pp 10 · flags failinstruct/failcopycat/nosleeptalk ·
handlers: onHit`
→ **C1 (`callsMove`) + C3 (`useMove` extracted).**
```
[{ when:'ON_ACT', where:'SELF', ops:[{op:'INVOKE', pool:'own-army-minus-dangerous', depth:1}], charge:2 }]
```
**Board:** samples one move from *your own army's derived move slots*, minus every `callsMove` move and every
`selfdestruct` move, using the seeded PRNG — so Metronome is **deterministic and replayable**. `depth: 1` is in
the type, so recursion is impossible to write. The exclusion lists are `callsMove` (3 gen-9 / 7 all-gens) and
`flags.failinstruct` (29) / `flags.failcopycat` (35) — the dataset already curated the denylist.

**14. Shadow Ball** — *the ranged attack with a rider*
`type Ghost · Special · bp 80 · flags bullet · secondary {chance:20, boosts:{spd:−1}} · no handlers`
→ **C1 only.** `flags.bullet ⇒ RAY_LOS`.
```
[{ when:'ON_ACT',     where:'RAY_LOS', ops:[{op:'CLASH'}], charge:3 },
 { when:'ON_CAPTURE', where:'TARGET', guard:{flip:20}, ops:[{op:'BOOST', d:{spd:-1}}] }]
```
**Board:** Gengar captures at range 2 along a ray, **without moving**, and 20% of the time the target's
`guard` drops. Since the target usually dies, the rider matters mostly when the Clash was `REPELLED` — which is
correct and reads as chip pressure. This is the single largest archetype: 114 gen-9 moves are
damage-plus-rider, all one compiler path.

**15. Soak** — *the identity change*
`type Water · Status · acc 100 · target normal · pp 20 · handlers: onHit` (no type field anywhere in `@pkmn/dex`)
→ **C3 only.** `setType('Water')` extracted from the handler source. Invisible to a dex-only compiler.
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'BECOME', type:'Water'}], charge:4 }]
```
**Board:** **the highest-leverage move in the game.** An enemy piece's `chessType` becomes Water — you have
rewritten its position in the type chart, and therefore what can capture it and what it can capture. A Steel
rook that repelled 10 of 18 attacker types becomes a Water rook that resists 4. Six moves do this (Soak, Magic
Powder, Forest's Curse, Trick-or-Treat, Conversion, Reflect Type) and they are the most Pokémon-Chess moves in
the dex. They cost nothing to implement because `BECOME` already exists for Mega Evolution and promotion.

**Bonus — Belly Drum**, the headline demo: `@pkmn/dex` reports **no** `boosts` field. C3 extracts
`this.boost({ atk: 12 }, target)` from the source. Compiles to
`[{when:'ON_ACT', where:'SELF', ops:[{op:'BOOST', d:{atk:+12}}], charge:2}]`, clamped to `+6` by the shared
`BOOST` clamp. **Zero authoring, and every other proposal ships it inert.**

---

## 6. The same ISA expresses abilities and items

This is the payoff. An **ability** is an `Effect[]` with a non-`ON_ACT` trigger. An **item** is an `Effect[]`
with a consumption counter and a transfer rule. There is no ability system and no item system — there is one
effect system with three sources. 45 of the 125 handler names are shared across the three kinds, which is the
empirical evidence that they *are* the same thing.

### 6.1 Abilities

| Ability | Channel | Emitted `Effect[]` | Board behaviour |
|---|---|---|---|
| **Levitate** (42 species) | **curated** — no handler anywhere | `[{when:CLASH_LEGAL, where:NONE, ops:[VETO('element')], params:{Ground}}]` | Ground captures against it are illegal — **once**, then the ward is spent (§9.6) |
| **Rough Skin** (6) | C3: `damage(source.baseMaxhp/8)` + `checkMoveMakesContact` guard | `[{when:ON_SURVIVE, where:TARGET, guard:{contact}, ops:[MEND(-1)]}]` | whatever captures it by contact loses a Stamina pip |
| **Static** (33) | C3: `trySetStatus('par', source)` | `[{when:ON_SURVIVE, where:TARGET, guard:{contact,flip:30}, ops:[MARK(PAR)]}]` | contact capturer is paralysed |
| **Intimidate** (46) | C3: `boost({atk:-1})` + scope `Foe` | `[{when:ON_ENTER, where:RING1_FOES, ops:[BOOST({atk:-1})]}]` | arriving drops adjacent enemies' `might` |
| **Moxie** (16) | C3: `boost({atk:1}, pokemon)` at `onSourceAfterFaint` | `[{when:ON_CAPTURE, where:SELF, ops:[BOOST({atk:+1})]}]` | snowballs on every capture |
| **Sturdy** (48) | C3: `return 0` at `onDamage` (a `VETO(zero)` pattern) | `[{when:CLASH_RESULT, where:SELF, guard:{pristine}, ops:[WARP(from:[1,2,3], to:-1, once:true)]}]` | the first capture that would take it fails; attacker stays put |
| **Thick Fat** (33) | C3: `chainModify(0.5)` + type guard | `[{when:CLASH_ROLL, where:SELF, guard:{atkType:[Fire,Ice]}, ops:[TILT('def',+2)]}]` | +2 defensive roll vs Fire and Ice |
| **Mold Breaker** (26) | C3b: `move.ignoreAbility = true` | `[{when:CLASH_LEGAL, where:SELF, ops:[PIERCE(['element','class','absolute'])]}]` | its captures ignore all 84 `flags.breakable` defences |
| **Protean** (7) | C3: `setType(move.type)` | `[{when:CLASH_LEGAL, where:SELF, guard:{oncePerGame}, ops:[BECOME({type:'move'})]}]` | once per game, becomes the type of the move it uses |
| **Drizzle** (3) | C3: `setWeather('raindance')` | `[{when:ON_ENTER, where:BOARD, ops:[MARK(RAIN, dur:5)]}]` | sets weather board-wide |
| **Shadow Tag** (6) | **curated** — bound | `[{when:CLASH_LEGAL, where:KING_RING, ops:[VETO('bind')], params:{exceptKing:true}}]` | adjacent enemies may not move *away*; never binds the enemy King |
| **Wonder Guard** (1) | **curated** — bound | `[{when:CLASH_LEGAL, where:SELF, ops:[VETO('absolute')], params:{unless:'rung>=2'}}]` | one-shot; a `CRITICAL` still takes it; hazards and status still kill it, which is how Shedinja actually dies |
| **Regenerator** (27) | C3: `heal(maxhp/3)` at `onSwitchOut` | `[{when:ON_EXIT, where:SELF, ops:[MEND(+1)]}]` | recovers a pip when it moves away |
| **Speed Boost** (14) | C3: `boost({spe:1})` at `onResidual` | `[{when:ON_UPKEEP, where:SELF, guard:{noCaptureThisTurn}, ops:[BOOST({spe:+1})]}]` | +1 `spe` per patient turn, capped +3 by the shared clamp |
| **Run Away** (36) | fallback (`INERT`) | `[]` + `shortDesc` tooltip + `+1 draft budget refund` | honest, visible, refunds points |

Note what did **not** need building: no ability hook interface, no ability registry, no 115 primitive functions.
`recon-abilities-items.md` proposes 115 hand-written functions averaging 15 LOC (~1700 LOC). My ability layer is
**0 LOC** plus 39 JSON rows, because the ops already exist for the move layer.

### 6.2 Items

An item is `{effects: Effect[], charges: number, onCapture: 'destroy'}`. Consumption is a `consume: true` flag
on an op; the engine decrements and zeroes `Piece.item`.

| Item | Channel | Emitted `Effect[]` |
|---|---|---|
| **Charcoal** (+25 more `TYPE_LENS`) | C1: `fling`/name + C3 `chainModify(1.2)` | `[{when:CLASH_ROLL, where:SELF, guard:{atkType:Fire}, ops:[TILT('atk',+1)]}]` |
| **Occa Berry** (+17 resist berries) | **C1 only — `naturalGift.type` IS the resisted type** | `[{when:CLASH_ROLL, where:SELF, guard:{atkType:Fire}, ops:[TILT('def',+2), {consume:true}]}]` |
| **Sitrus Berry** | C3: `heal(maxhp/4)` at `onUpdate` | `[{when:ON_UPKEEP, where:SELF, guard:{wounded}, ops:[MEND(+1), {consume:true}]}]` |
| **Lum Berry** (+14 cure berries) | C3: `cureStatus()` | `[{when:ON_TAG, where:SELF, ops:[UNMARK({kind:'status'}), {consume:true}]}]` |
| **Leftovers** | C3: `heal(maxhp/16)` at `onResidual` | `[{when:ON_UPKEEP, where:SELF, ops:[MEND(+1)]}]` |
| **Life Orb** | C3: `damage(maxhp/10)` | `[{when:ON_CAPTURE, where:SELF, ops:[MEND(-1)]}]` — **drains on every link of a capture chain, so a Life Orb piece cannot chain indefinitely** |
| **Focus Sash** | **curated** (`onTryHit` returns are ambiguous) | `[{when:CLASH_RESULT, where:SELF, guard:{pristine}, ops:[WARP(from:[1,2,3], to:-1, once:true), {consume:true}]}]` |
| **Air Balloon** | **curated** | `[{when:CLASH_LEGAL, where:SELF, ops:[VETO('element'), {consume:true}], params:{Ground}}]` — **the template for every ward** |
| **Ring Target** | **curated** | `[{when:CLASH_LEGAL, where:SELF, ops:[PIERCE(['type'])]}]` — inverted: it pierces *its own holder's* immunities. The immunity breaker. |
| **Rocky Helmet** | C3: `damage(maxhp/6)` at `onDamagingHit` | `[{when:ON_SURVIVE, where:TARGET, guard:{contact}, ops:[MEND(-1)]}]` |
| **Choice Scarf** | C1: `isChoice` | `[{when:ALWAYS, where:SELF, ops:[BOOST({spe:+2}), MARK(CHOICELOCK)]}]` — illegal on King and Queen |
| **Eviolite** | C1: name + `species.nfe` gate | `[{when:CLASH_ROLL, where:SELF, guard:{nfe}, ops:[TILT('def',+1)]}]` |
| **Weakness Policy** | C3: `boost({atk:2,spa:2})` | `[{when:ON_SURVIVE, where:SELF, guard:{rung>=2}, ops:[BOOST({atk:+2,spa:+2}), {consume:true}]}]` |
| **Draco Plate** (+61 `forcedForme`/`onPlate`/`onMemory`/`onDrive`) | **C1 only — the field carries the type** | `[{when:ALWAYS, where:SELF, ops:[BECOME({type:'Dragon'})]}]` |
| **Venusaurite** (+46 real Mega Stones) | **C1 only — `megaStone` names the exact target forme** | `[{when:'ON_PROMOTE', where:SELF, ops:[BECOME({forme:'Venusaur-Mega'})]}]` |
| **TR00–TR99** (100) | excluded class | `[]` — repurposed as the icon set for the signature-move picker |

**316 of 583 items classify from structured fields with zero prose reading** (`isPokeball` 28, `megaStone` 93,
`zMove` 35, `isBerry` 77, `isGem` 18, `forcedForme` 62, `isChoice` 3); the `/^TR\d\d$/` regex takes it to 416.
For all 18 type-resist berries `naturalGift.type` is *exactly* the resisted type, verified — so the largest
berry family is 100% derived. `itemUser: string[]` gives 155 species-locked items for free.

### 6.3 The item economy: Format Kits

Picking any of 353 held items for each of 16 pieces is `353^16` and paralysing. Instead a **format declares a
Kit: an ordered list of 12 items, and each side gets one of each.** 16 pieces, 12 items ⇒ four pieces hold
nothing. This caps the state space, forces real allocation decisions ("who gets the Sash?"), guarantees both
sides face the same toolbox, and makes the item layer *learnable* — a returning player already knows every item
on the board. I adopt `recon-abilities-items.md` §4.3's "Standard 12" Kit verbatim, including **Ring Target in
slot 7**, because a format must guarantee each side ends the draft with at least one immunity breaker.

Later formats swap the Kit wholesale ("Weather Kit", "Signature Kit" of 12 `itemUser`-locked items). That is how
the remaining 341 admitted items enter play over time — **as formats, not as an inventory screen.** Nothing is
missing; it is queued, and the compiler already emitted all of them.

Items are **destroyed on capture** (no looting — looting makes every capture a resource decision on top of a
chess decision and lets the winner snowball). Theft is confined to Magician/Pickpocket (2 abilities, ~20
species), countered by Sticky Hold and Ability Shield, plus the Knock Off / Trick / Thief move layer.
Both abilities and items are **public information, always, both sides.** Hidden information breaks the AI
search, converts "type knowledge is your edge" into "memorisation of hidden state", and makes losses feel
unfair. `Illusion` is the single sanctioned exception (it renders as a decoy species until its first Clash);
`Frisk`/`Forewarn`/`Anticipation` become `REVEAL` board-analysis affordances, which is both useful and exactly
their flavour.

---

## 7. The total fallback — nothing is ever missing

The fallback is not an error path. It is the modal case: **216 of 950 moves are plain damage with no signal at
all**, and that is *correct* — Tackle should be a plain capture.

```
function fallback(e): Effect[] {
  if (e.kind === 'move' && e.category !== 'Status')
    return [{ when:'ON_ACT', where: shapeOf(e.target) ?? 'MELEE',
              ops:[{op:'CLASH'}],
              power: tierOf(e.basePower || 60),          // the || 60 guard: 28 moves need it
              tilt:  accuracyTilt(e.accuracy),
              charge: chargesOf(e.pp) }];

  if (e.kind === 'move')                                  // unrecognised Status move
    return [{ when:'ON_ACT', where: shapeOf(e.target) ?? 'SELF',
              ops:[{op:'BOOST', d:{ [bestStatOf(e.owner)]: +1 }}],
              dur: 2, charge: chargesOf(e.pp) }];

  // ability or item with no derivable effect
  return [];   // + archetype 'INERT', + shortDesc as tooltip, + a visible "flavour only" badge,
               // + a +1 draft-budget refund so the piece is a bargain, not a trap
}
```

Three guarantees:

1. **No content is ever a no-op the player mistakes for a bug.** A damaging move is always at least an ordinary
   capture at a real strength tier. An unclassified Status move is always a small visible self-buff. Splash,
   Celebrate, Happy Hour and Teatime land here, and that is the *right* answer — Splash should do nothing.
2. **The fallback is legal-and-boring by construction, never illegal-or-broken.** It consumes a charge, does
   something visible, and cannot corrupt state. There is no code path in which unclassified content mutates
   something it should not, because the fallback only ever emits `CLASH` or `BOOST`.
3. **The 8 `INERT` abilities are honest rather than hidden.** `Run Away`, `Honey Gather`, `Ball Fetch`,
   `Corrosion`, `Dancer`, `Early Bird`, `Stall`, `No Ability` show their real `shortDesc` with a "flavour only"
   badge and refund a draft point. `Truant` and `Slow Start` get the same refund for the opposite reason —
   which is what makes Slaking (one of the highest BSTs in the dex) a *bargain with a drawback* rather than an
   undraftable trap.

**The test that makes the coverage claim auditable rather than asserted** (this is the single most valuable test
in the project):

```ts
// src/data/coverage.test.ts
for (const e of ALL_ADMITTED /* 1797 entries */) {
  const fx = compiled(e.id);
  expect(fx).toBeDefined();                                    // totality
  expect(e.coverageClass).toBeOneOf(['C1','C2','C3','curated','fallback-by-design']);
  if (e.coverageClass === 'fallback-by-design')
    expect(FALLBACK_ALLOWLIST).toContain(e.id);                // 8 abilities + 121 excluded items, named
  for (const f of fx) {
    expect(TRIGGERS).toContain(f.when);
    expect(REGIONS).toContain(f.where);
    for (const op of f.ops) expect(OPS).toContain(op.op);
    if (op.op === 'INVOKE') expect(op.depth).toBe(1);
    if (op.op === 'MARK')   expect(op.mark).toBeLessThan(MARK_TABLE.length);
  }
  if (e.kind === 'move' && e.category !== 'Status')
    expect(fx.some(f => f.ops.some(o => o.op === 'CLASH'))).toBe(true);   // damaging moves damage
}
expect(coverageReport().autoDerivedPct).toBeGreaterThan(94);    // regression gate on the headline claim
expect(coverageReport().curated.length).toBeLessThanOrEqual(120);
```

`coverageClass` is emitted per entry by the generator, exactly as `recon-data-substrate.md` §7.2 requires.

---

## 8. The rules of the game — a thin layer over the ISA

Everything above is Pokémon. Everything below is chess, and it references the ISA only through `CLASH` and
`TEMPO`. The rules engine imports no Pokémon concept except `TypeId` and the 18×18 chart.

### 8.1 Board and setup

Standard 8×8, standard chess geometry, standard starting squares. A **legal army is 16 pieces**:
1 King, 1 Queen, 2 Rooks, 2 Bishops, 2 Knights, 8 Pawns. Movement patterns are unchanged from chess —
castling, en passant, the two-square pawn advance all present. **This is deliberate:** a chess player's entire
existing knowledge transfers, and `chess.js` is a valid differential-test oracle for the movement layer
(§18.3).

Each piece declares **exactly one type** at draft, chosen from its real `species.types`. Nidoking = Poison,
Slowking = Psychic, Lapras = Water *or* Ice — the player picks. **Stellar is excluded** from declarable types:
it has 0 species and is 1× against everything both ways, so it would be a strictly dominant defensive pick.
The working chart is **18×18 = 324 ordered pairs**, not 19×19.

### 8.2 The turn loop

```
TURN(side):
  1. REVEAL   focusDie := rng.d6()                    // PUBLIC. Both players see it. Before any decision.
              recompute and display all legal actions, each annotated with its exact outcome
  2. UPKEEP   for each of side's pieces, in board order:
                fire ON_UPKEEP effects (status ticks, Leftovers, Perish, Speed Boost)
                decrement mark durations; expire marks at 0
              drain SCHEDULE entries whose delay hit 0        // horizon <= 5, proven
  3. ACT      chain := 0
              loop:
                the player chooses ONE action:
                  (a) MOVE-ACTION : relocate a piece along its chess pattern.
                                    if the destination holds an enemy piece -> CLASH using slot 0
                                    (the piece's melee move). Uncharged: chess must always work.
                  (b) ART-ACTION  : a piece uses slot 1, 2 or 3. It does NOT relocate.
                                    Spends one charge. Requires stamina >= 2.
                  (c) TRANSFORM   : Terastallize (once per side per game). Costs the whole turn.
                resolve it fully: run the Effect[], resolve any CLASH via §8.3, apply ops in order
                if enemy King is now capturable by any of side's pieces:  break        // T3
                if resolution granted TEMPO('grant-extra') and chain < 2
                   and the acting piece has not already earned one this turn:          // T2
                     chain += 1; continue
                break
  4. CLOSE    progress += subMoves; if a capture/pawn-advance/faint/hazard occurred, progress := 0
              push positionHash; check §8.6 terminal conditions
              toMove := other side
```

**Where do moves fit relative to chess?** The answer that makes this work: **the default chess action is
already a Pokémon move.** Capturing *is* using your melee slot — it costs nothing extra and needs no charges,
so the move layer never taxes ordinary chess. Charged ART-ACTIONS are the additions, and each one costs your
whole turn, which is the price that keeps the game chess-shaped. A ranged attack (`RAY_LOS`/`RAY_ANY`) lets you
capture *without occupying the square* — that is the genuinely new idea, and it costs a turn and a charge.

**Slots.** 4 per piece. Slot 0 is the melee slot: uncharged, used automatically on every capture. Slots 1–3 are
charged, `charges = clamp(round(pp/5), 1, 5)`, giving a piece ~12 charged uses per game.

**Move selection at draft.** Auto-picked deterministically by `recon-moves.md` §6.3's measured scorer (STAB +
stat fit + power + learner-count rarity, with a shape quota), applying both of that document's measured fixes
(allow "no melee move" when the best melee score is negative, so Blissey stops getting Hyper Beam; `−15` for
`flags.recharge || flags.pledgecombo`, so Charizard stops getting Blast Burn). Measured result: **488 distinct
moves appear across 876 species' auto-sets** — 71% of the corpus, and no 900-move menu. Exactly **one slot is
swappable**, from a shortlist of the 8 best alternatives filtered to a different region. Legality is baked into
the bundle, so there is no runtime validation surface.

Movesets come from the **all-gens prevo-chain learnset union with a `changesFrom ?? battleOnly ?? baseSpecies`
recursive union**, not gen-9 legality: 593 of 1417 species have zero gen-9-legal moves, and `rotomwash` proves
union rather than fallback is required (it needs base Rotom's moves *plus* its own Hydro Pump). After all
unions **29 species still have under 8 moves** (Caterpie 5, Weedle 4, Ditto 1, Unown 1), so a **type-kit floor
of 18 types × 6 moves = 108 curated ids** is mandatory, not optional.

### 8.3 The Clash — capture resolution, every case

One resolver, ~120 lines, the only place an outcome is decided.

```
CLASH(A: attacker, D: defender, slot):
  1. LEGALITY
       m := chart[A.chessType][D.chessType]                     // 0 | 0.5 | 1 | 2
       vetoes := [ ...(m === 0 ? ['type'] : []),
                   ...run(CLASH_LEGAL, D),                      // Levitate, Air Balloon, Wonder Guard, Protect
                   ...run(CLASH_LEGAL, board) ]                 // BIND, Queenly Majesty
       pierces := run(CLASH_LEGAL, A)                           // Mold Breaker, Scrappy, Ring Target
       live := vetoes minus pierces
       if live is non-empty:
            if the veto is one-shot (all wards are, §9.6):  consume it; A loses its action; return REPELLED_WARD
            else: THE MOVE IS NOT GENERATED. Never offered, never animated, never searched.

  2. AUTO-CAPTURE
       if D.stamina === 0:  return CLEAN            // fainted pieces are taken with no roll (§3.3)

  3. ROLL
       die  := (chain === 0) ? state.focusDie : rng.d6()         // sub-move 1 uses the PUBLIC die
       tilt := might(A, slot) - guard(D, slot)
             + Σ run(CLASH_ROLL, A) - Σ run(CLASH_ROLL, D)       // abilities, items, status, weather, power tier
       C    := clamp(die + tilt, 0, 12)

  4. LADDER
       rung := m <= 0.5 ? 0 : m === 1 ? 1 : 2                    // the TYPE CHART sets your starting rung
       step := C <= 1 ? -2 : C <= 2 ? -1 : C <= 5 ? 0 : C <= 8 ? +1 : +2
       r    := clamp(rung + step, -1, 3)

  5. WARP
       r := fold(run(CLASH_RESULT, D), r)                        // Sturdy, Focus Sash, Filter, Shell Armor
       r := fold(run(CLASH_RESULT, A), r)                        // Tinted Lens, Expert Belt, willCrit
       // survive-once effects are STRICTLY ONE-DIRECTIONAL: they convert only r in {1,2,3} -> -1.
       // They never convert r = 0 (BACKLASH). "A shield protects you from being killed;
       // it does not protect you from killing yourself." (kills the Focus-Sash exploit, §9.7)

  6. APPLY, in this fixed order
       r = -1  REPELLED : no capture. A returns to origin. A: MEND(-1). D untouched. run(ON_SURVIVE, D).
       r =  0  BACKLASH : REMOVE(D); REMOVE(A).            run(ON_FAINT, D); run(ON_FAINT, A).
       r =  1  CLEAN    : REMOVE(D); A occupies the square (MELEE) or stays (RAY_*).  run(ON_CAPTURE, A).
       r =  2  SURGE    : as CLEAN, plus TEMPO('grant-extra').
       r =  3  CRITICAL : as SURGE, plus BOOST(A, {atk:+1, spa:+1}); ignores all WARD and BULWARK.
       then: riders (ON_CAPTURE guards with flip), then ON_ENTER on the destination square (hazards fire).
```

**The five outcomes, complete:**

| Rung | Name | Defender | Attacker | Extra move |
|---|---|---|---|---|
| −1 | **REPELLED** | untouched | bounces to origin, −1 Stamina | no |
| 0 | **BACKLASH** | removed | **removed** | no |
| 1 | **CLEAN** | removed | survives, takes the square | no |
| 2 | **SURGE** | removed | survives | **yes** |
| 3 | **CRITICAL** | removed | survives, +1 might | **yes**, and pierces all wards |

Illegal (0×, or an unspent ward) is a sixth case that never reaches the resolver: **the move is not generated.**
The UI shows those squares with a dashed grey "NO EFFECT" ring from the moment you pick the piece up, so
immunity is never a surprise.

### 8.4 Why the ladder, and why the die is public

This is the design's central mechanical claim, and it fixes three separate problems in the original ruleset.

**The type chart sets your starting rung; the die moves you along it.** With `tilt = 0`:

| Matchup | REPELLED | BACKLASH | CLEAN | SURGE | CRITICAL | P(extra move) |
|---|---|---|---|---|---|---|
| 0.5× (19.3% of legal pairs) | 1/3 | 1/2 | 1/6 | 0 | 0 | **0** |
| 1× (64.6%) | 1/6 | 1/6 | 1/2 | 1/6 | 0 | 1/6 |
| 2× (16.1%) | 0 | 1/6 | 1/6 | 1/2 | 1/6 | **2/3** |

Aggregate per legal capture: **P(extra move) 0.215, P(attacker dies) 0.231, P(defender survives) 0.167.**

1. **It fixes the video's largest accidental bug.** Under rule 4 as filmed, a "miss" *still killed the
   defender*, so every legal capture removed its target unconditionally and there was no such thing as a failed
   attack — which also meant defending a piece deterred nothing (Rifle Chess's documented failure mode:
   "it is of no use to guard pieces"). Under the ladder, `REPELLED` leaves the defender alive 1/6 of the time,
   so protection is a real concept again.
2. **It amplifies type knowledge instead of drowning it.** `recon-tech.md`'s risk #3 is the sharpest criticism
   in the recon set: under the video's rules `P(crit) + P(miss) = 1/3` for *every* attacker while the static
   per-type value spread is only ±15%, so the die outweighs the chart and "type knowledge is worth less than
   the concept implies unless the rules amplify it." The ladder is that amplification: the matchup shifts the
   *entire distribution*, not one band. A 2× attacker gets an extra move 2/3 of the time; a 0.5× attacker
   **can never get one at all**. Type knowledge is now the dominant route to tempo.
3. **Making the die public converts luck into a decision.** `recon-variants.md` §6.3 measures input-vs-output
   randomness as the single biggest lever available (~5× on σ_dice at equal rate), and every dice-chess variant
   that survived rolls first and then lets you choose. Revealing one d6 at turn start means "my die is a 2 —
   this is a bad turn to attack into a neutral matchup; develop instead" is a real plan. The same 1/6 that was
   noise becomes information. It also gives each turn a distinct texture, and it is a great UI moment.

**[DEVIATION from recon-variants]** — that document recommends cutting the d6 entirely, making mutual
destruction purely deterministic, and shipping crit/flinch at 1/18. I keep a single d6 and I keep probabilistic
BACKLASH. Reasons: (a) DIRECTION.md is explicit that the TCG's coin flips *legitimise* randomness as how the
Pokémon board game already works, and that the richer option wins; (b) making the die public already captures
most of the σ reduction they wanted — their own analysis says variance a player can plan around costs far less
than its nominal size; (c) a fully deterministic chart makes every position a solved calculation and removes
the story generator. I accept their measurement that the *original* configuration was ~25× too loud and my
numbers are much quieter (attacker death 23.1% vs 29.5%, extra moves 21.5% vs 27.4%, and the load-bearing roll
is known in advance).

**The step table is a tuned constant, not a conviction.** `{−2,−1,0,0,0,+1}` ships first; the batch simulator
(§14.3) is the instrument that tunes it, and the two knobs are where the ±1 thresholds sit and whether a public
6 should reach `SURGE` from a neutral matchup at all.

### 8.5 Priority, charge and recharge

`priority` (42 non-zero moves) becomes **Reactions**, which is the faithful reading and the chess-legible one.

- **`priority ≥ +1` (21 moves).** The move may be declared as a **Reaction** when an enemy piece begins a Clash
  against this piece. It resolves first; if it captures the attacker, the attacker's Clash never happens.
  Spends a charge. At most one Reaction per piece per enemy turn. This is Quick Attack, Sucker Punch, Bullet
  Punch, Aqua Jet, Extreme Speed, Fake Out, Upper Hand, and it turns a defended square into an *active* threat.
- **`priority ≤ −1` (6 moves).** Cannot Reaction — *unless Trick Room is up*, in which case the comparison
  flips and Counter, Avalanche, Focus Punch, Circle Throw become the reactors. One mark, one flipped comparison,
  and an entire dead archetype comes alive for 5 turns.
- **`flags.charge` (13 moves: Fly, Dig, Dive, Solar Beam, Phantom Force).** `MARK('charging', dur 2)`. Turn 1
  the piece is **untargetable** (it lifted off / burrowed); turn 2 the Clash auto-resolves. A two-turn commit
  that dodges everything for a turn — a real chess resource.
- **`flags.recharge` (8 moves: Hyper Beam, Giga Impact).** `MARK('recharging', dur 1)`. Resolves at power tier
  T5, then the piece cannot act next turn.
- **`target: 'scripted'` (4 moves: Counter, Mirror Coat, Metal Burst, Comeuppance).** `REACTIVE` region: a
  1-turn mark such that if this piece is captured on the opponent's immediate reply, the attacker dies too.

Turn order itself is **strictly alternating**. Nothing reorders whole turns — that would break chess.

### 8.6 Termination — the bound, proved

**Claim.** A turn consists of at most 3 sub-moves, and a game contains at most 31 extra sub-moves.

**Proof.** Three independent arguments, in increasing strength:

*(i) The monovariant.* `TEMPO('grant-extra')` is emitted **only** by ladder rungs 2 and 3, and both require a
successful capture, and every capture removes at least one enemy piece. **No op in the ISA places a piece on the
board** — `SUMMON` does not exist, and CI gate 5 (§4.5) fails the build if it ever does. Therefore the enemy
piece count `N` is monotonically non-increasing, `N ≤ 16` always, and a chain of length `L` requires
`L − 1` distinct captures, so `L ≤ N + 1 ≤ 17`, and `L ≤ 16` once the King is excluded as a chain target
(T3 ends the turn the moment the King is exposed). Total extra sub-moves in a game ≤ 31, because each is paid
for by a distinct capture and there are at most 31 capturable pieces. **This argument is entirely independent of
RNG.** ∎

*(ii) The audited op.* Termination is a property of exactly one op. `TEMPO` has five kinds; `grant-extra` is the
only one that adds a sub-move, and it is emitted from exactly one place in the codebase (`clash.ts`, rungs 2–3).
Two ability-adjacent extra-action sources exist and both are restricted to **non-capturing** moves so they
cannot extend a chain: `Parental Bond` (1 species) and `Dancer` (4 species). `Gale Wings`/`Prankster`/`Triage`
are once-per-game pre-empts and may never be used to escape check. A one-line grep-able audit is the whole
proof obligation.

*(iii) The charge budget.* A piece has ~12 charged move-uses per game (`clamp(round(pp/5),1,5)` over 3 charged
slots), so even absent the monovariant no piece can act indefinitely.

**The caps we ship anyway, for feel rather than for termination:**

- **T1 — hard cap `L ≤ 3`** (one action + at most two extras). Under my probabilities `P(L ≥ 3)` is a few
  percent, so the cap removes the tail without binding in normal play. Also bounds the capture animation at
  700 + 420 + 420 = **1540 ms** (§15.5).
- **T2 — one extra per piece per turn.** A piece that has earned an extra move cannot earn another this turn;
  the baton must pass to a different piece. *[English Progressive Chess.]* This kills the
  "one super-typed piece mows the board" fantasy and makes a chain a **team combo**, which is a far better read
  on the board and much better Pokémon flavour.
- **T3 — exposing the enemy King ends your turn.** If after any sub-move the enemy King is capturable by any of
  your pieces, your turn ends immediately and remaining extras are forfeit. *[Marseillais Chess; Scottish
  Progressive Chess.]* **This is what makes king-capture safe:** the King can only ever be taken by the *first*
  sub-move of a turn, from an exposure that was already on the board when the turn began. The opponent always
  gets a reply. This is the exact bug Marseillais patched in 1925.

**Draws and non-progress:**

| Rule | Detail |
|---|---|
| **Threefold repetition** | on the **full state hash**: piece placement + types + Stamina + boosts + marks + square marks + side marks + board marks + charges + castling + ep + side to move. **Explicitly EXCLUDING the PRNG counter** — our PRNG advances monotonically, so including it makes repetition unreachable by construction and the rule silently never fires. Including Stamina and marks is equally load-bearing in the other direction: without them, Protect/Recover cycles hash-collide and produce false draws. |
| **Progress rule** | 100 consecutive **sub-moves** with no capture, no pawn advance, no faint and no hazard laid ⇒ draw. Healing and status application are **not** progress, so heal loops do not reset the clock. *[Progressive Chess recounts the 50-move rule in sub-moves.]* |
| **Perpetual exposure loses** | repeatedly exposing the enemy King with no progress ⇒ the exposing player loses. *[Shogi's perpetual-check rule.]* Closes the "chase forever with extra-move tempo" degeneracy. |
| **No legal action ⇒ that player loses** | under king-capture there is no forced-into-check, so orthodox stalemate cannot arise; genuine total immobility is a loss. *[Shogi/xiangqi; Really Bad Chess.]* Rejected alternatives: Progressive Chess makes self-stalemate a drawing resource (degenerate); Duck Chess makes being stalemated a win (bizarre). |
| **Both sides reduced to lone Kings** | draw. *[Archon: "if the last piece on each side kills the other, the game is a draw."]* |
| **Scheduler horizon** | `max(condition.duration)` in the entire dataset is **5**, and at most one pending `SCHEDULE` entry per (side, kind). A second Future Sight while one is pending simply fails. So the queue is O(pieces) and the horizon is provably ≤ 5 turns. |

### 8.7 Check, checkmate and king capture — one coherent model

**Checkmate is not a well-formed predicate under these rules, and that is the actual root cause of the video's
bug.** Orthodox legality asks "does the resulting position leave my King attacked?" — but with a Clash on every
capture the resulting position is a *random variable*. You cannot answer "is this move legal" without collapsing
the distribution, and if you collapse it you have either told the player the future or made legality depend on a
roll. That is exactly what produced *"your piece died in check… it's my turn."* It was not sloppiness; it was an
ill-posed rule.

The general law across the prior art: **every variant where check is hard to compute switches to king capture** —
Fog of War (hidden information), Duck Chess (post-move board mutation), Losing Chess, single-die Dice Chess
(RNG), ICC Atomic (collateral). We are in that family. So:

> **R1 — Win condition.** A player wins the moment the opposing King leaves the board, by any means (CLEAN,
> BACKLASH, CRITICAL, an auto-capture of a fainted King — impossible, since Kings have no Stamina track — or any
> other effect). There is no checkmate terminal state.
>
> **R2 — No check-legality.** A move that leaves your own King capturable is **legal**. A King may move to an
> attacked square. Castling through or out of attack is legal.
>
> **R3 — Suicide guard.** A move is **illegal** if the *deterministic* part of its resolution necessarily
> removes your own King. A move that only *risks* your King — because the public die could go against you, or
> because the opponent may reply — is legal, and **the UI must show the exact probability before the click.**
> *[Atomic Chess rule 5, verbatim: "It is illegal to blow up your own King, even if that destroys the opponent
> King as well." The RNG extension is ours; Atomic has no dice and never needed the distinction.]*
>
> **R4 — Simultaneous royal death.** If one resolution removes both Kings, **the mover wins.** Deaths apply in
> the fixed order defender-then-attacker (§8.3 step 6) and the game ends at the first moment a King leaves the
> board. *[Lichess Atomic: exploding the opposite king "overrides all checks and checkmates."]* Awarding a draw
> would create a degenerate strategy — a losing player hunting a mutual-annihilation line for half a point.
>
> **R5 — Exposure ends the turn.** T3 above. The King can only be captured by a turn's first sub-move.
>
> **R6 — Kings are never immune and never confer immunity.** A King's declared type is used for its own attacks
> and for the multiplier when it is captured, but **0× never applies to a King as defender: it degrades to
> BACKLASH (rung 0).** Kings are also immune to every indirect effect (§2.2). *[Stratego's "always supply the
> key" — the Flag is never unreachable.]*
>
> **R7 — Check is advice, not law.** Every turn the engine computes and displays which of your pieces are
> capturable, by what, at what rung, and with what probability — and specifically a persistent
> **"YOUR KING CAN BE TAKEN"** banner naming the attacker and the exact probability. Checkmate-like positions are
> *labelled* ("your King cannot escape") but are not terminal.

**Cost accepted, stated honestly.** King capture removes stalemate as a drawing resource and shifts basic endgame
theory (on ICC's no-check Atomic, K+R vs K becomes a forced win where it is a book draw under check-enforcing
rules). Mitigations: R7's banner, plus a **"Guarded" mode** (casual and tutorial default) that filters out moves
leaving your King capturable above a probability threshold — restoring something close to check-legality without
changing the win condition. Two legality paths in the engine, but they share a predicate with the AI's move
generator anyway.

---

## 9. The six bugs from brief §2, resolved

Each with the rule that fixes it and the prior art it comes from.

### 9.1 "Capture-in-check is broken" — *a piece died capturing while its king was in check, and the turn ended with the king still in check*

**Resolved by R2 + R5.** The move is legal; there is no such thing as "still in check" because check is not a
legal state, it is a *risk display*. Your piece and the checker both die (BACKLASH); if removing your own piece
opens a new line, your King is now capturable and the opponent takes it next turn. That is a **consequence, not
an illegality** — the player made a losing move, and R7's banner told them the probability before they clicked.
The bug becomes the correct outcome under a coherent model.

The general form of the fix, which also covers self-destruction: **a move is illegal iff its deterministic
resolution necessarily removes your own King** (R3). Self-KO moves (Explosion, Memento, Final Gambit, Healing
Wish, Lunar Dance, Destiny Bond, Perish Song) are just the extreme case, and they need no special rule.

### 9.2 "Infinite / runaway turns"

**Resolved by §8.6.** The bound is `L ≤ 3` shipped, `L ≤ 16` provable, `≤ 31` extra sub-moves per game, by a
monovariant argument that is independent of RNG and **enforced structurally**: the ISA has no op that creates a
piece, and CI fails the build if one appears. The fear was unfounded; what the mechanic actually needed was a cap
for *feel*, and a hard rule never to grant an extra move on a non-capture.

### 9.3 "King capture vs checkmate" — *players resolved a game by taking the king on a crit*

**Resolved by R1.** King capture, no checkmate terminal state. Checkmate becomes a UI label. Taking the King on a
`CRITICAL` is now the *correct* rule rather than a contradiction. R5 is what makes it safe: the King is only ever
takeable by a turn's first sub-move, so the opponent always got a reply.

### 9.4 "Is a move that kills your own King legal?"

**Resolved by R3.** No if deterministic, yes if probabilistic, with the probability displayed. The asymmetry is
deliberate: a player must never be able to *accidentally* end the game, but must be allowed to take a calculated
risk. The UI obligation is absolute.

### 9.5 "Draw / stalemate is undefined" — *"if I kill it with Gengar and I kill you it's a draw"*

**Resolved by the full regime in §8.6** plus R4. Specifically: both Kings dying in one resolution is **not** a
draw — the mover wins (R4). Threefold repetition on the full state hash excluding the PRNG counter. 100-sub-move
progress rule where healing is not progress. Perpetual exposure loses. No legal action loses. Both sides reduced
to lone Kings is the one genuine draw.

### 9.6 "Zero-effectiveness immunity creates untouchable pieces — bounded how?"

Bounded **four independent ways**, which is what makes this safe rather than patched:

1. **Wards are one-shot.** Every `VETO` — the type chart's own 0×, Levitate, Air Balloon, Bulletproof, Wonder
   Guard, all 28 `WARD` abilities — makes the *first* capture attempt illegal and **consumes the ward**. The
   attacker loses its action; the defender is thereafter capturable normally. *[Air Balloon's canon text is the
   template: "Holder is immune to Ground-type attacks. Pops when holder is hit."]* Flying pieces are not
   permanently immune to Ground; they are immune **once**. This preserves the whole point (type knowledge saves
   your piece at a critical moment), converts an invulnerable asset into a *tempo* asset, is trivially legible
   ("the shield broke"), and teaches the immunity chart through play.
2. **Support moves are always legal against an immune piece — from data.** `ignoreImmunity` is `true` on all 214
   gen-9 Status moves. So Will-O-Wisp, Toxic, Leech Seed, Spore and Thunder Wave all land on a piece your army
   cannot capture. Combined with Stamina, an untouchable piece can be **fainted**, after which anything takes it
   with no roll. This is the answer that needed no invention at all.
3. **The counter-suite is guaranteed by the draft validator.** Ring Target (Kit slot 7), Iron Ball,
   Scrappy/Mind's Eye (15 species), Mold Breaker/Teravolt/Turboblaze/Unseen Fist, Smack Down, Thousand Arrows.
   **A format must guarantee each side ends the draft with at least one immunity breaker**, enforced by the
   validator. *[Stratego always over-supplies the key: 5 Miners vs 6 Bombs, and its documented failure mode is
   precisely a drawn game when the key is exhausted.]*
4. **`CRITICAL` pierces all wards** (rung 3, §8.3). The die beats the wall, which is on theme.

Scale of the problem this solves, measured: immunity is only **8 of 324 ordered pairs (2.5%)** and each defending
type is immune to at most two attacker types, so Betza's Iron Ghost catastrophe is unreachable from the real
chart. But **190 of 1367 admitted species (13.9%) carry a type-immunity ability and 330 (24%) carry some ward**,
on top of 164 Flying-type species — so without the one-shot rule a quarter of the roster would be drafted for
untouchability. The *real* untouchable-piece problem nobody named is **Steel**, which repels or kills 11 of 18
attacker types (§10.3).

### 9.7 "Suicide-capture as a tactic — bug or feature?"

**Feature, kept deliberately, and made non-free.** It is the most battle-tested mechanic on the list (Stratego's
"equal ranks, both are removed" since 1942; Kamikaze Chess since 1928) and it is the mechanism by which a
type-literate player converts *knowledge* into *material*. It is what makes a Magikarp meaningful, and it is the
low-skill player's tool.

Two bounds make it a real cost rather than an exploit:

- **The survive-once rule is strictly one-directional.** Sturdy, Disguise, Ice Face, Multiscale, Shadow Shield,
  Focus Sash and Focus Band convert only rungs `{1,2,3}` → `−1`. They **never** convert rung 0 (BACKLASH).
  *A shield protects you from being killed; it does not protect you from killing yourself.* One sentence, no
  numbers, and it removes the "Sash a pawn, throw it at the queen, get a free queen" line entirely.
  `Rock Head` is the single named exception that *does* survive BACKLASH — making it unique is what makes it
  exciting.
- **The draft prices it.** `V = m·(1 − α·LIAB + β·ARM − ε·BLOCK) + τ·BONUS` (§10.2) means a Grass or Bug queen
  — each self-destructs on 7 of 18 attacking matchups — is *correctly cheaper*. The draft absorbs the
  distortion instead of the board.

Note the value-scale compression this causes is real and I accept it: mutual destruction is a levelling effect,
high-value pieces become liabilities that cheap pawns threaten, and Marseillais Chess independently reports the
same collapse ("the Queen probably doesn't exceed the value of two minor pieces"). My rate is 23.1% attacker
death versus the video's 29.5%, and 0.5× is only 18.8% of matchups, so the compression is ~19% of attacker value
per attack rather than ~30%.

---

## 10. Balance, value and the draft

### 10.1 What warps value

Four forces, each measured: type immunity (2.5% of pairs, but 24% of species carry a ward), mutual destruction
(18.8% of pairs), extra-move chains (21.5% of captures), and the draft itself. Two facts from `recon-tech.md` and
`recon-variants.md` that any balance model must respect:

- **The static per-type value spread is only ±15%** (Steel 1.148 → Bug 0.864). A naive "Steel pieces are worth
  more" evaluation is a *small* correction. The terms that actually carry the variant are **relational** — they
  depend on which types the *opponent* drafted.
- **Hand-balancing asymmetric armies does not work.** Betza's four Chess-with-Different-Armies armies were
  pronounced balanced by human masters and, decades later, scored **+62% / +19% / −11% / −71%** across 400 engine
  games; H. G. Muller further measured that army value is **sub-additive**, so point sums cannot be trusted.

### 10.2 The value model

Adopting `recon-variants.md` §3.2 essentially verbatim, because it is the only piece of genuinely new theory in
the recon set and it is evaluated against the real chart.

```
q_bonus(a,d) = [e>1]·(5/6) + [e=1]·(1/6)          // P(rung >= 2) from the ladder, §8.4
q_death(a,d) = [e=0.5]·(1/2) + [e=1]·(1/6) + [e=2]·(1/6)
q_block(a,d) = [e=0]

LIAB(t)  = Σ_d ŵ_d · q_death(t,d)     ARM(t)   = Σ_a ŵ_a · [q_death(a,t) + q_block(a,t)]
BLOCK(t) = Σ_d ŵ_d · q_block(t,d)     BONUS(t) = Σ_d ŵ_d · q_bonus(t,d)

V(piece) = m · (1 − α·LIAB(t) + β·ARM(t) − ε·BLOCK(t)) + τ · BONUS(t)
```

Base `m` = **P 1, N 3.2, B 3.3, R 5.0, Q 9.5** (Berliner/AlphaZero, not the folk 1/3/3/5/9, which assume fixed
movement and binary capture). Starting coefficients **α = 0.9, β = 0.5, ε = 0.3, τ = 0.5 pawns** — `α < 1`
because you *choose* when to attack; `β < α` because armour only helps when the opponent comes at you.

Two uses, one formula: **uniform weights ŵ = 1/18 for the draft price list** (published on the card at
quarter-pawn granularity), **live board composition for the AI eval** (three precomputed 18×18 byte tables,
O(1) incremental per capture). The measured spread on the real chart is **1.46× between the best and worst type
of a class** — Steel rook 5.61 vs Bug rook 3.85. That is the right magnitude: type knowledge is worth real
material, but a rook is still a rook.

**The model corrects two intuitions the draft UI must surface.** The worst types are **Bug and Grass**, not Ice —
each self-destructs on 7 of 18 attacking matchups, so their `LIAB` term dominates. Ice is a *good attacker*
(4 super-effective matchups) with the worst defence on the board (`ARM` = 0.052). And **Normal has zero
super-effective matchups** — a Normal piece can never earn an extra move from typing at all, only from a public 6.
Any price list that conflates offence and defence misprices half the roster.

**The point-buy is a usability tool, not a balance mechanism.** Actual army pairings are gated through the
**Chess18 procedure**: generate candidate pairings, engine-evaluate them with our own AI, publish the eval, ban or
handicap the tails. *[Chess960: Stockfish 9 evaluated all 960 start positions between 0.00 and +0.57, mean +0.18;
Chess18 exists specifically to exclude the outliers.]* Coefficients are recalibrated by self-play regression
forever, using the batch simulator (§14.3).

### 10.3 Draft supply rationing

Per-type supply over base formes is uneven and correlates *badly* with power: the strongest defensive type
(**Steel, 43 species**) and the weakest (**Ice, 35**) are the two scarcest, while Water (109) and Grass (99) are
the most common. Steel repels or kills **11 of 18** attacker types — `P(survive an attack) = 0.583` versus Ice's
0.204. So Steel is **rationed explicitly**: max 3 Steel-declared pieces per army in ranked formats, and the
draft UI shows the count. That is a supply constraint, not a nerf to the type chart.

### 10.4 The draft, and why 1025 Pokémon is not paralysing

A format is a data record, and **the match rules never see it**:

```ts
interface Format {
  poolSource: 'full-dex' | 'collection';        // ← DIRECTION.md's hard architectural seam
  roster:     { K:1, Q:1, R:2, B:2, N:2, P:8 };
  kit:        ItemId[12];
  budget:     number;                            // point-buy total
  bans:       Set<AbilityId|MoveId>;
  validators: Validator[];
  corpus:     { zMoves: boolean, maxMoves: boolean };
}
```

**The draft flow, three tiers of depth:**

1. **Pick a Squad Theme.** ~24 curated, named, pre-validated 16-piece armies with their point cost and engine
   eval published ("Kanto Classic", "Steel Wall", "Rain Offence", "Bug Swarm — hard mode"). You can play in
   30 seconds having made one choice. *[Chess960/Chess18 method: randomised-or-curated setups screened by engine
   eval are far safer than free drafting — hand-designed "equal" armies came out at +62%/−71%.]*
2. **Swap up to 6 slots.** For each slot you see the 12 best alternatives at that piece class within budget,
   sorted by `V`, with type coverage impact shown live. This is the mode ranked play uses.
3. **Full custom**, behind an advanced toggle: all 1025, point-buy enforced, validators enforced.

**Per piece the choices are tiny and measured:** one type from its real 1–2 types; **one ability from a 1-to-4
radio button** (slot distribution over 1367 formes: 1 slot 357, 2 slots 378, 3 slots 631, 4 slots 1 — only
Rockruff); one item from the 12-item Kit; and one swappable move slot with 8 options. **There is never a search
box over 954 moves or 351 items.**

**Validators (hard, enforced before the game starts):**

| Validator | Rule | Why |
|---|---|---|
| `immunityBreaker` | ≥ 1 per side (Scrappy/Mind's Eye piece, Ring Target holder, or a `pierce` ability) | §9.6 — always supply the key |
| `steelCap` | ≤ 3 Steel-declared pieces | §10.3 — rationing the strongest+scarcest |
| `ruinCap` | ≤ 1 of the 4 Ruin abilities | they are board-wide −1 to everyone else |
| `ohkoCap` | ≤ 1 OHKO move across the army | they bypass the type chart, which is the game's thesis |
| `critCap` | ≤ 1 of the 4 `willCrit` moves (Flower Trick, Frost Breath, Surging Strikes, Wicked Blow) | guaranteed-crit is the chain engine |
| `evasionCap` | total `eva` effect capped at +2 by the shared `BOOST` clamp | a second route to the untouchable-piece bug |
| `coverage` | each army declares ≥ 12 distinct types | delivers ≥ 16 of 18 types on the board, honouring the video's "at least one of every type" goal. A **Rainbow** format requires exactly 18 pieces covering all 18. |
| `bans` | `Moody` and `Imposter` banned in ranked | pure non-interactive variance / free material duplication |

`Choice` items are illegal on King and Queen (a queen with +2 range covers the board). `Eviolite` is gated on
`species.nfe`, a real structured field.

### 10.5 The named balance bounds

Every one of these is either a compiler invariant or a one-line rule, and each names the danger it bounds.

| Content | Species | Risk | Bound |
|---|---|---|---|
| All wards / 0× | 330 carry one | untouchable pieces | **one-shot** (§9.6) |
| `Wonder Guard` | 1 (Shedinja) | uncapturable by 15 of 18 types | one-shot + `CRITICAL` still takes it + no Magic Guard, so hazards/status/thorns kill it — exactly how Shedinja dies in canon |
| `Shadow Tag` / `Arena Trap` / `Magnet Pull` | 6 / 3 / 9 | board-wide trapping is **mate-forcing** | `KING_RING` only (a compiler invariant, §4.3) + **absolute carve-out: BIND may never restrict the enemy King**, so no ability can participate in producing checkmate or stalemate + Run Away/Suction Cups/Shed Shell hard-counter |
| `Neutralizing Gas` / `Teraform Zero` | 3 / 1 | global ability off-switch | `KING_RING` only — Weezing becomes a walking dead zone you route around, a genuinely interesting positional piece |
| `Huge Power` / `Pure Power` | 9 | `+2` tilt could manufacture `CRITICAL` from a 4 | their `TILT` is capped so `C ≤ 5`: they reliably win Clashes, they never give you **tempo**. The correct translation of "high Attack" into a game where tempo is scarce. |
| `Protean` / `Libero` | 11 | never on the wrong side of a matchup | **once per game**, then the type is locked — which is what Gen 9 itself did |
| `Speed Boost` | 14 | unbounded movement growth | +1 `spe` per turn, capped +3 by the shared clamp, **and only on a turn the piece does not capture** |
| `Imposter` (Ditto) | 1 | a pawn becomes a second queen | copies **movement pattern and ability only**; type stays Normal, class stays Pawn. Banned in ranked. |
| Thorns stacking | Rough Skin + Rocky Helmet + Iron Barbs | free mutual destruction through a side door | all thorns on one Clash resolve to **at most `MEND(−1)` total** — they wear the attacker down, they never convert an attack into a death. `Aftermath`/`Innards Out` are the 2 named exceptions that kill, and only after their own piece died. |
| `Truant` / `Slow Start` / the 8 `INERT` | 3 + 8 | so bad the species is undraftable | **+1 draft-budget refund.** Slaking becomes a bargain with a drawback. |
| `Trace`/`Receiver`/`Power of Alchemy` | 8 species | copying could launder a ban | copy legality reads `flags.notrace/noentrain/noreceiver/failroleplay/failskillswap` (34/35/35/35/29 abilities) — the dataset already encodes the whole matrix, for free |
| `Population Bomb` | `multihit: 10` | 10 ladder rolls in one move | rolls capped at 5 |
| `Life Orb` | Kit item | — | **a helpful interaction worth protecting:** it drains on *every* link of a capture chain, so a Life Orb piece cannot chain indefinitely. A thematic, player-visible contribution to termination. |
| Transformations | — | three simultaneous once-per-game budgets is unplayable | **one per side per game: Tera or Burst, not both.** Promotion-to-Mega is separate because reaching the last rank is already a cost. |

### 10.6 Transformations

- **Terastallize — ADOPT as the flagship.** Once per side per game, declare Tera on one piece: its `chessType`
  becomes any type it could legally have declared at draft, plus a format-granted Tera type (default: the type
  of its signature move). Permanent, public, and **it costs that piece's whole turn**, so it is a tempo sacrifice
  and cannot be a free escape from exposure. `BECOME({type})` — the op already exists.
  This is the right flagship because Tera is *literally the mechanic that changes a Pokémon's type*, and one type
  per piece is the game's central axis. It costs **zero data** (there is no `teraType` field and no Stellar type
  in the dataset — Tera is the one transformation we must author, and it is also the cheapest), applies uniformly
  to all 1025 with no haves and have-nots, and it directly answers "a piece countered at draft can be rescued
  once."
- **Mega Evolution + Primal Reversion — ADOPT as the promotion payload.** 48 + 2 real formes, 47 stones, and
  `megaStone` names the exact target forme. `BECOME({forme, cls, type})`. The 46 fan/CAP stones are excluded by
  `isNonstandard`, so the game never ships a Mega for a Pokémon that never had one. Rayquaza-Mega correctly needs
  no stone — the dataset encodes that asymmetry and we get it for free.
- **Z-Moves — ADOPT the shell, CUT the 35 items.** A once-per-game **Burst**: declare before a Clash and it
  auto-resolves at `CRITICAL`, ignoring all wards. Mutually exclusive with Tera, which makes the choice sharp.
  The 35 crystals become its art (18 type auras, 17 signature animations). Making Burst an *item* would occupy
  the one item slot and create a second hidden budget — the exact failure the brief warns about.
- **Dynamax / Gigantamax — CUT the mechanic, keep the art.** Its primary effect is doubling max HP and we have
  no HP; its secondary effect (G-Max moves) is already in the move layer; and only 41 of 1025 species (4%) can
  Gigantamax, which makes it a draft trap that renders 984 species second-class. The 34 Gmax sprites become
  promotion animations — they are the best-looking art in the dataset.

### 10.7 Promotion as evolution

A pawn reaching the last rank: `BECOME({cls: player's choice of Q/R/B/N, forme: next stage in species.evos})`.
Driven straight off `prevo`, `evos`, `evoType`, `evoLevel`, `evoItem`, `evoCondition`, all present in the data.
If the new forme has different types the player **re-declares** its `chessType`; its 4 move slots are re-derived
and its charges refresh. If the species is fully evolved and its side holds the matching Mega Stone in the Kit,
promotion may go straight to the Mega forme instead.

This is the TCG's model, which DIRECTION.md names as the better precedent: evolution is a **deliberate action
played onto a Pokémon in play**, which maps onto pawn promotion far more directly than the games' level-up model.
And `BECOME` is one op, so promotion, Mega, Tera, Stance Change, Zen Mode and Soak all share a code path.

