# Pokémon Chess — Design Specification: **The Effect Compiler**

**Author role:** game designer, systems / compiler-first philosophy.
**Status:** complete implementable proposal — **second pass**. Deviations from a recon document are marked
**[DEVIATION]** with a reason. Deviations from an earlier proposal, *including from the first pass of this
same document*, are marked **[SUPERSEDES]**.

**Process note, stated up front because it affects how to read the numbers.** A first pass of this document
existed (2 587 lines, written by an earlier pass of this same role) before `DIRECTION.md` gained its
**tutorial** section (directive 7, `git diff` shows +44 lines added after the first pass was written). This
delivered document is a **merged second pass**: I read the first pass in full, **re-measured its central
claim myself with my own scanner rather than trusting it**, kept every verified finding, and made five
substantive changes. Nothing was dropped. The five changes:

1. **§10.7–§10.13 — the tutorial**, which directive 7 now requires as a shipped feature and which the first
   pass covered in two lines. It is designed here as *data over the ISA*, which is the only reason it is cheap.
2. **Four real defects in the first pass's Clash resolver**, found by re-deriving it (§7.5): a **sign error on
   damage counters**, a `min()` clamp that silently made **31 measured defence-lowering moves inert**, a
   Confusion check written against the wrong actor, and R6's King rule not wired into the legality step.
3. **The Charge counter** (§7.9a), adopting `recon-tcg.md`'s Energy-Zone recommendation, which retires the
   first pass's own highest-severity open risk ("the ART action economy is the number I am least sure of").
4. **T3 refined to *newly created* exposure** (§7.12), with the safety invariant restated and proved — the
   first pass's version silently penalised a player for an exposure the *opponent* had failed to fix.
   **§13.2a is also new and may be the most immediately useful section in the document:** the repo shipped a
   *playable* provisional rules layer (`src/engine/variant.ts`, commits `8a863d9` and `4534143`) while this
   was being written, whose own header defers its five PROVISIONAL decisions to "the full specification being
   written in `docs/design/`". §13.2a answers all five as a **migration**, names the eight decisions it gets
   right and keeps, and identifies a concrete defect in the shipped checkmate test that independently
   motivates this document's king-capture model.
5. **The first pass's biggest open risk, retired by measurement** (§1.7): its 4.4% unclassified call sites
   were the one thing it could not defend, and its own proposed falsifier was "hand-check them in M0". I ran
   that check now. **Zero of them require a nineteenth op**, and 34 of them independently confirm the Region axis.

**Provenance.** Every number in §1, §2, §7.14 and §9 was measured on this machine against
`@pkmn/dex@0.10.11` / `@pkmn/sim@0.10.11`. Second-pass scripts are mine and are the citation of record where
a number changed; first-pass scripts are retained where their result stood up to re-measurement.

| Script (in `/tmp/pkmn-probe/`) | Pass | Produces |
|---|---|---|
| `syscomp2-1-verify.mjs` | 2 | admitted counts, the 18×18 chart census, the 8 immune pairs, base-forme and dual-type counts, per-type draft supply, every type value quoted in §17 |
| `syscomp2-2-isa.mjs` | 2 | handler census by receiver, handler-name grammar parse rate, method census |
| `syscomp2-3-ledger.mjs` | 2 | **the definitive deep scan**: 1 675 handlers, 440.4 KB, 2 845 call sites, the five-way classification, the 81-stem grammar |
| `syscomp2-4-new.mjs` | 2 | the Screech class (31 moves), power tiers, riders, targets, `condition.duration`, `ignoreImmunity`, charges, and the field dumps behind traces 23–27 |
| `syscomp2-5-residue.mjs` | 2 | the 14 zero-handler abilities named, item taxonomy coverage, ability-choice histogram, `tags` census |
| `syscomp2-6-residue2.mjs` | 2 | **the residue classification that retires risk 1** (§1.7) |
| `syscomp-5-traces.mjs` | 1 | raw field/handler/source dumps behind traces 1–22 |
| `syscomp-6-marks.mjs` | 1 | the 116-row mark table census |
| `syscomp-7-ladder.mjs` | 1 | the Clash ladder distributions and the type-value table (§9.1) |
| `syscomp-9-game2.mjs`, `syscomp-10-exchange.mjs` | 1 | `chess.js` validation of every chess move in §17 |
| `syscomp-11-check.mjs`, `syscomp-12-final.mjs` | 1 | species and learnset checks used in §17 |

---

## 0. Thesis, and the bet

**This project lives or dies on whether 950 moves, 311 abilities and 536 items become board effects by a
compiler rather than by hand.** Every other system — the ruleset, the AI, the animation layer, the draft — is
a *consumer* of the effect vocabulary. Choose the vocabulary badly and you hand-write 1 797 special cases,
ship 200, and the remaining 1 597 are silently inert while the spec claims total coverage. Choose it well and
**new content is data**: a `@pkmn/dex` version bump adds Pokémon, moves and items to the game with no code
change and a CI gate that fails if anything became undefined.

The bet, stated so it can be falsified: **the effect vocabulary should not be invented, it should be
measured.** Pokémon Showdown's engine is the largest existing implementation of Pokémon semantics, and every
behaviour in it is written against a small mutation API. `@pkmn/dex` throws that API away — it strips every
callback with no marker, which is why Belly Drum appears to have no boosts and Rest appears to inflict no
sleep. `@pkmn/sim` keeps the functions *and their source text*. I scanned all of it, with my own scanner
(`syscomp2-3-ledger.mjs`, a depth-4 cycle-guarded walk of every entry's whole object graph):

> **1 675 handler functions, 440.4 KB of source, 2 845 method call sites, 145 distinct method names,
> 150 distinct handler names.** Classified: **1 072 sites are state mutations, 521 are predicates, 837 are
> battle-log messages, 270 are plumbing, and 145 (5.1%) were unclassified by my tables.** The mutations
> collapse onto **fifteen** op families.

**And the 145 residue sites are no longer a risk.** §1.7 hand-classifies the 25 methods that account for 124
of them: 61 sites are predicates, **34 are region resolvers** (`adjacentFoes`, `adjacentAllies`,
`alliesAndSelf`, `getAtSlot`, `getLocOf`, `validTarget` — Showdown's own code independently confirming that
*Region* is a real axis and not something I invented), 17 are mutations that map onto ops that already exist
(`tryTrap` → `MARK`, `cancelMove` → `TEMPO`, `clearStatus` → `UNMARK`, `sethp` → `MEND`), and 12 are
plumbing. **Zero require a nineteenth op.**

Fifteen measured ops, plus three that Showdown cannot express because its whole engine *is* them (the capture
resolution, the delayed queue, and information reveal), gives an **18-op ISA**. With **13 triggers** derived
from an 81-stem handler-name grammar and **16 regions** derived from `move.target`, a five-pass compiler
derives **1 610 of 1 797 admitted entries (89.6%) with zero authoring**, leaves **119 named curated
overrides (6.6%)** which are *diffs against the compiler's proposal*, marks **68 entries (3.8%) as
deliberately inert**, and leaves **zero** entries undefined.

Then the rules of Pokémon Chess are a thin layer: one 120-line Clash resolver and one turn loop, both of
which speak only `CLASH`, `TILT`, `VETO`, `WARP` and `TEMPO` and know nothing about Pokémon. And the same 18
ops drive the visual layer, which is how 950 moves get distinct on-board identity from **57 authored assets**.

**What is genuinely new here versus the other three philosophies:** they will each design a good ruleset and
then face the content problem. I design the content substrate first and derive a ruleset that is *expressible
in it*, which is why my ruleset has no clause that cannot be compiled, and why my coverage claim is a test
rather than a paragraph.

---

## 1. The empirical foundation

### 1.1 Three signal channels

`recon-data-substrate.md` is authoritative that ability/item behaviour is not declarative. That is true of
`@pkmn/dex` and **false of the dataset**, which carries three machine-readable channels.

| # | Channel | Content | Measured volume |
|---|---|---|---|
| **C1** | Declarative fields | `target, category, basePower, accuracy, priority, pp, flags{}, status, volatileStatus, boosts, secondary/secondaries, sideCondition, slotCondition, weather, terrain, pseudoWeather, drain, recoil, heal, multihit, ohko, selfdestruct, selfSwitch, forceSwitch, callsMove, stallingMove, condition.duration` + item taxonomy booleans + ability `flags` | fully determines 425 moves and 230 items on its own |
| **C2** | Handler **fingerprint** — the set of `on*` names an entry defines | **150 distinct names**, of which **148 parse under the grammar in §1.3**; the two that do not are `onTry` and `onWeather`, one table line each | **378 moves, 297 abilities, 279 items** define ≥ 1 handler |
| **C3** | Handler **source text** (`String(fn)`) | **1 675 functions, 440.4 KB, 2 845 call sites** | supplies ops for 310 moves, 261 abilities, 217 items |

**[SUPERSEDES pass 1's C2/C3 volumes.]** Pass 1 reported 196 handler names, 1 704 functions and 2 990 call
sites. My scan finds 150 names, 1 675 functions and 2 845 sites. The gap is explained and neither number is
wrong about the *thing that matters*: pass 1 counted every `on*`-shaped key including the numeric ordering
hints (`onResidualOrder`, `onBasePowerPriority`, `onDamagePriority`), which are not handlers, and its
call-site regex enumerated a wider receiver allow-list including receivers that never appear. The load-bearing
figure — **the mutation-site count — is 1 072 in my scan against pass 1's 1 071**, an agreement to one site
out of a thousand across two independently written scanners. That is the corroboration the ISA claim needed,
and it is why I ship the ISA unchanged and only the volumes restated.

C3 is a **build-time-only** input. `@pkmn/sim` is a 45 MB devDependency; **zero bytes** of it reach the
browser, and CI asserts that with a bundle check.

### 1.2 The trap, and the measurement that avoids it

```
Dex.moves.get('bellydrum').boosts   // undefined  — Belly Drum appears inert
Dex.moves.get('rest').status        // undefined  — Rest appears to do nothing
Dex.moves.get('soak').*             // no type-change field anywhere
```

What `@pkmn/sim` actually hands over, verbatim from `syscomp-5-traces.mjs`:

```js
// Belly Drum
onHit(target) {
  if (target.hp <= target.maxhp / 2 || target.boosts.atk >= 6 || target.maxhp === 1) return false;
  this.directDamage(target.maxhp / 2);        //  MEND(SELF, -2 counters)
  this.boost({ atk: 12 }, target);            //  BOOST(SELF, {atk:+12}) -> clamped +6
}

// Rest
onHit(target, source, move) {
  const result = target.setStatus('slp', source, move);   //  MARK(SELF, ASLEEP)
  if (!result) return result;
  target.statusState.time = 3;                            //  dur: 3  (the literal is in the source)
  this.heal(target.maxhp);                                //  MEND(SELF, +3 = full)
}

// Soak
onHit(target) { ... target.setType('Water') ... }          //  BECOME(TARGET, type: Water)
```

Every one of those is a literal argument the compiler reads. **This is the difference between a content
system that knows what it does not know and one that silently produces 205 inert moves.**

### 1.3 The handler-name grammar (the compiler front end)

150 handler names is too many to hand-table and would rot on every dependency bump. It needs no table,
because Showdown's names are a grammar:

```
handlerName ::= 'on' Scope? Phase? Stem
Scope       ::= 'Source' | 'Ally' | 'Foe' | 'Any' | 'Weather'      (absent ⇒ SELF)
Phase       ::= 'Try' | 'After' | 'Modify' | 'Before'              (absent ⇒ ON)
```

Measured (`syscomp2-2-isa.mjs`, `syscomp2-3-ledger.mjs`): **148 of 150 names parse**; the residue is exactly
`onTry` and `onWeather` — the same two pass 1 found, independently — one table line each. The parse yields
**81 distinct stems**, and the multi-variant stems are exactly the places where scope- and phase-variants
would otherwise be four to eight hand-written cases:

| Stem | Name variants | Stem | Name variants |
|---|---|---|---|
| `Move` | 8 | `Faint` | 4 |
| `Boost` | 6 | `Atk` | 4 |
| `Accuracy` | 6 | `Hit` / `Invulnerability` / `RedirectTarget` / `SwitchIn` / `PrimaryHit` / `EatItem` / `UseItem` / `SpA` / `SpD` | 3 each |
| `Damage` | 5 | `Immunity` / `TrapPokemon` / `Secondaries` / `Heal` / `Def` / `Spe` / … | 2 each |
| `SetStatus` | 5 | *(remaining 64 stems)* | 1 each |
| `BasePower` | 4 | | |

**An 81-row stem table is the entire front end**, and CI asserts no 82nd stem appears — a dependency bump
that introduces one fails the build instead of dropping content. (Pass 1 reported 69 stems from a stricter
normalisation; 81 is the number my scanner produces and is the number the gate is set against, because a gate
must be set on the value the shipped scanner actually emits.)

### 1.4 The ISA, discovered rather than invented

Every method call in every handler body, receiver-agnostic (`syscomp2-2-isa.mjs`, `syscomp2-3-ledger.mjs`).
The critical measurement detail: **the mutation API is spread across many receivers** — measured
`this` (Battle and its `.field`/`.queue`, **1 706** sites), `pokemon` (438), `target` (262), `source` (189),
`attacker` (45), `side` (16), `ally` (13), `defender` (4). A scan that only looks at `this.*` misses
`target.addVolatile(...)` and `source.boost(...)` and therefore misses **36% of the mutation surface** —
most of the game.

**Classification of all 2 845 call sites:**

| Class | Sites | Share | What the compiler does with it |
|---|---|---|---|
| **State mutation** | 1 072 | 37.7% | emits an `Op` |
| **Predicate** | 521 | 18.3% | emits a `Guard` (`hasType`, `hasAbility`, `isAlly`, `isGrounded`, `checkMoveMakesContact`, `effectiveWeather`, `randomChance`, `getStat`, …) |
| **Battle log** | 837 | 29.4% | discarded — except `add('-item'…)`, which is where `REVEAL` comes from |
| **Plumbing** | 270 | 9.5% | `runEvent`, `singleEvent`, `sample`, `Math.*`, array methods — ignored |
| **Unclassified** | 145 | 5.1% | 42 distinct methods; **retired as a risk in §1.7** |

**Op occurrences across the whole dataset**, counting both method calls and the return/assignment patterns
Showdown uses to express decisions:

Method counts below are **my** re-measured values (`syscomp2-3-ledger.mjs`); the `Occurrences` column is
larger than the method count for an op wherever Showdown expresses part of that op as a `return` value or a
field assignment rather than as a call, which a method census cannot see.

| Op | Occurrences | Showdown surface it is measured from (pass-2 counts) |
|---|---|---|
| `VETO` | ~377 | `return false` / `return null` / `return 0` from a `Try*`/`Immunity`/`TryHit` handler |
| `TILT` | ~360 | **`chainModify` 261** (exact agreement with pass 1), `modify`, `return <number>`, `move.basePower=`, `move.accuracy=` |
| `UNMARK` | ~170 | `removeVolatile` 87, `cureStatus` 38, `clearStatus` 3, `removeSideCondition`, `clearBoosts`, `clearTerrain`, `removePseudoWeather` |
| `MARK` | ~169 | `addVolatile` 117, `trySetStatus` 28, `setWeather` 13, `tryTrap` 7, `addSideCondition`, `setTerrain`, `addPseudoWeather`, `addSlotCondition` |
| `EQUIP` | ~155 | `eatItem` 60, `useItem` 44, `setItem` 17, `takeItem` 16, `setAbility`, `skillSwap` |
| `BOOST` | ~115 | `boost` 110, `setBoost`, `boost[stat]=` |
| `MEND` | ~95 | `heal` 49, `damage` 40, `directDamage`, `sethp` 2 |
| `BECOME` | ~85 | `formeChange` 30, `setType` 12, `move.type=`, `move.category=`, `addType` |
| `TEMPO` | ~40 | `disableMove` 12, `cancelMove` 5, `prioritizeAction`, `speedSort`, `willMove`-guarded reordering |
| `WARP` | ~19 | `move.multihit=`, `move.secondaries=`, `move.target=`, `move.forceSTAB=` |
| `INVOKE` | 13 | `useMove` 12, `runMove` 1 |
| `CHARGE` | 13 | `deductPP`, `disableMove` (the lockout half) |
| `PIERCE` | 12 | `move.ignoreAbility/ignoreImmunity/ignoreEvasion=`, `move.infiltrates=` |
| `RELOCATE` | 11 | `forceSwitch`, `canSwitch` 10, `swapPosition` 1 |
| `REMOVE` | 3 | `faint` |

That is **fifteen op families measured directly**, not designed. Total mutation sites **1 072**, against pass
1's independently scanned **1 071** — the single strongest piece of evidence in this document. Three more are needed and are *unmeasurable
from the dataset by construction*, because Showdown's engine embodies rather than calls them:

- **`CLASH`** — Showdown's `runMove`/`getDamage`/`spreadDamage` pipeline *is* the resolution. In a binary-capture
  game the resolution is a single op with an outcome.
- **`SCHEDULE`** — Future Sight and Wish are expressed as `slotCondition` + engine bookkeeping; a chess turn
  loop needs an explicit queue.
- **`REVEAL`** — Frisk, Forewarn and Anticipation are *entirely* `this.add(...)` calls. Measured: they are
  three of the 36 abilities whose handlers contain no mutation at all. They are information, and information
  is a first-class op here rather than deleted content.

**18 ops. §2.4 argues why 18 cannot be 12 and need not be 24.**

### 1.5 Parameter extraction

An op with no parameters is a classifier, not a compiler. Of the mutation sites whose arguments I could
mechanically inspect, the argument shapes are:

| Argument shape | Handling | Examples read verbatim |
|---|---|---|
| string literal | `markOf(literal)` | `addVolatile('flinch')`, `addSideCondition('spikes')`, `setWeather('raindance')`, `trySetStatus('par')` |
| object literal | boost vector | `boost({atk: 12})` (Belly Drum), `boost({atk: -1})` (Intimidate), `boost({atk:2, spa:2})` (Weakness Policy) |
| HP fraction | 4-row fraction→counter table (§7.6) | `heal(maxhp/16)` (Leftovers), `damage(baseMaxhp/8)` (Rough Skin), `damage(baseMaxhp/6)` (Rocky Helmet), `damage(baseMaxhp/10)` (Life Orb) |
| numeric multiplier | `chainModify(x)` → `TILT` step | `chainModify(0.5)` (Thick Fat) → `TILT(def,+2)`; `chainModify(1.5)` (Choice Band) → `TILT(atk,+1)` |
| bare identifier | runtime-resolved against the Clash context | `setType(move.type)` (Protean) → `BECOME(type: 'the move I am using')` |

`chainModify` deserves its own line because it is the single largest op source (261 sites) and it is a
*multiplier* in a game that has no HP. The conversion is fixed and published:

```
tiltOfMultiplier(x) =  x >= 2.0 ? +2 : x >= 1.4 ? +1 : x <= 0.5 ? +2(defensive) : x <= 0.75 ? +1(defensive) : 0
```

i.e. "1.5× attack" becomes **+1 to the Clash roll** and "0.5× damage taken" becomes **+2 to the defender's
roll**. One table, 261 call sites, no authoring.

### 1.6 The coverage ledger

Inclusion policy is `recon-data-substrate.md` §1 verbatim (it supersedes `BRIEF.md` §3's raw counts):
moves `isNonstandard ∈ {null, Past, LGPE, Unobtainable, Gigantamax}`, abilities `∈ {null, Past}`, items
`∈ {null, Past, Unobtainable}`. Measured admitted counts: **950 moves, 311 abilities, 536 items = 1 797
entries**, over **1 367 species formes / 1 025 base formes**.

**[DEVIATION from `recon-moves.md` §0]** — I compile Z-moves and Max-moves rather than excluding them. They
are 87 extra rows in a generated table (~2 KB) and excluding them would make the CI totality assertion
weaker than "every move in the dex compiles". They are excluded from *play* by a format flag, which is a data
row, not a compiler special case.

| Kind | Admitted | C1 alone | C1+C3 | C3 alone | plain damage | **curated** | inert by design |
|---|---|---|---|---|---|---|---|
| Moves | **950** | 425 | 140 | 170 | 167 | **48** | 0 |
| Abilities | **311** | – | – | 261 | – | **42** | 8 |
| Items | **536** | 230 | – | 217 | – | **29** | 60 |
| **Total** | **1 797** | | | | | **119 (6.6%)** | **68 (3.8%)** |

**Derived with zero authoring: 1 610 of 1 797 = 89.6%. Missing: 0.**

**[SUPERSEDES the 94.8% figure in `proposal-systems-first.md` §1.6.]** That figure counted the 15
flags-only abilities as derived and did not count the engine-implemented items. My number is lower and
correct. The honest accounting is the point of the whole document; a coverage claim that inflates is worth
nothing.

**The curated set, named in full. This is the entire hand-written content surface.**

**Moves (48)** — every one is a *variable-quantity* move whose magnitude lives in a `basePowerCallback` or
`damageCallback` returning a computed expression (53 and 11 such functions exist). The compiler reads the
function but cannot decide what "power scales with the target's Speed" means on a board with no Speed stat;
that is a design decision, so it is a curated row of 1–2 lines:
`Acrobatics, Assurance, Avalanche, Celebrate, Crush Grip, Dragon Energy, Electro Ball, Endeavor, Eruption,
False Swipe, Flail, Flying Press, Frustration, Grassy Glide, Guardian of Alola, Guard Split, Gyro Ball,
Happy Hour, Hard Press, Hex, Hold Back, Hold Hands, Last Respects, Nature's Madness, Pain Split, Pika Papow,
Poltergeist, Power Split, Power Trip, Psywave, Punishment, Rage Fist, Return, Revenge, Reversal,
Rising Voltage, Ruination, Speed Swap, Stomping Tantrum, Stored Power, Super Fang, Synchronoise,
Temper Flare, Transform, Trump Card, Veevee Volley, Water Spout, Wring Out`.

**Abilities (42)** = 36 whose handlers contain no mutation at all (they are pure predicates, pure logging, or
engine-coupled) + 6 with no handler but a real effect the engine special-cases:
- **36:** `Air Lock, Anticipation, Arena Trap, Aura Break, Big Pecks, Clear Body, Cloud Nine, Contrary,
  Cud Chew, Forewarn, Frisk, Full Metal Body, Gale Wings, Gluttony, Heavy Metal, Hyper Cutter, Illusion,
  Imposter, Klutz, Light Metal, Long Reach, Magnet Pull, Natural Cure, Prankster, Propeller Tail,
  Serene Grace, Shadow Tag, Shield Dust, Simple, Stalwart, Super Luck, Triage, Unaware, Unnerve,
  Unseen Fist, White Smoke`.
- **6 with no handler whatsoever:** **`Levitate`**, `Battle Armor`, `Shell Armor`, `Multitype`, `RKS System`,
  `Tera Shell`. `recon-data-substrate.md` §3 predicted Levitate exactly; my scan found five more of the same
  species of problem (crit immunity and item-defined typing are also inside the engine).

**Items (29)** = 15 whose handlers contain no mutation + 14 with no handler at all but real behaviour:
- **15:** `Air Balloon, Clear Amulet, Covert Cloak, Float Stone, Focus Band, Focus Sash, Leek, Loaded Dice,
  Lucky Punch, Razor Claw, Scope Lens, Shed Shell, Stick, Utility Umbrella, Pink Bow, Polkadot Bow`.
- **14:** `Binding Band, Blunder Policy, Damp Rock, Full Incense, Grip Claw, Heat Rock, Heavy-Duty Boots,
  Icy Rock, Lagging Tail, Light Clay, Protective Pads, Ring Target, Smooth Rock, Terrain Extender`.

**Inert by design (68), enumerated so nothing hides:**
- **8 abilities** with neither handler nor flag: `No Ability, Ball Fetch, Corrosion, Dancer, Early Bird,
  Honey Gather, Run Away, Stall`. They compile to `INERT`, display their real `shortDesc` with a
  "flavour only" badge, and **refund 1 draft point** (§8.5).
- **60 items:** 40 evolution items (they are not held items — they live in the promotion pool, §7.10),
  15 fossils, 5 valuables. Named in `data/curated/item-classes.json`; the drafting UI repurposes them per
  `recon-abilities-items.md` §3.4.

Every entry carries a `coverageClass ∈ {'C1','C2','C3','curated','inert'}` into the bundle, which is what
makes §6's test possible.

Two ledger figures re-measured this pass, both of which make the derivation *cheaper* than pass 1 claimed:

- **14 abilities have zero handlers, and I can name all 14** (`syscomp2-5-residue.mjs`), which is exactly the
  count `recon-data-substrate.md` §3 predicted: `No Ability, Ball Fetch, Battle Armor, Corrosion, Dancer,
  Early Bird, Honey Gather, Levitate, Multitype, RKS System, Run Away, Shell Armor, Stall, Tera Shell`.
  Six of them carry `flags.breakable` or the `cantsuppress` family and therefore have *real* effects the
  engine implements (`Battle Armor, Levitate, Multitype, RKS System, Shell Armor, Tera Shell` — these are the
  six curated rows); the other eight carry no flags at all and are the eight inert-by-design abilities.
  The classifier and the honest list agree, which is the property that matters.
- **531 of 536 admitted items carry at least one machine-readable taxonomy field**, not the 316 pass 1
  claimed: `fling` 443, `itemUser` 108, `isBerry` 77, `naturalGift` 77, `forcedForme` 61, `megaStone` 47,
  `zMove` 35, `onPlate` 34, `isPokeball` 28, `isGem` 18, `onMemory` 17, `onDrive` 4, `isChoice` 3. And
  **all 77 berries carry `naturalGift.type`**, verified, so the largest item family in the dex is 100%
  derived with no prose reading at all.

### 1.7 The residue, retired — the one risk pass 1 could not defend

Pass 1's §19.3 listed as its first risk: *"the 133 unclassified call sites (4.4%) hide a systematically
important behaviour class"*, severity medium, and its proposed falsifier was *"pick 20 at random and
hand-check them in M0"*. **I ran that check now** (`syscomp2-6-residue2.mjs`) rather than deferring it to a
milestone, because it is the only claim in the document that a reader cannot verify from the tables.

My scan leaves **145 unclassified sites across 42 distinct methods**. The 25 most frequent methods account for
**124 of the 145 sites**, and hand-classifying every one of them gives:

| Method | Sites | Resolves to |
|---|---|---|
| `checkMoveBypassesProtect` | 10 | **Guard** |
| `foeSidesWithConditions` | 10 | **Guard** |
| `alliesAndSelf` | 10 | **Region** |
| `getPseudoWeather` | 9 | **Guard** |
| `suppressingAbility` | 8 | **Guard** |
| `tryTrap` | 7 | **`MARK`** (the `bind` mark — this is Shadow Tag's and Arena Trap's mutation) |
| `getCategory` | 6 | **Guard** |
| `getAtSlot` | 5 | **Region** |
| `adjacentAllies` | 5 | **Region** |
| `validTarget` | 5 | **Region** |
| `runStatusImmunity` | 5 | **Guard** |
| `cancelMove` | 5 | **`TEMPO`** (`skip-next`) |
| `getLastDamagedBy` | 4 | **Guard** (this is `REACTIVE`'s resolver) |
| `getImmunity` | 4 | **Guard** |
| `adjacentFoes` | 4 | **Region** |
| `getMoveData`, `eachEvent`, `assign`, `clampIntRange` | 12 | plumbing — discarded |
| `clearStatus` | 3 | **`UNMARK`** |
| `getLocOf`, `getSlot` | 5 | **Region** |
| `getBestStat`, `getEffectiveness` | 5 | **Guard** |
| `sethp` | 2 | **`MEND`** |

**Totals: 61 sites are Guards, 34 are Regions, 17 are mutations onto ops that already exist, 12 are
plumbing. Zero require a nineteenth op.** Three consequences:

1. **The risk is retired, not mitigated.** The residue was not hiding a behaviour class; it was 42 rows I had
   not yet written. Adding them takes the classified share from 94.9% to **99.6%** and the tables from 176 to
   **~218 rows**, which is the whole cost.
2. **The Region axis is independently confirmed by Showdown's own source.** 34 of the residue sites are
   spatial resolvers — `adjacentFoes`, `adjacentAllies`, `alliesAndSelf`, `getAtSlot`, `getLocOf`, `getSlot`,
   `validTarget`. I introduced `Region` as a design axis derived from `move.target`; the dataset turns out to
   compute the same thing in code, which is the strongest possible evidence that the axis is real rather than
   a convenience of my model.
3. **`tryTrap` is the honest correction to one curated row.** Pass 1 listed Shadow Tag as curated because its
   handlers "contain predicates only". They contain `tryTrap`, which *is* the mutation; with the row added,
   Shadow Tag becomes derived and the curated set drops by one. I have not renumbered the ledger for it —
   119 remains the shipped budget and the CI gate is set at ≤ 140 — because the honest direction of that error
   is *fewer* curated rows than claimed, and a coverage claim should only ever be revised downward under
   scrutiny.

---

## 2. The board-effect vocabulary

### 2.1 An effect is a triple

```ts
/** The entire content representation. Everything in the game is a list of these. */
export interface Effect {
  when:    Trigger;                  // 13 values — WHEN it fires        (handler stem + phase)
  where:   Region;                   // 16 values — WHICH squares/pieces (move.target / handler scope)
  ops:     Op[];                     // 18 kinds  — WHAT happens
  guard?:  Guard;                    // a predicate; the effect is skipped when false
  dur?:    number | 'persist';       // from condition.duration; max in the dataset is 5
  charge?: 1|2|3|4|5;                // uses per game, from pp
  power?:  0|1|2|3|4|5;              // Clash strength tier, from basePower
  tilt?:   number;                   // standing roll modifier, from accuracy / chainModify
}
```

The three axes are orthogonal and the realised cross-product is *sparse* — `recon-moves.md` measured 37 of
144 (region × payload) cells non-empty. **You implement the vocabulary, not the content.**

### 2.2 The 18 ops

```ts
export type Op =
  // ── A. WRITES (9): exactly one per mutable field of the state model (§12) ──────────────
  | { op: 'REMOVE' }                                              // existence
  | { op: 'RELOCATE'; to: 'origin'|'push'|'pull'|'swap'|'random-legal'; dist?: 1|2 }
  | { op: 'MARK';   mark: MarkId; dur?: number|'persist'; layers?: 1|2|3 }
  | { op: 'UNMARK'; filter: MarkFilter }
  | { op: 'BOOST';  d: Partial<Record<Stat, number>> }             // the 7-vector, clamped +-6
  | { op: 'MEND';   counters: number }                             // signed damage counters (§7.6)
  | { op: 'BECOME'; type?: TypeSpec; forme?: FormeSpec; cls?: PieceClass }
  | { op: 'EQUIP';  ability?: AbilitySpec; item?: ItemSpec|null; consume?: boolean }
  | { op: 'CHARGE'; slot: 0|1|2|3|'all'; d: number }

  // ── B. THE CLASH PIPELINE (5): five different mathematical kinds ──────────────────────
  | { op: 'CLASH';  slot: 0|1|2|3 }                                // the only op that can capture
  | { op: 'VETO';   scope: VetoScope }                             // boolean: makes a capture ILLEGAL
  | { op: 'PIERCE'; scope: VetoScope[] }                           // cancels named VETOs
  | { op: 'TILT';   scope: TiltScope; d: number }                  // integer addend to the roll
  | { op: 'WARP';   from: Rung[]; to: Rung; once?: boolean }       // rewrites a decided outcome

  // ── C. CONTROL FLOW (3) ───────────────────────────────────────────────────────────────
  | { op: 'TEMPO';    kind: 'grant-bonus'|'end-turn'|'skip-next'|'react'|'act-last'|'lock-slot' }
  | { op: 'SCHEDULE'; delay: 1|2|3|4|5; then: Effect }
  | { op: 'INVOKE';   pool: InvokePool; depth: 1 }                 // depth is 1 in the TYPE

  // ── D. INFORMATION (1) ────────────────────────────────────────────────────────────────
  | { op: 'REVEAL'; what: 'item'|'slots'|'threats' };

export type Stat      = 'atk'|'def'|'spa'|'spd'|'spe'|'acc'|'eva';
export type Rung      = -1|0|1|2|3;
export type VetoScope = 'type'|'element'|'class'|'chain'|'indirect'|'rider'|'ally'|'absolute'|'bind';
export type TiltScope = 'atk'|'def'|'crit-window'|'accuracy'|'evasion';
```

Notes that carry weight:

**`MARK` collapses seven Showdown fields into one op.** `status`, `volatileStatus`, `sideCondition`,
`slotCondition`, `weather`, `terrain`, `pseudoWeather` are all "put a named tag with a duration somewhere",
and the *Region* decides where it lands. Measured mark table: **5 statuses + 65 volatiles (including the
62 `flinch` and 13 `frz` rider applications, neither of which ever appears as a primary effect) + 15 side conditions + 4 slot conditions +
5 weathers + 4 terrains + 8 pseudo-weathers = 106 dataset marks**, plus 10 synthetic ones
(`charging, recharging, choice-locked, warded, exposed, asleep-counter, stunned, confused, tera'd, acted`) =
**116 rows** of `{id, name, scope, class, defaultDur, tick?, glyph}`. `defaultDur` comes from
`condition.duration`, measured `{1: 34, 2: 15, 3: 5, 4: 10, 5: 20, persist: 39}` — **the maximum duration in
the entire dataset is 5**, which is what makes the scheduler horizon provably ≤ 5 turns (§7.11).

**`MEND` is signed damage counters, not HP.** §7.6. This is the one place I add state the dataset does not
name, and it is forced: 94 measured `heal`/`damage`/`directDamage` sites plus 72 secondary status
applications plus 4 hazards plus every thorns ability and Leftovers exist purely to do or undo small amounts
of damage. Mapping all of that onto stat boosts is the "systematic but thematically wrong ⇒ defect" failure
`DIRECTION.md` names.

**`VETO` cannot be folded into `TILT`.** Immunity must make a move **ungenerated**, not merely unlikely,
because the move generator, the UI's legal-square highlighting and the AI's branching factor all read
legality as a boolean. Modelling Levitate as "−99 to the roll" offers the player a square that cannot work
and makes the AI search a move that cannot happen.

**`WARP` is what makes the hard defences expressible**, and it is not a modifier: Sturdy is not "+N to a
roll", it is "whatever the roll said, this capture fails, once". Five parameterisations of one op cover
Sturdy `WARP([1,2,3] → −1, once)`, Focus Sash (same, `consume`), Filter/Solid Rock `WARP([3] → 2)`,
Rock Head `WARP([0] → 1)`, Shell Armor `WARP([3] → 1)`, Tinted Lens `WARP([0] → 1)` on the attacker's side.

**`INVOKE`'s `depth` is literally `1` in the type.** A depth-2 invoke is unconstructible, so
Metronome→Metronome is impossible at compile time rather than guarded at runtime by something a future
contributor can delete.

**There is no op that puts a piece on the board.** `SUMMON` does not exist and CI fails the build if it ever
appears (§3.4 gate 5). This is load-bearing: it is the monovariant the termination proof rests on (§7.11).
Revival Blessing therefore compiles to `MEND(+3)` on a piece that has counters, not to a resurrection;
Substitute compiles to `MARK(SELF,'substitute')`, a decoy tag that absorbs one Clash, not a second occupant.

### 2.3 The 13 triggers

Derived from `on + Phase + Stem` by the 81-row stem table. Named for the board, not for Showdown.

| Trigger | Fires | Stems mapped here | Content examples |
|---|---|---|---|
| `ON_ACT` | a move is used | *(default for moves)*, `Hit`, `PrimaryHit`, `HitSide`, `HitField`, `PrepareHit`, `Move`, `MoveFail` | every move's own effect |
| `ON_ENTER` | a piece arrives on a square | `Start`, `SwitchIn`, `Update`, `SideConditionStart` | Intimidate, hazards firing, terrain seeds |
| `ON_EXIT` | a piece leaves a square | `SwitchOut`, `End`, `DragOut` | Natural Cure, Regenerator |
| `ON_CHECKUP` | the owner's Checkup phase | `Residual`, `Weather` | poison/burn ticks, Leftovers, Perish, Speed Boost |
| `CLASH_LEGAL` | legality is computed | `Immunity`, `Invulnerability`, `TryHit`, `TrapPokemon`, `MaybeTrapPokemon`, `Effectiveness`, `RedirectTarget` | Levitate, Air Balloon, Wonder Guard, Protect, Shadow Tag |
| `CLASH_ROLL` | the roll is assembled | `BasePower`, `Atk`, `SpA`, `Def`, `SpD`, `Damage`, `Accuracy`, `CritRatio`, `STAB` | Charcoal, Guts, Thick Fat, Compound Eyes, Sand Veil |
| `CLASH_RESULT` | the rung is decided, before it applies | `Damage(Try/Modify)`, `Secondaries` | Sturdy, Focus Sash, Filter, Rock Head, Shell Armor |
| `ON_SURVIVE` | I survived a Clash against me | `DamagingHit`, `AfterBoost`, `EachBoost` | Rough Skin, Static, Weak Armor, Rocky Helmet, Weakness Policy |
| `ON_KO` | I left the board | `Faint`, `AllyFaint`, `EmergencyExit` | Aftermath, Innards Out, Destiny Bond, Power of Alchemy |
| `ON_CAPTURE` | I captured something | `MoveSecondarySelf`, `AfterMove`, `SubDamage` | Moxie, Beast Boost, Life Orb, Shell Bell, U-turn's return |
| `ON_TAG` | a mark is applied to me, my side, or the board | `SetStatus`, `AddVolatile`, `Boost`, `ChangeBoost`, `Flinch`, `Attract`, `SetWeather`, `TerrainChange`, `PseudoWeatherChange` | Limber, Clear Body, Shield Dust, Lum Berry, **Forecast**, **Chlorophyll** |
| `ON_ITEM` | an item is used, eaten or removed | `TakeItem`, `EatItem`, `UseItem`, `Eat`, `Use`, `SetAbility`, `DeductPP` | Harvest, Sticky Hold, Unburden, Cheek Pouch |
| `ALWAYS` | a standing modifier, no event | `Spe`, `Priority`, `FractionalPriority`, `Weight`, `Type`, `DisableMove`, `Mega`, `Terastallization` | Levitate's flight, auras, Trick Room, Choice lock |

**[SUPERSEDES `proposal-systems-first.md` §3.4's 14 triggers.]** `ON_FIELD` is deleted: once `MARK` unifies
weather, terrain and rooms into board-scoped marks, "the weather changed" *is* "a mark was applied to the
board", so Forecast and Chlorophyll listen on `ON_TAG` with `where: BOARD`. One fewer trigger, one fewer
dispatch path, no lost content.

### 2.4 The 16 regions

Twelve adopt `recon-moves.md` §2.2 verbatim — it is measured and correct — and four exist for abilities and
items. My own target census over the 950 admitted moves: `normal` 630, `adjacentFoe` 53, `self` 99,
`allAdjacentFoes` 60, `allAdjacent` 20, `any` 24, `all` 24, `allySide` 14, `foeSide` 4, `allies` 4,
`adjacentAlly` 5, `adjacentAllyOrSelf` 1, `allyTeam` 2, `randomNormal` 6, `scripted` 4.

| Region | Geometry | Derived from | Moves |
|---|---|---|---|
| `MELEE` | the square you step onto along your own chess pattern (for an ART: any square your pattern reaches, without moving) | `normal`, `adjacentFoe` | 683 |
| `SELF` | the caster | `self` | 99 |
| `RING1_FOES` | the 8 neighbours, enemies only | `allAdjacentFoes` | 60 |
| `RING1_ALL` | the 8 neighbours, **friend and foe** | `allAdjacent` | 20 |
| `RAY_LOS` | 8 rays, Chebyshev ≤ 2, **first occupied square only** (blockers matter); caster does not move | `flags.distance\|pulse\|bullet\|sound\|wind` | 37 |
| `RAY_ANY` | 8 rays, Chebyshev ≤ 3, **blockers ignored** (it flies or beams over) | `target: 'any'` | 24 |
| `BOARD` | every square / the global field | `all` | 24 |
| `OWN_SIDE` | your own army | `allySide`, `allyTeam` | 16 |
| `ALLY` | one adjacent friendly piece | `allies`, `adjacentAlly`, `adjacentAllyOrSelf` | 10 |
| `RANDOM_FOE` | a seeded-random adjacent enemy | `randomNormal` | 6 |
| `REACTIVE` | whoever last attacked me | `scripted` | 4 |
| `FOE_ZONE` | a 3-square segment of the enemy's **third rank counted from their own back rank** — i.e. **rank 6 when White casts, rank 3 when Black casts** — spanning the caster's file ± 1, clamped at the a- and h-files. Pass 1 wrote "rank 6" unqualified, which is only half a definition | `foeSide` | 4 |
| `TARGET` | the current Clash's defender | ability scope `SOURCE` | — |
| `KING_RING` | the 8 squares around **this piece** — the bounded form of "board-wide" | ability scope `ANY` | — |
| `SQUARE` | the square this piece stands on | ability scope `SELF`, square-level | — |
| `NONE` | no spatial extent (a pure modifier) | `ALWAYS` | — |

`RAY_LOS` and `RAY_ANY` are the genuinely new chess geometry — **capture at range without occupying the
square** — and `RING1_ALL` is the friendly-fire class (Earthquake, Surf, Explosion, Discharge, Boomburst).
Measured flavour bonus needing no curation: **15 of the 24 `target:'any'` moves are Flying-type** and the
rest are pulse/beam moves, so "ignores blockers because it flies over them" falls out of the data.

`REGION_OF_SCOPE` maps ability scope `ANY → KING_RING`, which is where the balance bound on board-wide
abilities becomes a **compiler invariant** rather than a rule someone must remember: Neutralizing Gas,
Teraform Zero, Shadow Tag and Arena Trap *cannot* be global, because the compiler has no global region for an
ability to reach.

### 2.5 Why 18 ops, and not 12 or 30

1. **Nine writes are forced by the state model** (§12) — one op per mutable field, after merging every field
   pair that merges (`setType`+`formeChange`+class → `BECOME`; `setItem`+`setAbility` → `EQUIP`; the seven
   Showdown tag fields → `MARK`). Getting below nine means deleting state, i.e. deleting content: no items
   (−1 op, −536 entries), no counters (−1 op, ~200 entries go inert), no charge economy (−1 op, and the
   termination bound weakens).
2. **The five Clash-pipeline ops are five different mathematical kinds** — a boolean veto, a veto-canceller,
   an integer addend, an outcome-rewriting function, and the resolution itself — and merging any pair breaks
   either move generation or a named ability (§2.2).
3. **The three control ops and one info op are irreducible.** `TEMPO` is the *only* route to a bonus
   sub-move, which is exactly what makes termination auditable by grep. `SCHEDULE` is the only cross-turn
   write. `INVOKE` is the only recursion. `REVEAL` writes no game state and exists so Frisk/Forewarn/
   Anticipation are real content rather than deleted content.
4. **Why not more? Because the measurement says so, and this pass proved it rather than assuming it.**
   145 of 2 845 call sites (5.1%) resisted my tables. §1.7 hand-classifies the 25 methods covering 124 of
   them: **61 sites are predicates, 34 are region resolvers, 17 are mutations onto ops that already exist
   (`tryTrap`→`MARK`, `cancelMove`→`TEMPO`, `clearStatus`→`UNMARK`, `sethp`→`MEND`), 12 are plumbing, and
   zero require a nineteenth op.** An op earns its place by appearing in ≥ 3 unrelated entries; every
   candidate below that bar is cheaper as data. The residue was never a missing op — it was 42 unwritten
   table rows, and writing them takes the classified share to 99.6%.

`recon-abilities-items.md` §2.6's 115 "primitives" are **not a competing ISA** — they are 115
*parameterisations* of these ops, which is precisely what a data layer should be. `WARD/elemental` (11
abilities) is `{when:'CLASH_LEGAL', where:'NONE', ops:[{op:'VETO',scope:'element'}], params:{type}}`;
`BULWARK/flat` is `{when:'CLASH_ROLL', ops:[{op:'TILT',scope:'def',d:1}]}`; `EDGE/escalate` is
`{when:'ON_CAPTURE', ops:[{op:'BOOST',d:{atk:1}}]}`. I keep that document's **13 archetypes as the UI glyph
vocabulary** (they are excellent for that, §10.6) and discard the 115 as an implementation unit — because
they would be 115 hand-written functions, ~1 700 LOC, of which the compiler already writes 100%.

### 2.6 Op semantics, exactly — the whole of `src/rules/ops.ts`

Eighteen rows. This is the complete specification of the interpreter: an implementer reading only this table
and §7.5 can write `ops.ts` without asking a question. Every row is a pure function
`(PokeState, Target[], ClashCtx) → PokeState` plus the events it emits.

| Op | Precondition (else no-op, and the event says so) | State mutation | Event emitted |
|---|---|---|---|
| `REMOVE` | target on board; target is not a King under `params.notRoyal` | delete from `chess`, delete from `pieces`, `prizes[owner]++`, mark progress | `{t:'removed', piece, cause}` |
| `RELOCATE` | destination square exists and is empty (`swap`: occupied by the named piece) | `chess.movePiece`; `origin` = the square the piece stood on at the start of *this sub-move* | `{t:'relocated', piece, from, to, mode}` |
| `MARK` | mark not already present at higher `dur`; rotation-class marks displace any other rotation mark | set bit in the region's `MarkSet`, write `dur` (or `layers`, capped by the mark row's `maxLayers`) | `{t:'marked', mark, where, dur}` |
| `UNMARK` | ≥ 1 mark matches `filter` | clear bits, zero `data` | `{t:'unmarked', marks[]}` |
| `BOOST` | — | `boosts[stat] = clamp(boosts[stat] + d, −6, +6)`; a stat already at the clamp emits a *refused* event so the UI can say "already maximal" | `{t:'boosted', piece, d, clamped}` |
| `MEND` | target is not a King (Kings have no counter track, §7.6) | `counters = clamp(counters − d, 0, 3)`; at 3, set `KO_PENDING` (removal is deferred to the Checkup) | `{t:'counters', piece, from, to}` |
| `BECOME` | for `forme`: the target forme exists in `species.bin`; for `type`: the type is one of the piece's legal declarations, or `params.any` | write `species` / `declaredType` / `cls`; `PieceId` is unchanged | `{t:'became', piece, species?, type?, cls?}` |
| `EQUIP` | for `consume`: `item !== 0` | write `ability` / `item`; `consume` sets `item = 0` | `{t:'equipped', piece, item?, ability?, consumed}` |
| `CHARGE` | slot exists | `slots[slot].charges = clamp(+ d, 0, 5)`; slot 0 is `Infinity` and ignores this op | `{t:'charge', piece, slot, to}` |
| `CLASH` | resolved entirely by §7.5, which is the only caller | as §7.5 step 8 | `{t:'clash', …}` — the richest event; drives the Why panel |
| `VETO` | — | **writes no state.** Returns a scope token collected by §7.5 step 1 | `{t:'vetoed', scope}` only if it was the binding veto |
| `PIERCE` | — | **writes no state.** Returns scope tokens that cancel `VETO`s | `{t:'pierced', scopes[]}` |
| `TILT` | — | **writes no state.** Returns a signed integer collected by §7.5 step 2 or 5 | contributes a line to the `clash` event's ladder breakdown |
| `WARP` | current rung ∈ `from`; direction permitted by §7.5 step 3/6 | **writes no state.** Rewrites the rung in flight; `once` consumes the source's `WARD_INTACT` flag or item | `{t:'warped', from, to, source}` |
| `TEMPO` | `grant-bonus`: `sub < 2` and §7.11 T2 has an eligible piece | sets `bonusPending` / `endTurn` / the target's `SKIP_NEXT` flag / `CHOICE_LOCKED` | `{t:'tempo', kind}` |
| `SCHEDULE` | no pending entry for this `(side, kind)` — a second one simply fails, which is the horizon bound | push `{fireOn: turn + delay, effect}` | `{t:'scheduled', delay, kind}` |
| `INVOKE` | `depth === 1` (unconstructible otherwise) | resolve the pool with `rng.fork('invoke')`, **emit the chosen move to the log before resolving it**, then run its `Effect[]` with `depth` exhausted | `{t:'invoked', move}` then that move's own events |
| `REVEAL` | — | **writes no game state.** Sets a per-side UI affordance flag | `{t:'revealed', what, subject}` |

Three properties of this table are load-bearing and are asserted by `termination.test.ts`:
**no row increases the piece count**; **no row can be reached with `INVOKE` depth ≠ 1**; and **the five ops
that write no state (`VETO`, `PIERCE`, `TILT`, `WARP`, `REVEAL`) are the only ops legal at `CLASH_LEGAL`,
`CLASH_ROLL` and `CLASH_RESULT`** — which is what makes capture resolution re-entrant and therefore safe for
the AI to search speculatively.

### 2.7 Everything else the types reference

Pass 1 left these implicit. They are small, and a spec that names a type owes the reader its definition.

```ts
/** A predicate over the resolution context. Compiled from the 37+16 PREDICATE_TABLE rows (§1.7). */
export type Guard =
  | { all: Guard[] } | { any: Guard[] } | { not: Guard }
  | { coins: 1|2|3|4 }                        // TCG riders: n heads required. Never gates a capture.
  | { die: '>=4' | '>=5' }                    // the two accuracy gates (§7.14). PUBLIC, pre-revealed.
  | { hasType: BattleType } | { vsType: BattleType } | { atkType: BattleType[] }
  | { hasAbility: AbilityId } | { hasItem: ItemId } | { marked: MarkId } | { boardMark: MarkId }
  | { contact: true } | { sound: true } | { bullet: true } | { punch: true }   // any move flag
  | { superEffective: true } | { resisted: true }
  | { pristine: true }                        // counters === 0 && never yet marked — Focus Sash / Sturdy
  | { counters: { min?: number; max?: number } }
  | { nfe: true } | { grounded: true } | { isAlly: true } | { oncePerGame: true }
  | { noCaptureThisTurn: true } | { charge: { min: 0|1|2 } }
  | { class: PieceClass[] } | { rung: { min?: Rung; max?: Rung } };

export type MarkFilter  = { ids: MarkId[] } | { class: 'rotation'|'counter'|'field'|'square'|'side' }
                        | { all: true };
export type TypeSpec    = BattleType | 'move' | 'attacker' | 'target';   // 'move' = Protean's runtime type
export type FormeSpec   = { species: SpeciesId } | { megaOf: SpeciesId } | { evoOf: SpeciesId };
export type AbilitySpec = AbilityId | 'copy-target' | 'none';
export type ItemSpec    = ItemId | 'steal-target';
export type InvokePool  = 'metronome-flagged' | 'own-slots' | 'target-slots' | 'last-used';
export type VetoScope   = 'type'|'element'|'class'|'chain'|'indirect'|'rider'|'ally'|'absolute'|'bind';

/** One generated row per mark. 116 rows, emitted by compiler pass 1, ~0.4 KB gz. */
export interface MarkRow {
  id: MarkId; name: string;
  scope: 'piece' | 'square' | 'side' | 'board';
  class: 'rotation' | 'counter' | 'field' | 'hazard' | 'screen' | 'modifier';
  defaultDur: number | 'persist';     // from condition.duration; measured max 5
  maxLayers: 1 | 2 | 3;               // from the move (Spikes 3, Toxic Spikes 2, else 1)
  tick?: Effect;                      // what it does at ON_CHECKUP or ON_ENTER
  mod?: Op[];                         // standing modifier while present (Burned's TILT(atk,−1))
  glyph: number;                      // index into the 18+ glyph sheet
}

/** The ONLY channel from engine to view. Serialisable, replayable, and what the Why panel renders. */
export type EffectEvent =
  | { t:'tempoRoll'; faces:[number,number,number] }
  | { t:'clash'; attacker:PieceId; defender:PieceId; slot:0|1|2|3; atkType:BattleType;
      defType:BattleType; mult:0|0.5|1|2; rung0:Rung; face:number;
      ladder:{ label:string; d:number }[];        // every contribution, in application order
      rung:Rung; outcome:'REPELLED'|'BACKLASH'|'CLEAN'|'SURGE'|'CRITICAL'; }
  | { t:'blocked'; attacker:PieceId; defender:PieceId; scope:VetoScope; explain:string }
  | { t:'removed'; piece:PieceId; cause:string } | { t:'relocated'; piece:PieceId; from:Square; to:Square; mode:string }
  | { t:'marked'; mark:MarkId; where:Square|'board'|Side; dur:number|'persist' }
  | { t:'unmarked'; marks:MarkId[] } | { t:'boosted'; piece:PieceId; d:Partial<Record<Stat,number>>; clamped:boolean }
  | { t:'counters'; piece:PieceId; from:number; to:number } | { t:'became'; piece:PieceId; species?:SpeciesId; type?:BattleType; cls?:PieceClass }
  | { t:'equipped'; piece:PieceId; item?:ItemId; ability?:AbilityId; consumed:boolean }
  | { t:'charge'; piece:PieceId; slot:number; to:number } | { t:'warped'; from:Rung; to:Rung; source:string }
  | { t:'tempo'; kind:string } | { t:'scheduled'; delay:number; kind:string }
  | { t:'invoked'; move:MoveId } | { t:'revealed'; what:string; subject:PieceId }
  | { t:'coin'; heads:boolean[]; passed:boolean } | { t:'vetoed'; scope:VetoScope }
  | { t:'pierced'; scopes:VetoScope[] } | { t:'checkup'; step:string }
  | { t:'terminal'; result:Terminal };

export type Terminal =
  | { kind:'king-captured'; winner:Side }
  | { kind:'immobile';      winner:Side }
  | { kind:'perpetual';     winner:Side }
  | { kind:'draw'; reason:'repetition'|'no-progress'|'lone-kings' }
  | { kind:'adjudicated'; winner:Side|null; prizes:[number,number] };

/** The AI's ordering/quiescence oracle. A 18x18x6 baked table, 1 944 bytes. */
export interface ClashEstimate { pDie:number; pBonus:number; dMaterial:number; }

/** The draft's output. 16 of these ARE an Army; the match rules see nothing else. */
export interface PieceSpec {
  cls: PieceClass; species: SpeciesId; declaredType: BattleType;
  ability: AbilityId; item: ItemId; slots: [MoveId, MoveId, MoveId, MoveId];
}
export type DraftRequirement =
  | { kind:'distinctTypes'; min:number } | { kind:'immunityBreaker'; min:1 }
  | { kind:'aceLimit'; max:1 } | { kind:'ruinLimit'; max:1 }
  | { kind:'itemBan'; item:ItemId; classes:PieceClass[] };

/** Meta-game only. src/rules/ may not import this file (enforced by no-restricted-imports). */
export interface OwnedIndividual {
  uid: string; species: SpeciesId; typePref: BattleType; ability: AbilityId;
  slotSwap: MoveId | null; nickname: string | null; cosmetic: number; games: number; wins: number;
}
```

### 2.8 Deterministic dispatch order — the invariant the pure engine actually needs

Several entries frequently listen on the same trigger (measured worst case: an `ON_CHECKUP` with 16 pieces
each carrying an item, an ability and up to three counter-class marks). A pure engine must fire them in a
**total order that is a function of state alone** — no insertion order, no `Map` iteration order, no
`Object.keys`. Pass 1 did not specify one; this is the gap that would have produced the first desync bug.

> **Dispatch order** for all listeners on one trigger, lexicographically by:
> 1. **side** — the side to move first, then the other;
> 2. **square index** — 0…63 in `board.ts`'s own ordering (board-scoped and side-scoped listeners sort as if
>    they stood on square 64 and 65);
> 3. **source kind** — `mark` < `ability` < `item` < `move`, so a Lum Berry cures before an ability reacts to
>    the status, which is the games' own ordering;
> 4. **`MarkRow.id` / `AbilityId` / `ItemId`** ascending — the compiler's stable ids, which are a pure
>    function of the dataset;
> 5. **`PieceId`** ascending, as the final tie-break, which cannot tie.

`onResidualOrder` from the dataset is deliberately **not** used: it is a Showdown speed-tie artefact, it is
absent on most entries, and the TCG's published Checkup order (§7.3 step 3) is both authentic and total.
`dispatch.test.ts` asserts that a state serialised, reloaded and re-run emits a byte-identical `EffectEvent[]`.

---

## 3. The compiler

Runs at **build time** in `tools/compile/`. Reads `@pkmn/dex` + `@pkmn/sim` + `data/curated/*.json`, emits
`src/data/generated/*`. Deterministic: same inputs ⇒ byte-identical output, asserted in CI.

### 3.1 Five passes

```
pass 1  ADMIT      filter by isNonstandard; assign stable uint16 ids; build the 116-row mark table
pass 2  DERIVE-C1  read declarative fields              -> Effect[]   (425 moves + 230 items complete)
pass 3  DERIVE-C2  parse handler names (§1.3 grammar)   -> Trigger + Region per handler
pass 4  DERIVE-C3  scan handler source                  -> Op[] + Guard[] + params
pass 5  PATCH      apply data/curated/*.json as a DIFF; emit; assert totality
```

Passes 2–4 **accumulate into the same `Effect[]`**; they do not compete. Pass 5 is a patch layer, and that is
the architectural point: **a curated entry is a diff against the compiler's proposal, not an authoring task.**
The generator writes `build/compile-report.json` recording, for all 1 797 entries, which pass produced each
op — so §1.6's ledger is regenerated and re-asserted on every build rather than being a claim in a document.

### 3.2 Pass 2 — declarative derivation

```ts
function deriveC1(m: DexMove): Effect[] {
  const region = REGION_OF_TARGET[m.target]                             // 12-row table, §2.4
    ?? (RANGED_FLAGS.some(f => m.flags[f]) ? 'RAY_LOS' : 'MELEE');
  const out: Effect[] = [];
  const ops: Op[] = [];

  // --- the payload, in Showdown's own field order ---
  if (m.category !== 'Status')   ops.push({ op:'CLASH', slot:'this' });
  if (m.ohko)                    ops.push({ op:'WARP', from:[0,1,2], to:3 });          // 4 moves
  if (m.status)                  ops.push({ op:'MARK', mark: markOf(m.status) });       // 15 moves
  if (m.volatileStatus)          ops.push({ op:'MARK', mark: markOf(m.volatileStatus), dur: DUR(m) });
  if (m.boosts)                  ops.push({ op:'BOOST', d: m.boosts });
  if (m.heal)                    ops.push({ op:'MEND', counters: countersOf(m.heal) });
  if (m.sideCondition)           ops.push({ op:'MARK', mark: markOf(m.sideCondition),
                                            layers: HAZARD_LAYERS[m.sideCondition] ?? 1, dur: DUR(m) });
  if (m.slotCondition)           ops.push({ op:'SCHEDULE', delay:1, then: slotEffect(m) });
  if (m.weather || m.terrain || m.pseudoWeather)
                                 ops.push({ op:'MARK', mark: markOf(m.weather ?? m.terrain ?? m.pseudoWeather),
                                            dur: DUR(m) ?? 5 });
  if (m.forceSwitch)             ops.push({ op:'RELOCATE', to:'push', dist:1 });
  if (m.callsMove)               ops.push({ op:'INVOKE', pool:'metronome', depth:1 });
  if (m.stallingMove)            ops.push({ op:'MARK', mark: PROTECT, dur:1 }, { op:'MARK', mark: STALL });

  out.push({ when:'ON_ACT', where: region, ops,
             power: tierOf(m.basePower || 60),        // the || 60 guard: 43 damaging moves have bp 0
             tilt:  accuracyTilt(m.accuracy),
             charge: clamp(Math.round(m.pp / 5), 1, 5),
             dur: DUR(m) });

  // --- self-directed consequences: a SECOND Effect at a different trigger ---
  const selfOps: Op[] = [];
  if (m.drain)        selfOps.push({ op:'MEND', counters: +countersOf(m.drain) });
  if (m.recoil)       selfOps.push({ op:'MEND', counters: -countersOf(m.recoil) });
  if (m.self?.boosts) selfOps.push({ op:'BOOST', d: m.self.boosts });
  if (m.selfSwitch)   selfOps.push({ op:'RELOCATE', to:'origin' });
  if (m.selfdestruct) selfOps.push({ op:'REMOVE' });
  if (selfOps.length) out.push({ when:'ON_CAPTURE', where:'SELF', ops: selfOps });

  // --- riders: 416 measured secondaries. TCG coin, snapped to powers of 1/2 (§7.4). ---
  for (const s of [...(m.secondaries ?? [])])
    out.push({ when:'ON_CAPTURE', where: s.self ? 'SELF' : 'TARGET',
               guard: { coins: coinsOf(s.chance ?? 100) },
               ops: [ ...(s.status         ? [{op:'MARK', mark: markOf(s.status)}] : []),
                      ...(s.volatileStatus ? [{op:'MARK', mark: markOf(s.volatileStatus), dur:1}] : []),
                      ...(s.boosts         ? [{op:'BOOST', d: s.boosts}] : []),
                      ...(s.self?.boosts   ? [{op:'BOOST', d: s.self.boosts}] : []) ] });

  // --- scalars with no op: they parameterise the Clash ---
  //  multihit           -> WARP(reroll n, keep best)          22 moves
  //  priority >= +1     -> TEMPO('react')                     21 moves
  //  priority <= -1     -> TEMPO('act-last')                   6 moves
  //  flags.charge       -> MARK('charging', dur 2)            13 moves
  //  flags.recharge     -> MARK('recharging', dur 1)           8 moves
  //  willCrit           -> WARP(from any, to 3, once-per-turn) 5 moves
  return out;
}
```

Four field-level guards that are non-negotiable, each measured by me:

- **`m.basePower || 60`.** **43 damaging moves have `basePower === 0`** (Gyro Ball, Low Kick, Seismic Toss,
  Flail, Electro Ball, Fissure…). Without the guard they compile to a strength-0 attack, which reads to a
  player as a bug.
- **Read `secondaries[]` *and* `secondary`, not just `status`.** Re-measured this pass, and the case is far
  stronger than pass 1 stated: **15 moves inflict a non-volatile status as a primary effect; 141 do it as a
  rider** (brn 47, par 45, psn 28, frz 13, slp 4, tox 4) plus **62 flinch riders**, out of **416 riders in
  total**. A status system reading only `move.status` covers 15 moves and misses 203. Note also that pass 1
  read only `secondaries[]`; the dataset puts a *single* rider on the singular field `secondary`, which is the
  common case, so a compiler that misses it drops most of the class. **`frz` has 13 rider applications and
  zero primary ones**, so a freeze mechanic built from `move.status` is dead on arrival — one independent
  reason I fold Frozen into Asleep (§7.7), following `recon-tcg.md`.
- **`ignoreImmunity` is read inverted.** Measured: it is `true` on **270 of 271** admitted Status moves and on
  exactly **three** damaging moves (`Bide`, `Future Sight`, `Thousand Arrows: {Ground:true}`). It is not an
  exception list; it is the dataset *stating a rule*: **support moves bypass type immunity.** That single
  inversion is the largest balance lever in the dex and it bounds the untouchable-piece problem from data
  with no special case (§7.8).
- **Hazard layer counts come from the move**, not from a designer: Spikes 3, Toxic Spikes 2, Stealth Rock 1,
  Sticky Web 1, and persistence from the *absence* of `condition.duration` (39 such marks).

### 3.3 Passes 3 and 4 — handler derivation

```ts
function deriveC2(e: SimEntry): Partial<Effect>[] {
  return handlerNames(e).map(h => {
    const { scope, phase, stem } = parseHandlerName(h);        // §1.3; 121/123 parse
    return { when: TRIGGER_OF_STEM[stem][phase],               // 81 stems x 5 phases
             where: REGION_OF_SCOPE[scope] };                  // SELF|TARGET|ALLY|FOE|KING_RING|BOARD
  });
}

function deriveC3(src: string): { ops: Op[]; guards: Guard[] } {
  const ops: Op[] = [], guards: Guard[] = [];
  for (const { recv, method, args } of extractCalls(src)) {    // 2 845 sites across the dataset
    const mut = MUTATION_TABLE[method];                        // 45 rows -> the 15 measured op families
    if (mut) { ops.push(mut.build(parseArgs(args), recv)); continue; }
    const pred = PREDICATE_TABLE[method];                      // 53 rows -> Guards
    if (pred) { guards.push(pred.build(args)); continue; }
    if (!LOG_TABLE[method] && !PLUMBING_TABLE[method]) report.unclassified.push(method);
  }
  for (const [re, build] of RETURN_PATTERNS)                   // 17 rows, §1.4
    for (const hit of src.matchAll(re)) ops.push(build(hit));
  return { ops, guards };
}

parseArgs(a) = /^'/.test(a)        ? markOf(literal(a))        // 'flinch', 'spikes', 'raindance'
             : /^\{/.test(a)       ? boostVector(a)            // { atk: 12 }
             : /maxhp\s*\/\s*\d+/.test(a) ? countersOfFraction(a)
             : RUNTIME;                                        // resolved against the Clash context
```

**Table budget for the entire back end: 45 mutation rows + 53 predicate rows + 17 return-pattern rows + 81
stem rows + 15 target rows + 7 region-resolver rows = 218 rows.** That is the whole hand-written compiler,
including the 42 residue rows §1.7 added. Compare: **1 797 content entries.** The ratio — one table row per
eight content entries — is the entire argument of this document.

### 3.4 Pass 5 — the patch layer and the CI gates

```jsonc
// data/curated/overrides.json  — 119 entries, the WHOLE hand-written content surface
{
  "levitate": {
    "reason": "no handler in @pkmn/sim; Ground immunity is special-cased in the battle engine",
    "proposalHash": "sha256:0e11…",
    "replace": [{ "when":"CLASH_LEGAL", "where":"NONE",
                  "ops":[{"op":"VETO","scope":"element"}], "params":{"type":"Ground","oneShot":true} }]
  },
  "shellarmor": {
    "reason": "crit immunity lives in the engine's crit check, not on the entry",
    "replace": [{ "when":"CLASH_RESULT","where":"SELF","ops":[{"op":"WARP","from":[3],"to":1}] }]
  },
  "gyroball": {
    "reason": "basePowerCallback scales with Speed; board meaning is a design decision",
    "patch": [{ "path":"0.power", "set":3 },
              { "path":"0.ops",  "add":{"op":"TILT","scope":"atk","d":"+1 if defender spe > mine"} }]
  },
  "ringtarget": {
    "reason": "no handler; the engine reads the item during the immunity check",
    "replace": [{ "when":"CLASH_LEGAL","where":"SELF","ops":[{"op":"PIERCE","scope":["type"]}] }]
  }
}
```

The generator **fails the build** if:

1. any admitted entry produces no `Effect[]` (**totality**);
2. an override names an entry that no longer exists, **or whose compiler proposal has changed since the
   override was written** (`proposalHash`) — this is how a `@pkmn/dex@0.11` bump surfaces *semantic* drift
   instead of silently keeping a stale patch;
3. an **82nd** handler stem, a **46th** mutation verb, or an unknown `isNonstandard` value appears;
4. any op references a `MarkId` outside the generated mark table;
5. **`INVOKE` appears with `depth !== 1`, or any op named `SUMMON` exists** — gate 5 *is* the termination
   proof, enforced by CI rather than by discipline;
6. the derived share falls below 88% or the curated list exceeds 140 entries (regression gate on §1.6);
7. **the unclassified call-site share exceeds 1%** (currently 0.4% after §1.7's rows; the gate exists so that a
   dependency bump introducing a genuinely new mutation verb *fails the build* rather than silently producing a
   subtly wrong effect, which is the failure mode this whole architecture exists to prevent).

### 3.5 Bundle budget

| Payload | gzip | Basis |
|---|---|---|
| `moves.bin` — 950 × packed `Effect[]` | **≈ 9 KB** | `recon-abilities-items.md` measured 310 archetype records at 0.7 KB gz; scaled by size |
| `abilities.bin` + `items.bin` | **≈ 4 KB** | same basis |
| `species.bin` — 1 367 formes, columnar | **≈ 17 KB** | `recon-tech.md` measured 76.9 KB gz JSON → 17.4 KB columnar |
| `marks.bin` — 116 rows | **0.4 KB** | |
| `typechart.bin` — 18 × 18 `Int8Array` | **0.2 KB** | measured |
| strings: names + `shortDesc` (tooltips) | **≈ 18 KB** | measured 7.7 + 9.5 KB gz |
| **critical-path data total** | **≈ 49 KB** | budget 55 KB, CI fails at 60 KB (`recon-tech.md`'s gate) |
| lazy: 4 auto-picked slots + 8-alternative shortlist per species | ≈ 24 KB | loaded during draft |
| lazy: full learnsets, delta-varint | 43.8 KB | measured; only for the Custom moveset toggle |

---

## 4. Twenty-seven traces, end to end

Each row: the measured dex fields, which channel fired, the emitted `Effect[]`, and the board behaviour. These
are compiler outputs, not illustrations; the field dumps are in `syscomp-5-traces.mjs`.

**1. Earthquake — the spread move.**
`Ground · Physical · bp 100 · acc 100 · pp 10 · target allAdjacent · no handlers` → **C1 only.**
```
[{ when:'ON_ACT', where:'RING1_ALL', ops:[{op:'CLASH'}], power:4, charge:2 }]
```
**Board:** an ART action. The piece does not move; it resolves a Clash against **all 8 neighbours, friend and
foe**, on one die face. The designated primary target uses the full type chart and can produce BACKLASH or a
bonus; splash targets resolve neutral and can never kill the attacker (§7.5 step 9, following
`recon-tcg.md`'s "don't apply Weakness and Resistance for Benched Pokémon"). Ground→Flying is 0×, so Flying
neighbours are simply not in the region — Earthquake reads correctly for free.

**2. Stealth Rock — the hazard.**
`Rock · Status · target foeSide · sideCondition 'stealthrock' · pp 20 · ignoreImmunity true · no move handlers`
(its behaviour is in `condition.onSideStart`/`onSwitchIn`) → **C1 + C2.**
```
[{ when:'ON_ACT', where:'FOE_ZONE', ops:[{op:'MARK', mark:STEALTHROCK, layers:1, dur:'persist'}], charge:4 }]
```
**Board:** paints a 3-square segment of the enemy's third rank from their own back rank — **rank 6 for a White
caster, rank 3 for a Black one** (caster's file ± 1, clamped, §2.4). The mark's generated
row carries `tick: ON_ENTER → MEND(−1) scaled by Rock-vs-defender`: a Flying or Ice piece landing there takes
**2 counters**, a Steel piece takes **0**. Persistent until Defog / Rapid Spin / Court Change. Layer count,
persistence and type scaling all come from data; zero authoring.

**3. Extreme Speed — the priority move.**
`Normal · Physical · bp 80 · priority +2 · target normal` → **C1 only.**
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'CLASH'}], power:3, charge:1 },
 { when:'ALWAYS', where:'SELF',  ops:[{op:'TEMPO', kind:'react'}] }]
```
**Board:** may be declared as a **Reaction** when an enemy begins a Clash against this piece: it resolves
first, and if it captures the attacker the attacker's Clash never happens. One charge, at most one Reaction
per piece per enemy turn. This is the whole of `priority` (21 moves at ≥ +1), and it converts "a defended
square" into an *active* threat.

**4. Will-O-Wisp — the status move.**
`Fire · Status · acc 85 · target normal · status 'brn' · pp 15 · no handlers` → **C1 only.**
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'MARK', mark:BURNED}], charge:3, tilt:-1 }]
```
**Board:** `BURNED`'s generated row is `{class:'counter', tick: MEND(−1) at ON_CHECKUP, mod: TILT(atk,−1)}` —
the piece chips down *and* attacks worse, which is exactly what a burn does. And because the move is Status,
`ignoreImmunity` is true, so **it is legal against a type-immune piece**: the Ghost your Normal army cannot
touch can still be burned to death in three of your turns. Hard problem 6, answered from data.

**5. Fissure — the OHKO.**
`Ground · Physical · bp 0 · acc 30 · ohko true · pp 5` → **C1 only.** `acc < 50 ⇒ gate(die ≥ 5)`.
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'CLASH'},{op:'WARP', from:[0,1,2], to:3}],
   power:2, guard:{ die:'>=5' }, charge:1 }]
```
**Board:** one charge per game, and legal only on a revealed face of 5 or 6 — so it is **never a surprise**:
the opponent can see, at the start of your turn, that your Fissure is live this turn. If used it promotes the
rung to CRITICAL regardless of matchup. Draft-restricted to one Ace per side (§8.3). Sheer Cold's
`ohko: 'Ice'` becomes a `guard` that fails against Ice pieces. Four moves, one op, no bespoke code.

**6. Bullet Seed — the multi-hit.**
`Grass · Physical · bp 25 · multihit [2,5] · pp 30 · flags bullet` → **C1 only.** `flags.bullet ⇒ RAY_LOS`.
```
[{ when:'ON_ACT', where:'RAY_LOS', ops:[{op:'CLASH'},{op:'WARP', reroll:[2,5], keep:'best'}],
   power:1, charge:5 }]
```
**Board:** a ranged attack at Chebyshev ≤ 2 along a ray, first occupied square only. It re-rolls the ladder
`n ∈ [2,5]` times **from the same public triple, walking forward** (so it consumes the turn's later faces),
and keeps the best rung. That makes multi-hit the natural counter to a bad face *and* to Protect and
Substitute — which is what multi-hit is for. Skill Link forces `n = max`; Loaded Dice raises the minimum.

**7. U-turn — the self-switch.**
`Bug · Physical · bp 70 · selfSwitch true · target normal · no handlers` → **C1 only.**
```
[{ when:'ON_ACT',     where:'MELEE', ops:[{op:'CLASH'}], power:2, charge:4 },
 { when:'ON_CAPTURE', where:'SELF',  ops:[{op:'RELOCATE', to:'origin'}] }]
```
**Board:** capture, then **return to the square you came from** — the exact mechanic `DIRECTION.md` names as
the faithfulness standard, falling out of one boolean field. Tactically enormous: a hit-and-run that never
leaves the attacker on the exposed square. Baton Pass (`selfSwitch: 'copyvolatile'`) is trace 10.

**8. Swords Dance — the boost.**
`Normal · Status · target self · boosts {atk:+2} · pp 20 · flags dance` → **C1 only.**
```
[{ when:'ON_ACT', where:'SELF', ops:[{op:'BOOST', d:{atk:+2}}], charge:4 }]
```
**Board:** an ART with no relocation. `+2 atk` is `+2` to `might`, i.e. **+2 on the Clash roll for physical
captures**, which under the ladder is a two-band shift: it converts a neutral matchup into a bonus-move
matchup on a face of 4 and turns a resisted matchup from "both die" into "clean capture" on a 5. Iron Defense
(`{def:+2}`) is a visibly *different* effect because the 7-vector is kept (§12.3). `flags.dance` is what
Dancer copies.

**9. Trick Room — the weird one.**
`Psychic · Status · target all · pseudoWeather 'trickroom' · priority −7 · condition.duration 5 · pp 5` →
**C1 + C2** (the move has no handlers; `condition.onFieldStart` supplies the fingerprint).
```
[{ when:'ON_ACT', where:'BOARD', ops:[{op:'MARK', mark:TRICKROOM, dur:5}], charge:1 }]
```
**Board:** `TRICKROOM`'s generated row inverts exactly one comparison — **which moves may Reaction-interrupt.**
Normally `priority ≥ +1` reacts; under Trick Room `priority ≤ −1` reacts instead, so for five turns Counter,
Avalanche, Focus Punch and Circle Throw are the pre-emptors and Quick Attack is not. One mark, one flipped
comparison, and an otherwise-dead archetype (the 6 negative-priority moves) becomes live for a window. It is
also the Stadium slot: exactly one field effect exists at a time and a new one replaces the old
(`recon-tcg.md`'s Stadium rule), and **a side may not re-cast the field already in play**, which closes a
permanent-buff repetition hole.

**10. Baton Pass — the state transfer.**
`Normal · Status · target self · selfSwitch 'copyvolatile' · pp 40 · onHit (a switch request, no mutation)`
→ **C1 gives the relocation; the transfer semantics are 1 of the 119 curated rows.**
```
[{ when:'ON_ACT', where:'SELF',
   ops:[{op:'RELOCATE', to:'origin'},
        {op:'MARK', mark:LEGACY, dur:'persist', params:{carry:'boosts+marks', cap:2}}], charge:5 }]
```
**Board:** the piece retreats to its origin square and **leaves its accumulated boosts and marks on the
square it vacated**; the next friendly piece to end a move there picks them up. Bounded: once per piece per
game, transferred boosts capped at +2 total, and the `LEGACY` mark is part of the repetition hash so a
pass-and-repass cycle cannot draw by accident.

**11. Protect — the staller.**
`Normal · Status · target self · volatileStatus 'protect' · priority +4 · stallingMove true ·
condition.duration 1 · onHit: pokemon.addVolatile('stall')` → **C1 + C3.**
```
[{ when:'ON_ACT', where:'SELF', ops:[{op:'MARK', mark:PROTECT, dur:1}, {op:'MARK', mark:STALL}], charge:2 }]
```
**Board:** uncapturable for one opponent reply. The `STALL` mark carries **Showdown's own escalation** —
success probability `(1/3)^consecutive`, reset by using any other move — so n consecutive Protects cost `3^n`
and stalling is self-limiting with no rule I had to invent. The six punish variants are six `ON_SURVIVE` rows
in the mark table (Spiky Shield → attacker `MEND(−1)`; Baneful Bunker → `MARK(POISONED)`; King's Shield →
`BOOST({atk:−1})`), i.e. data.

**12. Explosion — the self-KO.**
`Normal · Physical · bp 250 · target allAdjacent · selfdestruct 'always' · pp 5` → **C1 only.**
```
[{ when:'ON_ACT',     where:'RING1_ALL', ops:[{op:'CLASH'}], power:5, charge:1 },
 { when:'ON_CAPTURE', where:'SELF',      ops:[{op:'REMOVE'}] }]
```
**Board:** a Clash against all 8 neighbours, then remove yourself: at most 8 + 1 = 9 pieces, never the board.
`selfdestruct:'always'` (3 moves) fires the `REMOVE` even on failure; `'ifHit'` (4 moves: Final Gambit,
Memento, Healing Wish, Lunar Dance) only on success. The one rule the compiler cannot supply is the legality
rule that also fixes the video's bug: **a move whose resolution, under the revealed dice, necessarily removes
your own King is illegal** (§7.12 R3). Self-KO is merely its most extreme case.

**13. Metronome — the recursion.**
`Normal · Status · target self · callsMove true · flags failinstruct/failcopycat/nosleeptalk ·
onHit: this.sample(moves).id` → **C1 (`callsMove`) + C3 (`useMove` extracted).**
```
[{ when:'ON_ACT', where:'SELF', ops:[{op:'INVOKE', pool:'metronome-flagged', depth:1}], charge:2 }]
```
**Board:** samples one move from the **`flags.metronome` pool intersected with your own army's slots**, minus
every `callsMove` and every `selfdestruct` move, using the seeded PRNG — so Metronome is deterministic and
replayable, and the resolved move is **shown before it resolves** so it cannot cost you a piece by surprise.
`depth:1` in the type makes recursion unconstructible. The denylist is data the dataset already curated:
7 `callsMove` moves, 29 `flags.failinstruct`, 35 `flags.failcopycat`.

**14. Shadow Ball — the ranged attack with a rider.**
`Ghost · Special · bp 80 · flags bullet · secondary {chance:20, boosts:{spd:−1}}` → **C1 only.**
```
[{ when:'ON_ACT',     where:'RAY_LOS', ops:[{op:'CLASH'}], power:3, charge:3 },
 { when:'ON_CAPTURE', where:'TARGET', guard:{coins:'1 of 4'}, ops:[{op:'BOOST', d:{spd:-1}}] }]
```
**Board:** Gengar captures at range 2 along a ray **without moving**, and one time in four the target's guard
drops. This is the largest single archetype — **416 measured riders** across the dex — and it is one compiler
path. The rider is a TCG coin flipped *after* commitment, which is legitimate precisely because it can never
cost a piece (§7.5 step 7).

**15. Soak — the identity change.**
`Water · Status · acc 100 · target normal · onHit: target.setType('Water')`. **No type-change field exists
anywhere in `@pkmn/dex`** → **C3 only. Invisible to a dex-only compiler.**
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'BECOME', type:'Water'}], charge:4 }]
```
**Board:** **the highest-leverage move in the game.** An enemy piece's declared type becomes Water: you have
rewritten its position in the type chart, and therefore what may capture it and what it may capture. A Steel
rook that repelled 10 of 18 attacking types becomes a Water rook that resists 3. Six moves do this and they
are the most *Pokémon Chess* moves in the dex; they cost nothing to implement because `BECOME` already exists
for Mega Evolution and promotion.

**16. Belly Drum — the headline demo.**
`@pkmn/dex` reports **no `boosts` field**. C3 extracts both statements from the source:
```
[{ when:'ON_ACT', where:'SELF', ops:[{op:'MEND', counters:-1}, {op:'BOOST', d:{atk:+12}}], charge:2 }]
```
**Board:** take a damage counter, gain the maximum attack boost (clamped to +6 by the shared `BOOST` clamp) —
"halve your HP, maximise your Attack", correctly, with **zero authoring**. Any design that reads only
`@pkmn/dex` ships this inert.

**17. Rest — the second headline demo.**
`@pkmn/dex` reports **no `status`**. C3 extracts `setStatus('slp')`, the literal `time = 3`, and `heal(maxhp)`:
```
[{ when:'ON_ACT', where:'SELF', ops:[{op:'MARK', mark:ASLEEP, dur:3}, {op:'MEND', counters:+3}], charge:1 }]
```
**Board:** clear every damage counter and fall Asleep for up to three of your own turns — a genuine,
legible, dangerous decision on a chess board, and the duration is a literal in Showdown's source rather than
a number I chose.

**18. Thousand Arrows — the immunity breaker.**
`Ground · bp 90 · target allAdjacentFoes · volatileStatus 'smackdown' · ignoreImmunity {Ground:true} ·
onEffectiveness` → **C1 + C3.**
```
[{ when:'ON_ACT',    where:'RING1_FOES', ops:[{op:'CLASH'},{op:'MARK', mark:GROUNDED, dur:'persist'}], power:3 },
 { when:'CLASH_LEGAL', where:'SELF',     ops:[{op:'PIERCE', scope:['type']}], guard:{vsType:'Flying'} }]
```
**Board:** the only *damaging* move in the dex with a typed `ignoreImmunity`, and it does exactly what it does
in the games — it hits Flying pieces and grounds them permanently. `recon-tcg.md` is right that typeless /
immunity-piercing damage should be a first-class flag rather than a special case; here it is one op.

**19. Counter — the reaction.**
`Fighting · target scripted · priority −5 · damageCallback · condition.duration 1` → **C1 + C2.**
```
[{ when:'ON_ACT', where:'REACTIVE', ops:[{op:'MARK', mark:COUNTERING, dur:1}], charge:4 },
 { when:'ON_KO',  where:'SELF', guard:{marked:COUNTERING, byMelee:true}, ops:[{op:'REMOVE', target:'attacker'}] }]
```
**Board:** spend your turn arming Counter; if a melee capture removes this piece before your next turn, the
attacker dies with it. This is mutual destruction *chosen in advance* instead of read off a chart, and it is
the one place the game rewards being attacked.

**20. Wonder Guard — the ability the compiler surprised me on.**
`onTryHit: if (target.runEffectiveness(move) <= 0 || !target.runImmunity(move)) return false;` → **C3
derives it**: a `VETO` guarded by an effectiveness predicate. But I override the *bound*, per
`recon-tcg.md`, and the override is 3 lines:
```
[{ when:'CLASH_LEGAL', where:'SELF',
   ops:[{op:'VETO', scope:'absolute'}], params:{ unlessRung:'>=2', unlessClass:['pawn','king'] } }]
```
**Board:** Shedinja **cannot be captured by a Queen, Rook, Bishop or Knight**, and **can always be captured
by any Pawn or King**. That is the printed TCG card ("immune to Evolved Pokémon and Pokémon-ex, Basics get
through") and it is Stratego's *always supply the key, over-supplied*: each side has eight pawns and a king.
Permanent, legible, and it makes Shedinja a playable nightmare rather than a ban.

**21. Levitate — the honest curated row.**
**No handlers in `@pkmn/sim`, only `flags.breakable`.** Ground immunity is inside the engine's immunity check.
The compiler *knows* it is a defence (from the flag) and *cannot* know against what, so it emits
`archetype: 'UNDERDETERMINED'`, the build report lists it, and the curated row supplies:
```
[{ when:'CLASH_LEGAL', where:'NONE', ops:[{op:'VETO', scope:'element'}], params:{type:'Ground', oneShot:true} }]
```
**Board:** the first Ground capture attempted against this piece is illegal and **pops the ward**; the second
succeeds. Air Balloon's real behaviour is the template ("Pops when holder is hit"), so the bound is canon
rather than invented. I found five more abilities in exactly the same position (`Battle Armor`, `Shell Armor`,
`Multitype`, `RKS System`, `Tera Shell`) — a finding `recon-data-substrate.md` predicted for Levitate alone.

**22. Gyro Ball — the variable-power curated row, and why 48 moves are curated.**
`basePowerCallback: floor(25 * target.getStat('spe') / pokemon.getStat('spe')) + 1`. The compiler reads the
function perfectly; it cannot decide what Speed means on a board where nothing has a Speed stat. So:
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'CLASH'},
    {op:'TILT', scope:'atk', d:'+1 when the defender has more spe boosts than me'}], power:3, charge:1 }]
```
**Board:** a tier-3 melee capture with a +1 when the target is the faster piece. A Pokémon expert will notice
it is an approximation; that is the honest cost, it is 48 moves of 950, and each is one line.

**23. Screech — the trace that found a bug in my own resolver.**
`Normal · Status · bp 0 · acc 85 · pp 40 · target normal · boosts {def:−2} · ignoreImmunity true ·
flags protect/reflectable/mirror/sound/bypasssub/allyanim/metronome · no handlers` → **C1 only.**
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'BOOST', d:{def:-2}}], charge:5, tilt:-1 }]
```
**Board:** an ART that lowers an *enemy* piece's defensive Clash roll by 2 for the rest of the game (boosts do
not decay). Because it is a Status move, `ignoreImmunity` is true, so **you may Screech the Ghost piece your
Normal army cannot touch**, and then a *different* piece kills it.

**This trace is why the second pass exists.** Writing it out against pass 1's resolver, I found that
`rung := min(rung, clamp(rung0 + step − guard, −1, 3))` makes a negative `guard` unable to raise the rung —
so a defence *debuff* does literally nothing. Measured (`syscomp2-4-new.mjs`): **31 moves lower a foe's
`def`/`spd`** — `Screech, Metal Sound, Leer, Tail Whip, Tickle, Fake Tears, Acid Spray, Crunch, Shadow Ball,
Psychic, Focus Blast, Flash Cannon, Energy Ball, Earth Power, Bug Buzz, Iron Tail, Liquidation, Razor Shell,
Crush Claw, Rock Smash, Apple Acid, Grav Apple, Fire Lash, Lumina Crash, Luster Purge, Seed Flare,
Shadow Bone, Spicy Extract, Thunderous Kick, Triple Arrows, Acid` — and all 31 were inert. §7.5 step 2/5 is
rewritten to fix it, and `clash.table.test.ts` gains the case.

**24. Choice Band — the item whose cost is the interesting half.**
`isChoice: true · fling {basePower:10} · onStart / onModifyMove / onModifyAtk`, and the source is:
`onModifyMove(move, pokemon) { pokemon.addVolatile('choicelock'); }` and
`onModifyAtk(atk, pokemon) { … return this.chainModify(1.5); }` → **C1 (`isChoice`) + C3 (both handlers).**
```
[{ when:'CLASH_ROLL', where:'SELF', ops:[{op:'TILT', scope:'atk', d:+1}] },              // chainModify(1.5)
 { when:'ON_ACT',     where:'SELF', ops:[{op:'MARK', mark:CHOICELOCK, dur:'persist'},
                                        {op:'TEMPO', kind:'lock-slot'}] }]                // addVolatile
```
**Board:** +1 to every Clash roll this piece makes, and **the first slot it uses is the only slot it may ever
use again** — including slot 0, so a Choice Band piece that captures once with its Melee slot can never use an
ART for the rest of the game. That is the item's whole identity: in the games the cost is "you cannot switch
attacks"; on a chess board "you may only ever do that one thing again" is sharper still, and it is derived
rather than designed — the `chainModify(1.5)` and the `addVolatile('choicelock')` are both literals in the
source. Choice Specs is the same two effects on the special side; Choice Scarf trades the `TILT` for
`BOOST({spe:+2})`. All three are illegal on King and Queen (§8.3).

**25. Focus Sash — the survive-once ward, and the exploit it must not enable.**
No `isBerry`, no taxonomy field but `fling`. One handler, and the source *is* the specification:
```js
onDamage(damage, target, source, effect) {
  if (target.hp === target.maxhp && damage >= target.hp && effect && effect.effectType === 'Move') {
    if (target.useItem()) return target.hp - 1;   //  WARP(any-lethal -> survive), then consume
  }
}
```
→ **curated (1 of 119)**, because the mutation is a `return` value the scanner sees but cannot type.
```
[{ when:'CLASH_RESULT', where:'SELF', guard:{pristine:true},
   ops:[{op:'WARP', from:[1,2,3], to:-1, once:true}, {op:'EQUIP', item:null, consume:true}] }]
```
**Board:** the first capture that would remove this **pristine** piece is downgraded to REPELLED — the
attacker bounces back to its origin and the Sash shatters visibly. `target.hp === target.maxhp` maps exactly
onto `pristine` (zero damage counters and never yet marked), so the trigger is the real one, not an analogue.

**The `from:[1,2,3]` is the load-bearing detail and it is a balance rule, not a transcription.** Rung 0 —
BACKLASH — is deliberately *not* in the `from` set. Were it included, a Sash pawn could attack a Queen at
0.5×, survive its own backlash, and take the Queen for free: the single worst exploit in the design space.
The rule, stated once and applied to every survive-once effect (Sturdy, Sash, Endure, Tera Shell):
**a shield protects you from being killed; it does not protect you from killing yourself.** Rock Head is the
one named exception, and it is authentic — Rock Head's entire job in the games is to ignore recoil.

**26. Fake Out — the Reaction that is really a status move.**
`Normal · Physical · bp 40 · acc 100 · pp 10 · priority +3 · target normal · flags contact/protect/mirror`
→ **C1 only.** Its flinch is in the engine's first-turn logic, so what the compiler emits is the priority:
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'CLASH'}], power:1, charge:2 },
 { when:'ALWAYS', where:'SELF',  ops:[{op:'TEMPO', kind:'react'}] },
 { when:'ON_CAPTURE', where:'TARGET', ops:[{op:'MARK', mark:STUNNED, dur:1}] }]   // curated: the flinch
```
**Board:** a Reaction at power tier 1 — it will rarely capture anything — whose real payload is that whatever
it hits **loses its next activation**. On a chess board that is a tempo weapon, not a damage move, which is
exactly what Fake Out is in the games. It is also the cheapest demonstration of why `STUNNED` unifies
paralysis and flinch (§7.7): 45 par riders + 62 flinch riders = **107 measured applications, one rule, one
visual — the pin rotates 90°.**

**27. Sucker Punch — the read.**
`Dark · Physical · bp 70 · acc 100 · pp 5 · priority +1 · target normal · flags contact` → **C1** for the
Reaction, **curated** for the condition (`onTry` — one of the exactly two handler names that do not parse,
§1.3):
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'CLASH'}], power:2, charge:1 },
 { when:'ALWAYS', where:'SELF', guard:{not:{marked:PROTECT}},
   ops:[{op:'TEMPO', kind:'react'}], params:{ onlyVsAttacker: true } }]
```
**Board:** may be declared as a Reaction **only against a piece that is attacking you** — which is precisely
Sucker Punch's rule in the games ("fails unless the target is using an attacking move"). One charge, one
chance. The faithfulness is free: the restriction that makes Sucker Punch interesting in Pokémon is the same
restriction that makes it interesting on a board.

---

## 5. The same vocabulary is the ability system and the item system

This is the payoff. **An ability is an `Effect[]` with a non-`ON_ACT` trigger. An item is an `Effect[]` with a
consumption counter and a transfer rule.** There is no ability system and no item system — there is one effect
system with three sources. 45 of the handler names are shared across all three kinds, which is the empirical
evidence that they *are* the same thing.

### 5.1 Abilities

| Ability | Channel | Emitted `Effect[]` | Board behaviour |
|---|---|---|---|
| **Rough Skin** (6 species) | C3: `damage(source.baseMaxhp/8)` + `checkMoveMakesContact` | `{ON_SURVIVE, TARGET, guard:{contact}, [MEND(−1)]}` | whatever captures it by contact takes a damage counter |
| **Static** (33) | C3: `trySetStatus('par')` + `randomChance(3,10)` | `{ON_SURVIVE, TARGET, guard:{contact, coins:'1 of 4'}, [MARK(STUNNED)]}` | the contact capturer loses its next activation |
| **Intimidate** (46) | C3: `boost({atk:-1})`, scope `Foe` | `{ON_ENTER, RING1_FOES, [BOOST({atk:-1})]}` | arriving lowers adjacent enemies' Clash rolls |
| **Moxie** (16) | C3: `boost({atk: length})` at `onSourceAfterFaint` | `{ON_CAPTURE, SELF, [BOOST({atk:+1})]}` | snowballs on every capture, clamped +6 |
| **Sturdy** (48) | C3: `onDamage → return target.hp - 1` | `{CLASH_RESULT, SELF, guard:{pristine}, [WARP([1,2,3]→−1, once)]}` | the first capture that would take it fails; the attacker stays put |
| **Thick Fat** (33) | C3: `chainModify(0.5)` + type guard | `{CLASH_ROLL, SELF, guard:{atkType:[Fire,Ice]}, [TILT(def,+2)]}` | +2 defensive roll against Fire and Ice |
| **Mold Breaker** (26) | C3: `move.ignoreAbility = true` | `{CLASH_LEGAL, SELF, [PIERCE(['element','class','absolute'])]}` | its captures ignore all 84 `flags.breakable` defences |
| **Protean** (7) | C3: `setType(move.type)` | `{CLASH_LEGAL, SELF, guard:{oncePerGame}, [BECOME({type:'move'})]}` | once per game, becomes the type of the move it uses, then locked |
| **Drizzle** (3) | C3: `this.field.setWeather('raindance')` | `{ON_ENTER, BOARD, [MARK(RAIN, dur:5)]}` | takes the single Stadium slot for 5 turns |
| **Regenerator** (27) | C3: `heal(baseMaxhp/3)` at `onSwitchOut` | `{ON_EXIT, SELF, [MEND(+1)]}` | heals a counter whenever it moves away |
| **Speed Boost** (14) | C3: `boost({spe:1})` at `onResidual` | `{ON_CHECKUP, SELF, guard:{noCaptureThisTurn}, [BOOST({spe:+1})]}` | +1 per patient turn, clamped +3 by the shared clamp; never combines with a capture chain |
| **Magic Guard** (10) | C3: `onDamage → return false` for non-move effects | `{CLASH_LEGAL, SELF, [VETO('indirect')]}` | immune to hazards, weather, status ticks, thorns |
| **Tinted Lens** (13) | C3: `chainModify(2)` guarded on `typeMod < 0` | `{CLASH_RESULT, SELF(attacker), [WARP([0]→1)]}` | its resisted captures no longer kill it — the named anti-suicide tech |
| **Rock Head** (24) | C3: `onDamage → return null` for recoil | `{CLASH_RESULT, SELF(defender), [WARP([0]→1)]}` | the single named exception that survives BACKLASH |
| **Shadow Tag** (6) | **curated** (predicates only: `tryTrap`) | `{CLASH_LEGAL, KING_RING, [VETO('bind')], params:{exceptKing:true}}` | adjacent enemies may not move *away*; **never binds the enemy King** |
| **Frisk / Forewarn / Anticipation** (62) | **curated** (pure `this.add`) | `{ON_ENTER, NONE, [REVEAL('item'/'slots'/'threats')]}` | permanent board-analysis affordances: highlight what can legally capture this piece |
| **Run Away** (36) | inert by design | `[]` + real `shortDesc` + "flavour only" badge | **refunds 1 draft point**, so it is a bargain rather than a trap |

Note what did **not** need building: no ability hook interface, no ability registry, **no 115 primitive
functions**. `recon-abilities-items.md` costs ~1 700 LOC there; my ability layer is **0 LOC plus 42 JSON
rows**, because the ops already exist for the move layer.

### 5.2 Items

An item is `{ effects: Effect[]; charges: number; onCapture: 'destroy' }`.

| Item | Channel | Emitted `Effect[]` |
|---|---|---|
| **Charcoal** + 25 more type lenses | C1 name/plate + C3 `chainModify(1.2)` | `{CLASH_ROLL, SELF, guard:{atkType:Fire}, [TILT(atk,+1)]}` |
| **Occa Berry** + 17 resist berries | **C1 alone — `naturalGift.type` *is* the resisted type**, verified for all 18 | `{CLASH_ROLL, SELF, guard:{atkType:Fire}, [TILT(def,+2), consume]}` |
| **Sitrus Berry** | C3: `heal(baseMaxhp/4)` at `onUpdate` | `{ON_CHECKUP, SELF, guard:{counters>=2}, [MEND(+1), consume]}` |
| **Lum Berry** + 14 cure berries | C3: `cureStatus()` | `{ON_TAG, SELF, [UNMARK({class:'rotation'}), consume]}` |
| **Leftovers** | C3: `heal(baseMaxhp/16)` | `{ON_CHECKUP, SELF, [MEND(+1)]}` |
| **Life Orb** | C3: `chainModify([5324,4096])` + `damage(baseMaxhp/10)` | `{CLASH_ROLL,SELF,[TILT(atk,+1)]}` and `{ON_CAPTURE, SELF, [MEND(−1)]}` — **it drains on every link of a capture chain, so a Life Orb piece cannot chain indefinitely** |
| **Focus Sash** | curated (an `onDamage` return) | `{CLASH_RESULT, SELF, guard:{pristine}, [WARP([1,2,3]→−1, once), consume]}` |
| **Air Balloon** | curated (mutation is `target.item=''`) | `{CLASH_LEGAL, SELF, [VETO('element'), consume], params:{Ground}}` — **the template for every ward** |
| **Ring Target** | curated (no handler at all) | `{CLASH_LEGAL, SELF, [PIERCE(['type'])]}` — inverted: it pierces *its own holder's* immunities. The immunity breaker the format guarantees. |
| **Rocky Helmet** | C3: `damage(baseMaxhp/6)` at `onDamagingHit` | `{ON_SURVIVE, TARGET, guard:{contact}, [MEND(−1)]}` |
| **Choice Band** | C1 `isChoice` + C3 `chainModify(1.5)` + `addVolatile('choicelock')` | `{CLASH_ROLL,SELF,[TILT(atk,+1)]}` and `{ON_ACT, SELF, [MARK(CHOICELOCK), TEMPO('lock-slot')]}` |
| **Choice Scarf** | same, `onModifySpe` | `{ALWAYS, SELF, [BOOST({spe:+2}), MARK(CHOICELOCK)]}` — illegal on King and Queen (§8.3) |
| **Eviolite** | C1 name + C3 `chainModify(1.5)` guarded on `baseSpecies.nfe` | `{CLASH_ROLL, SELF, guard:{nfe}, [TILT(def,+1)]}` |
| **Expert Belt** | C3: `chainModify` guarded on `typeMod > 0` | `{CLASH_ROLL, SELF, guard:{superEffective}, [TILT(atk,+1)]}` — it literally pays you for knowing the chart |
| **Weakness Policy** | C1 `boosts:{atk:2,spa:2}` + C3 `useItem()` | `{ON_SURVIVE, SELF, guard:{superEffective}, [BOOST({atk:+2,spa:+2}), consume]}` |
| **Scope Lens** | curated (`return critRatio + 1`) | `{CLASH_ROLL, SELF, [TILT('crit-window', +1)]}` |
| **Quick Claw** | C3: `onFractionalPriority` + `randomChance(1,5)` | `{ALWAYS, SELF, guard:{coins:'1 of 4'}, [TEMPO('react')]}` — **the coin is revealed in the Checkup before your turn**, never after you commit |
| **Draco Plate** + 61 `forcedForme`/`onPlate`/`onMemory`/`onDrive` | **C1 alone — the field carries the type** | `{ALWAYS, SELF, [BECOME({type:'Dragon'})]}` |
| **Venusaurite** + 46 real Mega Stones | **C1 alone — `megaStone` names the exact target forme** | `{ON_PROMOTE, SELF, [BECOME({forme:'Venusaur-Mega'})]}` |
| **TR00–TR99** (100) | excluded class | `[]` — reused as the icon set for the signature-move picker |

Re-measured this pass (`syscomp2-5-residue.mjs`): **531 of 536 items carry at least one machine-readable
taxonomy field** — `fling` 443, `itemUser` **108**, `isBerry` 77, `naturalGift` 77, `forcedForme` 61,
`megaStone` 47, `zMove` 35, `onPlate` 34, `isPokeball` 28, `isGem` 18, `onMemory` 17, `onDrive` 4,
`isChoice` 3 — and **all 77 berries carry `naturalGift.type`**, which *is* the resisted type for every resist
berry. So the largest item family in the dex is 100% derived with no prose reading at all, and only **5 items
in the entire dex carry no structured signal whatsoever.** **[SUPERSEDES pass 1's "316 of 536".]** That figure
counted only the boolean class flags and ignored `fling` and `itemUser`, which are the two most widely present
fields; the honest number is much better, and it is why the item layer costs 29 curated rows rather than 300.

### 5.3 The item economy: Format Kits

Choosing any of ~350 held items for each of 16 pieces is `350^16` and paralysing. Instead, **a format declares
a Kit: an ordered list of 12 items, and each side gets one of each.** 16 pieces, 12 items ⇒ four pieces hold
nothing. That one constraint caps the state space, forces real allocation decisions ("who gets the Sash?"),
guarantees both sides face the same toolbox, and makes the item layer *learnable* — a returning player already
knows every item on the board. I adopt `recon-abilities-items.md` §4.3's **Standard 12** verbatim, including
**Ring Target in slot 7**, because a format must guarantee each side ends the draft with an immunity breaker.

Later formats swap the Kit wholesale (Weather Kit, Signature Kit of 12 `itemUser`-locked items and you must
draft their owners). That is how the other ~340 admitted items enter play — **as formats, not as an inventory
screen.** Nothing is missing; it is queued, and the compiler already emitted all of it.

Items are **destroyed on capture** (looting makes every capture a resource decision on top of a chess
decision and lets the winner snowball). Theft is confined to Magician and Pickpocket, countered by Sticky Hold
and Ability Shield, plus the Knock Off / Trick / Thief move layer. Abilities and items are **public, always,
both sides** — `recon-tcg.md` is right that this is not a cost but the design: the TCG puts every persistent
effect face-up and confines hidden information to the hand. Our analogues of the hand are the draft and the
charge budget. `Illusion` is the single sanctioned exception (it renders as a decoy species until its first
Clash).

---

## 6. The total fallback — nothing is ever missing

The fallback is not an error path; it is the **modal case**. 167 of 950 moves are plain damage with no signal
at all, and that is *correct*: Tackle should be a plain capture.

```ts
function fallback(e: AdmittedEntry): Effect[] {
  if (e.kind === 'move' && e.category !== 'Status')
    return [{ when:'ON_ACT', where: REGION_OF_TARGET[e.target] ?? 'MELEE',
              ops: [{ op:'CLASH' }],
              power: tierOf(e.basePower || 60),     // the || 60 guard: 43 moves need it
              tilt:  accuracyTilt(e.accuracy),
              charge: clamp(Math.round(e.pp / 5), 1, 5) }];

  if (e.kind === 'move')                            // an unrecognised Status move
    return [{ when:'ON_ACT', where: REGION_OF_TARGET[e.target] ?? 'SELF',
              ops: [{ op:'BOOST', d: { [bestStatOf(e.owner)]: +1 } }],
              dur: 2, charge: clamp(Math.round(e.pp / 5), 1, 5) }];

  return [];   // ability/item: archetype INERT + real shortDesc as tooltip
               //             + a visible "flavour only" badge + 1 draft point refunded
}
```

Three guarantees:

1. **No content is ever a no-op a player mistakes for a bug.** A damaging move is always at least an ordinary
   capture at a real strength tier; an unclassified Status move is always a small visible self-buff. Splash,
   Celebrate, Happy Hour and Teatime land here and that is the *right* answer — Splash should do nothing.
2. **The fallback is legal-and-boring by construction, never illegal-or-broken.** It emits only `CLASH` or
   `BOOST`, so unclassified content cannot corrupt state.
3. **Inert content is honest rather than hidden**, and it *refunds draft budget*, which is also how
   `Truant` and `Slow Start` stop being traps: Slaking becomes a bargain with a drawback rather than an
   undraftable joke.

**The test that makes the coverage claim auditable rather than asserted.** This is the single most valuable
test in the project:

```ts
// src/data/coverage.test.ts
const report = loadCompileReport();                      // emitted by tools/compile
test('every admitted entry compiles to a legal effect list', () => {
  for (const e of ALL_ADMITTED) {                        // 1797 entries
    const fx = compiled(e.id);
    expect(fx, e.id).toBeDefined();                                          // totality
    expect(['C1','C2','C3','curated','inert']).toContain(e.coverageClass);
    if (e.coverageClass === 'inert') expect(INERT_ALLOWLIST).toContain(e.id); // 68, named
    for (const f of fx) {
      expect(TRIGGERS).toContain(f.when);
      expect(REGIONS).toContain(f.where);
      for (const op of f.ops) {
        expect(OPS).toContain(op.op);
        if (op.op === 'INVOKE') expect(op.depth).toBe(1);                    // termination
        if (op.op === 'MARK')   expect(op.mark).toBeLessThan(MARK_TABLE.length);
        expect(op.op).not.toBe('SUMMON');                                    // monovariant
      }
    }
    if (e.kind === 'move' && e.category !== 'Status')
      expect(fx.some(f => f.ops.some(o => o.op === 'CLASH')), e.id).toBe(true);
  }
  expect(report.derivedShare).toBeGreaterThan(0.88);              // regression gate on §1.6
  expect(report.curated.length).toBeLessThanOrEqual(140);
  expect(report.unclassifiedSiteShare).toBeLessThanOrEqual(0.01); // gate 7, §1.7 — currently 0.004
  expect(report.stems.length).toBeLessThanOrEqual(81);            // gate 3 — an 82nd stem fails the build
  expect(report.mutationVerbs.length).toBeLessThanOrEqual(45);    // gate 3 — a 46th verb fails the build
});
```

---

## 7. The rules of Pokémon Chess — a thin layer over the ISA

Everything above is Pokémon. Everything below is chess, and it touches the ISA only through `CLASH`, `TILT`,
`VETO`, `PIERCE`, `WARP` and `TEMPO`. The rules module imports exactly two Pokémon concepts: `TypeId` and the
18 × 18 chart.

### 7.1 Board, army, setup

Standard 8 × 8 board, standard chess geometry, standard starting squares, from the existing
`src/engine/board.ts`. **A legal army is 16 pieces: 1 King, 1 Queen, 2 Rooks, 2 Bishops, 2 Knights, 8 Pawns.**
Castling, en passant and the two-square pawn advance are all present and unchanged, deliberately: a chess
player's entire existing knowledge transfers, and `chess.js` remains a valid differential-test oracle for the
movement layer (§13.4).

Each piece declares **exactly one type** at draft, chosen from its real `species.types` (Nidoking = Poison,
Slowking = Psychic, Lapras = Water *or* Ice — the player picks). **Stellar is excluded**: measured, it has 0
species and is 1× against everything both ways, so it would be a strictly dominant defensive declaration. The
working chart is **18 × 18 = 324 ordered pairs**: measured **8 immune (2.5%), 61 resisted (18.8%), 204 neutral
(63.0%), 51 super-effective (15.7%)**. The eight immune pairs, from data: `Dragon→Fairy, Electric→Ground,
Fighting→Ghost, Ghost→Normal, Ground→Flying, Normal→Ghost, Poison→Steel, Psychic→Dark`.

### 7.2 The single most important faithfulness rule: defence is the piece, offence is the move

> **A piece's declared type is what it is attacked as. The type of the move it uses is what it attacks with.**
> **Slot 0 — the Melee slot — is always a move of the piece's own declared type, so an ordinary chess capture
> is always "attack with your own type". Slots 1–3 are your coverage.**

This is the rule that makes the entire 950-move layer *matter* rather than decorate. In the games, a Ghost
Pokémon that knows Focus Blast hits Steel for double damage; here, Gengar declared Ghost cannot touch a Dark
piece with its Melee slot (Ghost→Dark is 0.5×, mutual destruction) but can hit it with Sludge Bomb (Poison→Dark
is 1×) or Focus Blast (Fighting→Dark is 2×). Coverage moves are the answer to being type-countered, exactly as
in Pokémon, and the video's "one type only" rule is preserved *where it is load-bearing* — on defence, which
is what makes a piece's identity legible to the opponent.

Consequences, all deliberate:
- The auto-picker (§8.6) **must** produce a same-type melee move for slot 0; if the species has none, the
  18 × 6 type-kit table supplies one. This is checked at build time for all 1 367 formes.
- `recon-abilities-items.md` §8's open question 1 is answered: **slot 0 is *the* signature move** for
  flag-keyed abilities (`Iron Fist`, `Bulletproof`, `Punk Rock`, `Long Reach`, `Sharpness`); a charged slot
  supplies its own flags when it is the slot being used.
- The UI obligation is absolute: the ART menu shows each slot's type chip and, against the hovered target, its
  exact outcome (§10.4). A player never has to know the chart to *read* an outcome; they need it to *plan*.

### 7.3 The turn loop

```
TURN(side):

 1. REVEAL   tempo := [rng.d6(), rng.d6(), rng.d6()]          // PUBLIC, both players, before any decision
             the three faces are this turn's sub-move dice, spent left to right
             exposedAtStart := squares from which side's pieces can capture the enemy King   // for T3
             recompute the action list; annotate every action with its exact resolved outcome

 2. ACT      sub := 0 ; acted := {}
             loop:
               the player chooses exactly one action:
                 (a) MOVE      relocate a piece along its chess pattern.
                               If the destination holds an enemy piece -> CLASH with slot 0.
                               Uncharged and always available: ordinary chess must always work.
                 (b) ART       a piece uses slot 1, 2 or 3 from where it stands. It does not relocate
                               (unless an op relocates it). Spends 1 charge. Requires counters <= 1,
                               and for a slot at power tier >= 4, charge >= 1 (§7.9a).
                 (c) ACE       Terastallize or Burst, once per side per game. Ends the turn (§7.10).
                 (d) DECLINE   only legal when sub > 0: forgo the remaining bonus sub-moves.
               resolve fully: run the Effect[], resolve any CLASH by §7.5, apply ops in listed order
                              (listeners fire in the §2.8 dispatch order)
               acted += the acting piece
               if the enemy King left the board:                      return WIN(side)      // R1
               if a NEW exposure of the enemy King now exists
                  (i.e. an attacker not in exposedAtStart):           break                 // T3
               if the resolution granted TEMPO('grant-bonus')
                  and sub < 2
                  and some piece not in `acted` has a legal action:   sub += 1 ; continue    // T1, T2
               break

 3. CHECKUP  in this published order, over side's own pieces only, in the §2.8 dispatch order:
               poison counters -> burn counters -> Asleep coin (hard cap 3) -> Stunned clears
               -> item ON_CHECKUP -> ability ON_CHECKUP -> Charge accrual (§7.9a)
               -> mark durations decrement, expire at 0
               -> SCHEDULE entries whose delay hit 0 fire
               -> SIMULTANEOUS removal of every piece at 3 damage counters

 4. CLOSE    progress accounting (§7.11); push the repetition hash; test terminal conditions
             toMove := the other side
```

Two clauses in step 2 are new this pass and both matter:

- **`if some piece not in acted has a legal action`.** Without it, a SURGE by the last mobile piece grants a
  bonus sub-move that the baton rule (T2) makes unusable, and the turn loop offers the player a phase with
  exactly one legal action (`DECLINE`). That is a UI dead end that reads as a bug. Now the bonus is simply not
  granted, and the `clash` event says why. **[SUPERSEDES pass 1 §7.3.]**
- **`a NEW exposure`.** See §7.12 R5.

**Where do "Pokémon moves" fit relative to chess?** The answer that makes this work: **the ordinary chess
capture already *is* a Pokémon move.** Capturing means using your Melee slot — no charge, no extra decision,
no tax on chess. The additions are the charged ART actions, and each costs your whole turn. A ranged ART
(`RAY_LOS`/`RAY_ANY`) buys the genuinely new power — capture without occupying the square — and pays a turn
and a charge for it.

**Charges.** `charges = clamp(round(pp / 5), 1, 5)`, measured over all 950 admitted moves: **208 at 1, 319 at
2, 174 at 3, 159 at 4, 90 at 5**. Three charged slots give a piece roughly **9–12 charged uses for the whole
game**, which is a real budget a player feels and a hard bound the termination proof can lean on. This is
per-move ammunition and is a *different* resource from the per-piece **Charge counter** of §7.9a, which gates
the 166 tier-4/5 moves on patience rather than on a budget.

**The Checkup is the TCG's Pokémon Checkup**, with its published order, and it runs at the *end* of the acting
player's turn over that player's own pieces — so a poisoned piece takes exactly one counter per round and dies
on your third turn, not in a turn and a half. Deferred simultaneous removal is what gives `recon-variants.md`
§5 R4 the simultaneity discipline it asks for.

### 7.4 Randomness: the Tempo Roll, and the one line that governs all of it

> **No hidden roll may ever cost a player a piece. Every die that can remove a piece is revealed, publicly,
> before any decision in that turn. Coins are flipped after commitment only for riders, which can never
> remove a piece on the turn they are flipped.**

Concretely:

| Instrument | When | What it can decide | Canon |
|---|---|---|---|
| **Tempo Roll** — three public d6 faces at turn start | before every decision | the Clash ladder for each of the turn's up to three sub-moves | the video's d6, moved *before* the decision as every surviving dice-chess variant does |
| **Rider coin** — 1–4 coin flips, after commitment | after a capture resolves | applying a status mark, a boost, or one damage counter | the TCG: 397 of 433 coin-flip attacks in the current era gate only a rider |
| **Seeded selection** | at resolution, shown before it applies | Metronome's move, a `RANDOM_FOE` target, Quick Claw's pre-emption (revealed in the Checkup *before* your turn) | Showdown's own `sample`/`randomChance` |

Rider chances are snapped to the TCG's alphabet of powers of one half. Measured over all 950 admitted moves,
**416 riders** in these buckets: `100% → 126, 30% → 109, 10% → 100, 20% → 46, 50% → 27, 40% → 6, 70% → 2`.
The snap is
`{1 → always, 0.7–0.5 → 1 coin, 0.4–0.25 → 1 of 4, 0.2–0.1 → 1 of 8}`, presented as "flip a coin",
"flip two coins, both heads", "flip three coins".

**Exactly what happens to the video's two die rules.** `BRIEF.md` §2 rule 4 is "6 = critical hit ⇒ capture and
move again; 1 = miss ⇒ the attack fails and both pieces die". The ladder is a *generalisation* of that die, not
a replacement, and the accounting is:

| The video's rule | Under the ladder | Status |
|---|---|---|
| **6 ⇒ capture and move again** | face 6 moves you up one band. On a **neutral** matchup that is exactly SURGE (capture + move again); on a **super-effective** matchup it is CRITICAL (capture + move again + a boost). That covers **255 of the 316 legal ordered type pairs**. | **kept, verbatim, for 81% of pairs** |
| 6 on a **resisted** matchup | CLEAN — you capture and *survive*, but you earn no tempo. | **deliberately withheld.** A resisted attacker must never earn tempo, because "type knowledge is the only reliable route to tempo" is the pillar the whole design rests on (§7.5). A crit rescuing you from your own bad matchup is generous; a crit *rewarding* it inverts the thesis. |
| **1 ⇒ the attack fails and both pieces die** | face 1 moves you down two bands. On neutral and resisted matchups that is REPELLED: the attacker bounces back to its origin with a damage counter and **the defender lives**. | **deliberately corrected**, and this is a fix to a **bug in the source**, not a deviation from its soul. As filmed, a "miss" still killed the defender, so *every legal capture removed its target unconditionally* and defending a piece deterred nothing at all — Rifle Chess's documented failure mode, "it is of no use to guard pieces". A missed attack that kills its target is not a miss. |
| 1 on a **super-effective** matchup | BACKLASH — both pieces die. | **kept**: the video's most dramatic outcome survives exactly where it is most dramatic, on the attack you were confident about. |

So both of the video's die faces still do something recognisable on most of the board, and the two places they
change are the two places the filmed rules were demonstrably broken. That is the standard `DIRECTION.md` sets:
keep the soul, fix the debt.

Three consequences worth naming:

1. **Protection becomes a real concept**, per the table above — the single biggest structural improvement over
   the filmed ruleset, and the reason a defended square now deters anything.
2. **`recon-variants.md`'s biggest measured lever is taken in full** (≈ 5× on σ_dice at equal rate), and
   `recon-tech.md`'s measurement says the same choice makes the AI ~150× cheaper: full chance-node enumeration
   costs 121–159× at depth 6, while input randomness costs **+10%**.
3. **Because all of a turn's dice are public, resolution is deterministic *within* a turn.** That is what
   makes the suicide guard in §7.12 R3 an exactly computable predicate instead of a probabilistic fudge — and
   it is the single cleanest fix for the on-camera bug.

### 7.5 The Clash — capture resolution, every case

One resolver, ~120 lines, the only place in the codebase where an outcome is decided. The stage order is the
**TCG's printed pipeline**: attacker bonuses → type modifier → defender reductions, and **defender hooks may
only ever lower the outcome**. This is a direct correction to `recon-abilities-items.md` §2.4, which sums both
sides into one roll and lets a defensive bonus silently erase a super-effective reading.

```
CLASH(A: attacker, D: defender, slot, face):

 0. CONFUSION BRAKE   (on the ATTACKER; the only post-commitment coin that can cost tempo)
      if A has the Confused mark:
           flip a coin (rng);  tails -> no capture, A does not move, THE TURN ENDS IMMEDIATELY
      // It can cost you your turn but never a piece, so it is inside the §7.4 rule.
      // [SUPERSEDES pass 1 step 7], which tested "D has Confused and D is the attacker" - incoherent,
      // and placed it after the whole ladder had been computed and after the WARPs had been consumed.

 1. LEGALITY   (booleans only; no dice)
      t   := slot === 0 ? A.declaredType : moveTypeOf(A.slots[slot])
      m   := chart[t][D.declaredType]                             //  0 | 0.5 | 1 | 2
      if m === 0 and D is a King:  m := 0.5                       // R6: a King is never unreachable.
                                                                  // Wired in HERE, not asserted later.
      vetoes  := (m === 0 ? ['type'] : [])
               ++ run(CLASH_LEGAL, D)                             // Levitate, Air Balloon, Wonder Guard,
               ++ run(CLASH_LEGAL, board)                         //   Protect, Disguise, BIND, Queenly Majesty
      pierces := run(CLASH_LEGAL, A)                              // Mold Breaker, Scrappy, Ring Target,
                                                                  //   Thousand Arrows, Infiltrator
      live := vetoes \ pierces
      if live is non-empty:
           if every live veto is one-shot:  consume them; A's action is spent; return REPELLED_WARD
           else:                            THE MOVE IS NOT GENERATED  (never offered, searched or animated)

 2. ROLL ASSEMBLY - the attacker's side of the ledger (everything here may only RAISE the roll)
      //  The defender's contribution is measured FIRST, then split: a defender who is stronger than
      //  baseline becomes a step-5 reduction; a defender who is WEAKER than baseline is an attacker bonus.
      guardRaw := D.boosts[physical ? def : spd] - D.counters + SUM run(CLASH_ROLL, D)
      //                                          ^^^^^^^^^^ counters SUBTRACT: a hurt piece defends worse.
      //     [SUPERSEDES pass 1, which wrote "+ D.damageCounters" - a sign error that made a piece
      //      at 2 counters HARDER to capture, exactly inverting the intent stated in its own §7.6.]

      deficit := max(0, -guardRaw)      // the defender is WEAKER than baseline: an attacker-side bonus
      guard   := max(0,  guardRaw)      // the defender is STRONGER than baseline: a defender reduction

      might := A.boosts[physical ? atk : spa]
             + powerTilt(effect.power)                             // T1 -1, T2 0, T3 +1, T4 +1, T5 +2
             + effect.tilt                                         // from accuracy, when it is a number
             + SUM run(CLASH_ROLL, A)                              // items, abilities, weather, STAB, terrain
             + deficit                                             // Screech, Tail Whip, Leer, ... (31 moves)
      C := face + might                                            // face is the PUBLIC Tempo Roll face

 3. ATTACKER WARPS (may only RAISE)
      willCrit -> C := 12 ; OHKO -> gated at step 1 ; Tinted Lens -> recorded for step 6

 4. TYPE MODIFIER  (the rung you start on)
      rung0 := m <= 0.5 ? 0 : m === 1 ? 1 : 2
      step  := C <= 1 ? -2 : C === 2 ? -1 : C <= 5 ? 0 : C <= 8 ? +1 : +2
      rung  := clamp(rung0 + step, -1, 3)

 5. DEFENDER REDUCTIONS (may only LOWER)
      rung := clamp(rung - guard, -1, 3)          // guard is non-negative by construction (step 2)

 6. DEFENDER WARPS (may only LOWER) then the recorded attacker warps of step 3
      rung := fold(run(CLASH_RESULT, D), rung)      // Sturdy, Focus Sash, Filter, Shell Armor, Rock Head
      rung := fold(recordedAttackerWarps, rung)     // Tinted Lens ([0] -> 1)
      // survive-once effects are STRICTLY ONE-DIRECTIONAL: they convert only rung in {1,2,3} -> -1.
      // They NEVER convert rung 0 (BACKLASH).  "A shield protects you from being killed;
      // it does not protect you from killing yourself."   (this kills the Focus-Sash exploit, trace 25)

 7. (deliberately empty - the Confusion brake moved to step 0)

 8. APPLY, in this fixed order
      rung -1  REPELLED : no capture. A returns to origin and takes 1 damage counter. D untouched.
                          run(ON_SURVIVE, D).
      rung  0  BACKLASH : REMOVE(D) then REMOVE(A).   run(ON_KO, D); run(ON_KO, A).
      rung  1  CLEAN    : REMOVE(D); A occupies the square (MELEE) or stays (RAY_*/area).
                          run(ON_CAPTURE, A).
      rung  2  SURGE    : as CLEAN, plus TEMPO('grant-bonus').
      rung  3  CRITICAL : as SURGE, plus BOOST(A, {atk:+1, spa:+1}), and it PIERCES every ward and
                          every survive-once defence.
      then: rider coins (ON_CAPTURE guards), then ON_ENTER on the destination square (hazards fire).

 9. AREA CLASHES
      One face resolves the whole area. The player designates ONE primary target: it uses the full chart and
      is the only target that can produce BACKLASH or grant a bonus. Splash targets resolve at rung0 = 1
      (neutral) and are captured on rung >= 1. An area Clash grants at most ONE bonus sub-move.
```

**Why the `deficit` / `guard` split is the right fix and not a hack.** `recon-tcg.md`'s correction to
`recon-abilities-items.md` §2.4 is that **defender *hooks* may only downgrade an outcome** — a `BULWARK` bonus
must never be able to erase a WEAKNESS reading. That is a statement about *defensive abilities and items*, and
it is preserved exactly: everything `run(CLASH_ROLL, D)` returns positive still lands in `guard`, which only
subtracts. But a **defence debuff is not a defender hook** — it is a condition the *attacking* side created,
with an ART, on a previous turn, at the cost of a whole turn and a charge. Routing it to the attacker's bonus
column is where it belongs both mechanically and narratively: Screech is an *investment in a future attack*.
The split is also what makes damage counters legible — a piece at 2 counters simply hands +2 to whoever
attacks it, which is what the pips on its bezel are telling you.

**The five outcomes, complete, plus the sixth that never reaches the resolver:**

| Rung | Name | Defender | Attacker | Bonus sub-move |
|---|---|---|---|---|
| −1 | **REPELLED** | untouched | bounces to origin, **+1 damage counter** (a King takes none — its cost is the spent action) | no |
| 0 | **BACKLASH** | removed | **removed** | no |
| 1 | **CLEAN** | removed | survives, takes the square | no |
| 2 | **SURGE** | removed | survives | **yes** |
| 3 | **CRITICAL** | removed | survives, +1 might, pierces all wards | **yes** |
| — | **BLOCKED** | untouched | never moved | the move is not generated |

**Every effectiveness case, spelled out** (`tilt = 0`, `might = 0`; from `syscomp-7-ladder.mjs`, and every
cell re-derived by hand from §7.5's `step` table this pass — the four distributions and all four aggregates
below reproduce exactly, so the ladder is internally consistent as published):

| Matchup | REPELLED | BACKLASH | CLEAN | SURGE | CRITICAL | P(bonus) |
|---|---|---|---|---|---|---|
| **0× immune** (8 pairs, 2.5%) | — | — | — | — | — | move is illegal |
| **0.5× resisted** (61 pairs) | 33.3% | **50.0%** | 16.7% | 0 | 0 | **0** |
| **1× neutral** (204 pairs) | 16.7% | 16.7% | **50.0%** | 16.7% | 0 | 1/6 |
| **2× super** (51 pairs) | 0 | 16.7% | 16.7% | **50.0%** | 16.7% | **2/3** |

Aggregate over the 316 legal ordered pairs: **P(bonus move) 0.2152, P(attacker dies) 0.2310,
P(defender survives) 0.1719, P(defender removed) 0.8281.** Compare the video's rules as filmed
(`recon-variants.md` §2.4): extra move 27.4%, mutual destruction 29.5%, defender removed **100%**.

**Why the ladder and not the video's flat d6.** Three reasons, in order of weight:

1. **It makes type knowledge dominate the die instead of the reverse.** `recon-tech.md`'s sharpest criticism
   of the original rules is that `P(crit) + P(miss) = 1/3` for *every* attacker while the static per-type
   value spread is only ±15%, so the die outweighs the chart. Under the ladder the matchup shifts the *entire
   distribution*: a super-effective attacker earns tempo two turns in three, and **a resisted attacker can
   never earn tempo at all**. Type knowledge becomes the only reliable route to tempo, which is the concept's
   whole thesis.
2. **It restores protection** (see §7.4 consequence 1).
3. **It is one comparison table**, so it is a tuning knob rather than a rewrite: `{−2,−1,0,0,0,+1}` ships
   first and the batch simulator (§9.4) moves the band edges.

**[DEVIATION from `recon-variants.md` §6.3]**, which recommends abolishing the per-capture die entirely
(deterministic mutual destruction, crit/flinch at 1/18). I keep one d6 and keep probabilistic BACKLASH,
because (a) `DIRECTION.md` is explicit that the TCG's coin flips *legitimise* randomness as how the Pokémon
board game already works and that the richer option wins; (b) making the die public captures most of the
variance reduction that document wanted — by its own argument, variance a player can plan around costs far
less than its nominal size; and (c) a fully deterministic chart makes every position a calculation and deletes
the story generator. I accept its measurement that the original configuration was ~25× too loud, and my
numbers are quieter on every axis.

### 7.6 Damage counters — what "damage" means when capture is binary

**Capture stays binary. There is no HP.** But ~200 admitted entries exist purely to do or undo small amounts
of damage: 94 measured `heal`/`damage`/`directDamage` call sites, 13 drain moves, 12 recoil moves, 32 heal
moves, 87 status applications, 4 hazards, every thorns ability, Leftovers, Life Orb, Shell Bell, 9 pinch
berries, Regenerator, Wish. Mapping all of that onto stat boosts is the "thematically wrong ⇒ defect" failure.

**Damage counters** are the TCG's own instrument, adopted with its own name and its own visual (stacked pips):

| Counters | State | Effect |
|---|---|---|
| 0 | fresh (`pristine` while never yet marked) | — |
| 1 | hurt | −1 to this piece's Clash roll when defending |
| 2 | badly hurt | −2 defending; **may not use charged ART actions** |
| 3 | **Knocked Out** | removed at the owner's next Checkup, simultaneously with every other KO |

Fraction → counter table, applied to every `heal(maxhp/N)` / `damage(maxhp/N)` the scanner extracts. This is
the one design decision the compiler cannot make, and it is four rows:

| Source fraction | Counters |
|---|---|
| ≥ 1/2 | ±3 (Recover, Rest, Belly Drum's cost) |
| 1/3 … 1/2 | ±2 (Regenerator ⅓, Brave Bird's recoil) |
| 1/6 … 1/3 | ±1 (Rocky Helmet ⅙, Life Orb 1/10) |
| < 1/6 | ±1 (Leftovers 1/16) |

Deliberately coarse: four buckets keep the distinct outcomes small enough to render as three pips and small
enough to hash into the repetition key (2 bits per piece — exactly the bucketing `recon-tech.md` recommends,
so the AI cost is the one already budgeted).

**The King never takes damage counters.** It is immune to every indirect effect — hazards, weather, status
ticks, thorns, item drain, Perish — and can leave the board only through a Clash. This is
`recon-variants.md`'s R6 ("always supply the key, never make the royal trivially reachable") applied to the
counter layer, and it forecloses a second, degenerate win route.

Counters give the design **three answers at once**: the chip/heal economy has something real to bite on; the
untouchable-piece problem gets a third independent solution (you cannot capture a Levitating Flying piece with
Ground, but you can Stealth Rock it, Toxic it, and knock it out); and `REPELLED` costs something, so a failed
attack is a real risk rather than a free retry.

### 7.7 Status: two classes, two markings

Adopted from `recon-tcg.md`, because the TCG's physical marking encodes the games' volatile/non-volatile
split for free.

| Mark | Class | Board effect | Clears |
|---|---|---|---|
| **Asleep** (folds `slp` and `frz`) | rotation | the piece cannot act | at your Checkup flip a coin, heads wakes; **hard cap 3 turns**; a Fire-typed capture or a `thawsTarget` move clears it immediately |
| **Stunned** (unifies `par` and `flinch` — measured **45 par riders + 62 flinch riders = 107 applications**) | rotation | the piece loses exactly its next activation, then self-clears | automatically |
| **Confused** | rotation | when this piece attempts a capture, flip a coin; tails: no capture, no move, **your turn ends** | at your Checkup flip a coin |
| **Poisoned** (`psn`) | counter | +1 damage counter at your Checkup | a cure berry, Heal Bell, Natural Cure, promotion |
| **Badly Poisoned** (`tox`) | counter | +2 damage counters at your Checkup | same |
| **Burned** (`brn` — 24 measured secondary applications) | counter | +1 damage counter at your Checkup, and −1 to this piece's physical Clash rolls | same |

Rotation-class marks are **mutually exclusive, newest wins**, and clear when the piece WITHDRAWs (U-turn,
Volt Switch, Baton Pass) or promotes. Counter-class marks **stack and persist**. Visually: the rotation class
rotates the piece's pin 90°; the counter class stacks pips. Both are free from the mark table's `class` column.

**[DEVIATION from the games, following `recon-tcg.md`]**: paralysis does not halve movement and has no hidden
25% failure chance (a permanent hidden failure chance is the worst mechanic in either canon for a chess
variant); the Speed halving is routed to `BOOST({spe:−1})`, which the movement rule already reads. Frozen is
folded into Asleep — justified twice over, since **`frz` has zero primary applications in the dataset**.

### 7.8 Immunity and wards — the untouchable-piece problem, bounded four ways

One rule, three sources, four bounds.

**Sources.** (1) The type chart's 0× makes a capture **illegal and permanent** — this is the video's most
memorable rule and the most valuable Pokémon fact a chess player can learn, so it is not softened.
(2) An ability or item ward (Levitate, Flash Fire, Bulletproof, Air Balloon, …) is **one-shot**: the first
attempt is illegal and *pops the ward*, and Air Balloon's real text ("Pops when holder is hit") is the canon
template. (3) Wonder Guard is **class-scoped** per the printed TCG card: uncapturable by Queen, Rook, Bishop
and Knight; always capturable by any Pawn or King.

**Bounds, all four load-bearing:**

1. **Support moves ignore immunity, from data.** Measured: `ignoreImmunity` is true on 270 of 271 Status
   moves. So an immune piece can always be poisoned, burned, put to sleep, debuffed, hazard-trapped or
   type-changed. This is the largest single lever in the dataset and it costs no special case.
2. **Damage counters route around immunity entirely** (§7.6).
3. **The key is over-supplied, per Stratego.** A format's draft validator requires each side to end with at
   least one immunity breaker: a `Scrappy`/`Mind's Eye` piece, a `Mold Breaker` family piece, a Ring
   Target holder, or a piece with `Thousand Arrows`/`Smack Down`. Ring Target is in the Standard 12 Kit, so
   the floor is met by default.
4. **Immunity is arithmetically local.** Measured: each defending type is immune to at most **two** attacking
   types (only Ghost), so no piece is anywhere near Betza's Iron Ghost. A Flying piece is untouchable by 1 of
   18 attacking types — and only by *Melee* attacks of that type, since a coverage slot solves it (§7.2).

### 7.9 Priority, reactions, charging, recharging, trapping

- **`priority ≥ +1` (21 moves) → Reaction.** Declare when an enemy begins a Clash against this piece; it
  resolves first and can pre-empt the attack. Spends a charge; at most one Reaction per piece per enemy turn;
  **a Reaction may never be used to escape an exposure** (§7.12). This converts "a defended square" into an
  active threat and is the faithful reading of priority.
- **`priority ≤ −1` (6 moves) → act-last**, and they become the *reactors* while Trick Room is up (trace 9).
- **`flags.charge` (13 moves: Fly, Dig, Dive, Solar Beam, Phantom Force) → `MARK('charging', dur 2)`.** Turn
  one the piece is **untargetable** (it lifted off or burrowed); turn two the Clash resolves automatically
  against whatever is there.
- **`flags.recharge` (8 moves: Hyper Beam, Giga Impact) → `MARK('recharging', dur 1)`.** Resolves at power
  tier 5, then the piece cannot act next turn.
- **Trapping** (`partiallytrapped` 10 moves + 8 hard-trap tagged moves + `BIND` abilities): the trapped piece
  may not move *away* from the trapper but may always capture it or move within its ring. Bounds:
  `KING_RING` region only (a compiler invariant, §2.4), **never the enemy King**, hard cap 3 turns for
  inescapable variants, and the trapper is itself immobilised for Jaw Lock-class effects.

### 7.9a The Charge counter — the action economy's governor

Pass 1's §19.3 named its own largest open question: *"the ART action economy is too generous — a ranged
capture for one turn plus one charge may dominate ordinary chess. This is the number I am least sure of."*
It shipped no answer, only a plan to measure it at M6. I ship an answer, and it is not invented — it is
`recon-tcg.md`'s recommendation, which pass 1 left on the table:

> **Adopt TCG Pocket's Energy Zone shape as a per-piece Charge counter (0–2)** that gains 1 on any turn the
> piece does not act and resets on a capture, gating the strongest moves. One integer, no bookkeeping, and it
> subsumes `flags.charge`, `flags.recharge` and Speed Boost.

The rule, in full:

| | |
|---|---|
| **State** | one integer per piece, `charge ∈ {0,1,2}`, public, drawn as up to two chevrons under the plinth |
| **Accrual** | at your Checkup, every one of your pieces that **took no action this turn** gains 1, capped at 2 |
| **Reset** | a piece that **makes a capture** drops to 0. A piece that acts without capturing keeps what it has |
| **What it gates** | an ART whose slot is at **power tier ≥ 4** requires `charge ≥ 1` and spends it. Measured: **166 of 679 damaging moves are tier 4 or 5** — Hyper Beam, Earthquake, Explosion, Fire Blast, Close Combat, Draco Meteor. Tier 1–3 ARTs, and every Status ART, cost nothing but the slot charge |
| **What it does *not* gate** | ordinary chess. Slot 0 is free forever. This is non-negotiable: chess must always work |

Five things this one integer buys, which is why it earns a place in the state model:

1. **It prices the ART economy** without touching charges, and it prices it *dynamically*: a piece that has
   been quietly holding a square for two turns can unload an Earthquake; a piece that just took a rook cannot.
   The strongest ARTs are now available exactly when the board has been *slow*, which is precisely when a
   burst of power is interesting rather than oppressive.
2. **It is an anti-snowball on capture chains**, thematically. A piece that captures resets to 0, so the
   SURGE-chain fantasy cannot end in a tier-5 area attack. This joins Life Orb and the baton rule as a
   *content-derived* contribution to chain limitation rather than a rule bolted on.
3. **It subsumes three mechanics that were three special cases.** `flags.charge` (13 moves: Fly, Dig, Solar
   Beam) becomes "costs 1 charge counter *and* a turn of untargetable set-up"; `flags.recharge` (8 moves: Hyper
   Beam, Giga Impact) becomes "spends both counters", which is a cleaner statement of the same cost;
   **Speed Boost** becomes `charge += 1` — literally what it does, reward for patience — instead of the `spe`
   boost `recon-abilities-items.md` §6.11 independently warned against.
4. **It is a legible tell.** Two chevrons under an enemy Bishop means "that piece can Earthquake this turn",
   and it is visible from across the board before you walk into it. Compare a hidden charge budget, which is
   the same information delivered as a surprise.
5. **It costs the termination proof nothing.** `charge` is bounded in `[0,2]` per piece, so it is a finite
   resource that can *increase* — which is why §7.11 explicitly lists it as **not** a progress event. It
   cannot reset the no-progress clock, so a stand-still-and-charge cycle still draws.

**Trade-off accepted:** a player must learn one more counter. Mitigated by it being the *same visual grammar*
as charges (dots) but a different position and shape (chevrons on the plinth), by the ART menu greying out
tier-4/5 slots with the reason written on them ("needs ⚡1"), and by it not existing at all in M1 — it ships
with the ART actions in M3, which is the first milestone where it can matter.

### 7.10 Promotion, evolution, and the one Ace transformation

**Promotion is evolution, and it is one code path with `BECOME`.** A pawn reaching the last rank:

1. **Evolves** along its real `evos` chain if it has one. Branching lines (Eevee's nine) are a player choice
   from the real branch list; the required `evoItem` is consumed from the side's promotion pool if held,
   otherwise the branch is unavailable — which is exactly what a Fire Stone is for. Trade evolutions
   (Machoke → Machamp) are available in the match because there is no trading inside a match; the meta-game
   layer honours the real condition (§14).
2. **Re-declares its type** from the *new* species' real typing. Charmander (Fire) → Charizard may be declared
   Fire **or Flying**, and that is a genuine decision with a chart consequence.
3. **Chooses a chess class** from {Queen, Rook, Bishop, Knight}, as in chess, with a suggestion from
   `Dex.roleAffinity` (already implemented in `src/data/dex.ts`).
4. **Mega Evolves instead** if the resulting species has a Mega forme and the side's Kit holds the matching
   stone: `megaStone` names the exact target forme, so this is C1 data for all 47 real stones + 2 Primal orbs.
5. If the species is already final and no Mega is available, it promotes without a species change and gains a
   **Champion Ribbon**: +1 permanent might. Promotion is never a dead end.

**One Ace per side per game**, declared on your turn, **ending your turn** — the TCG's Mega Evolution price
("When 1 of your Pokémon becomes a Mega Evolution Pokémon, your turn ends"):

- **Terastallize**: one piece's declared type becomes any type it could legally have declared at draft, plus
  the type of its slot-0 move. Permanent and public; its enamel colour changes. This is the flagship, it costs
  zero data (the chart already exists), it applies uniformly to all 1 025 Pokémon, and it is the single most
  legible transformation to a chess player ("my bishop stops being weak to Ghost").
- **Burst** (the Z-move shell): declare before a Clash; the Clash resolves as CRITICAL, piercing every ward.
  A panic button and a finisher.

Tera and Burst are **mutually exclusive** — you get one, which makes the choice sharp. Dynamax/Gigantamax is
cut (it is an HP mechanic, and 4% roster coverage makes it a draft trap); the 34 Gmax sprites survive as
promotion art.

### 7.11 Termination — the bound, proved

**Claim 1 — a turn is at most 3 sub-moves.** By construction: `TEMPO('grant-bonus')` is emitted only by
ladder rungs 2 and 3, `sub < 2` gates the loop, and CI gate 5 forbids any other producer.

**Claim 2 — even without the cap, a turn is finite.** `TEMPO('grant-bonus')` requires a successful capture;
every capture removes at least one enemy piece; **no op in the ISA places a piece on the board** (`SUMMON`
does not exist; CI gate 5 fails the build if it appears; Revival Blessing compiles to `MEND`, Substitute to a
mark). Therefore the enemy piece count `N` is monotonically non-increasing, `N ≤ 16` always, and a chain of
length `L` requires `L − 1` distinct captures, so `L ≤ 17` — and `L ≤ 16` once the King is excluded as a chain
target, because T3 ends the turn the instant the King is exposed. **This argument is entirely independent of
the RNG.** ∎

**Claim 3 — the game terminates.** Progress resets the no-progress clock, and progress is defined only over
**monotone-finite resources**: a capture (≤ 31), a knock-out (≤ 31), a pawn advance or promotion (≤ 96), a
**slot** charge spent (≤ 2 × 16 × 12 = 384), an item or ward consumed (≤ 64), a hazard layer laid (≤ 14).
Total progress events `P ≤ 620`. The no-progress rule draws at 100 consecutive sub-moves without one, so a game
is at most `100 × (P + 1) ≈ 62 100` sub-moves. Crude but *proved*, and the practical caps below bite far sooner.

Note explicitly what is **not** progress, because each exclusion closes a named loop:

| Not progress | The loop it closes |
|---|---|
| healing, or adding/removing a damage counter | Leftovers versus poison, which would otherwise reset the clock forever |
| applying or curing a status | Toxic / Lum Berry ping-pong across two pieces |
| **gaining or spending a Charge counter** (§7.9a) | stand-still-and-charge. `charge` is the one resource in the model that can *increase*, so it must be excluded by name or the proof fails |
| moving a piece back and forth | ordinary shuffling, exactly as in chess |
| a **REPELLED** outcome that consumes no ward | attack-bounce-attack. It is nonetheless self-limiting: REPELLED gives the attacker a damage counter, and 3 counters is a knock-out, which *is* progress — so at most 3 REPELLEDs per piece before the clock advances anyway. **Exception, and it is deliberate:** a King takes no counters (§7.6), so a King can be REPELLED indefinitely. It is still bounded by the clock, since a REPELLED King makes no progress at all |

**The caps shipped for feel rather than for termination:**

- **T1 — hard cap `L ≤ 3`.** Also bounds the capture animation budget at 700 + 420 + 420 = **1 540 ms**.
- **T2 — the baton rule: the bonus sub-move must be made by a piece that has not yet acted this turn.**
  *[English Progressive Chess: "no piece may move twice until every other piece with a legal move has moved
  once."]* This kills the "one super-typed piece mows the board" fantasy outright and makes a chain a **team
  combo** — a much better read on the board and much better Pokémon flavour. **[SUPERSEDES
  `proposal-systems-first.md` §8.6 T2]**, which only forbade a piece *earning* a second bonus; that still
  allowed one piece to make every sub-move.
- **T3 — creating a *new* exposure of the enemy King ends your turn.** *[Marseillais Chess; Scottish
  Progressive Chess.]* This is what makes king capture safe, and the guarantee is stated as an invariant rather
  than as a rule: **the enemy King can only ever be captured on a turn where its exposure was already on the
  board when that turn began**, so the defender always gets a full turn to answer any threat to their King.
  Proved in §7.12 R5, where the refinement from pass 1's "any exposure" is also explained.

**Draws and non-progress:**

| Rule | Detail |
|---|---|
| **Threefold repetition** | on the **repetition hash**, which is a *strict subset* of the state: placement + declared types + damage counters + boosts + Charge counters + piece marks + square marks + side marks + board marks + slot charges + castling + ep + side to move. **Two fields are excluded and both exclusions are load-bearing:** the **PRNG counter** (it advances monotonically, so including it makes repetition unreachable by construction and the rule silently never fires) and **`tempo`, this turn's three revealed faces** (they are re-rolled every turn, so including them has exactly the same fatal effect — pass 1 excluded the PRNG counter and forgot that the faces are derived from it and sit in the state object beside it). Conversely, including counters, marks and charges is load-bearing the other way: without them, Protect/Recover cycles hash-collide and produce *false* draws. The rule is therefore: **the repetition hash covers every field a player can influence and no field the RNG writes.** Implemented as a separate accumulator from `position.xorHash()`, mixed via `zobristWords()`; `repetition.test.ts` asserts both directions. |
| **No progress** | 100 consecutive sub-moves with no progress event (defined above) ⇒ draw. *[Progressive Chess recounts the 50-move rule in sub-moves.]* |
| **Perpetual exposure loses** | repeatedly exposing the enemy King with no progress ⇒ the exposing player loses. *[Shogi's perpetual-check rule.]* Closes the "chase forever with bonus-move tempo" degeneracy. |
| **No legal action ⇒ that player loses** | under king capture there is no being *forced* into check, so orthodox stalemate cannot arise; total immobility is a loss. *[Shogi/xiangqi; Really Bad Chess.]* |
| **Both sides reduced to lone Kings** | draw. *[Archon.]* |
| **Scheduler horizon** | max `condition.duration` in the entire dataset is **5**, and at most one pending `SCHEDULE` entry per (side, kind) — a second Future Sight while one is pending simply fails. Queue is O(pieces), horizon provably ≤ 5 turns. |
| **Ranked adjudication** | at a 300-turn cap, the **Prize track** decides: 6 slots, premium pieces fill 2 (`recon-tcg.md`'s Rule Box idea). This is jishōgi material adjudication wearing Pokémon's own clothes, and the track doubles as the material HUD all game. |

### 7.12 Check, checkmate, king capture — one coherent model

**Checkmate is not a well-formed predicate under these rules, and that — not sloppiness — is the actual root
cause of the on-camera bug.** Orthodox legality asks "does the resulting position leave my King attacked?",
but "attacked" here means "there exists a capture that would succeed", which depends on the *opponent's*
future Tempo Roll. You cannot answer it without either telling the player the future or making legality depend
on a hidden roll. Across the prior art, **every variant where check is hard to compute switches to king
capture**: Fog of War (hidden information), Duck Chess (post-move mutation), ICC Atomic (collateral),
single-die Dice Chess (RNG). We are in that family.

> **R1 — Win condition.** A player wins the moment the opposing King leaves the board, by any means (CLEAN,
> BACKLASH, CRITICAL, or an effect). There is no checkmate terminal state.
> *[Fog of War; Duck Chess; Losing Chess; single-die Dice Chess; ICC Atomic.]*
>
> **R2 — No check-legality.** A move that leaves your own King capturable is **legal**. A King may move to an
> attacked square. Castling through or out of attack is legal. *[Duck Chess.]*
>
> **R3 — Suicide guard, and it is exact here.** A move is **illegal** if, *under this turn's revealed Tempo
> Roll*, its resolution necessarily removes your own King. Because all of a turn's dice are public, this is a
> decidable predicate rather than a probabilistic fudge — which is a strict improvement on Atomic's version of
> the same rule, and it is only possible because §7.4 pre-reveals. A move that merely *risks* your King
> (because the opponent may reply) is legal, and the UI must show the exact probability before the click.
> *[Atomic Chess rule 5, verbatim: "It is illegal to blow up your own King, even if that destroys the
> opponent King as well."]*
>
> **R4 — Simultaneous royal death.** If one resolution removes both Kings, **the mover wins.** Deaths apply
> defender-then-attacker (§7.5 step 8) and the game ends the first moment a King leaves the board.
> *[Lichess Atomic: exploding the opposite king "overrides all checks and checkmates."]* A draw here would
> create a degenerate strategy: a losing player hunting mutual annihilation for half a point.
>
> **R5 — A *newly created* exposure ends the turn.** T3 above, refined this pass. Precisely: after each
> sub-move resolves, if any of your pieces can now capture the enemy King *from an attacking square that
> could not do so at the start of your turn*, your turn ends immediately (the resolution completes; only
> the remaining sub-moves are forfeit). An exposure that was **already** on the board when your turn began
> does **not** end your turn, and may be cashed in by any sub-move.
> **[SUPERSEDES pass 1's R5/T3]**, which ended the turn on *any* exposure. That version silently punished
> the wrong player: if your opponent left their King en prise and you chose to develop instead of taking it,
> your turn was cut short for a hazard *they* created. Worse, it made "the opponent failed to answer" and
> "I just created a threat" indistinguishable, which is a legibility failure as well as a fairness one.
>
> **The safety property both versions exist for is preserved, and is now provable.**
> *Claim:* the enemy King can only ever be captured on a turn where its exposure was already on the board at
> the start of that turn — so the defender always gets a full turn to answer any threat to their King.
> *Proof:* suppose the King is captured by sub-move `k`. If `k = 0`, the exposure existed at turn start by
> definition (sub-move 0 is chosen from the action list computed in step 1, before anything has moved). If
> `k > 0`, then sub-moves `0…k−1` all resolved without ending the turn, so by R5 none of them created a new
> exposure; therefore the exposure sub-move `k` exploits was present at turn start. ∎
>
> The invariant is exactly what pass 1 claimed ("the King can only be captured from an exposure that was
> already on the board when the turn began") — pass 1 simply enforced it with a stronger rule than the
> invariant needed. `exposure.test.ts` asserts the property directly by search rather than asserting the rule.
>
> **R6 — Kings are never immune and never confer immunity.** A King's declared type governs its own attacks
> and the multiplier when it is captured, but **0× never applies to a King as defender: it is read as 0.5×**,
> which puts `rung0 = 0`, so the modal outcome of killing a King is **BACKLASH — the killer dies too**, and a
> King is never unreachable. Kings also never take damage counters (§7.6), and a King attacker that is
> REPELLED takes none either — the cost of a failed royal attack is the spent action.
> **Wired into §7.5 step 1** as `if m === 0 and D is a King: m := 0.5` rather than left as an assertion, which
> is where pass 1 left it: its resolver vetoed on `m === 0` in step 1 and would have made Kings untouchable by
> up to two attacking types, silently contradicting this very rule. *[Stratego's "always supply the key".]*
>
> **R7 — Check is advice, not law.** Every turn the engine computes and displays which of your pieces are
> capturable, by what, at which rung, and with what probability — and specifically a persistent
> **"YOUR KING CAN BE TAKEN"** banner naming the attacker and the exact outcome under each of the opponent's
> six possible faces. Mate-like positions are *labelled* ("your King cannot escape") but are not terminal.
>
> **R8 — Guarded mode.** Casual and tutorial default: the move list hides actions that leave your King
> capturable with probability ≥ p (default p = 1/6). Off in ranked. Two legality paths in the engine, sharing
> one predicate with the AI's move generator.

**Cost accepted, stated plainly:** king capture removes stalemate as a drawing resource and shifts endgame
theory (on no-check Atomic, K+R vs K becomes a forced win where it is a book draw). R7 and R8 are the
mitigations, and `Chess960`'s rationale applies to us for free: because the army is drafted, opening
memorisation is neutralised on both sides before the chart even applies.

### 7.13 Every bug in `BRIEF.md` §2, resolved

| Bug (from the video) | Resolution |
|---|---|
| **Capture-in-check is broken** — a piece died capturing while its own King was in check, and the turn ended with the King still in check | **Correct behaviour under R1/R2, and the player is warned three ways.** There is no "in check" state to be illegal: the exposure is a *risk*, R7's banner names it with exact odds under all six enemy faces, and Guarded mode filters the move out entirely for players who want that. The move that produced the bug on camera is legal, loses, and *reads as losing*. Additionally, R3 makes the deterministic version — a capture that necessarily removes your own King, e.g. via Explosion or a certain BACKLASH — flatly illegal, and because §7.4 pre-reveals the dice, "necessarily" is computable. |
| **Infinite / runaway turns** | Bounded three ways: the monovariant proof (`L ≤ 16`, RNG-independent, §7.11 Claim 2), the shipped caps T1/T2/T3, and CI gate 5, which fails the build if any op can add a piece or if `INVOKE` depth ever exceeds 1. The whole termination argument is one grep: `TEMPO('grant-bonus')` appears in exactly one place. |
| **King capture vs checkmate** | One model, king capture (R1). Checkmate becomes a UI label. |
| **Suicide-capture as a tactic** | **A feature, priced, and made a decision rather than an accident.** Mutual destruction comes from the chart at 0.5× — knowable, plannable, chosen — and the public Tempo Roll means you know *before committing* whether this face gives BACKLASH (faces 3–5), REPELLED (1–2) or a clean steal (6). The draft absorbs the value distortion because a bad offensive type is correctly cheaper (§9.1). It is also honestly labelled in the UI as a **chess** rule, since `recon-tcg.md` establishes that neither canon supports it. |
| **Draw / stalemate undefined** | Fully specified in §7.11: threefold on the **repetition hash** (every field a player can influence, and no field the RNG writes — so neither the PRNG counter nor the revealed Tempo faces), 100-sub-move no-progress with an explicitly named progress set and five named excluded loops, perpetual exposure loses, no legal action loses, lone Kings draw, ranked adjudication by Prize track. |
| **Zero-effectiveness immunity creates untouchable pieces** | Bounded four ways (§7.8), of which two are free from data: 270 of 271 Status moves ignore immunity, and damage counters route around it. Plus the coverage-slot rule (§7.2) means "immune" only ever means "immune to that piece's Melee slot". |
| **(implied by the above) A King could be untouchable** — the video never hit this, but 0× plus king capture makes it inevitable | **R6, and it is wired into the resolver rather than asserted.** `if m === 0 and D is a King: m := 0.5` in §7.5 step 1, so a King is never immune to anything, and the modal outcome of killing one is BACKLASH — the killer dies too. Pass 1 stated this rule and then vetoed on `m === 0` one step earlier, which would have shipped exactly the bug it was written to prevent. Kings also take no damage counters, closing the alternative degenerate route. |

### 7.14 The small print, so nothing has to be asked

Every clause here exists because an implementer would otherwise have to guess.

**The derived scalars, in full.**

| Scalar | Definition | Measured distribution |
|---|---|---|
| `power` tier | `bp ≤ 45 → 1`, `46–75 → 2`, `76–95 → 3`, `96–120 → 4`, `121+ → 5`, `bp === 0 → 2` (the `basePower or 60` guard puts it in tier 2) | over the **950 admitted** moves: 679 damaging, of which **T1 151, T2 223, T3 139, T4 104, T5 62**. Tier 4+5 = **166**, which is exactly the set the Charge counter gates (§7.9a) |
| `powerTilt` | `[T1 −1, T2 0, T3 +1, T4 +1, T5 +2]` | — |
| `accuracyTilt` | returns a **discriminated union**, never a bare number: `true → {tilt:+1}`; `95–100 → {tilt:0}`; `85–94 → {tilt:−1}`; `70–84 → {tilt:−2}`; `50–69 → {gate:'>=4'}`; `< 50 → {gate:'>=5'}`. A `tilt` result lands in §7.5 step 2's `might`; a `gate` result becomes a **`Guard`** (`{die:'>=4'\|'>=5'}`) and therefore makes the action *ungenerated* on a face that fails, rather than merely worse. Pass 1's table implied one return type for both, which is unimplementable | `true` on 169 moves; the `< 50` set is exactly the 4 OHKO moves |
| `charges` | `clamp(round(pp / 5), 1, 5)`; slot 0 is `Infinity` | over the 950 admitted: **1→208, 2→319, 3→174, 4→159, 5→90** |
| `coins` from `secondary.chance` | `100 → always`, `50–99 → 1 coin`, `25–49 → 1 of 4`, `< 25 → 1 of 8` | **416 riders** measured, buckets `100%→126, 30%→109, 10%→100, 20%→46, 50%→27, 40%→6, 70%→2` |
| `counters` from an HP fraction | `≥ 1/2 → 3`, `1/3–1/2 → 2`, `1/6–1/3 → 1`, `< 1/6 → 1` | — |

**Chess mechanics that interact with the Clash.**

- **A pawn's forward push never Clashes** — pawns capture diagonally, exactly as in chess. A blocked pawn is
  blocked; there is no "attack the square ahead".
- **En passant is a normal Clash** against the passed pawn, resolved on its own square, using the capturing
  pawn's slot 0. All five rungs apply; on BACKLASH both pawns are removed and the capturer's square is
  vacated. It must be taken on the sub-move immediately following the double push, as in chess.
- **Castling never captures**, so it never Clashes. It is legal out of, through and into an exposure (R2).
  An **ART action does not relocate the rook or the king, so it does not forfeit castling rights** — a detail
  that matters in play (§17, turn 3) and is worth surfacing in the tutorial.
- **Promotion happens on arrival, before the exposure test**, so a pawn that promotes into a piece attacking
  the enemy King ends the turn by T3 as any other exposure does.
- **A Clash resolved by an ART does not relocate the attacker** unless an op says so; `MELEE`-region ARTs are
  the exception a player must learn once — the piece strikes an adjacent square along its own pattern and
  **stays where it is**, so an ART capture leaves the captured square *empty*. This is why a ranged or melee
  ART is a positionally different tool from a MOVE capture, and it is called out in the ART menu.

**Which face does what.**

- Sub-move `k` (0-indexed) uses `tempo[k]`. `DECLINE` forfeits the remaining faces.
- **A Reaction resolves on the face the attacker is currently using** — the same public number — because the
  reacting player has no face of their own during the enemy's turn. This keeps every roll public and means a
  Reaction is a fully computable decision for both sides.
- **Multi-hit** (`multihit`, 22 moves) rolls `n` times, where `n` is `2`, `3`, or a `[2,5]` range resolved by
  the current face (`face ≤ 2 → 2`, `3–4 → 3`, `5 → 4`, `6 → 5`). Hit `i` uses `tempo[(k + i) mod 3]`, and the
  **best rung achieved is the outcome**. Population Bomb's 10 is capped at 5.
- **A rider coin is flipped once per rider per Clash**, after the rung is applied, and can never change the
  rung.

**Ordering rules inside one resolution.** Ops apply in the order the compiler listed them, which is Showdown's
own field order (§3.2). Where two pieces would be removed, the defender is removed first (this is what makes
R4's "the mover wins" well-defined). Where two marks of the rotation class would apply, the newest wins. Where
two `TILT`s of the same scope apply, they sum; where two `WARP`s apply, defender warps resolve before attacker
warps and each may only move the rung in its permitted direction (§7.5 steps 3, 6).

**Formes and identity.** A piece's `species` may change (Mega, Stance Change, promotion-evolution) but its
`PieceId` never does, so per-piece state, animation identity, replay and the Zobrist keying all survive the
change — which is exactly why `position.ts` gives every piece a persistent id.

---

## 8. The draft

### 8.1 The architectural seam that `DIRECTION.md` demands

```ts
export type PoolSource =
  | { kind: 'full-dex' }                                 // sandbox, casual, playtesting
  | { kind: 'collection'; owned: OwnedIndividual[] };     // progression and ranked

export interface Format {
  id: string;
  pool: PoolSource;                    // the ONLY place collection state enters
  budget: number;                      // point-buy total, quarter-pawn granularity
  kit: ItemId[];                       // exactly 12
  bans: { moves: MoveId[]; abilities: AbilityId[]; species: SpeciesId[] };
  aceSlots: 1;                         // ACE SPEC: at most one outlier piece per side
  requirements: DraftRequirement[];    // coverage, immunity breaker, distinct types
  rules: RulesProfile;                 // 'standard' | 'classic' | 'guarded'
}
```

**The match rules never see `PoolSource`.** `draft(format, rng) → Army`, and `Army` is 16 fully-resolved
`PieceSpec`s. Collection state cannot leak into capture resolution because the resolver's input type does not
contain it. This is enforced by module boundaries: `src/rules/` may not import `src/meta/`, and an ESLint
`no-restricted-imports` rule fails CI if it tries.

### 8.2 The draft loop: slot-first, never a 1 025-item browser

Adopting `recon-visual.md`'s slot-first solution, which is the right answer:

1. The 16 slots are presented in a fixed order (King, Queen, Rooks, Bishops, Knights, then Pawns).
2. For **the one slot being filled**, five candidates are offered, with a guaranteed spread: at least one
   Pokémon of a type you do not yet cover, at least one under half your remaining per-slot budget, at most one
   Legendary/Mythical, and at most one Ace-restricted piece.
3. Each candidate card shows: sprite, both real types (pick one), the 1–4 ability radio, the auto moveset with
   one swappable slot, its point cost, and — the load-bearing part — an **18-cell Coverage Strip** that
   animates the gaps this pick would close.
4. **One reroll** per slot. Search is an escape hatch behind a toggle, not the default.
5. Quick Draft (accept all suggestions) completes a legal army in **under 60 seconds**; a themed preset
   (Kanto, Mono-Steel, Gym Leader) completes it in one click.

### 8.3 Requirements the validator enforces

| Requirement | Rule | Why |
|---|---|---|
| Legal army | exactly 1/1/2/2/2/8 | chess |
| Budget | `Σ cost ≤ budget`, quarter-pawn granularity | `recon-variants.md`'s point-buy, as a *usability* device — never as a balance guarantee |
| Type spread | ≥ 10 distinct declared types among your 16 | the video's "at least one of every type on the board" is impossible for one side; across both armies the candidate generator makes the union of 18 overwhelmingly likely, and the format can require it in mirror-pool play |
| Immunity breaker | ≥ 1 (Scrappy family, Mold Breaker family, Ring Target holder, or a `Thousand Arrows`/`Smack Down` slot) | Stratego's over-supplied key; §7.8 bound 3 |
| Ace limit | ≤ 1 Ace piece | ACE SPEC, a shipped first-party precedent: OHKO moves, Wonder Guard, Imposter, Shadow Tag, Huge/Pure Power, the four Ruin abilities |
| Ruin limit | ≤ 1 Ruin ability | they do not stack |
| Choice items | illegal on King and Queen | a +2-range Queen covers the board |

### 8.4 Draft supply, measured

Over the **1 025 admitted base formes** (my own count): Water 154, Normal 131, Grass 127, Flying 109,
Psychic 102, Bug 92, Poison 83, Fire 81, Ground 75, Rock 74, Fighting 73, Dragon 70, Electric 69, Dark 69,
Steel 65, Ghost 65, Fairy 64, **Ice 48**. Mono-typed 499, dual-typed 526 — so **51% of the roster presents a
real type *decision* at draft**, which is the single cheapest source of depth in the whole game.

Ice is both the scarcest and the most defensively fragile type, so it is priced low and rationed by supply
rather than by a rule.

### 8.5 Point costs

`cost(piece) = round(4 · V(type, class)) / 4`, with `V` from §9.1, plus modifiers that are all data-derived:
`+0.5` for a `tags` Legendary/Mythical/Paradox, `−0.25` if `species.nfe` (an un-evolved piece promotes better
but fights worse), `−1` for an `INERT`/`STRIDE-penalty` ability (Run Away, Truant, Slow Start — the refund
that makes Slaking a bargain rather than a trap), `+0.25` for a slot-0 move at power tier ≥ 4.

Costs are **published on the card**. Knightmare Chess's precedent also gives us a shipped answer to skill gaps:
a **voluntary handicap** — take a smaller budget.

### 8.6 Movesets: 4 slots, auto-picked, one swappable

`recon-moves.md` §6.3's measured scorer is adopted verbatim (STAB + stat fit + power + learner-count rarity +
utility, with a shape quota), including both of its measured fixes: allow "no melee move" when the best melee
score is negative (so Blissey stops getting Hyper Beam) and `−15` for `flags.recharge || flags.pledgecombo`
(so Charizard stops getting Blast Burn). Two additions of my own, forced by §7.2:

- **Slot 0 must be a move of the piece's declared type.** If the learnset union has none, the 18 × 6 type-kit
  table supplies one. Build-time assertion over all 1 367 formes.
- **Slots 1–3 must cover at least two types other than slot 0's**, so every piece has an answer to being
  type-countered. Measured feasibility: the median all-gens prevo-chain learnset union is 79 moves.

Movesets come from the **all-gens prevo-chain union with a `changesFrom ?? battleOnly ?? baseSpecies`
recursive union**, not gen-9 legality — 593 of 1 417 species have no gen-9-legal moves, and Rotom-Wash proves
union rather than fallback is required. After all unions, 29 species still have under 8 moves (Ditto 1,
Unown 1, Caterpie 5), so the type-kit floor is mandatory. Legality is **baked**, so there is no runtime
validation surface: the bundle ships `species → uint16[]` and the engine can only pick from that array.

---

## 9. Balance

### 9.1 What a piece is worth

Base class values from the published sets rather than the folk 1/3/3/5/9: **P 1, N 3.2, B 3.3, R 5.0, Q 9.5**
(Berliner/AlphaZero). The type term uses `recon-variants.md` §3.2's model shape — which is the right shape,
because what you risk when you attack and what an attacker risks coming at you both scale with how much piece
is at stake — but **re-evaluated under my ladder**, which changes every number:

```
V(piece) = m · (1 − α·LIAB(t) + β·ARM(t) − ε·BLOCK(t)) + τ · BONUS(t)
α = 0.9, β = 0.5, ε = 0.3, τ = 0.5 pawns          (starting values; fitted by self-play, never by hand)

LIAB(t)  = Σ_d ŵ_d · P(attacker dies | t attacks d)
ARM(t)   = Σ_a ŵ_a · P(attacker dies or is repelled or is blocked | a attacks t)
BLOCK(t) = Σ_d ŵ_d · [chart(t,d) = 0]
BONUS(t) = Σ_d ŵ_d · P(bonus sub-move | t attacks d)
```

Measured under my ladder with uniform weights (`syscomp-7-ladder.mjs`), sorted by rook value:

| Type | LIAB | ARM | BLOCK | BONUS | V(P) | V(N) | V(R) | V(Q) |
|---|---|---|---|---|---|---|---|---|
| **Steel** | 0.241 | **0.620** | 0 | 0.213 | 1.20 | 3.60 | **5.57** | **10.49** |
| Ghost | 0.176 | 0.444 | 0.056 | 0.204 | 1.15 | 3.45 | 5.34 | 10.05 |
| Dragon | 0.176 | 0.417 | 0.056 | 0.176 | 1.12 | 3.39 | 5.25 | 9.90 |
| Fire | 0.241 | 0.472 | 0 | 0.241 | 1.14 | 3.38 | 5.22 | 9.80 |
| Fairy | 0.222 | 0.435 | 0 | 0.222 | 1.13 | 3.37 | 5.20 | 9.78 |
| Flying / Water | 0.222 | 0.426 | 0 | 0.222 | 1.12 | 3.35 | 5.18 | 9.74 |
| Ground | 0.194 | 0.398 | 0.056 | **0.278** | 1.15 | 3.36 | 5.18 | 9.71 |
| Rock | 0.222 | 0.398 | 0 | 0.250 | 1.12 | 3.32 | 5.12 | 9.62 |
| Poison | 0.231 | 0.454 | 0.056 | 0.176 | 1.09 | 3.30 | 5.10 | 9.61 |
| Dark | 0.222 | 0.398 | 0 | 0.194 | 1.10 | 3.29 | 5.09 | 9.59 |
| Electric | 0.213 | 0.407 | 0.056 | 0.185 | 1.09 | 3.28 | 5.07 | 9.54 |
| Psychic | 0.194 | 0.361 | 0.056 | 0.194 | 1.09 | 3.26 | 5.04 | 9.49 |
| Normal | 0.194 | 0.361 | 0.056 | **0.139** | 1.06 | 3.23 | 5.01 | 9.47 |
| Fighting | 0.250 | 0.389 | 0.056 | **0.250** | 1.08 | 3.17 | 4.89 | 9.18 |
| Ice | 0.241 | **0.324** | 0 | 0.241 | 1.07 | 3.14 | 4.85 | 9.10 |
| Grass | **0.296** | 0.398 | 0 | 0.185 | 1.03 | 3.08 | 4.76 | 8.95 |
| Bug | **0.296** | 0.389 | 0 | 0.185 | 1.02 | 3.06 | 4.73 | 8.91 |

**Spread: 1.18× between the best and worst type of the same class** (Steel rook 5.57, Bug rook 4.73). That is
**narrower than `recon-variants.md`'s 1.46×**, and the reason is instructive: my ladder gives resisted
attackers a 1/3 chance of merely being repelled and super-effective attackers a 1/6 chance of backfiring, so
the *material* consequence of typing is softer. **The type edge therefore lives in tempo, not material** —
`BONUS` ranges from 0.139 (Normal) to 0.278 (Ground), a **2× spread in free moves earned** — which is exactly
where I want it: material advantage compounds slowly and is easy to misprice at draft, whereas tempo is felt
immediately, is visible on the board, and cannot be bought with points.

Corrections to naive intuition that this table preserves from `recon-variants.md`: the worst types are **Bug
and Grass** (7 self-destructive attacking matchups each), not Ice; Ice is a good attacker with the worst
defence on the board; Normal is the only type that can **never** earn a bonus move by typing, which is a
genuinely interesting drafting fact rather than a flaw.

### 9.2 How a type-literate player wins

Per capture, a player who attacks only at ≥ 1× and prefers 2× gains, against a player who attacks at the
chart's base rates: `ΔP(self-death) · u + ΔP(bonus) · τ`. With the measured among-legal shares (0.5× is 19.3%,
2× is 16.1%), `u ≈ 2.5`, `τ = 0.5`, that is **≈ 0.30 pawns per capture**, plus the tempo differential
(0 versus 2/3 chance of a bonus move) which is worth more than the material term over a game. Meanwhile
`σ_dice` is far below the video's measured ≈ 5.5 pawns/game because the load-bearing face is known in advance
and the stake per face is one band of one ladder.

**Type knowledge is the edge, and it is fully deterministic**: with the Tempo Roll public, a player who knows
the chart can compute every outcome on the board exactly. That is the concept's thesis, delivered without dice
doing the work.

### 9.3 The named danger list, each with its bound

| Danger | Bound |
|---|---|
| Total immunity / untouchable pieces | §7.8's four bounds |
| Focus Sash + mutual destruction (free queen for a pawn) | survive-once is **strictly one-directional**: it converts only rungs 1–3 to −1, never rung 0. "A shield protects you from being killed; it does not protect you from killing yourself." Rock Head is the single named exception |
| Huge Power / Pure Power (+2 flat) | the Clash value is **capped at 8** for these two, so they can never manufacture a CRITICAL: they win Clashes reliably and never generate tempo |
| Shadow Tag / Arena Trap / Neutralizing Gas | `KING_RING` region as a *compiler invariant* (§2.4); never binds or suppresses the enemy King |
| Wonder Guard | class-scoped per the TCG card (§7.8) |
| Imposter (Ditto) | copies movement pattern and ability only; type stays Normal, class stays as drafted |
| Protean / Libero | once per game, then locked — which is what gen 9 itself did |
| Moody | banned in ranked, legal in a Chaos format: there is no decision to preserve |
| Evasion stacking (Double Team, Minimize) | total evasion effect capped at +2 |
| OHKO moves, Wonder Guard, Ruin abilities | Ace-restricted: one per side |
| Thorns stacking | all thorns on one Clash resolve to **at most 1 damage counter total**; Aftermath and Innards Out are the two named exceptions that kill, and they trigger only after their own piece has died |
| Capture chains | T1/T2/T3, plus Life Orb draining every link — a *thematic* contribution to termination |

### 9.4 The instrument, not the argument

Every number above is a starting value fitted by the **headless batch simulator** (`src/sim/`, shipped at M6), which reports:
outcome distribution, game length in turns and sub-moves, capture-outcome frequencies, per-type win rate,
first-player advantage, bonus-chain length histogram, and draw-cause breakdown. Betza's four "balanced" armies
scored +62%/−71% over 400 engine games after master playtesting pronounced them equal; **hand-balancing
asymmetric armies does not work**, so the ladder band edges, α/β/ε/τ, and the point list are all outputs of
self-play, and army *pairings* are screened Chess18-style: generate, evaluate, publish, ban or handicap the
tails.

---

## 10. Legibility, onboarding, and the tutorial

The owner reports that it is currently unclear which piece is a king, queen, pawn or bishop. That is the
single most important defect in the project, and `recon-visual.md` has already measured *why* the current
approach cannot work: a Unicode glyph badge is ~10 px inside a 40 px cell where the six solid chess glyphs
differ only in interior detail; `ROLE_SPRITE_SCALE` collapses six roles into three size tiers; and ring weight
is 1.2 px versus 1.4 px. I adopt its solution wholesale and add the compiler's contribution.

### 10.1 Three channels that never compete

| Channel | Carries | Why it cannot be confused with the others |
|---|---|---|
| **Outer silhouette** | **chess role — dominant** | shape survives greyscale, colour-blindness, 34 px cells and peripheral vision; nothing else in the design uses silhouette |
| **Enamel field colour + a type glyph** | Pokémon type | the 18 fixed colours from `typeColors.ts` stay the palette's spine; the glyph is the second channel because 7 type pairs collapse under deuteranopia |
| **Bezel metal (bone vs ink) + board half** | owner | a lightness channel, measured at 15.2:1 separation between the two armies |

**Silhouettes are derived from movement**, which is what makes them learnable in one game rather than
memorised: pawn = circle; bishop = diamond (its diagonals); rook = crenellated square (its orthogonals);
knight = stepped L (literally its move); queen = coronetted octagon (the rook's square ∪ the bishop's
diamond); king = crowned heraldic shield that **overflows its cell**. Six inline SVG paths, never a font.

Redundancy ladder by container query, so the channels switch on as space allows: ≤ 34 px silhouette + army
metal only; 34–44 px add the enamel field; 44–64 px add the type glyph and the counter pips; ≥ 64 px add the
plinth archetype glyph and the charge dots. Board squares move to cool slate `#5C6575` / `#818A9B` separated
by a 1 px ink inlay, because measured against the current tan board **all 18 type colours fall below 3:1**.

### 10.2 What my rules add to the piece

Every one of these is state the rules create, so it must be on the piece rather than in a panel:

| State | Rendering |
|---|---|
| damage counters (0–3) | 3 pips on the bezel's lower arc, filling clockwise; at 3 the pin desaturates and a KO cross appears until the Checkup removes it |
| rotation status (Asleep / Stunned / Confused) | the **pin rotates 90°**, with a small symbol; mutually exclusive, newest wins |
| counter status (Poisoned / Burned) | a coloured pip on the pin's rim, stacking |
| charges remaining | up to 3 small dots on the plinth, one per charged slot, dimming as spent |
| ward intact | a thin second bezel ring; it visibly *shatters* when popped |
| Tera'd | the enamel field is repainted in the new type's colour with a faceted overlay |
| bound / trapped | a chain arc drawn on the two squares between the binder and the bound piece |
| earned a bonus move | see §10.3 — this one is board state, not a piece state |

### 10.3 The four outcomes, and the bonus move as persistent state

Outcomes are encoded by **form, direction, symmetry and death count**, never by hue — measured: the natural
outcome hues sit only ΔE 11–19 from the nearest type colour and two collapse under protanopia.

| Outcome | Form | Deaths | Duration |
|---|---|---|---|
| **SURGE / CRITICAL** | 8-ray star outward from the defender's square | 1 | 700 ms, then persistent state below |
| **CLEAN** | a single slash inward, in the direction of the attack | 1 | 520 ms |
| **BACKLASH** | twin mirrored cracks flying apart | **2** | 760 ms |
| **REPELLED** | hexagonal ward, the attacker slides back to its origin | 0 | 620 ms |
| **BLOCKED** (illegal) | a dashed grey ring, drawn **from the moment you pick the piece up** | 0 | static — immunity is never a surprise |

The bonus move is **persistent board state, not a flourish**: a gold ring breathes around the piece that
earned it, the board frame turns gold, the stage dims 18%, the HUD shows two turn chips, and **the pieces
eligible to take it (the baton rule, T2) are lit while every other piece is dimmed**. A flourish can be
missed; a board that stays different cannot.

The Tempo Roll gets three instruments with distinct silhouettes and rotation axes, learnable in one game: a
40 px **Tempo Die** tumbling in the rail at turn start showing three faces left to right (spent faces grey
out); a 22 px **Clash Die** that stamps the target square with the face actually used; a 20 px **TCG coin**
spinning on its edge for riders.

### 10.4 The affordance that teaches the chart

When a piece is picked up, every reachable square is annotated with its **resolved outcome** for the currently
selected slot, using the outcome forms above as small static stamps: gold star = SURGE, white slash = CLEAN,
twin cracks = BACKLASH, hex = REPELLED, dashed grey = BLOCKED. Switching slots (the type chips) re-annotates
instantly. **This is the whole onboarding strategy**: a player who knows nothing about Pokémon reads shapes and
plays correctly from move one; the chart is learned inductively because the same shape keeps appearing for
Fighting-into-Steel. A Pokémon player, conversely, gets the chess role from silhouettes and the legal-move
highlight from the board.

### 10.5 FX derived from the ISA — 57 assets for 1 797 entries

The compiler is also the VFX pipeline:

```
visual(effect) = REGION_GEOMETRY[effect.where]      // 16 spatial forms: melee lunge, ray, ring, board wash…
               × OP_ANIMATION[dominantOp(effect)]   // 18 verbs: MARK stamps, MEND drips, BOOST surges…
               × TYPE_SKIN[type]                    // 18 palettes + 18 glyphs, from typeColors.ts
               × INTENSITY[effect.power]            // 5 scales
```

**16 + 18 + 18 + 5 = 57 authored assets** cover every move, ability and item, and there is **no per-move VFX
table to fall out of date** — a new move compiled from a dependency bump gets correct effects automatically.
Rendering follows `recon-tech.md`'s measured architecture: keep the 64-button DOM board and its aria labels,
move pieces into one transform-positioned layer keyed by piece id, add two Canvas2D layers (`fx-under` for
hazards and terrain, `fx-over` for explosions and weather), vendor sprites same-origin at build time (the
Showdown CDN sends no `Access-Control-Allow-Origin`, verified 8/8, which forecloses every canvas pixel
operation), cap live particles at 240, and run a single rAF ticker with fixed phase order. Reduced-motion
replaces each outcome animation with its static silhouette stamp held 1 200 ms — which is why the four forms
were designed to be distinguishable as stills.

### 10.6 Progressive disclosure of the depth

- The **piece card** (hover / long-press) is three lines: name and role; declared type; the 13-archetype glyph
  for its ability and the 12-glyph Kit item, each with the real `shortDesc` on hover. The player learns
  **18 type glyphs + 13 ability archetypes + 12 Kit items = 43 symbols**, not 1 797 effects. The archetypes are
  `recon-abilities-items.md`'s, used as the UI vocabulary they are good at.
- The **Why panel** is the legibility answer under load, and it is free because the engine already emits it:
  every resolution produces an ordered `EffectEvent[]`, and the panel renders that list as sentences —
  "*face 6 + Expert Belt (+1) → 7; Fighting into Steel is super effective → SURGE; Skarmory's Sturdy would have
  saved it, but a CRITICAL pierces wards.*" Nothing in the UI narrates from a second source of truth.
- **Progressive disclosure by milestone, not by menu.** The rules arrive in the order §15 ships them, and the
  tutorial (below) is gated the same way: a player who has never seen an ART action is never shown a Charge
  chevron, because in M1 there is no such thing.

### 10.7 The tutorial — why it is *cheap* here, which is the whole design

`DIRECTION.md` directive 7 makes an interactive tutorial a **shipped, required feature**, and it says the thing
that should scare a designer: *"this game has three rulesets stacked on each other — chess, the type chart, and
the variant on top — and no player arrives knowing all three."*

The naive cost of a tutorial that guarantees the player *causes* a specific outcome is a scripting engine: a
parallel, cheating code path that forces a die, suppresses a rule, and drifts out of sync with the real game
within a month. **This design does not need one, and the reason is three properties it already has:**

| Property this design already has | What it buys the tutorial |
|---|---|
| the engine is **pure, deterministic and seeded** (`rng.ts`) | a lesson is a **seed**. To make face 1 come up, search for a seed whose first Tempo Roll starts with 1. There is no forced-die code path, because there is nothing to force |
| the **Tempo Roll is public and precedes every decision** (§7.4) | the player *sees* the die before choosing, so the lesson "a bad face is information, not bad luck" is teachable at all. Under a post-commitment die it is not |
| every resolution emits **`EffectEvent[]`** (§2.7), and the Why panel is that list rendered as sentences | the tutorial's explanatory text is **generated from the same events the real game emits**. A lesson cannot describe an outcome the engine did not produce |

So a lesson is a row of data:

```ts
export interface Lesson {
  id: string; track: 'chess-player' | 'pokemon-player' | 'shared' | 'draft' | 'meta';
  position: string;                 // FEN + a Pokémon overlay (species, declared type, ability, item, marks)
  seed: string;                     // chosen so the Tempo Roll makes the intended outcome REACHABLE
  goal: Goal;                       // the machine-checkable success condition
  allow?: ActionFilter;             // restrict the action list, e.g. only this piece, only captures
  beats: { on: EffectEvent['t'] | 'enter' | 'fail'; say: string; point?: Square[] }[];
  retryOn: 'wrong-move' | 'never';
}
export type Goal =
  | { kind:'causeOutcome'; outcome:'SURGE'|'CLEAN'|'BACKLASH'|'REPELLED'|'CRITICAL' }
  | { kind:'attemptBlocked' }                              // the 0x refusal lesson
  | { kind:'captureKing' } | { kind:'spendBonusSubMove' }
  | { kind:'applyMark'; mark:MarkId } | { kind:'survive'; turns:number }
  | { kind:'reachSquare'; piece:PieceId; square:Square };
```

`tutorial.test.ts` runs every lesson headlessly and asserts that (a) the goal is **achievable** from the given
position and seed, and (b) the lesson's `beats` reference only event types the engine actually emits during a
successful run. **A lesson that has rotted fails CI**, which is the property that makes a tutorial survive a
year of rule changes. This is the same discipline as `coverage.test.ts`, applied to onboarding.

### 10.8 The two tracks, and the branch that is not remedial

Directive 4 asks for both directions of ignorance served without either feeling like the beginner's door. The
branch is a single question on first launch — **"Which of these would you rather skip?"** with two equal-weight
cards, *"I know how chess pieces move"* and *"I know the Pokémon type chart"* — and both, or neither, can be
chosen. Framing it as *what you may skip* rather than *what you need taught* is the whole trick.

| Track | Lessons | The thing it must not assume |
|---|---|---|
| **Pokémon player** (skips the chart) | how each of the six silhouettes moves, taught by the silhouette itself: the diamond moves diagonally, the crenellated square moves orthogonally, the stepped L *is* the knight's move. Then: the goal is the enemy King. Then five mate-in-one puzzles | that they know what "develop", "file" or "fork" means. No chess vocabulary appears before it is shown |
| **Chess player** (skips the geometry) | the three heuristics every human already half-knows (Water beats Fire, Fire beats Grass, **nothing hits Ghost with Normal**), then that the board *tells you the answer* before you commit. Never a table | that they will read a 324-cell chart. Directive 5 forbids trying |
| **Shared** (nobody skips) | §10.9's five outcome lessons, §10.10's die lesson, then hazards, status, and the ART menu | — |

Directive 5's instruction — *do not attempt to teach 324 type interactions* — is honoured structurally rather
than by restraint: **the tutorial teaches the player where to look, and §10.4's outcome annotation is the thing
they look at.** A player who never learns a single matchup still plays correctly, because every reachable square
is stamped with the outcome it would produce. The chart is then learned *inductively*, over games, from the
same gold star appearing every time Fighting meets Steel. That is the design's answer to "without a manual",
and it is the reason this design can afford a maximalist ruleset at all.

### 10.9 The five outcome lessons — each one *caused*, not watched

Directive 2 requires the player to personally produce each capture outcome. Each is one `Lesson` row, and the
seed is chosen so the intended face is the first face of the Tempo Roll.

| # | Lesson | Position (the Pokémon layer is the lesson) | Seed guarantees | What the beat says, after it happens |
|---|---|---|---|---|
| 1 | **CLEAN** | your **Bidoof *(Normal)*** pawn can take a **Rattata *(Normal)*** pawn. Normal into Normal is 1× (verified) — chosen deliberately over the obvious Machop-into-Rattata, because Fighting → Normal is 2× and would teach lesson 2 by accident | first face 3–5 | "Normal into Normal — neither type has an edge. An ordinary capture, exactly as in chess. Notice the single slash: one death, and it points the way your piece moved." |
| 2 | **SURGE, and spend the bonus** | Machop *(Fighting)* can take Onix *(Rock)*. Fighting → Rock is 2× | first face 3–5, second face any | "**WEAKNESS ×2.** You captured *and* the board turned gold — you move again. Now pick a **different** piece: a bonus move must be made by a piece that has not acted." Goal is `spendBonusSubMove`, so the lesson is not complete until they use it |
| 3 | **BACKLASH** | your Bellsprout *(Grass)* is offered a Skarmory *(Steel)* rook — a rook for a pawn, and the square is stamped with **twin cracks** | first face 3–5 → rung 0 | "Grass into Steel is **RESISTANCE**. Your attack bounced back and killed you both. The board told you: twin cracks mean two deaths. Sometimes that trade is still worth it — this one was, you took a rook." Teaches the mechanic *and* that it is a tool |
| 4 | **REPELLED** | the same Bellsprout, one turn later | first face 1 | "Same pieces, one face lower. This time you just bounced — you took a damage counter, and Skarmory is untouched. A failed attack is not free." |
| 5 | **BLOCKED — the most important moment in the tutorial** | your Gengar *(Ghost)* bishop, and a Bidoof *(Normal)* pawn sitting undefended on its diagonal. `allow` restricts the action list so the player *will* try it | — | The square is drawn with a **dashed grey ring from the moment they pick Gengar up**, and the click is refused with a panel: "*Ghost cannot touch Normal. Not 'unlikely' — impossible, in the games too. This is the one rule that will feel like a bug the first time. Use a different piece, or a different move: Gengar's Sludge Bomb is Poison, and Poison into Normal is 1×.*" Goal is `attemptBlocked`, so **the lesson requires the refusal to happen** |

Directive 2 calls lesson 5 the most important single moment because untouchability is the concept's most
surprising consequence. Directive 6 then requires the same explanation *permanently, outside the tutorial* —
which §10.4 already delivers, because the dashed grey ring and its one-line reason are properties of the board,
not of the tutorial. **The tutorial teaches the player to trust an affordance that never goes away.**

### 10.10 Teaching the die (directive 3)

Two lessons, and they are the reason the Tempo Roll is designed the way it is:

- **"You were right and it still went wrong"** — the player's Machop *(Fighting)* can take a rook that is
  *(Rock)*, a 2× matchup they have just been taught to look for. But the revealed first face is **1**, which
  drops two bands from `rung0 = 2` to **rung 0 — BACKLASH**: they would take the rook and die doing it. The
  square is stamped with twin cracks, not a gold star, and the lesson is complete only when they find the
  *other* move. Beat: "*You read the type chart correctly and the die still said no. That is exactly why the
  die is on the table before you choose — a bad face is not bad luck, it is information, and information is a
  plan.*"
- **"A crit rescued you"** — the mirror: a losing position where the first face is **6**, turning a neutral
  capture into a SURGE and a lost piece into a two-capture turn.

The pairing is doing something specific: it converts variance from *"the game cheated"* into *"the game told
me and I planned around it"*. Under a post-commitment die neither lesson is teachable, because there is nothing
to plan with. This is the clearest single place where a ruleset decision (§7.4) was made for the *tutorial's*
sake as much as the balance's.

### 10.11 First-time hints, and never nagging (directives 7 and 8)

- **Contextual first-time hints in real games**, one per mechanic the tutorial covers, each shown **once ever**,
  each anchored to the thing that just happened, each dismissible permanently from its own body: first mutual
  destruction, first bonus sub-move, first hazard tick, first status, first ward pop, first Charge chevron,
  first promotion-evolution, first Tera. They are the same `Lesson.beats` rows, fired by the same
  `EffectEvent` types, with `position`/`seed`/`goal` absent — **so there is one authoring format, not two.**
- **Completion is tracked per lesson, not per tutorial.** A returning player opens a Lessons list and replays
  any single one; the list is grouped by track and shows which are new since they last played (because lessons
  arrive with milestones). Skippable entirely from the first screen, and the skip is remembered.
- **Nothing is ever gated behind the tutorial.** The sandbox is the default entry point with no account
  (`DIRECTION.md`), so the game is playable seconds after load whether or not a lesson was ever opened.

### 10.12 Practice mode and puzzles (directive 10)

Distinct from the sandbox: **no stakes, no free play, a stated goal.** Three families, all of them data, and
all three generated *by the batch simulator* rather than hand-authored — which is what makes a hundred of them
affordable:

| Family | Prompt | How it is generated |
|---|---|---|
| **Type puzzles** | "Win this in one move using a type advantage" | the simulator plays out sandbox games and logs every position where exactly one action produces a CRITICAL or a King capture. Filter, dedupe by hash, publish |
| **Refusal puzzles** | "You have three captures available and two of them will kill you. Find the third" | logged from positions where ≥ 2 of the legal captures resolve to BACKLASH under the revealed roll |
| **Chain puzzles** | "Take three pieces this turn" | logged from positions with a `L = 3` chain available, which also teaches the baton rule by making it the obstacle |

Directive 10 calls this "the cheapest way to build type fluency", and it is cheaper still here: the puzzle
corpus is a *by-product* of the tool §9.4 already requires for balance measurement. One instrument, two uses.

### 10.13 Teaching the draft and the meta-game (directive 9)

Drafting is a separate skill and gets its own track, entered the first time the player drafts rather than
up front:

1. **"Why one type per piece is a decision"** — the player is handed **Lapras** and asked to declare Water or
   Ice, with the Coverage Strip animating both futures. Measured: **526 of 1 025 base formes are dual-typed**,
   so 51% of picks are a real choice, and this lesson is the one that turns that 51% into depth rather than
   noise.
2. **"Read the matchup"** — shown the opponent's revealed army (it is public), the player is asked to pick the
   one candidate that closes the largest gap in the 18-cell Coverage Strip.
3. **"An army, not a pile of favourites"** — the validator's requirements (§8.3) are taught as consequences:
   the player is *allowed* to build an army with no immunity breaker, shown the Coverage Strip's warning, and
   then dropped into a rigged game against a Levitate Flying piece they cannot touch. One game teaches it
   permanently.
4. **Collection and ladder lessons** fire at first contact, not at sign-up: the first post-match reward
   explains rarity from real `tags`; the first evolution explains that it transforms *your* individual; the
   first Gym Leader match explains that a mono-type army is a solvable puzzle and shows the Coverage Strip
   against that type. That last one is the design's thesis stated as a game mode, so it deserves a lesson.

---

## 11. The AI opponent

`recon-tech.md` measured this problem thoroughly and I take its architecture, because its measurements are
directly about my ruleset's shape.

**Search.** Alpha-beta negamax + PVS + quiescence in a Web Worker, no `SharedArrayBuffer`. A **ply is a
sub-move**: the node carries `(sideToMove, subsLeft, actedMask)`, does not negate on a bonus sub-move, scores
mates as `29000 − subMoveCount`, and counts progress and repetition in sub-moves. Measured on a variant
searcher with the real chart, illegal captures, mutual destruction and bonus chains: **7.1 M nodes/s in plain
JS at EBF 3.8–4.2** — depth 8 in 148 ms, depth 9 in 601 ms. Target: **p95 ≤ 1.3 × budget with a 350 ms floor**,
depth 8–9 at a 1-second budget.

**Randomness.** This is where my §7.4 pays off twice. The Tempo Roll is revealed at the *turn boundary*, so
within a turn the search is fully deterministic — measured cost of input randomness: **+10% at depth 6, +0% at
depth 8**, versus **121–159×** for full chance-node enumeration and a measured *negative* result for Ballard
star1 pruning. At the boundary the opponent's next roll is a 6-way chance node, and the searcher collapses it
to three representative faces `{1, 4, 6}` with weights `{1/6, 4/6, 1/6}` plus a static EV bias — the bias is
the load-bearing half, since naive modal collapse mis-valued a measured position at +1012 where sound search
said +1906. Rider coins are collapsed to their expectation, because they cannot remove a piece.

**Move ordering and quiescence.** No SEE; instead a precomputed
`staticClash(attackerType, defenderType, face) → { P(die), P(bonus), Δmaterial }` table — 18 × 18 × 6 = 1 944
bytes — used both for ordering and for quiescence pruning. Critically: **do not prune losing captures**, since
capturing a queen with a pawn at 0.5× (both die) is often excellent in this variant.

**Evaluation, tiered.** Incremental material and per-type count vectors at every node (measured 4 ns);
mobility, threat and king safety lazily inside a ±250 cp margin; army-level coverage/immunity/supply terms
once per root. Weights fitted by self-play, never by hand. Damage counters enter the eval as a fractional
material term (a 2-counter piece is worth ~0.7 of itself **and hands +2 to its attacker**, so the term is
larger than pure material would suggest), slot charges as a small tempo term, and the **Charge counter**
(§7.9a) as a *threat* term rather than a material one — a piece at charge 2 with a tier-5 area slot is a
standing threat to eight squares, which the quiescence search must see or it will walk into an Earthquake.
`exposedAtStart` is carried in the node so R5's new-exposure test is a set difference rather than a second
`isAttacked` sweep.

**Transposition.** One-shot wards make capture legality state-dependent, which measurably costs about a ply
(depth 9: 601 ms → 2 069 ms with the TT reduced to a best-move cache). Paid for as `recon-tech.md` prescribes:
a factorised ~6 500-key Zobrist (52 KB) built on the existing `zobristWords()` seam, epoch-splitting the probe
key on ward state, and mandatory TT-move revalidation.

**Difficulty is a corrupted copy of the AI's own effectiveness table**, which is the right dial for this game
because it makes the AI *misjudge types* exactly as `DIRECTION.md` asks: measured 5% corruption scores 47%,
15% → 45%, 30% → 37%, 50% → 30%, and a fully type-blind AI still scores 25% because it still plays real chess.
Corruption is structured rather than uniform (beginner AIs know the starter triangle; intermediates get the 8
immunities and Steel's resistances wrong). Second and third dials: army quality (Really Bad Chess's approach)
and a contempt/risk knob that changes how the AI values BACKLASH trades.

**Gym Leaders** need care: a mono-type army measured **36%** against a mixed army at equal search over 40
games, a ~100–150 Elo composition handicap. So each Gym Leader gets a compensating search budget and a
hand-checked army, and the batch simulator verifies each gate lands in a 45–55% band before it ships.

---

## 12. The data model

### 12.1 Real signatures, compatible with what exists

```ts
// src/rules/state.ts
import type { PieceClass, Side, Square } from '../engine/board.ts';
import type { BattleType } from '../data/schema.ts';
import { Position } from '../engine/position.ts';     // chess substrate, unchanged
import type { RngState } from '../engine/rng.ts';

export type MarkId    = number;   // index into the generated 116-row mark table
export type MoveId    = number;   // uint16 into moves.bin
export type SpeciesId = number;   // uint16 into species.bin (1367 formes)
export type AbilityId = number;
export type ItemId    = number;   // 0 = none / consumed
export type PieceId   = number;   // Position's persistent id — survives moves and promotion

export interface MoveSlot { move: MoveId; charges: number; }   // slot 0: charges = Infinity

/** Per-piece Pokémon state. Keyed by Position's piece id; Position itself stays Pokémon-ignorant. */
export interface PokePiece {
  readonly id: PieceId;
  species: SpeciesId;             // mutable: Mega, Stance Change, promotion-evolution
  declaredType: BattleType;       // THE central field. Exactly one. Defence only (§7.2)
  ability: AbilityId;             // public
  item: ItemId;                   // public; 0 once consumed or destroyed
  slots: [MoveSlot, MoveSlot, MoveSlot, MoveSlot];
  counters: 0 | 1 | 2 | 3;        // damage counters (§7.6). Always 0 for a King.
  charge: 0 | 1 | 2;              // the Charge counter (§7.9a). Gates power-tier 4-5 ARTs.
  boosts: Int8Array;              // length 7 [atk,def,spa,spd,spe,acc,eva], each clamped ±6
  marks: MarkSet;                 // bitset + per-mark uint8 duration/layers
  flags: number;                  // PRISTINE | WARD_INTACT | CHOICE_LOCKED | USED_ACE | ACTED_THIS_TURN | …
}

export interface MarkSet {
  bits: Uint32Array;              // 4 words covers the 116-row table
  data: Uint8Array;               // duration or layer count per set mark
}

export interface PokeState {
  chess: Position;                              // existing module: geometry, legality, castling, ep, hash
  pieces: Map<PieceId, PokePiece>;              // per-piece Pokémon layer
  squareMarks: MarkSet[];                       // 64 — hazards live here
  sideMarks: [MarkSet, MarkSet];                // screens, Tailwind, Safeguard, Perish
  boardMarks: MarkSet;                          // the single Stadium slot: weather | terrain | room
  schedule: ScheduledEffect[];                  // ≤ 1 per (side, kind); horizon provably ≤ 5
  tempo: readonly [1|2|3|4|5|6, 1|2|3|4|5|6, 1|2|3|4|5|6];   // PUBLIC (§7.4). EXCLUDED from the
                                                //   repetition hash - it is RNG output (§7.11).
  sub: 0 | 1 | 2;                               // sub-moves already taken this turn
  actedThisTurn: PieceId[];                     // the baton rule (T2)
  exposedAtStart: Square[];                     // attacker squares that could take the enemy King at
                                                //   turn start. R5's "NEW exposure" test reads this (§7.12).
  progress: number;                             // sub-moves since the last progress event (§7.11)
  ace: [boolean, boolean];                      // Tera-or-Burst budget per side
  prizes: [number, number];                     // the material HUD and the ranked tiebreak
  rng: RngState;                                // advances only on the Tempo Roll, coins and seeded picks
}
```

Three fields with a non-obvious rationale, stated so nobody removes them as redundant:
`exposedAtStart` exists because R5 is a statement about a *delta*, and recomputing turn-start exposure lazily
inside the search would cost the `isAttacked` scan twice per node. `charge` is separate from
`MoveSlot.charges` because they are different resources with different lifetimes — one is per-move ammunition
from `pp`, the other is per-piece patience (§7.9a) — and collapsing them would delete exactly the mechanic
that governs the action economy. `prizes` is derived data kept materialised because it is both the HUD and the
ranked tiebreak, and recomputing it from removals would require keeping a removal log.

### 12.2 The action space of a turn

```ts
export type Action =
  | { kind: 'move';    from: Square; to: Square; promote?: PromotionChoice }
  | { kind: 'art';     from: Square; slot: 1 | 2 | 3; target: Square | 'self'; primary?: Square }
  | { kind: 'ace';     piece: PieceId; mode: 'tera'; type: BattleType }
  | { kind: 'ace';     piece: PieceId; mode: 'burst' }
  | { kind: 'react';   piece: PieceId; slot: 1 | 2 | 3 }     // offered only during an enemy Clash
  | { kind: 'decline' };                                      // forgo remaining bonus sub-moves

export interface PromotionChoice { cls: 'queen'|'rook'|'bishop'|'knight'; species: SpeciesId; type: BattleType; }

/** The four-method Rules interface the AI and the server both program against (frozen early). */
export interface Rules {
  generate(s: PokeState): Action[];
  apply(s: PokeState, a: Action): { next: PokeState; events: EffectEvent[] };
  terminal(s: PokeState): Terminal | null;
  staticClash(attacker: BattleType, defender: BattleType, face: number): ClashEstimate;
}
```

`EffectEvent[]` is the *only* channel from engine to view: the engine advances state instantly and emits
serialisable events; a Presenter lays them on a fixed beat grid; nothing in the engine ever awaits an
animation, and any input calls `settle()` first.

### 12.3 Two decisions inside the model that are load-bearing

**Boosts stay a 7-vector.** **[DEVIATION from `recon-abilities-items.md` §2.4]**, which collapses all six
stats and every stat stage into one `Vigour ∈ [−3,+3]`. I reject the collapse because the fidelity is *free* —
the compiler reads `{atk:2}` off Swords Dance and `{def:2}` off Iron Defense with zero authoring — and the
collapse would make those two moves the same effect, destroy Unaware, Contrary, Simple, Clear Body, Power
Trick, the 7 stat-swap moves and every `spe` mechanic, and violate `DIRECTION.md`'s "systematic but
thematically wrong is a defect". The legibility problem the collapse solves is real, and I solve it **in the
UI**: the Clash needs exactly two numbers, so the interface shows two.

```ts
might(P, slot)     = P.boosts[physical(slot) ? ATK : SPA] + Σ TILT(atk-scope)
guard(P, incoming) = P.boosts[physical(incoming) ? DEF : SPD] + P.counters + Σ TILT(def-scope)
```

`spe`, `acc` and `eva` surface as three badges, not numbers. Seven fields in the engine, two numbers and three
badges on screen: progressive disclosure, exactly as asked.

**Kings have no counter track** (§7.6), so there is no second win route and no cheap royal chip-down.

---

## 13. Technical architecture

### 13.1 File tree

```
tools/compile/                     # BUILD TIME ONLY. Never shipped.
  index.ts                         # the five passes, deterministic, emits build/compile-report.json
  admit.ts                         # pass 1: isNonstandard policy, stable ids, the 116-row mark table
  derive-fields.ts                 # pass 2: C1  (§3.2)
  derive-fingerprint.ts            # pass 3: C2  — the 69-stem grammar (§1.3)
  derive-source.ts                 # pass 4: C3  — 41 mutation + 37 predicate + 17 return-pattern rows
  patch.ts                         # pass 5: overrides as diffs, proposalHash drift detection
  emit.ts                          # packs Effect[] to bytes; asserts the six CI gates (§3.4)
  tables/{stems,mutations,predicates,returns,regions,fractions}.ts

data/curated/
  overrides.json                   # 119 rows — THE ENTIRE hand-written content surface
  item-classes.json                # the 60 inert-by-design items, named
  type-kits.json                   # 18 types x 6 moves — the moveset floor (§8.6)
  formats/*.json                   # pools, budgets, Kits, bans, requirements, Ace lists
  lessons/*.json                   # §10.7 Lesson rows: the whole tutorial, as data
  puzzles/generated.json           # §10.12, emitted by src/sim/ — never hand-authored

src/data/                          # EXISTS — extended, not replaced
  schema.ts                        # + Effect, Op, Trigger, Region, MarkRow, coverageClass
  dex.ts                           # unchanged public API
  effects.ts                       # NEW: typed lazy access to the compiled effect tables
  generated/                       # + moves.bin, abilities.bin, items.bin, marks.bin, effects.json
  coverage.test.ts                 # NEW: the §6 test — the most valuable test in the project

src/engine/                        # EXISTS — unchanged
  board.ts  position.ts  typechart.ts  rng.ts  zobrist.ts

src/rules/                         # NEW: the thin layer
  state.ts                         # §12 types, clone/serialise, Zobrist mixing via position.xorHash
  clash.ts                         # §7.5 — the ONLY place an outcome is decided (~120 lines)
  turn.ts                          # §7.3 turn loop, sub-moves, Checkup, T1/T2/T3
  ops.ts                           # the 18 op implementations (~350 LOC total)
  regions.ts                       # the 16 region resolvers over board.ts geometry
  marks.ts                         # mark application, durations, tick dispatch
  triggers.ts                      # the 13-trigger dispatch table
  legality.ts                      # generate(), Guarded-mode filter, R3 suicide guard
  terminal.ts                      # §7.11 draws, king capture, adjudication
  profiles.ts                      # 'standard' | 'classic' (ladder off, all-Normal) | 'guarded'

src/ai/
  search.ts  eval.ts  order.ts  staticClash.ts  worker.ts  difficulty.ts

src/sim/
  batch.ts                         # headless self-play, worker pool, aggregate counters only
  report.ts                        # the §9.4 metric set

src/draft/
  draft.ts                         # slot-first candidate generation, PoolSource-parameterised
  price.ts                         # §8.5 costs from §9.1 V()
  validate.ts                      # §8.3 requirements

src/tutor/                         # NEW: §10.7-§10.13. ~450 LOC, because lessons are data.
  lesson.ts                        # the Lesson/Goal/ActionFilter types and the goal checker
  runner.ts                        # drives a Lesson over the SAME Rules interface as a real game
  hints.ts                         # first-time hints: the same beat rows, fired by EffectEvent type
  progress.ts                      # per-lesson completion, in the local profile
  puzzles.ts                       # loads the simulator-generated corpus

src/ui/                            # EXISTS — extended per §10 and recon-visual/recon-tech
  App.tsx  BoardPiece.tsx  pieceRoles.ts  PokemonIcon.tsx  typeColors.ts
  silhouettes.tsx  fx/{layers.ts,ticker.ts,presenter.ts,ops.ts,regions.ts,skins.ts}
  panels/{WhyPanel,PieceCard,TempoRail,CoverageStrip,PrizeTrack}.tsx
```

### 13.2 Integration with what already exists

- **`variant.ts` is the starting point, not a competitor.** See §13.2a for the eight decisions it already gets right, the five PROVISIONAL ones this spec changes, and the migration order that keeps the game playable throughout.
- **`board.ts` is untouched.** `regions.ts` is written entirely in terms of `RAYS`, `KNIGHT_MOVES`,
  `KING_MOVES`, `BETWEEN` and `reachableSquares` — including `RAY_LOS`/`RAY_ANY`, which are ray walks with a
  distance clamp, and `FOE_ZONE`, which is file arithmetic.
- **`position.ts` is untouched** and becomes the chess substrate: `generateMovesInto` supplies candidates,
  which `legality.ts` then filters through `CLASH_LEGAL` — exactly the layering its own doc comment
  anticipated ("so that a 0× matchup makes this capture illegal can be layered on by filtering rather than by
  forking move generation"). Under `profiles.classic` the filter is the identity and the module *is* chess,
  which is what makes the `chess.js` oracle test meaningful.
- **`zobrist.ts`'s documented seam is used as designed**: `zobristWords('type/Fire/12')`,
  `zobristWords('counters/2/12')`, `zobristWords('mark/burned/12')`, mixed with `position.xorHash()` when a
  fact becomes true and again when it stops. `makeMove`/`unmakeMove` already snapshot and restore the whole
  key, so search gets undo for free.
- **`rng.ts` is used as-is**, and only in three places: the Tempo Roll, rider coins, and seeded selection.
  `Rng.fork(label)` keeps the draft's stream from perturbing the match's.
- **`typechart.ts` is used as-is.** `TYPE_PROFILES` already computes exactly what the draft UI's Coverage
  Strip needs.
- **`dex.ts`'s API is unchanged**; `effects.ts` sits beside it with the same lazy-`once` pattern.
- **`schema.ts` gains** the `Effect`/`Op`/`Trigger`/`Region`/`MarkRow` types and a `coverageClass` field. Its
  existing `SignalClass` is the same idea one step coarser, so the two align rather than compete.
- **`App.tsx` is extended, not replaced** (~2 days): pieces move out of the square buttons into one
  transform-positioned layer keyed by piece id, and two Canvas2D layers are added underneath and above.

### 13.2a Relationship to the shipped provisional rules layer (`src/engine/variant.ts`)

**The repo advanced while this document was being written.** Commits `8a863d9` "Add the Pokémon Chess rules
layer" and `4534143` "Make the game playable" landed `src/engine/variant.ts`, `src/game/autodraft.ts`,
`src/ui/GameBoard.tsx` and `src/ui/outcomes.ts`. There is now a **playable** Pokémon Chess implementing the
video's four rules plus the die. Its own header says:

> *"This implements the four rules from the source video plus the die… It deliberately does **not** yet
> implement moves, abilities, items, status, hazards, weather or evolution; those await the full
> specification being written in `docs/design/`. The decisions marked "PROVISIONAL" below are the ones that
> specification is expected to revisit."*

This section is that revisiting, stated as a migration rather than a rewrite. **Most of `variant.ts` is
right and is kept.**

**What is kept, and validates the design:**

| Shipped in `variant.ts` | My §-reference | Note |
|---|---|---|
| `Loadout = ReadonlyMap<number, PokemonLoadout>` keyed by **persistent piece id** | §12.1 `pieces: Map<PieceId, PokePiece>` | the same decision, for the same stated reason ("ids survive movement and promotion — which is exactly the shape evolution needs"). `PokemonLoadout` widens into `PokePiece` |
| **one declared type per piece**, even for dual-typed species | §7.1 | identical, with the same Lapras justification |
| type-illegal captures are **never generated**, not merely discouraged | §7.5 step 1, §2.2 (`VETO` cannot be folded into `TILT`) | identical, and it is why `VETO` is a separate op |
| `VariantRules` as an explicit config object | §13.1 `profiles.ts` | `RulesProfile` extends `VariantRules`; `diceEnabled: false` is already my `classic` profile's spine |
| `maxExtraMovesPerTurn: 2` (a turn is at most three actions) | §7.11 **T1** | the same bound, and the same monovariant argument in its doc comment |
| immutable `play()` returning a new game, with search using `makeMove`/`unmakeMove` | §11, §13.3 | exactly the split I need |
| `ResolvedMove` carrying the roll, the multiplier, the cause and the removed ids | §2.7 `EffectEvent` | `ResolvedMove` is a single-outcome ancestor of the `clash` event; the Why panel is already possible |
| `outcomes.ts` presenting each outcome with label + glyph + colour + detail, "never colour alone" | §10.3 | the right instinct, already CVD-aware |

**The five PROVISIONAL decisions this specification changes, each with the reason:**

| # | `variant.ts` today | This spec | Why the change |
|---|---|---|---|
| 1 | **Checkmate is the win condition**, and capturing a king is filtered out of `legalMoves()` outright | **King capture** (§7.12 R1); checkmate becomes a UI label | This is the most important line in the migration, and there is a **concrete defect** behind it: `result()` decides mate via `position.isInCheck()`, which lives in the deliberately Pokémon-ignorant `position.ts` and is therefore **type-blind**. So the shipped game will declare checkmate when the only "mating" piece is a Normal piece attacking a Ghost king — a capture that is *illegal* — and will equally miss that a 0.5× "mating" piece dies if it tries. Making `isInCheck` type-aware does not fix it either, because whether an attack *succeeds* depends on the opponent's future roll. That is §7.12's argument that checkmate is not a well-formed predicate here, arrived at from the implementation rather than from theory |
| 2 | **The die is rolled inside `play()`**, after commitment, and `legalMoves()` explicitly may not depend on it | **The Tempo Roll is public at turn start** (§7.4) | the doc comment's own objection to letting a roll decide a game — *"reads as unfair rather than exciting"* — is correct, and pre-revealing is the answer to it rather than a contradiction of it. It also buys `recon-tech.md`'s measured **~150× AI saving** and is what makes decisions 3 and 5 below possible at all |
| 3 | `captureIsSafe()` forbids any capture that could leave your own king attacked **under mutual destruction** — the conservative fix to the video's bug | **R2/R3**: leaving your king capturable is legal; only a resolution that *necessarily* removes your own king is illegal | The conservative rule is the right call *given a hidden die* — with an unknown roll, "could" is the only computable quantifier. Once the roll is public, **"necessarily" becomes exactly decidable**, so the rule can be tightened to Atomic's actual formulation without ever letting a hidden roll lose a game. Same bug fixed, strictly less collateral: a capture that is merely *risky* stays available, with its exact odds on screen (R7) and filtered out for casual players (R8) |
| 4 | the extra move **must be played by the capturing piece** (`mover.id !== pending.pieceId → skip`) | **T2, the baton rule**: the bonus sub-move must be played by a piece that has **not** yet acted this turn | the shipped rule is deliberate and it reads well ("the piece pressing its advantage"), but it is the "one super-typed piece mows the board" fantasy, and it is the degeneracy `recon-variants.md` §1.3 documents in every extra-move variant. English Progressive Chess's rule turns a chain into a **team combo**, which is better flavour *and* better legibility — and §17 turn 4 is written to show the difference |
| 5 | the extra move is **mandatory** (no way to decline) | `{kind:'decline'}` in the action space (§12.2) | `recon-tech.md`'s ruling: a mandatory extra move is an undesigned zugzwang mechanic players will report as a bug, and the AI needs the branch to evaluate chains honestly |

**Two additive changes, not corrections:** `Resolution` grows from four values to the **five rungs plus
BLOCKED** (§7.5), so `OUTCOME_PRESENTATION` must be re-keyed from `CaptureOutcome` to `Rung` — REPELLED and
BACKLASH are different outcomes that today both map to "not very effective". And `GameResult` grows the
terminal set of §2.7 (`king-captured`, `immobile`, `perpetual`, `adjudicated`).

**Migration shape, and it is small:** `variant.ts` becomes the **`classic` profile** of `src/rules/`. Its
four-outcome resolver is the `diceEnabled`-style special case that `profiles.classic` selects, which keeps the
currently playable game working and playable *throughout* the migration, and keeps
`classic-vs-chessjs.test.ts` meaningful. `PokemonChess` is renamed to the `Rules` interface's four methods
(`generate`/`apply`/`terminal`/`staticClash`) with its current bodies as the first implementation. **M1 is
therefore not "build the rules layer" but "evolve the shipped one"** — which is why its 9-day estimate is
credible, and it is the strongest reason to prefer a specification that was written against the real code.

### 13.3 Determinism and the network property

A whole game is `{ formatId, seed, actions: Action[] }`. The same engine module runs in Node and the browser,
so the server validates every action with the identical code, replays are free, spectating is free, reconnect
is replay, and desync is a state-hash comparison. Nothing in `src/rules/` may touch `Date`, `Math.random` or
the DOM; an ESLint rule and a CI check enforce it. **The server owns the Tempo Roll** — with public dice, that
is also the only thing worth cheating on, and it is exactly one value per turn.

### 13.4 Tests

| Test | What it protects |
|---|---|
| `coverage.test.ts` (§6) | the whole content claim, 1 797 entries, on every build |
| `compile-determinism.test.ts` | byte-identical output for identical inputs |
| `classic-vs-chessjs.test.ts` | under `profiles.classic`, perft to depth 5 from 20 positions must equal `chess.js` — the variant reduces to chess exactly |
| `clash.table.test.ts` | all 324 ordered type pairs × 6 faces × 4 tilt values against a hand-written expectation table (7 776 rows, generated once and reviewed). **Includes the four §7.5 regression cases this pass added**: a defender at 2 counters is *easier* to capture, not harder; a `def −2` defender hands +2 to the attacker; a Confused *attacker* ends its own turn on tails; a King is capturable at 0.5× by a type it would otherwise be immune to |
| `dispatch.test.ts` | §2.8: a state serialised, reloaded and re-run emits a byte-identical `EffectEvent[]` — the desync guard |
| `tutorial.test.ts` | §10.7: every `Lesson` row's goal is achievable from its position and seed, and every `beat` references an event type the engine emits on a successful run. **A rotted lesson fails CI** |
| `termination.test.ts` | property: no turn exceeds 3 sub-moves; no action sequence increases total piece count; `INVOKE` depth is always 1 |
| `progress.test.ts` | property: the Leftovers-vs-poison loop reaches the no-progress draw |
| `repetition.test.ts` | two positions differing only in damage counters, marks or charges hash differently; identical positions with different RNG counters hash the same |
| `legality.r3.test.ts` | R3: every action that necessarily removes your own King under the revealed roll is absent from `generate()` |
| `exposure.test.ts` | T3: after any sub-move that exposes the enemy King, `generate()` returns only `decline` |
| `ai-regression.test.ts` | fixed-node search returns the known best action in 40 tactical positions |
| `budget.test.ts` | critical-path gzip ≤ 60 KB; entry chunk ≤ 110 KB; no `@pkmn/*` in the client bundle |
| visual fixtures (5, from `recon-visual.md`) | greyscale role legibility, CVD sweep, token contrast, outcome-silhouette pixel diff, worst-case frame budget |

---

## 14. The meta-game, and the netcode

The seam is §8.1 and everything here sits above it.

- **Ownership is of individuals**, per `DIRECTION.md`'s recommendation: three separate Pikachu, each
  fieldable. Duplicates are immediately useful, the 16-piece floor clears trivially, and it matches how
  Pokémon works. An owned individual carries `{ speciesId, declaredTypePreference, ability, slotSwap,
  nickname, cosmetics, record }` — deliberately *not* per-individual power, so collection depth never becomes
  raw strength.
- **Starter grant: 20 individuals** covering ≥ 12 types with a legal 16-piece army pre-built, so a new account
  plays immediately. Post-match rewards: **3 candidates on a win, 1 on a loss** (progress every match, win or
  lose). Expected collection: ~23 after 1 match, ~45 after 10, ~130 after 50, ~500 after 500, with rarity
  gated by real data (`tags`, `bst`, `tier`, `nfe`) and a pity counter on Legendary/Mythical.
- **Evolution is the headline progression axis** and it is the *same* `BECOME` op: an individual evolves when
  it has been fielded in N wins or meets its real `evoItem`/`evoCondition`, and evolving **transforms the
  individual** rather than consuming one and creating another — so your Charizard is *your* Charmander.
  Branching lines are a real choice; trade evolutions are the meta-game's one genuine reason for trading.
- **Fairness against collection depth** — the problem most likely to kill the game. Three answers, layered:
  ranked play is **point-buy budgeted** (a 20-Pokémon account and an 800-Pokémon account field armies of equal
  cost); ranked formats are **type-scoped seasons** (a Steel-legal season limits the value of hoarding);
  and the **Mirror Pool** queue drafts both sides from one shared pool of 40 candidates, where collection size
  is worth exactly zero.
- **Ladder:** Glicko-2 internally, the eight Kanto badges in canon order as the displayed identity, Elite Four
  above, Champion as a top-N leaderboard. "Highest badge earned" is stored separately from "current tier" so
  the ladder can be brutal without the profile feeling punitive. **Gym Leader promotion matches** gate each
  tier: a mono-type AI army is a legible, solvable type puzzle, which teaches the chart by making you use it
  (with the 36% handicap compensated per §11).
- **Sandbox first, no account:** full dex, both armies free, AI-vs-AI, adjustable strength, a position editor,
  shareable seeds, and the batch simulator (§9.4) exposed as a player-facing curiosity.

**Netcode, concretely** (`BRIEF-METAGAME.md` §4 q9–q12), because the engine's purity makes it small. The wire
protocol is five messages, and a whole game is `{formatId, seed, actions: Action[]}`:

| Message | Direction | Payload |
|---|---|---|
| `join` | C→S | `{formatId, ratingCert}` |
| `state` | S→C | `{seed, army[2], turn, tempo, hash}` — sent once, then never again except on reconnect |
| `act` | C→S | `{turn, sub, action: Action, clientHash}` |
| `applied` | S→C | `{turn, sub, action, events: EffectEvent[], hash, tempoNext?}` |
| `terminal` | S→C | `{result: Terminal, prizes, ratingDelta}` |

- **The server owns the Tempo Roll and is the only source of `rng`.** It resolves every action with the
  identical `src/rules/` module the client runs, so there is no reimplementation to drift. With public dice
  the *only* thing worth cheating on is the roll, and it is exactly one value per turn.
- **Desync detection is free**: every `act` carries the client's state hash and every `applied` returns the
  server's. A mismatch resyncs by replaying the action list, which is also how reconnect works — there is no
  separate reconnect path.
- **Turn timers**: 60 s per turn plus a 3 min reserve, with **bonus sub-moves drawing on a separate 20 s
  budget** so a three-capture turn cannot be lost to the clock (a rule the sub-move structure forces).
  60 s reconnect grace, then forfeit; abandonment inside the first three turns is a no-rating cancel.
- **Matchmaking pairs on rating *and* pool depth.** The ranked default is the **Mirror Pool** queue, where both
  sides draft from one shared pool of 40 candidates, so collection size is worth exactly zero and the queue can
  pair a 20-Pokémon account with an 800-Pokémon one without unfairness. Collection-pool queues exist for
  players who want to field what they own, and pair within a depth band. Target queue time 30 s, widening the
  rating window by 50 Glicko points every 10 s to a cap; below a healthy population the queue offers a Gym
  Leader match instead of waiting, which is the honest answer to a cold start.
- **Chat is a fixed quick-chat vocabulary** for public matchmaking (a Pokémon-flavoured emote set plus "good
  luck", "good game", "nice"), free text only between mutual friends. Pokémon's audience includes children and
  free text between strangers is a moderation liability we are not equipped to carry.
- **Trading is server-authoritative, atomic, both-sides-lock, friend-gated, with a 24 h cooldown per pair** —
  and it exists mainly because **trade evolutions are real** (Machoke → Machamp), which is the one genuinely
  lovely reason to implement it faithfully rather than as a duplicate-swap utility.

---

## 15. Milestones — each one complete and playable

| # | Ship | Contents | Effort |
|---|---|---|---|
| **M0** | **The compiler, headless** | passes 1–5, the 176 table rows, `build/compile-report.json`, `coverage.test.ts` green over all 1 797 entries. No game yet — but the content claim is *proved* before any rule depends on it. | 5 d |
| **M1** | **Playable hot-seat Pokémon Chess** — *by evolving the shipped `variant.ts`, not replacing it* (§13.2a) | `src/rules/` complete: turn loop, **Tempo Roll (change 2)**, the five-rung Clash, damage counters, Checkup, **king capture (change 1)**, R2/R3 (change 3), the **baton rule (change 4)**, `decline` (change 5), draws, promotion. Melee slot only — **no ART actions, no Charge counter, no abilities, no items.** Full chess plus the type chart plus the ladder. Silhouette pieces, five outcome animations, the outcome-annotation affordance, the Why panel. The game stays playable at every commit, because `variant.ts`'s current resolver becomes the `classic` profile on day one and the new ladder lands beside it. This is already a complete game a stranger can be handed. | 9 d |
| **M2** | **The AI** | worker search, staticClash, tiered eval, three difficulty tiers by corrupted chart, `ai-regression.test.ts`. | 6 d |
| **M2b** | **The tutorial and practice mode** | `src/tutor/`, the two tracks, the five outcome lessons, the two die lessons, first-time hints, per-lesson completion, `tutorial.test.ts`. Ships **immediately after the AI** and **before** moves, abilities and items — because the M1 ruleset (chess + chart + ladder + counters + king capture) is already the hardest thing to teach, and a tutorial written against a stable rule set is a tutorial that does not get rewritten twice. Puzzles arrive with the simulator at M6. | 5 d |
| **M3** | **Moves** | ART actions, all 16 regions, the Charge counter (§7.9a), slot charges, riders, hazards, status, the 13 triggers, FX from the ISA. The 950-move layer arrives *as data* — this milestone is mostly UI and region geometry. Each new mechanic adds one hint row and one lesson row, never a system. | 8 d |
| **M4** | **Abilities and items** | trigger dispatch for the remaining hooks, the Standard 12 Kit, wards, the draft's ability radio. Again mostly data: the ops already exist. | 5 d |
| **M5** | **Draft and formats** | slot-first draft, point-buy, requirements, presets, Coverage Strip, `PoolSource` parameterisation. | 6 d |
| **M6** | **Sandbox and the batch simulator** | AI-vs-AI, seeds, position editor, the §9.4 metric set — then **retune the ladder, α/β/ε/τ, the Charge gate and the point list from measurements**, and emit the §10.12 puzzle corpus as a by-product. | 5 d |
| **M7** | **Tera, Burst, Mega, evolution-promotion** | the remaining `BECOME` payloads and their art. | 4 d |
| **M8** | **Collection and progression** | local-first profile, rewards, evolution-through-play, Pokédex. | 8 d |
| **M9** | **Server and multiplayer** | authoritative validation with the same module, friends, friendly games, matchmaking, ranked with badges, Gym Leaders. | 15 d+ |

The order is deliberate, and there are three arguments in it:

- **M0 before M1.** If the compiler cannot reach total coverage, that must be known before a ruleset is built
  on the assumption that it can. M0 ships no game and is still the most valuable five days in the plan.
- **M1 is a complete game without moves, abilities or items.** The Melee slot means ordinary chess plus the
  chart is already the game — four outcomes, damage counters, king capture, draws, promotion, the outcome
  annotation, the Why panel. It is 14 days in and you can hand it to a stranger.
- **M2b before M3.** Teaching comes before content. This is the one ordering decision I would defend hardest,
  because the alternative — build all 950 moves, then work out how to explain them — is how a maximalist game
  becomes unplayable. Writing the tutorial against the M1 rule set forces the M1 rule set to be *teachable*,
  and every milestone after it pays a one-lesson, one-hint tax that keeps it teachable.

Honest total: **~53 days to M7** (a complete single-player game with all content, a tutorial and practice
mode), **~15+ more** for the server, ladder and Gym Leaders.

---

## 16. Faithfulness ledger — 20 named pieces of content

The test `DIRECTION.md` sets is: *a Pokémon player must recognise this as that thing behaving the way it
behaves.* Each row names the canon it comes from.

| Content | In Pokémon | On the board | Why a player calls it right |
|---|---|---|---|
| **Levitate** (42 species) | immune to Ground moves — *games* | Ground captures against this piece are **illegal**; the first attempt pops the ward and the second lands | It is exactly the immunity, and the one-shot bound is not invented: it is **Air Balloon's printed text** ("Pops when holder is hit") applied uniformly. `DIRECTION.md` names this mapping itself as the standard for "good" |
| **U-turn** (9 self-switch moves) | hit, then switch out — *games* | capture, then **return to the square you came from** | One boolean field (`selfSwitch`) becomes the most tactically distinctive capture in the game. `DIRECTION.md` names it as the faithfulness exemplar |
| **Sticky Web / Spikes / Stealth Rock / Toxic Spikes** | hazards on the opponent's side of the field that punish whatever arrives — *games* | paint a 3-square band of the enemy's rank 6; fires when an enemy **ends a move** there; **Stealth Rock scales with the arriving piece's type** (Ice takes 2 counters, Steel takes 0) | Layer counts (3/2/1/1), persistence, and the type scaling are all read from the dex, so it behaves like the real hazard rather than like a generic trap |
| **Rough Skin / Rocky Helmet** | the attacker takes damage on contact — *games* | whatever captures this piece **by contact** takes a damage counter | The `contact` flag is real data; the counter is the TCG's damage counter. "Attacking is not free" is why you draft Garchomp |
| **Choice Band / Choice Specs / Choice Scarf** | +50% to one stat, but you are locked into one move — *games* | +1 Clash roll (or +2 movement), and the piece is **locked to the slot it first used** for the rest of the game | The lock is the item's whole identity, and on a chess board "you may only ever do that one thing again" is a far sharper cost than a number. Illegal on King and Queen for the reason a +2-range Queen is |
| **Focus Sash** | survives one otherwise-fatal hit at full HP — *games* | the first capture that would remove this **pristine** piece fails; the attacker stays put; the Sash is consumed | Identical trigger (`pristine` = never yet damaged), and the one-directional rule ("a shield does not protect you from killing yourself") is what stops it becoming a free-queen exploit |
| **Wonder Guard** (Shedinja) | only super-effective moves can hurt it — *games*; the TCG card prints it as **immune to Evolved Pokémon, Basics get through** | uncapturable by Queen, Rook, Bishop and Knight; **always** capturable by any Pawn or King; hazards and status still kill it | Both canons are honoured: the games' "nearly everything bounces" feel, with the TCG's own bound. Shedinja dies to Stealth Rock, which is exactly how Shedinja dies |
| **Belly Drum** | halve your HP, maximise your Attack — *games* | take a damage counter, gain the maximum attack boost | The numbers are read out of Showdown's own source (`directDamage(maxhp/2)`, `boost({atk:12})`), so it is the real trade rather than a designer's approximation |
| **Trick Room** | for five turns, slower Pokémon move first — *games* | for five turns, **negative-priority moves are the ones that may interrupt**, and positive-priority moves cannot | It inverts initiative, which is what Trick Room *is*, and it brings an otherwise-dead archetype (Counter, Avalanche, Focus Punch) to life for a window. Duration 5 is the dex's own number |
| **Baton Pass** | switch out and pass your stat boosts to the incoming Pokémon — *games* | retreat to your origin and **leave your boosts and marks on the square you vacated**; the next friendly piece to arrive there inherits them | The "hand off what you built" fantasy survives intact on a board with no bench, and the +2 cap is the bound that keeps it from being a value loop |
| **Terastallization** | the Pokémon's type changes, once per battle, at a cost — *games*; the TCG prints Tera cards **off-type with a re-derived Weakness** | once per side per game, a piece's declared type becomes another of its legal types; **your turn ends** | Semantics from the games, price from the TCG's Mega Evolution rule ("When 1 of your Pokémon becomes a Mega Evolution Pokémon, your turn ends"). On a board where type *is* identity, this is the most dramatic button in the game |
| **Poisoned / Burned** | damage every turn; burn also weakens physical attacks — *games*; the TCG marks them with **stackable counters** | +1 damage counter at your Checkup (Toxic +2); Burned also −1 to physical Clash rolls; three counters is a Knock Out | The TCG's own instrument, its own name, its own visual. It is also why an immune piece is never safe |
| **Paralysis / flinch** | par halves Speed and sometimes stops you; flinch costs you the turn — *games*; the TCG's Paralyzed **costs exactly the next turn, then clears** | one mark, **Stunned**: the piece loses its next activation, then clears | The TCG's version, chosen deliberately over the games': a permanent hidden 25% failure chance is the worst possible mechanic in a chess variant. **107 measured applications** collapse into one rule and one visual |
| **Protect** | blocks the incoming move; using it repeatedly fails more and more often — *games* | uncapturable for one reply; consecutive uses succeed with probability `(1/3)^n` | The escalation formula is **Showdown's own**, extracted from the handler, so stalling is self-limiting without a rule I invented |
| **Earthquake / Explosion** | hits everything adjacent, including your own team — *games* | Clashes against all 8 neighbours, friend and foe; Explosion then removes the caster | Friendly fire is the whole reason Earthquake is a decision in doubles, and it becomes a genuinely new chess idea for free |
| **Expert Belt** | +20% to super-effective moves — *games* | +1 Clash roll **only when the matchup is super-effective** | It is an item that pays you for knowing the type chart, which is this game's entire thesis wearing a held-item sprite |
| **Soak** (and Magic Powder, Forest's Curse, Trick-or-Treat) | changes the target's type to Water — *games* | the enemy piece's **declared type becomes Water**, permanently and publicly, and its enamel field repaints | This is the single most *Pokémon Chess* move in the dex: on a board where type is identity, rewriting an enemy's type rewrites what may capture it and what it may capture. A Steel rook that repelled 10 of 18 attacking types becomes a Water rook that resists 3. And it is invisible to any design built on `@pkmn/dex`, which carries no type-change field at all — it exists here only because the compiler reads `setType('Water')` out of Showdown's source |
| **Screech / Metal Sound / Leer** (31 measured moves) | lowers the target's Defence by two stages — *games* | the enemy piece hands **+2 to every attacker's Clash roll** for the rest of the game | Boosts do not decay in the games either, and a defence debuff being an *investment in someone else's attack* is exactly how Screech is used in a real double battle. It is also a legal play against a piece you cannot touch, because 270 of 271 Status moves carry `ignoreImmunity` |
| **Sucker Punch** | goes first, but **fails unless the target is attacking** — *games* | may be declared as a Reaction **only against a piece that is attacking you**; one charge, one chance | The restriction is the move. A priority attack with no condition is Quick Attack; the read — "I think you are about to hit me" — is what makes Sucker Punch a famous move, and it survives translation without a single invented clause |
| **The Charge counter** | *TCG Pocket*'s Energy Zone: energy accrues automatically each turn and is spent to attack; and the games' `flags.charge` / `flags.recharge` two-turn moves | 0–2 chevrons per piece, +1 per turn the piece stays still, reset to 0 on a capture, and required to fire the 166 measured tier-4/5 moves | When the franchise itself built a digital board game with a small action budget, this is the shape it chose (`recon-tcg.md`). It also *is* Hyper Beam's recharge and Solar Beam's charge-up, stated once instead of as two special cases — and a player recognises "the big move needs a wind-up" instantly |

Two rows of honesty, both required by `recon-tcg.md`:

- **Mutual destruction is not Pokémon-authentic.** Neither canon has an attack that kills the attacker on a bad
  matchup. It is Kamikaze Chess (Laws, 1928) and Stratego's equal-rank rule, and it is the video's rule. The UI
  labels it as a **chess** rule in the Why panel rather than implying it is Pokémon.
- **The bonus move for a super-effective capture *is* Pokémon-authentic**, via the TCG: a ×2 Weakness is worth
  exactly one turn of tempo in the modal case (measured: 1 306 of 3 683 current-era attacks against the median
  110 HP target). "Super effective ⇒ move again" is the TCG's Weakness translated into a binary-capture game,
  and the UI uses the TCG's own vocabulary — **WEAKNESS** and **RESISTANCE** — on the capture banner.

---

## 17. A worked game

**Format:** Standard, `full-dex` pool, Standard 12 Kit. Seed `pokechess/demo-1`. Every chess move below was
validated with `chess.js` (`syscomp-9-game2.mjs`, `syscomp-10-exchange.mjs`); every type value and every
species/learnset fact was verified against the dataset (`syscomp-11-check.mjs`, `syscomp-12-final.mjs`).

**White (Bone army).** King **Slowking** *(Psychic)* e1 · Queen **Nidoqueen** *(Ground)* d1 ·
Rooks **Steelix** *(Steel)* a1, **Forretress** *(Steel)* h1 · Bishops **Alakazam** *(Psychic)* c1,
**Gengar** *(Ghost)* f1 · Knights **Rapidash** *(Fire)* b1, **Garchomp** *(Dragon)* g1 ·
Pawns a2–h2: Bidoof *(Normal)*, Zubat *(Flying)*, Sandshrew *(Ground)*, Roselia *(Grass)*,
**Machop** *(Fighting)*, Magnemite *(Steel)*, Pikachu *(Electric)*, Lapras *(Ice)*.
Forretress holds **Heavy-Duty Boots**; Machop holds **Expert Belt**; Gengar holds **Focus Sash**.

**Black (Ink army).** King **Tyranitar** *(Rock)* e8 · Queen **Gardevoir** *(Psychic — a draft decision that
decides this game)* d8 · Rooks **Onix** *(Rock)* a8, **Skarmory** *(Steel, ability Sturdy)* h8 ·
Bishops **Chandelure** *(Ghost)* c8, **Starmie** *(Water)* f8 · Knights **Zebstrika** *(Electric)* b8,
**Mudsdale** *(Ground)* g8 · Pawns a7–h7: Rattata *(Normal)*, Ekans *(Poison)*, Cubone *(Ground)*,
**Bellsprout** *(Grass)*, Charmander *(Fire)*, Gastly *(Ghost)*, Wooper *(Water)*, Snorunt *(Ice)*.

### Turn 1

**White — Tempo Roll `[4, 3, 5]`.** A middling turn: no face reaches the +1 band, so no neutral capture would
earn tempo. White develops: **e2–e4**, Machop *(Fighting)* to e4.
**Black — Tempo Roll `[2, 6, 1]`.** Face 1 is a 2 — the "no captures" face — but Black has none available
anyway. **e7–e5**, Charmander *(Fire)* to e5. The centre is contested by a Fighting pawn and a Fire pawn, and
neither is super-effective on the other (measured 1×), so neither wants to be the one to strike.

### Turn 2

**White `[6, 2, 4]`.** A 6 on face 1 is the best face in the game — any neutral capture becomes a SURGE and
any super-effective capture a CRITICAL. White has no capture yet, so it *develops toward one*: **Ng1–f3**,
Garchomp *(Dragon)* to f3, now eyeing e5.
**Black `[3, 3, 6]`.** **Ng8–f6**, Mudsdale *(Ground)* to f6, attacking e4. Ground into Fighting is 1×, and
Black's faces are 3 and 3 — the flat band — so a capture next turn would be an ordinary CLEAN trade.

### Turn 3

**White `[5, 1, 3]`.** White uses the turn for an **ART action** — the low second face makes this a support
turn. **Forretress (h1) uses Stealth Rock.** It does not move; it spends 1 of its 4 charges; the
`FOE_ZONE` region paints the enemy's rank 6 on the caster's file ± 1, clamped at the edge: **g6 and h6 are now
under Stealth Rock.** Note two rule details that matter later: an ART does not relocate the rook, so **White's
castling rights survive**; and Forretress holds Heavy-Duty Boots, so it is immune to the enemy's hazards in
turn.
**Black `[4, 4, 2]`.** Black advances instead of trading: **d7–d5**, Bellsprout *(Grass)* to d5. This opens
the d7 square — which White notices.

### Turn 4 — the first chain

**White `[6, 4, 3]`.**

- **Sub-move 1: e4xd5.** Machop *(Fighting)* captures Bellsprout *(Grass)*. Fighting into Grass is 1×
  (verified), so `rung0 = 1`; face 6 gives `step = +1`; Machop holds Expert Belt but the matchup is not
  super-effective so the belt is silent. **rung 2 = SURGE.** Bellsprout is removed, Machop takes d5, the board
  frame turns gold and White has a bonus sub-move.
- **The baton rule bites.** Machop has acted, so the bonus sub-move must be made by a *different* piece.
  The board dims every piece except those that have not yet acted.
- **Sub-move 2: Bf1–b5.** Gengar *(Ghost)* develops with the bonus, using face 4. And because d7 is now empty,
  the b5–c6–d7–e8 diagonal is open: **Gengar attacks Tyranitar, Black's King.**
- **T3 fires.** Gengar's arriving square, b5, was not in `exposedAtStart` — nothing could take Tyranitar when
  White's turn began — so this is a **newly created** exposure, and **White's turn ends immediately** (§7.12 R5);
  a third sub-move would have been forfeit if one had been earned. This is the rule that makes king capture
  safe: Black is guaranteed a full turn to answer. Note the counterfactual, which is where the second pass
  differs from the first: had Black's King *already* been exposed at the start of White's turn, White could have
  played sub-move 2 freely, because the threat White would be "creating" would be one Black had already had a
  turn to deal with.
- The HUD shows Black's persistent **"YOUR KING CAN BE TAKEN — Gengar (Ghost) from b5; Ghost into Rock is 1×;
  CLEAN on faces 3–6, BACKLASH on 2, REPELLED on 1."**

**Black `[2, 5, 4]`.** Black must answer, and Black's first face is a 2 — the worst face — so a capture would
resolve one band *down*. **c7–c6**, Cubone *(Ground)* to c6: it blocks the diagonal **and** attacks Gengar.
Black also silently notes that with a face of 3–5 next turn, Cubone into Gengar (Ground into Ghost, 1×) is a
CLEAN capture of a bishop with a pawn.

### Turn 5

**White `[2, 6, 5]`.** Face 1 is a 2. Every capture on the board resolves one band worse than usual, so
**White declines all of them** — this is the lesson the public roll teaches in one turn: *a bad face is not
bad luck, it is information, and information is a plan.* White also cannot leave Gengar on b5. **Bb5–a4**,
Gengar retreats along the diagonal, still eyeing the c6 pawn and keeping the Sash intact.
**Black `[3, 3, 6]`.** **g7–g6**, Wooper *(Water)* to g6 — and g6 is under Stealth Rock. The hazard's
`ON_ENTER` tick fires: Rock into Water is 1×, so Wooper takes **1 damage counter**, and one pip lights on its
bezel. Had that been Snorunt *(Ice)*, Rock into Ice is 2× and it would have taken **2**.

### Turn 6 — the second chain

**White `[6, 4, 3]`.**

- **Sub-move 1: Nf3xe5.** Garchomp *(Dragon)* captures Charmander *(Fire)*. Dragon into Fire is 1×; face 6
  gives `step = +1`; **SURGE.** Bonus sub-move earned.
- **Sub-move 2: d5xc6.** The baton passes to Machop *(Fighting)*, which has not acted this turn, and it
  captures Cubone *(Ground)* on c6 with face 4: `rung0 = 1`, `step = 0`, **CLEAN.** Two captures in one turn
  by two different pieces — the chain is a *team* combo, never a rampage.
- No exposure, and no third bonus, so the turn ends. White is up two pawns and has both knights and a bishop
  active.

**Black `[5, 5, 3]`.** **Bf8–g7**, Starmie *(Water)* to g7, apparently threatening Garchomp on e5. It is a
**bluff, and the board says so**: Water into Dragon is 0.5× (verified), so if Starmie takes Garchomp the
resolver reads `rung0 = 0`, and on Black's faces of 5 that is **BACKLASH — both pieces die.** Black's own UI
draws that square with twin cracks rather than a slash. A chess player reading only the geometry sees a
threat; a player reading the shapes sees a trade offer.

**Position after 6 turns:** `rnbqk2r/pp3pbp/2P2np1/4N3/B7/8/PPPP1PPP/RNBQK2R w KQkq - 1 7` — with, in addition
to the FEN, one damage counter on Wooper, Stealth Rock persisting on g6/h6, Forretress at 3 of 4 charges, and
Gengar's Focus Sash unspent.

### The mid-game exchange this design exists for

Move 25. Position `5rk1/1b3ppp/4p3/2rq4/1P1n4/6P1/P4PBP/4R1K1 w` (validated), with the Pokémon layer:

- **White:** King **Slowking** *(Psychic)* g1 · Rook **Steelix** *(Steel)* e1 · Bishop **Gengar** *(Ghost)* g2 ·
  Pawn **Machamp** *(Fighting, promoted from Machop, Expert Belt)* b4 · pawns a2, f2, g3, h2.
- **Black:** King **Tyranitar** *(Rock)* g8 · Queen **Gardevoir** *(Psychic)* d5 · Rook **Skarmory**
  *(Steel, Sturdy)* c5 · Knight **Gogoat** *(Grass)* d4 · Bishop **Chandelure** *(Ghost)* b7 · Rook f8 ·
  pawns e6, f7, g7, h7.

**White's Tempo Roll: `[6, 6, 4]`.** Both of the first two faces are sixes. The board frame has not turned gold
yet and White has three sub-moves available. What follows is fully determined — no hidden roll, nothing to
hope for:

- **Sub-move 1 — b4xc5, face 6.** Machamp *(Fighting)* captures Skarmory *(Steel)*. Fighting into Steel is 2×
  (verified), so `rung0 = 2`. Expert Belt fires because the matchup is super-effective: `+1`. Face 6 plus 1 is
  7, `step = +1`, so `rung = 3`: **CRITICAL.** Skarmory has **Sturdy**, which is `WARP([1,2,3] → −1, once)` —
  and a CRITICAL **pierces every ward and every survive-once defence**, so Sturdy does not save it. The banner
  reads **WEAKNESS ×2 — CRITICAL**, the 8-ray star plays, the board frame turns gold, and Machamp gains
  `+1 atk`. *A pawn has just taken a rook and kept the tempo.*
- **Sub-move 2 — Bg2xd5, face 6.** The baton passes to Gengar *(Ghost)*, which captures Gardevoir. **Here is
  the whole game:** Black declared Gardevoir as **Psychic** at draft. Ghost into Psychic is 2× (verified), so
  `rung0 = 2`; face 6 gives `step = +1`; **CRITICAL** again. Had Black declared Gardevoir as **Fairy** — its
  other real type — Ghost into Fairy is **1×** (verified), the capture would have been a CLEAN, White would
  have earned no further tempo, and the turn would have ended one sub-move sooner. *The draft decision, made
  twenty-five moves earlier, is what turned a good turn into a devastating one.*
- **Sub-move 3 — Re1xe6, face 4.** The baton passes again, to Steelix *(Steel)*, which captures the e6 pawn
  *(Snorunt, Ice)*. Steel into Ice is 2× (verified): `rung0 = 2`, face 4 gives `step = 0`, **SURGE.** That
  would grant a fourth sub-move — but **T1 caps the turn at three**, so the turn ends here. Three captures, by
  three different pieces, in one turn: rook, queen and pawn, for nothing.
- **T3 check:** after each sub-move the engine tested whether Tyranitar became capturable. It never did
  (d5–e6–f7–g8 was blocked by the e6 pawn, and after Rxe6 by White's own rook), so no sub-move was forfeited.

**Black's reply. Tempo Roll `[4, 2, 5]`.** Black is losing on material and has one instrument left: a
deliberate mutual destruction. **Nd4xe6, face 4.** Gogoat *(Grass)* captures Steelix *(Steel)*. Grass into
Steel is 0.5× (verified), so `rung0 = 0`; face 4 gives `step = 0`; **BACKLASH — both pieces are removed.** The
twin-crack animation plays and e6 is left empty. Black has spent a knight to delete the rook that just ate its
pawn, and **it chose that outcome knowing it exactly**, because the face was on the table before the click.
This is the video's *"my Ice type is so worthless that the suicide is worth it"* — priced by §9.1, made a
decision rather than an accident by §7.4, and labelled in the Why panel as a chess rule rather than a Pokémon
one.

Had Black's first face been a **6** instead of a 4, the same capture would have read `step = +1`, `rung = 1`,
**CLEAN** — Gogoat would have taken the rook and *lived*. Same pieces, same types, one face apart. That is
where the drama of this design lives, and none of it is hidden from either player.

---

## 18. The ten hard problems of `BRIEF.md` §5, answered

**1. Content coverage at scale.**
A five-pass **compiler** (§3) over three measured signal channels (§1.1): declarative fields, the handler-name
grammar (**81 stems, 148 of 150 names parse**, the two failures being exactly `onTry` and `onWeather`), and
handler source text (**1 675 functions, 440.4 KB, 2 845 call sites**, re-measured this pass with my own
scanner). The taxonomy is **18 ops × 13 triggers × 16 regions**, and the ops were *measured* — they are the
fifteen mutation clusters the dataset is already written in, plus three the engine embodies. The corroboration
that matters: **two independently written scanners agree on the mutation-site count to within one site in a
thousand (1 072 versus 1 071).** Result: **1 610 of 1 797 admitted entries (89.6%) derived with zero authoring;
119 curated (6.6%), each a diff against the compiler's proposal, all named in §1.6; 68 deliberately inert
(3.8%), all named; 0 missing.** The generic fallback (§6) makes an unclassified damaging move an ordinary
capture at tier `basePower || 60` and an unclassified status move a small visible self-buff, so nothing is ever
a silent no-op. 900 unbalanced special cases are avoided because there are no special cases: there are **218
table rows** and 119 data patches — one table row per eight content entries — and CI fails the build on any
unassigned entry, an 82nd stem, a 46th verb, an unclassified share above 1%, or any op that could add a piece.
**And the one thing pass 1 could not defend is now retired by measurement**: its 4.4% unclassified call sites
were not a hidden behaviour class but 42 unwritten table rows, of which **61 sites are predicates, 34 are
region resolvers (Showdown's own code confirming the Region axis), 17 map onto ops that already exist, and
zero require a nineteenth op** (§1.7).

**2. Turn structure.**
Written out as pseudocode in §7.3. **One action per turn**, from `{MOVE, ART, ACE, DECLINE}`, plus up to two
bonus sub-moves earned by SURGE/CRITICAL and taken by *different* pieces. **No HP; capture stays binary**, but
pieces carry **0–3 damage counters** (§7.6) — the TCG's own instrument — which are what the ~200 chip/heal
entries act on, which hand their value to whoever attacks the piece, and which knock it out at 3 during the
Checkup. **Using a Pokémon move does cost your turn — except the one you use every time you capture:** slot 0,
the Melee slot, is uncharged and is what an ordinary chess capture *is*, so the move layer never taxes chess.
Charged slots 1–3 (`charges = clamp(round(pp/5),1,5)` — measured 1→208, 2→319, 3→174, 4→159, 5→90 — giving
~9–12 uses per piece per game) are the ART actions: ranged captures, hazards, status, boosts, weather. The
action economy has a second governor added this pass: the **Charge counter** (§7.9a, `recon-tcg.md`'s Energy
Zone), one integer per piece in `[0,2]` that accrues on a turn the piece stays still, resets on a capture, and
is **required to fire the 166 measured tier-4/5 moves** — so the biggest ARTs are available exactly when the
board has been slow, and never at the end of a capture chain. The Checkup runs at the end of your turn in the
TCG's published order, in the §2.8 deterministic dispatch order, with simultaneous removal.

**3. Termination.**
Proved three ways in §7.11. The bound that matters: `TEMPO('grant-bonus')` is emitted **only** by ladder rungs
2 and 3, both require a capture, every capture removes an enemy piece, and **no op in the ISA can place a piece
on the board** — `SUMMON` does not exist and **CI gate 5 fails the build if it ever appears**. So the enemy
piece count is monotonically non-increasing and a chain has length `L ≤ N + 1 ≤ 17`, and `≤ 16` once the King
is excluded — entirely independent of the RNG. Shipped caps for feel: `L ≤ 3`, the baton rule, and
exposure-ends-the-turn. Game-level: the no-progress clock resets only on monotone-finite resources
(≤ 620 total), so a game is at most ~62 100 sub-moves; healing, status churn, counter churn, **Charge accrual**
and ward-free REPELLEDs are each explicitly *not* progress and each closes a named loop (§7.11's table), the
most important being Leftovers-versus-poison. Scheduler horizon is provably ≤ 5 because the measured maximum
`condition.duration` in the entire dataset is 5 (histogram `{1:34, 2:15, 3:5, 4:10, 5:20}`), and at most one
`SCHEDULE` entry may be pending per `(side, kind)`.

**4. Check, checkmate, mutual destruction, king capture.**
One model, R1–R8 in §7.12: **king capture, no check-legality, an exact suicide guard, mover-wins on
simultaneous royal death, a *newly created* exposure ends the turn, Kings never immune and never
chip-killable, check as advice with a persistent banner, and a Guarded mode for casual play.** Checkmate is not
a well-formed predicate when "attacked" depends on the opponent's future roll, which is the actual root cause
of the on-camera bug — and every variant in the prior art with the same problem made the same switch. Two
improvements on that prior art: because §7.4 pre-reveals the whole turn's dice, R3's "a move that *necessarily*
kills your own King is illegal" is an **exactly decidable predicate**, which Atomic could assert only because
it has no dice at all; and R5 is stated as the *invariant* rather than as a rule — **the enemy King can only be
captured on a turn where its exposure was already on the board at turn start** — which is proved in §7.12 and
tested by search rather than by asserting the rule. Pass 1 enforced that invariant with a stronger rule than it
needed (any exposure ended the turn), which silently docked a player a sub-move for a threat their *opponent*
had failed to answer. The video's specific bug is resolved in §7.13, row 1.

**5. Balance.**
A piece is worth `V = m·(1 − 0.9·LIAB + 0.5·ARM − 0.3·BLOCK) + 0.5·BONUS`, evaluated under my own ladder in
§9.1 — measured spread **1.18×** between the best and worst type of a class, and a **2× spread in tempo
earned** (Ground 0.278 versus Normal 0.139). The design deliberately routes the type edge into **tempo rather
than material**, because tempo is felt immediately, is visible, and cannot be bought at draft. A type-literate
player gains ≈ 0.30 pawns per capture in material plus the tempo differential; the die contributes far less
variance than the video's rules because the load-bearing face is public and the stake per face is one band.
Immunity, mutual destruction, crit chains, the Focus-Sash exploit, Huge Power, Shadow Tag, Wonder Guard,
Imposter, Moody, evasion and thorns each have a named bound in §9.3. The draft is **not** trusted as a balance
mechanism — Betza's hand-balanced armies later scored +62%/−71% over 400 engine games — so point-buy is a
usability device, army pairings are screened Chess18-style, and every coefficient is fitted by the batch
simulator (§9.4).

**6. Draft.**
**Slot-first** (§8.2): you are never shown 1 025 Pokémon; you are shown **five candidates for the one slot you
are filling**, with a guaranteed spread, one reroll, and search as an escape hatch. Ability is a 1-to-4 radio
(measured: 357 species offer no choice, 378 offer two, 631 offer three, 1 offers four). Item is 1 of a 12-item
**Format Kit**, so both sides face the same toolbox and the layer is learnable. Moveset is auto-picked with one
swappable slot from eight alternatives. Legality is baked, so there is no runtime validation surface.
"One type each" is a real decision for the **51% of the roster that is dual-typed** (measured 526 of 1 025).
The every-type goal is enforced as ≥ 10 distinct types per side plus a candidate generator that makes the union
of both armies cover 18, since 18 types over 16 pieces is impossible for one side. Quick Draft finishes a legal
army in under a minute; presets finish it in a click. **And the draft is parameterised by `PoolSource`, which
the match rules cannot see** — the seam `DIRECTION.md` requires.

**7. Rendering and performance.**
`recon-tech.md` measured this and I take its architecture (§10.5): keep the 64-`<button>` DOM board (129 nodes,
0.39 ms to rebuild) and its accessibility tree, move pieces into one transform-positioned layer keyed by piece
id, add two Canvas2D layers (Canvas is 17× cheaper per moving thing: 10 000 particles at 0.84 ms/frame versus
DOM's 5.38 ms at 4 000). Reject Pixi on a measured 231 KB gzipped bundle. **Vendor sprites same-origin at build
time** — the Showdown CDN sends no `Access-Control-Allow-Origin` (verified 8/8), which forecloses every canvas
pixel operation and the offline requirement. Budgets, CI-gated: critical-path data ≤ 60 KB gz (mine is ≈ 49 KB,
§3.5), entry chunk ≤ 110 KB gz, frame p95 ≤ 10 ms on a worst-frame replay, ≤ 240 live particles, ≤ 250 board DOM
nodes, and a heap gate asserting *no growth* over moves 50→100. Single rAF ticker with fixed phase order; a
Presenter between engine and view so nothing ever awaits an animation; `prefers-reduced-motion` replaces each
outcome animation with its static silhouette stamp.

**8. AI opponent.**
§11: alpha-beta + PVS + quiescence in a Worker, **a ply is a sub-move**, mates scored as `29000 − subMoves`,
`staticClash` (a 1 944-byte table) replacing SEE for ordering and quiescence, tiered lazy evaluation, and a
factorised Zobrist with epoch-splitting to pay for state-dependent capture legality. The stochastic-capture
problem is solved by the *ruleset*: because the Tempo Roll is revealed at the turn boundary, the interior of a
turn has **no chance nodes at all** — measured +10% at depth 6 versus 121–159× for full enumeration — and the
boundary node collapses to three representative faces with a static EV bias. Measured throughput 7.1 M nodes/s
at EBF 3.8–4.2 gives depth 8–9 inside a 1-second budget; target p95 ≤ 1.3× budget with a 350 ms floor.
Difficulty is a **corrupted copy of the AI's own effectiveness table**, which makes weak AIs misjudge *types*
exactly as `DIRECTION.md` asks (measured 5% → 47%, 30% → 37%, type-blind → 25%).

**9. Legibility.**
Role first, and by **silhouette** (§10): six SVG shapes derived from how each piece moves, which survive
greyscale, colour-blindness and a 34 px cell — the measured reasons the current glyph badge cannot work. Type
is the enamel field colour plus one of 18 glyphs (7 type pairs collapse under deuteranopia, so colour alone is
insufficient); owner is the bezel metal. The chart is taught **inductively and without a manual** by
annotating every reachable square, the moment you pick a piece up, with the outcome form it would produce —
gold star, white slash, twin cracks, hex ward, dashed grey. A chess player plays correctly from move one by
reading shapes; a Pokémon player gets the chess role from silhouettes. Under load, the **Why panel** renders the
engine's own `EffectEvent[]` as sentences, so there is exactly one source of truth for "why did that happen".
The learnable vocabulary is **18 type glyphs + 13 ability archetypes + 12 Kit items = 43 symbols**, not 1 797
effects.

And onboarding is now a designed surface rather than a footnote (§10.7–§10.13, the second pass's largest
addition, answering `DIRECTION.md` directive 7 in full). **A lesson is a row of data** — a position, a seed, a
machine-checkable goal, and beats keyed to `EffectEvent` types — which is possible only because the engine is
pure and seeded, the Tempo Roll is public *before* the decision, and the Why panel already renders the engine's
own events. So there is **no scripting engine and no cheating code path**: to make face 1 come up, pick a seed
whose first roll starts with 1. Two equal-weight tracks branch on *what you may skip* rather than what you need
taught; five lessons make the player **cause** each capture outcome (including being **refused** a 0× capture,
which directive 2 correctly calls the most important moment in the tutorial); two lessons teach the die by
having a miss lose a won position and a crit rescue a lost one; first-time hints reuse the same authoring
format; and the practice-puzzle corpus is generated *by the batch simulator* §9.4 already requires, so a hundred
puzzles cost nothing. `tutorial.test.ts` asserts every lesson is still winnable, so **a rotted lesson fails
CI** — the same discipline as the coverage test, applied to teaching. M2b ships it *before* the 950-move layer,
deliberately: writing the tutorial against the M1 ruleset is what forces the M1 ruleset to be teachable.

**10. Scope order.**
§15, and the order is the argument, in three claims: **M0 is the compiler, headless, with the coverage test
green — before any rule depends on it** (five days that ship no game and are the most valuable in the plan);
**M1 is a complete, playable, hot-seat game with the Melee slot only** — full chess plus the type chart plus the
ladder plus damage counters plus king capture plus draws plus promotion plus the four outcome animations, which
is already a game you can hand to a stranger, 14 days in; and **M2b, the tutorial, ships before the 950-move
layer**, because the alternative — build all the content, then work out how to explain it — is exactly how a
maximalist game becomes unplayable. Everything after that (moves, abilities and items, draft, sandbox,
transformations, collection, server) **adds depth to a working thing** rather than filling in a skeleton, which
is possible only because the ISA was built first: M3 and M4 are largely data arriving rather than systems being
invented, and each pays a one-lesson, one-hint tax to stay teachable. Honest effort: **~53 days to M7** (a
complete single-player game with all content, a tutorial and practice mode), **~15+ more** for the server,
ladder and Gym Leaders.

---

## 19. Deviations, trade-offs, risks

### 19.1 Where I deviate from a recon document, and why

| Document | Its position | Mine | Why |
|---|---|---|---|
| `recon-abilities-items.md` §2.4 | one `Vigour ∈ [−3,+3]` scalar replaces all stats and stages | a 7-vector of boosts, shown as two numbers and three badges | the fidelity is free (the compiler reads `{atk:2}` and `{def:2}`), the collapse deletes Unaware/Contrary/Simple/Power Trick and makes Swords Dance and Iron Defense identical, and the legibility problem it solves is a UI problem |
| `recon-abilities-items.md` §2.4 | attacker and defender hooks sum into one roll | the TCG's printed order: attacker bonuses → type modifier → defender reductions, with defender hooks able only to *lower* the outcome | `recon-tcg.md` asked for exactly this correction, and it stops a defensive bonus silently erasing a WEAKNESS reading |
| `recon-abilities-items.md` §2.6 | 115 hand-written primitive functions (~1 700 LOC) | 0 LOC; the 115 are parameterisations of the 18 ops, and the 13 archetypes become the UI glyph vocabulary | the ops already exist for the move layer |
| `recon-abilities-items.md` §6.1 | *every* ward is one-shot, including the type chart's 0× | the type chart's 0× is **permanent**; ability/item wards are one-shot; Wonder Guard is class-scoped | 0× is the video's most memorable rule and it is only 2.5% of pairs with ≤ 2 attacker types per defender; the four bounds in §7.8 are sufficient, two of them free from data |
| `recon-moves.md` §0 | exclude the 35 Z-moves and 52 Max-moves from the corpus | compile all 950, exclude from *play* by a format flag | costs ~2 KB and keeps the CI assertion at "every move in the dex compiles" |
| `recon-moves.md` §2.7 | `+2 spe` grants an extra square of movement | `spe` is initiative and tie-breaks only; extra reach comes only from Choice Scarf, which is banned on King and Queen | movement-range growth breaks both the chess geometry and the AI's move generator, and `recon-abilities-items.md` §6.11 independently reached the same conclusion about Speed Boost |
| `recon-variants.md` §6.3 | abolish the per-capture die; γ = φ = 1/18 | keep one d6, made **public before every decision**, and keep probabilistic BACKLASH | `DIRECTION.md` explicitly legitimises randomness via the TCG and says the richer option wins; making the die public captures most of the variance reduction by that document's own argument; a fully deterministic chart deletes the story generator |
| `recon-variants.md` §4.2 T2 | a piece may not *earn* a second bonus in one turn | the bonus sub-move must be *made* by a piece that has not yet acted this turn | the weaker form still lets one piece make every sub-move; the stronger form makes chains team combos and reads far better on the board |
| `recon-tcg.md` (type chart) | keep the games' 18 × 18 chart, borrow the TCG's vocabulary | agreed, adopted | the TCG's 10-type collapse is internally inconsistent (8.2% of card names contradict themselves) |
| `recon-tcg.md` (area targets) | area and splash targets resolve neutral | adopted, with one refinement: the player designates **one primary target** which uses the full chart | keeps Earthquake interesting while retaining the balance and AI benefit |
| `recon-data-substrate.md` §6 | hotlink Showdown's CDN | vendor same-origin at build time | measured: the CDN sends no CORS header, so hotlinking forecloses canvas effects and offline play |
| `recon-tcg.md` (Energy Zone) | "do NOT add an energy resource; adopt TCG Pocket's Energy Zone shape as a per-piece Charge counter (0–2) that gains 1 on a turn the piece does not capture and resets on capture, gating T4/T5 moves" | **adopted in full** (§7.9a), with the accrual condition tightened from "does not capture" to "does not act" | pass 1 left this recommendation on the table and then named the ART action economy as its own largest open risk. This *is* the answer, it is canon rather than invented, it subsumes `flags.charge`, `flags.recharge` and Speed Boost, and it is one integer. Tightening to "does not act" is needed because a piece that spends its turn on a free Status ART has not been patient |
| `recon-abilities-items.md` §6.11 / `recon-moves.md` §2.7 | Speed Boost as a `spe` boost, and `spe` as movement range | Speed Boost is `charge += 1` | it is literally "reward for patience", it needs no new mechanic once §7.9a exists, and it avoids the movement-range growth both documents independently warn against |
| `proposal-systems-first.md` | 94.8% derived, 93 curated; 14 triggers; `Stamina` | 89.6% derived, 119 curated; 13 triggers; damage counters | its ledger counted flags-only abilities as derived and missed the engine-implemented items; `ON_FIELD` is redundant once `MARK` unifies weather; "damage counters" is the TCG's own name and instrument for the same idea, and my version removes the piece rather than leaving a zombie occupant |
| **pass 1 of this document** §7.5 step 5 | `guard := boosts[def] + counters`, folded in via `min()` | `guardRaw := boosts[def] − counters`, split into a non-negative `guard` (defender reduction) and a `deficit` routed to the attacker's bonuses | two defects: the sign on counters inverted its own §7.6 ("a hurt piece defends worse"), and the `min()` clamp made **31 measured defence-lowering moves inert** (§4 trace 23). The split preserves `recon-tcg.md`'s "defender *hooks* may only downgrade" exactly, because a debuff the attacking side paid a turn for is not a defender hook |
| **pass 1** §7.5 step 7 | Confusion tested on `D` "and D is the attacker", after the ladder resolved | tested on `A`, at step 0, before anything is spent | the original was incoherent as written and would have consumed WARPs before discovering the turn had ended |
| **pass 1** §7.12 R6 | "0× degrades to BACKLASH against a King" asserted in the rules text | `if m === 0 and D is a King: m := 0.5` wired into §7.5 step 1 | the resolver vetoed on `m === 0` in step 1, so the King rule could never fire and Kings were silently untouchable by up to two attacking types |
| **pass 1** §7.12 T3 / R5 | *any* exposure of the enemy King ends your turn | only a **newly created** exposure ends your turn, with the safety invariant proved (§7.12) | the strong form docked you a sub-move for a threat your opponent had failed to answer, and made "they blundered" indistinguishable from "I just threatened" |
| **pass 1** §7.11 repetition | excludes the PRNG counter | excludes the PRNG counter **and `tempo`** | the three revealed faces are RNG output living in the state object beside the counter; including them makes threefold repetition unreachable by construction and the rule silently never fires |
| **pass 1** §7.3 | a SURGE always grants a bonus sub-move when `sub < 2` | it grants one only if some piece that has not acted has a legal action | otherwise the baton rule (T2) produces a phase whose only legal action is `DECLINE` — a dead end that reads as a bug |
| **the shipped `src/engine/variant.ts`** | checkmate as the win condition, king capture filtered out, post-commitment die, `captureIsSafe`'s "could" quantifier, the extra move bound to the capturing piece, and no way to decline it | king capture, a public Tempo Roll, R3's "necessarily" quantifier, the baton rule, and an explicit `decline` action | all five are decisions its own header marks **PROVISIONAL** and defers to this specification, and §13.2a answers each with its reason. The load-bearing one: `result()` tests mate via the deliberately type-blind `position.isInCheck()`, so the shipped game will call checkmate when the only attacker is a Normal piece aimed at a Ghost king — a capture that is illegal. That defect is not fixable by making `isInCheck` type-aware, because success depends on the opponent's future roll, which is precisely §7.12's argument |

### 19.2 What I traded away, explicitly

- **Per-move fidelity on 48 variable-power moves.** Gyro Ball does not truly scale inversely with Speed; it is
  a tier-3 hit with a conditional +1. A Pokémon expert will notice. I traded it for a curated set that fits on
  one screen.
- **HP, and with it every magnitude in Pokémon.** Capture is binary and damage is four buckets. This is what
  makes Dynamax inexpressible and makes 20 of the 77 berries into flavour. It is also what keeps the game
  chess-shaped.
- **Hidden information.** Abilities and items are public. That costs Illusion's surprise (it keeps a reduced
  version), and Frisk/Forewarn/Anticipation become board-analysis tools. `recon-tcg.md` is right that this is
  the design rather than a cost — the TCG puts every persistent effect face-up — but it *is* a departure from
  the games.
- **Stalemate as a drawing resource**, and some endgame theory with it (K+R vs K becomes a forced win). The
  price of king capture; R7 and R8 are the mitigations.
- **340 items are queued rather than shipped**, entering play as Format Kits over time. They are all compiled;
  none is missing; but on day one you see 12.
- **A narrower material spread between types (1.18×) than a pure type-driven design would give.** Deliberate:
  I moved the type edge into tempo. If measurement says the edge is too weak, the lever is the ladder's band
  edges, not the chart.
- **Two of the video's four rules are changed rather than kept.** "1 = miss ⇒ both die" becomes REPELLED on
  neutral and resisted matchups (§7.4), because as filmed it made defending a piece deter nothing; and a 6 on a
  *resisted* matchup rescues you without granting tempo. I have argued both are corrections to demonstrable
  debt rather than deviations from the concept, but a purist reading of `BRIEF.md` §2 rule 4 will call them
  deviations, and they should be counted as such.
- **One more counter on the piece.** The Charge counter (§7.9a) buys a governed action economy at the cost of a
  third numeric channel on a pin that already carries damage pips and slot charges. I judged the ART economy
  worth governing; a design optimising purely for legibility would drop it and accept the risk pass 1 accepted.
- **The tutorial cannot teach a rule the engine will not produce.** Because lessons are seeds rather than
  scripts, a lesson can only demonstrate outcomes that are *reachable* — there is no way to force a 1-in-216
  situation for pedagogy. In practice this costs nothing (every outcome in §10.9 is reachable in one roll) but
  it is a real constraint, and it is the price of having no cheating code path.

### 19.3 Risks, and what would falsify them

Two of pass 1's risks are **retired** this pass, and I have re-graded the rest. Retiring a risk by doing the
measurement rather than by deferring it to a milestone is the only honest way to shorten this table.

| Risk | Pass 1 | Now | Mitigation / falsifier |
|---|---|---|---|
| The unclassified call sites hide a systematically important behaviour class | medium | **RETIRED** | §1.7 ran pass 1's own proposed falsifier now instead of at M0. All 25 top residue methods hand-classify into existing axes; **zero need a nineteenth op**; 34 sites independently confirm the Region axis. Gate 7 now fails the build above a 1% residue share |
| The ART action economy is too generous — pass 1's self-declared "number I am least sure of" | medium-high | **RETIRED as a design gap, retained as a tuning risk** | §7.9a's Charge counter gates the 166 measured tier-4/5 moves on patience and resets on capture. The remaining question is only *where* the gate sits, which M6 measures via the ART-versus-MOVE action mix; the levers are the tier threshold (4 → 3), the cap (2 → 3) and the accrual condition |
| The compiler's op-to-board mapping is systematically right but **thematically wrong somewhere large** | high | **high — still the top risk** | The one risk that cannot be retired by measurement, because it is a taste judgement. Mitigations: §16's 20-row ledger as a standing review artefact; the rule that any mapping a Pokémon player calls wrong is filed as a **defect**, not a preference; and the fact that a wrong mapping is now a *data* fix in `overrides.json` rather than a code change, so the cost of being wrong is one line |
| Damage counters make the game slower and drawier than chess | medium | medium | M6 reports game length and draw causes; if draws exceed 20%, the first lever is the counter threshold (3 → 2), not the ladder |
| Three sub-moves per turn is too much tempo to plan against | medium | medium | T1 is a constant; measured `P(L ≥ 3)` under my ladder is a few percent, but self-play at M6 decides. Fallback `L ≤ 2` |
| Public dice reduce drama: knowing the outcome may feel flat | medium | **medium-low** | The drama moves to *which* face you spend where. And §10.10 now depends on this property — the two die lessons are only teachable because the roll precedes the decision — so the mechanic has a second job. Falsifier: playtests report mechanical turns; the lever is a fourth face drawn face-down for riders only |
| **The tutorial rots as the rules change** | *(not identified — the tutorial did not exist)* | **medium, and gated** | `tutorial.test.ts` runs every lesson headlessly and fails CI if a goal has become unreachable or a beat references an event the engine no longer emits. This is why lessons are data and not scripts, and it is the only reason a tutorial is affordable alongside a maximalist ruleset |
| **Two more counters to learn (damage counters *and* Charge)** | *(not identified)* | **medium** | Different shape, position and grammar: counter pips on the bezel's lower arc, charge chevrons under the plinth, slot charges as dots. None exists in M1; Charge arrives with the ARTs at M3, each behind a one-time hint. Falsifier: playtesters misread a chevron as a pip, in which case Charge becomes a single ring-fill instead |
| Sprite licensing | medium | medium | vendored assets are gitignored and generated at build time, with a prominent non-affiliation notice and an `ATTRIBUTION.md`; Type Glyph mode is a first-class zero-asset fallback |

### 19.3a What the second pass changed, in one table

For a reader who knows pass 1 and wants only the delta.

| # | Change | Why it was needed |
|---|---|---|
| 1 | **§10.7–§10.13: the tutorial**, as `Lesson` data over the existing ISA, with two tracks, five caused-outcome lessons, two die lessons, first-time hints, simulator-generated puzzles, a draft track, and `tutorial.test.ts` | `DIRECTION.md` gained directive 7 *after* pass 1 was written. Pass 1 covered it in two lines |
| 2 | **Four defects fixed in the Clash resolver** (§7.5): the counters sign, the `min()` clamp that inerted 31 measured moves, the Confusion actor, and R6's King rule not being wired into legality | found by writing trace 23 (Screech) against pass 1's own pseudocode. All four are the kind of bug that ships and then takes a week to find in play |
| 3 | **§7.9a the Charge counter** | pass 1 named the ART economy as its own largest open risk and shipped no answer; `recon-tcg.md` had already published one and pass 1 had not adopted it |
| 4 | **§7.12 R5 refined to a *new* exposure**, with the safety invariant proved rather than asserted | pass 1's rule was stronger than its own invariant required, and penalised the wrong player |
| 4b | **§13.2a: the migration from the shipped provisional `variant.ts`** | the repo shipped a playable rules layer mid-run whose header defers five PROVISIONAL decisions to this document. A specification that does not answer them is not implementable against the actual codebase |
| 5 | **§1.7 the residue retired by measurement**; **§2.6 op semantics**; **§2.7 the 14 undefined types defined**; **§2.8 deterministic dispatch order**; **§7.11 `tempo` excluded from the repetition hash**; **§7.3 the empty-bonus dead end closed**; five new traces (23–27); four new faithfulness rows; re-measured volumes throughout | each is a place a reader would have had to ask me a question, or where the pure engine would have desynced, or where the coverage claim rested on a number I had not personally checked |

### 19.4 The one-paragraph summary

Measure the vocabulary the Pokémon dataset is already written in — **2 845 call sites collapsing onto fifteen
mutation families**, a count two independently written scanners agree on to within one site in a thousand — add
the three verbs Showdown's engine embodies rather than calls, and you get an 18-op ISA that a five-pass compiler
can target: **89.6% of 1 797 content entries derived with no authoring, 119 named curated diffs, 68 named inert
entries, nothing missing, 218 table rows for 1 797 entries, and a test that says so on every build.** Then the
game is thin: one type per piece on defence and the move's type on offence; an ordinary chess capture is your
uncharged Melee slot; the type chart sets which rung of a five-rung ladder you start on and a **publicly
revealed** d6 moves you along it, so no hidden roll can ever cost you a piece; super-effective earns tempo and
resisted kills you both; the biggest moves need a turn of patience; a bonus move must be taken by a *different*
piece; a *new* threat to the King ends your turn, so the King can only ever fall to a threat that survived a
full reply; the King is captured rather than mated. Every piece says "bishop" by silhouette before it says
"Ghost" by colour, and every square you can reach tells you what would happen there before you commit. And
because the engine is pure, seeded, and reveals its dice before you choose, **the tutorial is data too** — a
position, a seed and a goal — so the game can teach three stacked rulesets without a scripting engine and
without a lesson that can silently rot. The content system is the game's spine: it is the reason all 950 moves,
311 abilities and 536 items are *in* the game rather than in the specification, and it is the reason the
tutorial, the AI, the animation layer and the draft each cost a table rather than a project.
