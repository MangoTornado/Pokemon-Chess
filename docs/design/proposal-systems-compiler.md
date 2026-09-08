# Pokémon Chess — Design Specification: **The Effect Compiler**

**Author role:** game designer, systems / compiler-first philosophy.
**Status:** complete implementable proposal — **third pass**. Deviations from a recon document are marked
**[DEVIATION]**. Deviations from an earlier proposal, *including from earlier passes of this same document*,
are marked **[SUPERSEDES]**.

**Process note, stated up front because it changes how to read the numbers.** Two earlier passes of this
document existed (pass 1: 2 587 lines; pass 2: 3 460 lines), written by earlier passes of this same role. I
read pass 2 in full, **re-measured its central claims with my own independently written scanner rather than
trusting them**, and read the actual shipped source (`src/engine/variant.ts`, `position.ts`, `board.ts`,
`zobrist.ts`, `dex.ts`, `schema.ts`, and the generated bundle) line by line. Nothing has been dropped. Pass
2's headline measurement **reproduced exactly** — 1 675 handler functions, 440.4 KB of source, 150 distinct
handler names — which is the third independent confirmation of the ISA claim and is why the architecture is
unchanged.

Seven things did change, and five of them are defects that would have shipped:

| # | Change | Severity |
|---|---|---|
| 1 | **A nineteenth op, `CHART`** (§2.2, §7.9b). 7 measured entries rewrite a *cell of the type chart* — Freeze-Dry, Flying Press, Thousand Arrows, Tar Shot, Disguise, Ice Face, Iron Ball. In a game whose entire thesis is the type chart this is the most on-thesis content class in the dex, and pass 2 has no op that can express it: `TILT` writes the roll and `WARP` rewrites a decided rung, but nothing writes `rung0`. | **design gap** |
| 2 | **A fourth signal channel, C4, measured** (§1.8): **494 of 1 675 handlers (29.5%) make no method call at all** — 356 speak only through a `return` value, 138 only through a field assignment. Pass 2's census classified *call sites*, so this channel was structurally invisible to it, which is exactly where `CHART` was hiding. C4 gets a 14-row grammar. | **method gap** |
| 3 | **The Band Cap** (§7.5 step 5a). Pass 2's own load-bearing pillar is "a resisted attacker can never earn tempo", but its `step` table reaches `+2`, so any attacker with `might ≥ 3` — trivially reachable with a T5 move and one boost — reaches SURGE from a resisted matchup. One clamp fixes it, changes **none** of the published distributions, and *subsumes* two of pass 2's named ability bounds. | **rules defect** |
| 4 | **`TiltScope` 5 → 3, and `crit-window` given a job.** Pass 2 declares tilt scopes `crit-window`, `accuracy` and `evasion` that its resolver never reads — 11 measured `onModifyCritRatio` handlers plus Scope Lens, Super Luck and Sniper compile to an op that does nothing. | **rules defect** |
| 5 | **Riders: 212, not 416.** Measured: `move.secondary` is *the identical object* already inside `move.secondaries` in **all 204 cases**. Pass 2's instruction to "read `secondaries[]` *and* `secondary`" double-counts, and a compiler that follows its prose applies 204 riders **twice**. Also corrected: priority ≥ +1 is 42 (not 21), ≤ −1 is 14 (not 6), `multihit` 31 (not 22), and the mark table is **165 rows, not 116**. | **content defect** |
| 6 | **The op journal** (§2.9, §11). Pass 2's `Rules` interface offers only immutable `apply()`. Measured: deep-cloning its own §12.1 state costs **20.8 µs/node = 48 000 nodes/s**, against the 7.1 M nodes/s its AI section quotes — **148× short, about four plies**. Every op has a bounded inverse, so `makeAction`/`unmakeAction` over a flat journal costs **53 ns (392× faster)**, and `position.ts` already ships exactly this pattern. | **architecture defect** |
| 7 | **The bundle budget, measured instead of scaled.** Pass 2's §3.5 was "scaled by size" from another document. Measured on the real files: the shipped critical path is **268 KB gz** — `Dex.load()` eagerly loads all five bundles including the 74 KB learnsets — against the 60 KB gate. The same architecture, measured, lands at **37.2 KB for M1** and **≈50 KB with all content**; the delta is prose (`moves.desc` alone is 26.2 KB gz), non-base formes (39 KB) and eager learnsets. Also found: **`condition.duration` is not in the shipped bundle at all**, so the 123 moves that carry a condition currently have no duration to read. | **budget defect** |

**Provenance.** Every number in §1, §2, §3.5, §7.5, §7.14, §9 and §11 was measured on this machine against
`@pkmn/dex@0.10.11` / `@pkmn/sim@0.10.11` and against the repository's own generated bundle. Third-pass
scripts are mine and are the citation of record wherever a number changed; earlier scripts are retained
where their result stood up to re-measurement.

| Script (in `/tmp/pkmn-probe/`) | Pass | Produces |
|---|---|---|
| `syscomp3-1-effectiveness.mjs` | 3 | the chart-rewriting census: every `onEffectiveness` / `onModifyType` / `onNegateImmunity` / `onImmunity` entry across moves, abilities and items |
| `syscomp3-2-returns.mjs` | 3 | independent re-derivation of 1 675 handlers / 440.4 KB / 150 names; **handlers by receiver path** (entry 1 246, condition 371, self 49, secondary 9) |
| `syscomp3-3-grammar.mjs` | 3 | the verbatim `onEffectiveness` bodies, the condition-scope handler-name census, and the return-channel samples behind §1.8's grammar |
| `syscomp3-4-scalars.mjs` | 3 | power tiers, charges, riders, statuses, the 31 defence-lowering moves, `ignoreImmunity`, `condition.duration`, mark classes |
| `syscomp3-5-fix.mjs` | 3 | **the `secondary`/`secondaries` aliasing proof**, the priority census, the 165-row mark table |
| `syscomp3-6-chart.mjs` | 3 | the 18×18 census, all 19 type facts quoted in §17, Freeze-Dry's 23 learners, Flying Press's chart union |
| `syscomp3-7-clone.mjs`, `syscomp3-8-sparse.mjs` | 3 | **the 392× journal-versus-clone measurement** and the 1 416-byte sparse state |
| `syscomp3-9-returns2.mjs` | 3 | **the C4 partition**: 949 mutation / 356 return / 138 assignment / 181 log-only / 51 other |
| (repo) `src/data/generated/*` | 3 | the measured bundle budget in §3.5, by re-encoding the real files |
| `syscomp2-*.mjs` | 2 | pass 2's ledger, retained where re-measurement agreed |
| `syscomp-5..12-*.mjs` | 1 | the raw field dumps and `chess.js` validation behind traces 1–22 and §17 |

---

## 0. Thesis, and the bet

**This project lives or dies on whether 950 moves, 311 abilities and 536 items become board effects by a
compiler rather than by hand.** Every other system — the ruleset, the AI, the animation layer, the draft, the
tutorial — is a *consumer* of the effect vocabulary. Choose the vocabulary badly and you hand-write 1 797
special cases, ship 200, and the remaining 1 597 are silently inert while the spec claims total coverage.
Choose it well and **new content is data**: a `@pkmn/dex` version bump adds Pokémon, moves and items to the
game with no code change, and a CI gate fails the build if anything became undefined.

The bet, stated so it can be falsified: **the effect vocabulary should not be invented, it should be
measured.** Pokémon Showdown's engine is the largest existing implementation of Pokémon semantics, and every
behaviour in it is written against a small mutation API. `@pkmn/dex` throws that API away — it strips every
callback with no marker, which is why Belly Drum appears to have no boosts and Rest appears to inflict no
sleep. `@pkmn/sim` keeps the functions *and their source text*. I scanned all of it with my own scanner
(`syscomp3-2-returns.mjs`, a depth-4 cycle-guarded walk of every admitted entry's whole object graph):

> **1 675 handler functions, 440.4 KB of source, 150 distinct handler names**, spread across four receiver
> paths — **entry 1 246, `condition` 371, `self` 49, `secondary` 9**. Of those handlers, **949 contain a
> mutation call, 356 speak only through a `return` value, 138 only through a field assignment, 181 only log,
> and 51 are empty.** The mutations collapse onto **fifteen** op families; the return and assignment
> channels supply **four more**.

Nineteen ops. Fifteen measured from the call channel, three that Showdown cannot express because its whole
engine *is* them (the capture resolution, the delayed queue, and information reveal), and **one — `CHART` —
that was invisible to a call-site census because it is expressed entirely as a return value.** With **14
triggers** derived from an 81-stem handler-name grammar and **16 regions** derived from `move.target` and the
receiver path, a five-pass compiler derives **1 604 of 1 797 admitted entries (89.3%) with zero authoring**,
leaves **125 named curated overrides (7.0%)** which are *diffs against the compiler's proposal*, marks
**68 entries (3.8%) as deliberately inert**, and leaves **zero** entries undefined.

Then the rules of Pokémon Chess are a thin layer: one ~130-line Clash resolver and one turn loop, both of
which speak only `CLASH`, `CHART`, `TILT`, `VETO`, `PIERCE`, `WARP` and `TEMPO` and know nothing about
Pokémon. The same 19 ops drive the visual layer, which is how 950 moves get distinct on-board identity from
**58 authored assets**; and because every op has a bounded inverse, the same 19 ops give the AI its
make/unmake for free (§2.9).

**What is genuinely new here versus the other three philosophies:** they will each design a good ruleset and
then face the content problem. I design the content substrate first and derive a ruleset that is *expressible
in it*, which is why my ruleset has no clause that cannot be compiled, why my coverage claim is a test rather
than a paragraph, and why the two most interesting rules in this document (§7.9b's chart layer and §7.9a's
Charge counter) were **found in the data rather than invented for the board**.

---

## 1. The empirical foundation

### 1.1 Four signal channels

`recon-data-substrate.md` is authoritative that ability/item behaviour is not declarative. That is true of
`@pkmn/dex` and **false of the dataset**, which carries four machine-readable channels. C4 is new this pass.

| # | Channel | Content | Measured volume |
|---|---|---|---|
| **C1** | Declarative fields | `target, category, basePower, accuracy, priority, pp, flags{}, status, volatileStatus, boosts, secondaries, sideCondition, slotCondition, weather, terrain, pseudoWeather, drain, recoil, heal, multihit, ohko, selfdestruct, selfSwitch, forceSwitch, callsMove, stallingMove, condition.duration` + item taxonomy booleans + ability `flags` | fully determines **425 moves and 230 items** on its own |
| **C2** | Handler **fingerprint** — the set of `on*` names an entry defines, *and the receiver path it sits on* | **150 distinct names**, of which **148 parse** under §1.3's grammar; the two that do not are `onTry` and `onWeather`, one table line each. Paths: entry 1 246, `condition` 371, `self` 49, `secondary` 9 | **378 moves, 297 abilities, 279 items** define ≥ 1 handler |
| **C3** | Handler source, **call channel** — the methods a body invokes | 15 mutation families, 45 mutation verbs, 53 predicate verbs | **949 handlers**, 2 845 call sites |
| **C4** | Handler source, **return / assignment channel** — the semantics a body expresses *without calling anything* | 14 grammar rows (§1.8) | **494 handlers (29.5%)**: 356 return-only, 138 assignment-only |

C3 and C4 are **build-time-only** inputs. `@pkmn/sim` is a 45 MB devDependency; **zero bytes** of it reach the
browser, and CI asserts that with a bundle check (§13.4).

### 1.2 The trap, and the measurement that avoids it

```
Dex.moves.get('bellydrum').boosts   // undefined  — Belly Drum appears inert
Dex.moves.get('rest').status        // undefined  — Rest appears to do nothing
Dex.moves.get('soak').*             // no type-change field anywhere
Dex.moves.get('freezedry').*        // no field says "this beats Water"
```

The fourth line is new this pass and it is the sharpest example in the whole document: **there is no field
anywhere in the dataset that says Freeze-Dry is super effective against Water.** It is a five-line function
returning a number. Verified against the repository's own shipped bundle, which is built from `@pkmn/sim` and
still cannot express it:

```jsonc
// src/data/generated/moves.json, verbatim
{"num":573,"id":"freezedry","name":"Freeze-Dry","type":"Ice","category":"Special","basePower":70,
 "accuracy":100,"pp":20,"priority":0,"target":"normal", … ,"handlers":["onEffectiveness"],
 "signalClass":"fields+handlers"}
```

What `@pkmn/sim` actually hands over, verbatim from `syscomp3-3-grammar.mjs`:

```js
// Freeze-Dry
onEffectiveness(typeMod, target, type) { if (type === 'Water') return 1; }   // CHART(cell Water, +1 step)

// Flying Press
onEffectiveness(typeMod, target, type, move) {
  return typeMod + this.dex.getEffectiveness('Flying', type);               // CHART(union 'Flying')
}

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

Every one of those is a literal argument or a literal return value the compiler reads. **This is the
difference between a content system that knows what it does not know and one that silently produces 205
inert moves — and, after this pass, between one that gets the type chart right and one that quietly makes the
seven most chart-relevant entries in the dex do nothing.**

### 1.3 The handler-name grammar (the compiler front end)

150 handler names is too many to hand-table and would rot on every dependency bump. It needs no table,
because Showdown's names are a grammar:

```
handlerName ::= 'on' Scope? Phase? Stem
Scope       ::= 'Source' | 'Ally' | 'Foe' | 'Any' | 'Weather'      (absent ⇒ SELF)
Phase       ::= 'Try' | 'After' | 'Modify' | 'Before'              (absent ⇒ ON)
```

Measured (`syscomp3-2-returns.mjs`, agreeing with pass 2): **148 of 150 names parse**; the residue is exactly
`onTry` and `onWeather` — one table line each. The parse yields **81 distinct stems**, and the multi-variant
stems are exactly the places where scope- and phase-variants would otherwise be four to eight hand-written
cases:

| Stem | Name variants | Stem | Name variants |
|---|---|---|---|
| `Move` | 8 | `Faint` | 4 |
| `Boost` | 6 | `Atk` | 4 |
| `Accuracy` | 6 | `Hit` / `Invulnerability` / `RedirectTarget` / `SwitchIn` / `PrimaryHit` / `EatItem` / `UseItem` / `SpA` / `SpD` | 3 each |
| `Damage` | 5 | `Immunity` / `TrapPokemon` / `Secondaries` / `Heal` / `Def` / `Spe` / … | 2 each |
| `SetStatus` | 5 | *(remaining 64 stems)* | 1 each |
| `BasePower` | 4 | | |

**An 81-row stem table is the entire front end**, and CI asserts no 82nd stem appears — a dependency bump
that introduces one fails the build instead of dropping content.

### 1.4 The ISA, discovered rather than invented

Every method call in every handler body, receiver-agnostic. The critical measurement detail: **the mutation
API is spread across many receivers** — `this` (Battle and its `.field`/`.queue`, 1 706 sites), `pokemon`
(438), `target` (262), `source` (189), `attacker` (45), `side` (16), `ally` (13), `defender` (4). A scan that
only looks at `this.*` misses `target.addVolatile(...)` and `source.boost(...)` and therefore misses **36% of
the mutation surface** — most of the game.

**Classification of all 2 845 call sites:**

| Class | Sites | Share | What the compiler does with it |
|---|---|---|---|
| **State mutation** | 1 072 | 37.7% | emits an `Op` |
| **Predicate** | 521 | 18.3% | emits a `Guard` (`hasType`, `hasAbility`, `isAlly`, `isGrounded`, `checkMoveMakesContact`, `effectiveWeather`, `randomChance`, `getStat`, …) |
| **Battle log** | 837 | 29.4% | discarded — except `add('-item'…)`, which is where `REVEAL` comes from |
| **Plumbing** | 270 | 9.5% | `runEvent`, `singleEvent`, `sample`, `Math.*`, array methods — ignored |
| **Unclassified** | 145 | 5.1% | 42 distinct methods; **retired as a risk in §1.7** |

**Op occurrences across the whole dataset.** The `Occurrences` column exceeds the method count for an op
wherever part of that op is expressed as a `return` value or a field assignment — i.e. wherever C4 is doing
the work, which §1.8 now measures instead of estimating.

| Op | Occurrences | Showdown surface it is measured from |
|---|---|---|
| `VETO` | ~377 | `return false` / `return null` / `return 0` from a `Try*`/`Immunity`/`TryHit`/`TakeItem` handler |
| `TILT` | ~360 | **`chainModify` 261**, `modify`, `return <number>`, `move.basePower=`, `move.accuracy=` |
| `UNMARK` | ~170 | `removeVolatile` 87, `cureStatus` 38, `clearStatus` 3, `removeSideCondition`, `clearBoosts`, `clearTerrain`, `removePseudoWeather` |
| `MARK` | ~169 | `addVolatile` 117, `trySetStatus` 28, `setWeather` 13, `tryTrap` 7, `addSideCondition`, `setTerrain`, `addPseudoWeather`, `addSlotCondition` |
| `EQUIP` | ~155 | `eatItem` 60, `useItem` 44, `setItem` 17, `takeItem` 16, `setAbility`, `skillSwap` |
| `BOOST` | ~115 | `boost` 110, `setBoost`, `boost[stat]=` |
| `MEND` | ~95 | `heal` 49, `damage` 40, `directDamage`, `sethp` 2 |
| `BECOME` | ~85 | `formeChange` 30, `setType` 12, `move.type=` (19), `move.category=`, `addType` |
| `TEMPO` | ~48 | `disableMove` 12, `cancelMove` 5, `prioritizeAction`, `speedSort`, `onModifyPriority` returns (4), `willMove`-guarded reordering |
| `WARP` | ~29 | `move.multihit=`, `move.secondaries=`, `move.target=`, `move.forceSTAB=`, `onDamage` returns (10) |
| `INVOKE` | 13 | `useMove` 12, `runMove` 1 |
| `CHARGE` | 13 | `deductPP`, `disableMove` (the lockout half) |
| `PIERCE` | 12 | `move.ignoreAbility/ignoreImmunity/ignoreEvasion=`, `move.infiltrates=` |
| `RELOCATE` | 11 | `forceSwitch`, `canSwitch` 10, `swapPosition` 1 |
| **`CHART`** | **8** | **`onEffectiveness` returns (7 entries, 8 handlers counting Tar Shot's condition)** |
| `REMOVE` | 3 | `faint` |

Total mutation sites **1 072**, against pass 2's independently scanned **1 071** and pass 1's **1 071** — three
scanners agreeing to one site in a thousand. That is the corroboration the ISA claim needed. Three ops more
are *unmeasurable from the dataset by construction*, because Showdown's engine embodies rather than calls
them:

- **`CLASH`** — Showdown's `runMove`/`getDamage`/`spreadDamage` pipeline *is* the resolution. In a
  binary-capture game the resolution is a single op with an outcome.
- **`SCHEDULE`** — Future Sight and Wish are expressed as `slotCondition` + engine bookkeeping; a chess turn
  loop needs an explicit queue.
- **`REVEAL`** — Frisk, Forewarn and Anticipation are *entirely* `this.add(...)` calls. Measured: they are
  three of the **181 log-only handlers**. They are information, and information is a first-class op here
  rather than deleted content.

**19 ops. §2.5 argues why 19 cannot be 12 and need not be 24.**

### 1.5 Parameter extraction

An op with no parameters is a classifier, not a compiler. The argument shapes, all read verbatim:

| Argument shape | Handling | Examples |
|---|---|---|
| string literal | `markOf(literal)` | `addVolatile('flinch')`, `addSideCondition('spikes')`, `setWeather('raindance')`, `trySetStatus('par')` |
| object literal | boost vector | `boost({atk: 12})` (Belly Drum), `boost({atk: -1})` (Intimidate), `boost({atk:2, spa:2})` (Weakness Policy) |
| HP fraction | 4-row fraction→counter table (§7.6) | `heal(maxhp/16)` (Leftovers), `damage(baseMaxhp/8)` (Rough Skin), `damage(baseMaxhp/6)` (Rocky Helmet), `damage(baseMaxhp/10)` (Life Orb) |
| numeric multiplier | `chainModify(x)` → `TILT` step | `chainModify(0.5)` (Thick Fat) → `TILT(def,+2)`; `chainModify(1.5)` (Choice Band) → `TILT(atk,+1)` |
| bare identifier | runtime-resolved against the Clash context | `setType(move.type)` (Protean) → `BECOME(type: 'the move I am using')` |
| **`return` expression** | **the C4 grammar, §1.8** | `return 1` (Freeze-Dry) → `CHART`; `return false` (Sticky Hold) → `VETO`; `return critRatio + 1` (Scope Lens) → `TILT('crit-window')` |
| **field assignment** | **the C4 grammar, §1.8** | `move.type = 'Water'` → `BECOME`; `this.effectState.counter = 3` → `MARK.data` initialiser |

`chainModify` deserves its own line because it is the single largest op source (261 sites) and it is a
*multiplier* in a game that has no HP. The conversion is fixed and published:

```
tiltOfMultiplier(x) =  x >= 2.0 ? +2 : x >= 1.4 ? +1 : x <= 0.5 ? +2(defensive) : x <= 0.75 ? +1(defensive) : 0
```

i.e. "1.5× attack" becomes **+1 to the Clash roll** and "0.5× damage taken" becomes **+2 to the defender's
roll**. One table, 261 call sites, no authoring.

### 1.6 The coverage ledger

Inclusion policy is `recon-data-substrate.md` §1 verbatim (it supersedes `BRIEF.md` §3's raw counts), and it
is already what the repository's `manifest.json` records: moves `isNonstandard ∈ {null, Past, LGPE,
Unobtainable, Gigantamax}`, abilities `∈ {null, Past}`, items `∈ {null, Past, Unobtainable}`. Measured
admitted counts, re-verified: **950 moves, 311 abilities, 536 items = 1 797 entries**, over **1 367 species
formes / 1 025 base formes**.

**[DEVIATION from `recon-moves.md` §0]** — I compile Z-moves and Max-moves rather than excluding them. They
are 87 extra rows in a generated table (~1.8 KB) and excluding them would make the CI totality assertion
weaker than "every move in the dex compiles". They are excluded from *play* by a format flag, which is a data
row, not a compiler special case.

| Kind | Admitted | C1 alone | C1+C3/C4 | C3/C4 alone | plain damage | **curated** | inert by design |
|---|---|---|---|---|---|---|---|
| Moves | **950** | 425 | 140 | 170 | 167 | **48** | 0 |
| Abilities | **311** | – | – | 258 | – | **45** | 8 |
| Items | **536** | 230 | – | 214 | – | **32** | 60 |
| **Total** | **1 797** | | | | | **125 (7.0%)** | **68 (3.8%)** |

**Derived with zero authoring: 1 604 of 1 797 = 89.3%. Missing: 0.**

The curated total moved from pass 2's 119 to **125**: three abilities and three items that pass 2 counted as
derived turn out to need a row (§1.9), and I have not netted that against the one row §1.7 removes. **A
coverage claim should only ever be revised downward under scrutiny**, so the shipped CI gate stays at ≤ 140.

**[SUPERSEDES the 94.8% figure in `proposal-systems-first.md` §1.6.]** That figure counted the 15 flags-only
abilities as derived and did not count the engine-implemented items. My number is lower and correct. The
honest accounting is the point of the whole document; a coverage claim that inflates is worth nothing.

**The curated set, named in full. This is the entire hand-written content surface.**

**Moves (48)** — every one is a *variable-quantity* move whose magnitude lives in a `basePowerCallback` or
`damageCallback` returning a computed expression (measured: **53** and **11** such functions exist). The
compiler reads the function but cannot decide what "power scales with the target's Speed" means on a board
with no Speed stat; that is a design decision, so it is a curated row of 1–2 lines:
`Acrobatics, Assurance, Avalanche, Celebrate, Crush Grip, Dragon Energy, Electro Ball, Endeavor, Eruption,
False Swipe, Flail, Flying Press, Frustration, Grassy Glide, Guardian of Alola, Guard Split, Gyro Ball,
Happy Hour, Hard Press, Hex, Hold Back, Hold Hands, Last Respects, Nature's Madness, Pain Split, Pika Papow,
Poltergeist, Power Split, Power Trip, Psywave, Punishment, Rage Fist, Return, Revenge, Reversal,
Rising Voltage, Ruination, Speed Swap, Stomping Tantrum, Stored Power, Super Fang, Synchronoise,
Temper Flare, Transform, Trump Card, Veevee Volley, Water Spout, Wring Out`.
(Flying Press stays curated: `CHART` derives its chart union automatically, but its `basePowerCallback`
still needs a tier.)

**Abilities (45)** = 36 whose handlers contain no mutation *and* no C4 signal + 6 with no handler but a real
engine-implemented effect + **3 added this pass**:
- **36:** `Air Lock, Anticipation, Arena Trap, Aura Break, Big Pecks, Clear Body, Cloud Nine, Contrary,
  Cud Chew, Forewarn, Frisk, Full Metal Body, Gale Wings, Gluttony, Heavy Metal, Hyper Cutter, Illusion,
  Imposter, Klutz, Light Metal, Long Reach, Magnet Pull, Natural Cure, Prankster, Propeller Tail,
  Serene Grace, Shadow Tag, Shield Dust, Simple, Stalwart, Super Luck, Triage, Unaware, Unnerve,
  Unseen Fist, White Smoke`.
- **6 with no handler whatsoever:** **`Levitate`**, `Battle Armor`, `Shell Armor`, `Multitype`, `RKS System`,
  `Tera Shell`. `recon-data-substrate.md` §3 predicted Levitate exactly; my scan found five more of the same
  species of problem. Verified against the shipped bundle: `levitate` carries `flags:["breakable"]`, no
  `handlers` key at all, and `signalClass:"fields"` — **which is the bundle asserting derivability it does not
  have** (§1.9, correction 6).
- **3 added this pass:** `Disguise` and `Ice Face` (their `onEffectiveness` returns `0`, which `CHART` can
  express, but *which* rung it should produce for a once-per-game busting mechanic is a design call), and
  `Tinted Lens` (its `chainModify(2)` is guarded on `typeMod < 0`, which the compiler reads as a `TILT` when
  the intended board effect is a `WARP` — pass 2 wrote the correct `WARP` by hand in its own table without
  noticing the compiler would not produce it).

**Items (32)** = 15 whose handlers contain no mutation + 14 with no handler at all but real behaviour + **3
added this pass**:
- **15:** `Air Balloon, Clear Amulet, Covert Cloak, Float Stone, Focus Band, Focus Sash, Leek, Loaded Dice,
  Lucky Punch, Razor Claw, Scope Lens, Shed Shell, Stick, Utility Umbrella, Pink Bow, Polkadot Bow`.
- **14:** `Binding Band, Blunder Policy, Damp Rock, Full Incense, Grip Claw, Heat Rock, Heavy-Duty Boots,
  Icy Rock, Lagging Tail, Light Clay, Protective Pads, Ring Target, Smooth Rock, Terrain Extender`.
- **3 added this pass:** `Iron Ball` (its `onEffectiveness` returns `0` for Ground-into-Flying, which is a
  `CHART` write whose board meaning — "this piece is grounded" — is the same as a `MARK`, and the choice
  between them is a design call, resolved in §7.9b in favour of the mark so the state is visible),
  `Ability Shield` and `Sticky Hold` (their `onTakeItem` returns are `VETO`s the compiler now derives, but
  both also need the *scope* naming which effects they refuse — §1.8 row 1).

**Inert by design (68), enumerated so nothing hides:**
- **8 abilities** with neither handler nor flag: `No Ability, Ball Fetch, Corrosion, Dancer, Early Bird,
  Honey Gather, Run Away, Stall`. They compile to `INERT`, display their real `shortDesc` with a
  "flavour only" badge, and **refund 1 draft point** (§8.5).
- **60 items:** 40 evolution items (they are not held items — they live in the promotion pool, §7.10),
  15 fossils, 5 valuables. Named in `data/curated/item-classes.json`; the drafting UI repurposes them per
  `recon-abilities-items.md` §3.4.

Every entry carries a `coverageClass ∈ {'C1','C2','C3','C4','curated','inert'}` into the bundle, which is what
makes §6's test possible. Note that this **supersedes the shipped `signalClass`**: measured, `signalClass`
puts Levitate in `fields` on the strength of one flag, which is precisely the false confidence the ledger
exists to prevent. `signalClass` is retained as an input and `coverageClass` is the output.

Two ledger figures re-measured this pass, both of which make the derivation *cheaper* than pass 1 claimed:

- **14 abilities have zero handlers, and I can name all 14**, exactly the count `recon-data-substrate.md` §3
  predicted: `No Ability, Ball Fetch, Battle Armor, Corrosion, Dancer, Early Bird, Honey Gather, Levitate,
  Multitype, RKS System, Run Away, Shell Armor, Stall, Tera Shell`. Six carry `flags.breakable` or the
  `cantsuppress` family and therefore have *real* effects the engine implements (the six curated rows); the
  other eight carry no flags at all and are the eight inert-by-design abilities. Measured on the shipped
  bundle: **81 of the 311 admitted abilities carry `flags.breakable`** (`recon-abilities-items.md` measured 84
  over the 320 raw entries — the same set, minus the three non-admitted).
- **531 of 536 admitted items carry at least one machine-readable taxonomy field**: `fling` 443, `itemUser`
  108, `isBerry` 77, `naturalGift` 77, `forcedForme` 61, `megaStone` 47, `zMove` 35, `onPlate` 34,
  `isPokeball` 28, `isGem` 18, `onMemory` 17, `onDrive` 4, `isChoice` 3. **All 77 berries carry
  `naturalGift.type`**, so the largest item family in the dex is 100% derived with no prose reading at all.

### 1.7 The residue, retired

Pass 1 listed as its first risk *"the unclassified call sites hide a systematically important behaviour
class"*, severity medium, with the falsifier *"hand-check them in M0"*. Pass 2 ran that check. My scan
reproduces its result: **145 unclassified sites across 42 distinct methods**, of which the 25 most frequent
account for **124**, and hand-classifying every one gives:

| Method | Sites | Resolves to |
|---|---|---|
| `checkMoveBypassesProtect` | 10 | **Guard** |
| `foeSidesWithConditions` | 10 | **Guard** |
| `alliesAndSelf` | 10 | **Region** |
| `getPseudoWeather` | 9 | **Guard** |
| `suppressingAbility` | 8 | **Guard** |
| `tryTrap` | 7 | **`MARK`** (the `bind` mark — Shadow Tag's and Arena Trap's mutation) |
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
plumbing. Zero require a new op from the call channel.** Three consequences:

1. **The risk is retired for the call channel.** The residue was not hiding a behaviour class; it was 42 rows
   not yet written. Adding them takes the classified share from 94.9% to **99.6%**.
2. **The Region axis is independently confirmed by Showdown's own source.** 34 residue sites are spatial
   resolvers — `adjacentFoes`, `adjacentAllies`, `alliesAndSelf`, `getAtSlot`, `getLocOf`, `getSlot`,
   `validTarget`. Region was introduced as a design axis derived from `move.target`; the dataset computes the
   same thing in code.
3. **But the conclusion was scoped too widely, and §1.8 is the correction.** Pass 2 wrote "zero require a
   nineteenth op" as a statement about the ISA. It is only a statement about the **call** channel. A method
   census cannot see a handler that calls nothing, and **494 handlers call nothing.** That is where `CHART`
   was, and it is the one measurement in this document that changes the vocabulary.

### 1.8 C4 — the return and assignment channel, measured

This section is new, and it is the reason the op count moved.

**The partition of all 1 675 handlers** (`syscomp3-9-returns2.mjs`), by what a body actually *does*:

| Class | Handlers | Share | Visible to a call-site census? |
|---|---|---|---|
| contains a mutation call | **949** | 56.7% | yes — this is C3, and §1.4's 1 072 sites live here |
| **no call; semantics is a `return` value** | **356** | 21.3% | **no** |
| **no call; semantics is a field assignment** | **138** | 8.2% | **no** |
| log-only (`this.add`, `this.hint`) | 181 | 10.8% | as `REVEAL`, or discarded |
| empty / other | 51 | 3.0% | — |

**494 handlers — 29.5% of the surface — are invisible to a method census.** Their grammar is small: fourteen
rows cover every one of them, ranked by measured volume.

| # | Pattern | Handlers | Op emitted | Named examples |
|---|---|---|---|---|
| 1 | `onTakeItem → return false` / `return !item.megaStone?.[…]` | **98** | `VETO('item-theft')` | Sticky Hold, Ability Shield, all 47 Mega Stones, Plates and Memories on their own user, Griseous Orb |
| 2 | `onTryHit → return false / NOT_FAIL` | **40** | `VETO('absolute')` guarded | Wonder Guard, Crafty Shield, Disable, Magic Bounce, Telepathy |
| 3 | `onTry → return false` | **37** | `VETO('rider')` | Rest's full-HP refusal, Sketch, Belch, Stuff Cheeks |
| 4 | `onSetStatus / onTryAddVolatile → return false` | **26** | `VETO('mark')` | Comatose, Immunity, Limber, Insomnia, Aroma Veil, Sweet Veil |
| 5 | `onImmunity / onTryImmunity → return false` | **23** | `VETO('indirect')`, parameter = the named hazard/weather | Overcoat, Safety Goggles, Magma Armor, Sand Veil, Dig's and Dive's `condition`, Magnet Rise |
| 6 | `onTryBoost → delete boost[stat]` | **13** | `VETO('boost')`, parameter = the stat set | Clear Body, White Smoke, Big Pecks, Hyper Cutter, Full Metal Body, Guard Dog |
| 7 | `onModifyCritRatio → return critRatio + n` | **11** | **`TILT('crit-window', +n)`** | Scope Lens, Razor Claw, Super Luck, Sniper, Leek, Lucky Punch, Focus Energy's `condition` |
| 8 | `onDamage → return target.hp − 1` / `return false` | **10** | `WARP([1,2,3] → −1, once)` | Sturdy, Focus Sash, Endure, False Swipe, Magic Guard, Bide |
| 9 | **`onEffectiveness → return typeMod + n` / `return 0` / `return 1`** | **8** | **`CHART`** | **Freeze-Dry, Flying Press, Thousand Arrows, Tar Shot, Disguise, Ice Face, Iron Ball** |
| 10 | `onModifyPriority / onFractionalPriority → return n` | 4 | `TEMPO('react')` / `TEMPO('act-last')` | Quick Claw, Gale Wings, Prankster, Triage |
| 11 | `onRedirectTarget / onFoeRedirectTarget → return pokemon` | 6 | `WARP(target)` — the Region is rewritten | Lightning Rod, Storm Drain, Follow Me, Rage Powder |
| 12 | `onAccuracy / onInvulnerability → return true / false` | 7 | `TILT('atk')` / `VETO('type')` | No Guard, Lock-On, Fly's and Dive's `condition` |
| 13 | `move.<field> = …` (`type`, `category`, `multihit`, `secondaries`, `forceSTAB`, `ignore*`) | **62** | `BECOME` / `WARP` / `PIERCE` | Aerilate, Galvanize, Pixilate, Refrigerate, Normalize, Liquid Voice, the 3 Pledges, Beat Up |
| 14 | `*State.<field> = <literal>` | **28** | `MARK.data` initialiser | Protect's `counter = 3` stall escalation, Rest's `time = 3`, Stockpile, Perish Song |

Three things follow, and they are why this section exists rather than being a footnote:

1. **Row 9 is a nineteenth op, and it is not optional.** Look at what the bodies actually say. Freeze-Dry
   returns `1` when the defender is Water — Showdown's `typeMod` is a **log₂ exponent** (`−1` = 0.5×, `0` =
   1×, `+1` = 2×), so `return 1` is literally *"read this matchup one band better"*. In a game where the
   entire design is "the type multiplier decides which rung of a five-rung ladder you start on", an effect
   that edits the multiplier is an effect that edits `rung0` — and **nothing else in the ISA can write
   `rung0`.** `TILT` writes the roll `C`, which cannot turn RESISTED into anything that grants tempo because
   `rung0` is already 0 and BACKLASH is decided by `rung0`. `WARP` rewrites a rung *after* the type modifier,
   which is a different thing and produces different, wrong interactions with defender reductions. Pass 2's
   17-row `RETURN_PATTERNS` table would have mapped `return 1` to a `TILT` and made Freeze-Dry a +1 to the
   roll — the single most Pokémon-Chess move in the dex, silently wrong.
2. **Row 1 is the largest single class in the dataset that pass 2 mis-filed.** 98 handlers. Pass 2 counted
   `takeItem` (16 call sites) under `EQUIP`; measured, **98 handlers use `onTakeItem` to *refuse*.** They are
   legality, not equipment, and they are one `VETO` scope.
3. **Row 7 is an op pass 2 declared and never read.** 11 measured handlers plus three named items compile to
   `TILT('crit-window')`, which appears in pass 2's `TiltScope` union and in its item table and **nowhere in
   its resolver**. §7.5 gives it a job (it raises the Band Cap), which is both the faithful reading of a
   critical hit and the fix for the defect in §1.9 correction 3.

### 1.9 Seven corrections to the census, measured

Each is a number a reader would otherwise carry forward, and five of them would have changed shipped
behaviour. All from `syscomp3-4-scalars.mjs` and `syscomp3-5-fix.mjs`.

**1. Riders are 212, not 416, and `secondary` must not be read.**
Measured: **204 moves carry `move.secondary`; in all 204 cases it is the *identical object* already present
inside `move.secondaries`** (`Object.is` true; `syscomp3-5-fix.mjs` reports `distinct: 0`). Total rider
entries counting `secondaries` alone: **212**. Counting both, as pass 2's §3.2 prose instructs: **416** —
exactly `212 + 204`. So pass 2's rider count is a double count, and worse, **a compiler that follows its
prose applies 204 riders twice**: every Thunderbolt would have two paralysis rolls. The corrected buckets:

| `secondary.chance` | 100 | 30 | 10 | 20 | 50 | 40 | 70 |
|---|---|---|---|---|---|---|---|
| riders | 63 | 55 | 53 | 23 | 14 | 3 | 1 |

The rule for the compiler, stated once: **read `secondaries` only. `secondary` is an alias `@pkmn/sim`
maintains for backward compatibility.** The repository's own `MoveEntry` schema already gets this right — it
declares `secondaries?: MoveSecondary[]` and no singular field — so the shipped bundle is safe and only the
specification was wrong. Pass 2's *code* sample reads `secondaries` only; its prose and its count do not.

**2. Priority is 42 and 14, not 21 and 6.**
Measured over the 950 admitted moves: `priority ≥ +1` on **42** moves (**19 damaging, 23 Status**);
`priority ≤ −1` on **14** (**10 damaging**). Full histogram:
`0:894, +1:16, +2:7, +3:6, +4:12, +5:1, −1:1, −3:3, −4:2, −5:2, −6:5, −7:1`.
Pass 2 quoted 21 and 6, which are `recon-moves.md`'s **gen-9 damaging** counts, presented as admitted-set
counts. This matters because §7.9 turns `priority ≥ +1` into the Reaction mechanic: the real Reaction pool is
**twice** the size pass 2 budgeted, and 23 of the 42 are Status moves, which need their own answer (given in
§7.9: a Status Reaction resolves its ops but cannot capture, which is what Helping Hand, Follow Me and Ally
Switch actually do).

**3. `multihit` is 31, `flags.charge` 17, `flags.recharge` 10, `stallingMove` 11.**
Pass 2's 22 / 13 / 8 / 12 are the gen-9 figures. The corrected numbers are all *larger*, which makes the
mechanics cheaper per authored line, not more expensive.

**4. The mark table is 165 rows, not 116.**
Measured across moves **and** abilities **and** items, including marks applied only from handler source:
`status` 6, `volatileStatus` **101**, `sideCondition` 20, `slotCondition` 5, `weather` 10, `terrain` 4,
`pseudoWeather` 9 = **155 dataset marks**, plus the 10 synthetic ones (`charging, recharging, choice-locked,
warded, exposed, asleep-counter, stunned, confused, tera'd, acted`) = **165 rows**. Pass 2's 116 counted only
marks reachable from a move's declarative fields. Consequences: `MarkSet.bits` needs **6** `Uint32` words, not
4; and the glyph budget must be **per mark *class* (6) plus ~20 named marks**, not one glyph per mark, or the
art bill explodes. Byte cost of the extra rows: 0.2 KB gz.

**5. `condition.duration` is real, is the scheduler bound, and is *not in the shipped bundle*.**
Measured: **123 of 950 moves carry a `condition` object**, with durations
`{1: 34, 2: 15, 3: 5, 4: 10, 5: 20, persist: 39}` and a **maximum of 5**, which is what makes §7.11's
scheduler horizon provable. But the repository's `MoveEntry` schema has no `condition` field and
`moves.json` carries none, so **today there is no duration data in the game at all**. `tools/compile` must
emit `dur` per mark; this is a named M0 deliverable rather than an assumption.

**6. `signalClass` as shipped asserts derivability it does not have.**
Verified on the real bundle: `levitate` has `flags:["breakable"]`, **no `handlers` key**, and
`signalClass:"fields"`. A consumer trusting `signalClass` concludes Levitate is field-derivable, which is the
exact failure `recon-data-substrate.md` §7 warns about. Fix (§1.6): `coverageClass` supersedes it, with a
distinct `flags-only` input state that resolves to `curated`, and `coverage.test.ts` asserts the six
flags-only abilities are in the curated list rather than in a derived class.

**7. Confirmed unchanged, and worth restating because the design leans on them.**
Damaging moves **679**, power tiers **T1 151, T2 223, T3 139, T4 104, T5 62** (T4+T5 = **166**, exactly the
set the Charge counter gates); **43** damaging moves have `basePower === 0`; charges
`{1:208, 2:319, 3:174, 4:159, 5:90}`; **31** moves lower a foe's `def`/`spd`; **270 of 271** Status moves
carry `ignoreImmunity` and exactly three damaging moves do (`Bide`, `Future Sight`,
`Thousand Arrows {Ground:true}`); primary statuses total **15** (`slp` 7, `par` 3, `psn` 3, `tox` 1, `brn` 1)
against rider marks `flinch` **62**, `brn` 47, `par` 45, `psn` 28, `confusion` 24, `frz` **13**, `tox` 4,
`slp` 4 — so `frz` still has **zero** primary applications, independently justifying folding Frozen into
Asleep; `basePowerCallback` **53**, `damageCallback` **11**, `willCrit` 5, `ohko` 4, `selfdestruct` 7,
`callsMove` 7, `selfSwitch` 9, `forceSwitch` 4; and the 18×18 chart is **8 immune / 61 resisted / 204 neutral
/ 51 super-effective**.
---

## 2. The board-effect vocabulary

### 2.1 An effect is a triple

```ts
/** The entire content representation. Everything in the game is a list of these. */
export interface Effect {
  when:    Trigger;                  // 14 values — WHEN it fires        (handler stem + phase)
  where:   Region;                   // 16 values — WHICH squares/pieces (target / receiver path / mark scope)
  ops:     Op[];                     // 19 kinds  — WHAT happens
  guard?:  Guard;                    // a predicate; the effect is skipped when false
  dur?:    number | 'persist';       // from condition.duration; max in the dataset is 5
  charge?: 1|2|3|4|5;                // uses per game, from pp
  power?:  0|1|2|3|4|5;              // Clash strength tier, from basePower
  tilt?:   number;                   // standing roll modifier, from accuracy / chainModify
}
```

The three axes are orthogonal and the realised cross-product is *sparse* — `recon-moves.md` measured 37 of
144 (region × payload) cells non-empty. **You implement the vocabulary, not the content.**

### 2.2 The 19 ops

```ts
export type Op =
  // ── A. WRITES (9): exactly one per mutable field of the state model (§12) ──────────────
  | { op: 'REMOVE' }                                              // existence
  | { op: 'RELOCATE'; to: 'origin'|'push'|'pull'|'swap'|'random-legal'; dist?: 1|2 }
  | { op: 'MARK';   mark: MarkId; dur?: number|'persist'; layers?: 1|2|3; data?: number }
  | { op: 'UNMARK'; filter: MarkFilter }
  | { op: 'BOOST';  d: Partial<Record<Stat, number>> }             // the 7-vector, clamped ±6
  | { op: 'MEND';   counters: number }                             // signed damage counters (§7.6)
  | { op: 'BECOME'; type?: TypeSpec; forme?: FormeSpec; cls?: PieceClass }
  | { op: 'EQUIP';  ability?: AbilitySpec; item?: ItemSpec|null; consume?: boolean }
  | { op: 'CHARGE'; slot: 0|1|2|3|'all'; d: number }

  // ── B. THE CLASH PIPELINE (6): six different mathematical kinds ────────────────────────
  | { op: 'CLASH';  slot: 0|1|2|3 }                                // the only op that can capture
  | { op: 'VETO';   scope: VetoScope }                             // boolean: makes something ILLEGAL
  | { op: 'PIERCE'; scope: VetoScope[] }                           // cancels named VETOs
  | { op: 'CHART';  d?: -2|-1|1|2; set?: 0|1; union?: BattleType }  // NEW: rewrites the type reading itself
  | { op: 'TILT';   scope: TiltScope; d: number }                  // integer addend to the roll
  | { op: 'WARP';   from: Rung[]; to: Rung; once?: boolean }        // rewrites a decided outcome

  // ── C. CONTROL FLOW (3) ───────────────────────────────────────────────────────────────
  | { op: 'TEMPO';    kind: 'grant-bonus'|'end-turn'|'skip-next'|'react'|'act-last'|'lock-slot' }
  | { op: 'SCHEDULE'; delay: 1|2|3|4|5; then: Effect }
  | { op: 'INVOKE';   pool: InvokePool; depth: 1 }                 // depth is 1 in the TYPE

  // ── D. INFORMATION (1) ────────────────────────────────────────────────────────────────
  | { op: 'REVEAL'; what: 'item'|'slots'|'threats' };

export type Stat      = 'atk'|'def'|'spa'|'spd'|'spe'|'acc'|'eva';
export type Rung      = -1|0|1|2|3;
export type VetoScope = 'type'|'element'|'class'|'chain'|'indirect'|'rider'|'ally'|'absolute'|'bind'
                      | 'item-theft'|'mark'|'boost';               // last three added by §1.8 rows 1,4,6
export type TiltScope = 'atk'|'def'|'crit-window';                 // was five; see the note below
```

Notes that carry weight.

**`CHART` is the new op, and it is the one that fits this game best.** It writes the *type reading* of a
Clash, in Showdown's own log₂ units, and it is the only op that can. Three parameterisations cover all eight
measured handlers:

| Form | Meaning | Content |
|---|---|---|
| `{d: +1}` guarded on the defender's type | read this matchup one band better | **Freeze-Dry** (`vsType:'Water'`), **Tar Shot**'s mark (`atkType:'Fire'`) |
| `{set: 1}` | read this matchup as **neutral**, whatever the chart says | **Iron Ball**, **Thousand Arrows** (both against Flying), **Disguise**, **Ice Face** |
| `{union: 'Flying'}` | multiply in a second attacking type's chart row | **Flying Press** — measured: vs Grass 1 × 2 = 2×, vs Steel 2 × 0.5 = 1×, vs Ghost 0 × 1 = 0× |

`CHART` cannot be folded into `TILT`, `WARP` or `PIERCE`, and the reason is structural rather than aesthetic:

- **Not `TILT`.** `TILT` adds to the roll `C`; `CHART` changes `rung0`. Under §7.5, `rung0` alone decides
  whether the modal outcome is BACKLASH, and no amount of `TILT` converts a resisted matchup into one that
  earns tempo (that is the Band Cap, §7.5 step 5a, and it is a pillar of the design). Freeze-Dry as a `TILT`
  would leave Ice pieces dying to Water pieces, which is the exact opposite of what Freeze-Dry is for.
- **Not `WARP`.** `WARP` rewrites a rung *after* the type modifier and the defender's reductions. A
  `CHART` write happens *before* them, so it composes with `guard` correctly: Freeze-Dry against a boosted
  Water rook is a super-effective attack that the rook's defence can still pull down, which is right.
  Modelled as a `WARP` it would be un-defendable.
- **Not `PIERCE`.** Piercing removes a veto (a boolean). Iron Ball does not merely make Ground *legal*
  against Flying — the card and the code both say **neutral**, which is a different and weaker thing than
  "super effective" and than "legal but still 0×-shaped". `{set: 1}` says exactly that.

**`MARK` collapses seven Showdown fields into one op.** `status`, `volatileStatus`, `sideCondition`,
`slotCondition`, `weather`, `terrain`, `pseudoWeather` are all "put a named tag with a duration somewhere",
and the *Region* decides where it lands. Measured mark table (§1.9 correction 4): **155 dataset marks + 10
synthetic = 165 rows** of `{id, name, scope, class, defaultDur, maxLayers, tick?, mod?, glyph}`. `defaultDur`
comes from `condition.duration`, measured `{1:34, 2:15, 3:5, 4:10, 5:20, persist:39}` — **the maximum
duration in the entire dataset is 5**, which is what makes the scheduler horizon provably ≤ 5 turns (§7.11).
`data` is the payload initialiser §1.8 row 14 extracts (Protect's `counter = 3`, Rest's `time = 3`).

**`MEND` is signed damage counters, not HP.** §7.6. This is the one place I add state the dataset does not
name, and it is forced: 94 measured `heal`/`damage`/`directDamage` sites plus 87 status applications plus 4
hazards plus every thorns ability and Leftovers exist purely to do or undo small amounts of damage. Mapping
all of that onto stat boosts is the "systematic but thematically wrong ⇒ defect" failure `DIRECTION.md` names.

**`VETO` cannot be folded into `TILT`.** Immunity must make a move **ungenerated**, not merely unlikely,
because the move generator, the UI's legal-square highlighting and the AI's branching factor all read
legality as a boolean. Modelling Levitate as "−99 to the roll" offers the player a square that cannot work
and makes the AI search a move that cannot happen. Three scopes are added this pass because §1.8 measured
them: `item-theft` (98 handlers), `mark` (26), `boost` (13).

**`WARP` is what makes the hard defences expressible**, and it is not a modifier: Sturdy is not "+N to a
roll", it is "whatever the roll said, this capture fails, once". Five parameterisations of one op cover
Sturdy `WARP([1,2,3] → −1, once)`, Focus Sash (same, `consume`), Filter/Solid Rock `WARP([3] → 2)`,
Rock Head `WARP([0] → 1)`, Shell Armor `WARP([3] → 1)`, Tinted Lens `WARP([0] → 1)` on the attacker's side.

**`TiltScope` drops from five to three, and this is a defect fix.** Pass 2 declared `'accuracy'` and
`'evasion'` scopes and a `'crit-window'` scope, and its resolver (§7.5 steps 2–6) reads only `atk` and `def` —
so **Scope Lens, Razor Claw, Super Luck, Sniper, Leek, Lucky Punch, Focus Energy, Compound Eyes, Keen Eye,
Illuminate, No Guard, Sand Veil, Snow Cloak, Tangled Feet and Wonder Skin all compile to ops the resolver
throws away.** The fix is two lines of the compiler and one line of the resolver:

- **accuracy → `atk`, evasion → `def`.** They are already numeric addends to a roll, and in a game with one
  die and no damage formula, "harder to hit" and "better defended" are the same quantity. Two scopes deleted,
  15 entries repaired, zero content lost. *(Two of the 950 moves — Double Team and Minimize — are the reason
  §9.3 caps total `eva` effect at +2; that cap survives unchanged as a `BOOST` clamp.)*
- **`crit-window` survives with a real job: it raises the Band Cap** (§7.5 step 5a) by its value. That is
  exactly what a critical hit is in Pokémon — a separate mechanism that upgrades an already-landed hit — and
  it is the only way a *neutral* matchup can ever reach CRITICAL, which is a good place for the game's
  rarest outcome to live.

**`INVOKE`'s `depth` is literally `1` in the type.** A depth-2 invoke is unconstructible, so
Metronome→Metronome is impossible at compile time rather than guarded at runtime by something a future
contributor can delete.

**There is no op that puts a piece on the board.** `SUMMON` does not exist and CI fails the build if it ever
appears (§3.4 gate 5). This is load-bearing: it is the monovariant the termination proof rests on (§7.11).
Revival Blessing therefore compiles to `MEND(+3)` on a piece that has counters, not to a resurrection;
Substitute compiles to `MARK(SELF,'substitute')`, a decoy tag that absorbs one Clash, not a second occupant.

### 2.3 The 14 triggers

Derived from `on + Phase + Stem` by the 81-row stem table. Named for the board, not for Showdown.

| Trigger | Fires | Stems mapped here | Content examples |
|---|---|---|---|
| `ON_ACT` | a move is used | *(default for moves)*, `Hit`, `PrimaryHit`, `HitSide`, `HitField`, `PrepareHit`, `Move`, `MoveFail` | every move's own effect |
| `ON_ENTER` | a piece arrives on a square, or a mark starts | `Start`, `SwitchIn`, `Update`, `SideStart`, `FieldStart` | Intimidate, hazards firing, terrain seeds, screens going up |
| `ON_EXIT` | a piece leaves a square, or a mark ends | `SwitchOut`, `End`, `SideEnd`, `FieldEnd`, `DragOut` | Natural Cure, Regenerator, weather expiring |
| **`ON_RESTACK`** | **the same mark is applied while already present** | **`Restart`, `SideRestart`, `FieldRestart`** | **Spikes' 2nd and 3rd layer, Toxic Spikes' 2nd, Stockpile, Protect's stall escalation, Perish Song refresh** |
| `ON_CHECKUP` | the owner's Checkup phase | `Residual`, `Weather` | poison/burn ticks, Leftovers, Perish, Charge accrual |
| `CLASH_LEGAL` | legality is computed | `Immunity`, `Invulnerability`, `TryHit`, `Try`, `TakeItem`, `TrapPokemon`, `MaybeTrapPokemon`, `RedirectTarget` | Levitate, Air Balloon, Wonder Guard, Protect, Shadow Tag, Sticky Hold |
| **`CLASH_CHART`** | **the type reading is computed, before the roll** | **`Effectiveness`, `NegateImmunity`, `ModifyType`** | **Freeze-Dry, Flying Press, Tar Shot, Iron Ball, Thousand Arrows, Aerilate** |
| `CLASH_ROLL` | the roll is assembled | `BasePower`, `Atk`, `SpA`, `Def`, `SpD`, `Damage`, `Accuracy`, `CritRatio`, `STAB` | Charcoal, Guts, Thick Fat, Compound Eyes, Scope Lens |
| `CLASH_RESULT` | the rung is decided, before it applies | `Damage(Try/Modify)`, `Secondaries` | Sturdy, Focus Sash, Filter, Rock Head, Shell Armor |
| `ON_SURVIVE` | I survived a Clash against me | `DamagingHit`, `AfterBoost`, `EachBoost` | Rough Skin, Static, Weak Armor, Rocky Helmet, Weakness Policy |
| `ON_KO` | I left the board | `Faint`, `AllyFaint`, `EmergencyExit` | Aftermath, Innards Out, Destiny Bond, Power of Alchemy |
| `ON_CAPTURE` | I captured something | `MoveSecondarySelf`, `AfterMove`, `SubDamage` | Moxie, Beast Boost, Life Orb, Shell Bell, U-turn's return |
| `ON_TAG` | a mark is applied to me, my side, or the board | `SetStatus`, `AddVolatile`, `Boost`, `ChangeBoost`, `Flinch`, `Attract`, `SetWeather`, `TerrainChange`, `PseudoWeatherChange` | Limber, Clear Body, Shield Dust, Lum Berry, Forecast, Chlorophyll |
| `ON_ITEM` | an item is used, eaten or removed | `EatItem`, `UseItem`, `Eat`, `Use`, `SetAbility`, `DeductPP` | Harvest, Unburden, Cheek Pouch |
| `ALWAYS` | a standing modifier, no event | `Spe`, `Priority`, `FractionalPriority`, `Weight`, `Type`, `DisableMove`, `Mega`, `Terastallization` | Levitate's flight, auras, Trick Room, Choice lock |

Two changes from pass 2's 13, both measured:

- **`ON_RESTACK` is added.** Measured: `onRestart` 21 handlers + `onFieldRestart` 4 + `onSideRestart` 2 =
  **27 handlers** whose entire purpose is "this mark was applied again". Pass 2 has no trigger for it, yet it
  *depends* on the behaviour twice — on Showdown's stall-escalation formula for the Protect family (§7.9) and
  on Spikes' three layers (§4 trace 2). Without the trigger, a second Spikes compiles to a no-op and the
  Protect curve never escalates. This is the 14th trigger and it earns its place at 27 handlers.
- **`CLASH_CHART` is added** as the phase `CHART` writes, sitting between legality and the roll. It is not
  merely a home for the new op: it is where the ordering guarantee lives (§7.5), because a chart rewrite must
  be visible to the *player's* pre-commitment outcome preview, and therefore must resolve before any die is
  spent.
- **`ON_FIELD` stays deleted** (pass 2's correct call): once `MARK` unifies weather, terrain and rooms into
  board-scoped marks, "the weather changed" *is* "a mark was applied to the board", so Forecast and
  Chlorophyll listen on `ON_TAG` with `where: BOARD`. Net count 13 → 14.

### 2.4 The 16 regions, and why the derivation is two-dimensional

Twelve regions adopt `recon-moves.md` §2.2 verbatim — it is measured and correct — and four exist for
abilities and items. My own target census over the 950 admitted moves: `normal` 630, `adjacentFoe` 53,
`self` 99, `allAdjacentFoes` 60, `allAdjacent` 20, `any` 24, `all` 24, `allySide` 14, `foeSide` 4, `allies` 4,
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
| `FOE_ZONE` | a 3-square segment of the enemy's **third rank counted from their own back rank** — i.e. **rank 6 when White casts, rank 3 when Black casts** — spanning the caster's file ± 1, clamped at the a- and h-files | `foeSide` | 4 |
| `TARGET` | the current Clash's defender | scope `SOURCE` | — |
| `KING_RING` | the 8 squares around **this piece** — the bounded form of "board-wide" | scope `ANY` | — |
| `SQUARE` | the square this piece stands on | scope `SELF`, square-level | — |
| `NONE` | no spatial extent (a pure modifier) | `ALWAYS` | — |

`RAY_LOS` and `RAY_ANY` are the genuinely new chess geometry — **capture at range without occupying the
square** — and `RING1_ALL` is the friendly-fire class (Earthquake, Surf, Explosion, Discharge, Boomburst).
Measured flavour bonus needing no curation: **15 of the 24 `target:'any'` moves are Flying-type** and the rest
are pulse/beam moves, so "ignores blockers because it flies over them" falls out of the data.

**The derivation is two-dimensional, and this is a defect fix.** Pass 2 derives Region from one input — the
handler *name's* scope prefix (`Source|Ally|Foe|Any|Weather`). Measured, that is wrong for **429 of 1 675
handlers (25.6%)**, because a handler's region also depends on **which object it hangs off**:

| Receiver path | Handlers | What the region actually is |
|---|---|---|
| `entry` | 1 246 | `REGION_OF_TARGET[move.target]` for moves; `REGION_OF_SCOPE[nameScope]` for abilities and items |
| **`condition`** | **371** | **the scope of the mark this condition *is*** — `MARK_TABLE[markOf(entry)].scope`, i.e. `SQUARE` for a hazard, `OWN_SIDE` for a screen, `BOARD` for weather, `SELF` for a volatile |
| `self` | 49 | always `SELF`, regardless of the name |
| `secondary` / `secondary.self` | 9 | `TARGET`, or `SELF` when the path ends in `.self` |

So `regionOf(handler) = REGION_2D[receiverPath][nameScope]`, a 4 × 6 table with the `condition` row deferring
to the mark table the compiler already builds. Without it, Stealth Rock's `condition.onSwitchIn` — the handler
that *is* the hazard — resolves to `SELF` and the hazard never fires on the arriving enemy; Reflect's
`condition.onSourceModifyDamage` resolves to `SELF` instead of `OWN_SIDE` and protects one piece instead of an
army. The condition-scope handler-name census that drives this row is measured in full:
`onStart 74, onEnd 27, onSideStart 23, onResidual 20, onSideEnd 14, onTryHit 14, onRestart 13, onFieldStart 13,
onBeforeMove 12, onHit 10, onFieldEnd 10, onBasePower 9, onDisableMove 7, onSwitchIn 7,` + 51 more names at
≤ 5 each.

`REGION_OF_SCOPE` maps ability scope `ANY → KING_RING`, which is where the balance bound on board-wide
abilities becomes a **compiler invariant** rather than a rule someone must remember: Neutralizing Gas,
Teraform Zero, Shadow Tag and Arena Trap *cannot* be global, because the compiler has no global region for an
ability to reach.

### 2.5 Why 19 ops, and not 12 or 30

1. **Nine writes are forced by the state model** (§12) — one op per mutable field, after merging every field
   pair that merges (`setType` + `formeChange` + class → `BECOME`; `setItem` + `setAbility` → `EQUIP`; the
   seven Showdown tag fields → `MARK`). Getting below nine means deleting state, i.e. deleting content: no
   items (−1 op, −536 entries), no counters (−1 op, ~200 entries go inert), no charge economy (−1 op, and the
   termination bound weakens).
2. **The six Clash-pipeline ops are six different mathematical kinds** — a boolean veto, a veto-canceller,
   a **rewrite of the type reading**, an integer addend, an outcome-rewriting function, and the resolution
   itself. Merging any pair breaks either move generation or a named piece of content (§2.2).
3. **The three control ops and one info op are irreducible.** `TEMPO` is the *only* route to a bonus
   sub-move, which is exactly what makes termination auditable by grep. `SCHEDULE` is the only cross-turn
   write. `INVOKE` is the only recursion. `REVEAL` writes no game state and exists so
   Frisk/Forewarn/Anticipation are real content rather than deleted content.
4. **Why exactly one more than pass 2, and why not two more.** An op earns its place by appearing in ≥ 3
   unrelated entries and by being *unrepresentable* as a parameterisation of an existing op. `CHART` clears
   both bars: 7 entries across all three content kinds, and §2.2 proves it is not a `TILT`, `WARP` or
   `PIERCE`. I tested three further candidates against the same bar and **rejected all three**, which is the
   discipline that keeps the number from drifting:
   - `SWAP` (Power Swap, Guard Swap, Heart Swap, Speed Swap, Power/Guard Split — 7 entries) — rejected: it is
     two `BOOST`s with computed arguments, and `BOOST` already takes a vector.
   - `COPY` (Trace, Receiver, Power of Alchemy, Transform, Imposter — 5 entries) — rejected: it is
     `EQUIP{ability:'copy-target'}` plus `BECOME`, both of which exist.
   - `REDIRECT` (Lightning Rod, Storm Drain, Follow Me, Rage Powder — 6 entries, §1.8 row 11) — rejected, but
     it is the closest call in the document: it rewrites the *Region* of an in-flight Clash. `WARP` is
     extended with an optional `target` field instead, because a redirect is exactly "the decided resolution
     is rewritten", and adding a field to an op is cheaper than adding an op.
5. **The residue is measured in both channels now.** 145 of 2 845 call sites (5.1%) resisted the tables and
   §1.7 hand-classifies them: **61 Guards, 34 Regions, 17 mutations onto existing ops, 12 plumbing, zero new
   ops.** And §1.8 exhaustively partitions the 494 no-call handlers into 14 grammar rows, of which exactly one
   needed a new op. There is no third channel: a handler either calls something, returns something, assigns
   something, logs, or is empty, and all five are now counted.

`recon-abilities-items.md` §2.6's 115 "primitives" are **not a competing ISA** — they are 115
*parameterisations* of these ops, which is precisely what a data layer should be. `WARD/elemental` (11
abilities) is `{when:'CLASH_LEGAL', where:'NONE', ops:[{op:'VETO',scope:'element'}], params:{type}}`;
`BULWARK/flat` is `{when:'CLASH_ROLL', ops:[{op:'TILT',scope:'def',d:1}]}`; `EDGE/escalate` is
`{when:'ON_CAPTURE', ops:[{op:'BOOST',d:{atk:1}}]}`. I keep that document's **13 archetypes as the UI glyph
vocabulary** (they are excellent for that, §10.6) and discard the 115 as an implementation unit — because they
would be 115 hand-written functions, ~1 700 LOC, of which the compiler already writes 100%.

### 2.6 Op semantics, exactly — the whole of `src/rules/ops.ts`

Nineteen rows. This is the complete specification of the interpreter: an implementer reading only this table
and §7.5 can write `ops.ts` without asking a question. Every row is a pure function
`(PokeState, Target[], ClashCtx) → void` over the journal (§2.9) plus the events it emits.

| Op | Precondition (else no-op, and the event says so) | State mutation | Journal entry | Event emitted |
|---|---|---|---|---|
| `REMOVE` | target on board; target is not a King under `params.notRoyal` | delete from `chess`, delete from `pieces`, `prizes[owner]++`, mark progress | `(REMOVE, pieceId, square, cls)` | `{t:'removed', piece, cause}` |
| `RELOCATE` | destination exists and is empty (`swap`: occupied by the named piece) | `chess.movePiece`; `origin` = the square the piece stood on at the start of *this sub-move* | `(RELOCATE, pieceId, fromSquare, 0)` | `{t:'relocated', piece, from, to, mode}` |
| `MARK` | mark not already present at higher `dur`; a rotation-class mark displaces any other rotation mark; if already present at any `dur`, fire `ON_RESTACK` instead | set bit in the region's `MarkSet`, write `dur`/`layers`/`data` capped by `MarkRow.maxLayers` | `(MARK, scopeId, markId, oldDur)` | `{t:'marked', mark, where, dur}` |
| `UNMARK` | ≥ 1 mark matches `filter` | clear bits, zero `data` | one entry per cleared mark | `{t:'unmarked', marks[]}` |
| `BOOST` | — | `boosts[stat] = clamp(boosts[stat] + d, −6, +6)`; a stat already at the clamp emits a *refused* event so the UI can say "already maximal" | `(BOOST, pieceId, statMask, packedOld)` | `{t:'boosted', piece, d, clamped}` |
| `MEND` | target is not a King (Kings have no counter track, §7.6) | `counters = clamp(counters − d, 0, 3)`; at 3, set `KO_PENDING` (removal deferred to the Checkup) | `(MEND, pieceId, 0, oldCounters)` | `{t:'counters', piece, from, to}` |
| `BECOME` | for `forme`: the target forme exists in `species.bin`; for `type`: the type is one of the piece's legal declarations, or `params.any` | write `species` / `declaredType` / `cls`; `PieceId` is unchanged | `(BECOME, pieceId, field, oldValue)` | `{t:'became', piece, species?, type?, cls?}` |
| `EQUIP` | for `consume`: `item !== 0` | write `ability` / `item`; `consume` sets `item = 0` | `(EQUIP, pieceId, field, oldValue)` | `{t:'equipped', piece, item?, ability?, consumed}` |
| `CHARGE` | slot exists | `slots[slot].charges = clamp(+d, 0, 5)`; slot 0 is `Infinity` and ignores this op | `(CHARGE, pieceId, slot, oldCharges)` | `{t:'charge', piece, slot, to}` |
| `CLASH` | resolved entirely by §7.5, which is the only caller | as §7.5 step 8 | — (its component ops journal themselves) | `{t:'clash', …}` — the richest event; drives the Why panel |
| `VETO` | — | **writes no state.** Returns a scope token collected by §7.5 step 1 | none | `{t:'vetoed', scope}` only if it was the binding veto |
| `PIERCE` | — | **writes no state.** Returns scope tokens that cancel `VETO`s | none | `{t:'pierced', scopes[]}` |
| **`CHART`** | — | **writes no state.** Returns a log₂ delta / absolute / union collected by §7.5 step 1b | none | `{t:'charted', from, to, source}` |
| `TILT` | — | **writes no state.** Returns a signed integer collected by §7.5 step 2 or 5 | none | contributes a line to the `clash` event's ladder breakdown |
| `WARP` | current rung ∈ `from`; direction permitted by §7.5 step 3/6 | **writes no state.** Rewrites the rung in flight; `once` consumes the source's `WARD_INTACT` flag or item | none (the consume is a separate `EQUIP`) | `{t:'warped', from, to, source}` |
| `TEMPO` | `grant-bonus`: `sub < 2` and §7.11 T2 has an eligible piece | sets `bonusPending` / `endTurn` / the target's `SKIP_NEXT` flag / `CHOICE_LOCKED` | `(TEMPO, 0, kind, oldFlags)` | `{t:'tempo', kind}` |
| `SCHEDULE` | no pending entry for this `(side, kind)` — a second one simply fails, which is the horizon bound | push `{fireOn: turn + delay, effect}` | `(SCHEDULE, index, 0, 0)` | `{t:'scheduled', delay, kind}` |
| `INVOKE` | `depth === 1` (unconstructible otherwise) | resolve the pool with `rng.fork('invoke')`, **emit the chosen move to the log before resolving it**, then run its `Effect[]` with `depth` exhausted | — (its component ops journal themselves) | `{t:'invoked', move}` then that move's own events |
| `REVEAL` | — | **writes no game state.** Sets a per-side UI affordance flag | `(REVEAL, side, what, oldFlags)` | `{t:'revealed', what, subject}` |

Four properties of this table are load-bearing and are asserted by `termination.test.ts` and
`journal.test.ts`:
**no row increases the piece count**; **no row can be reached with `INVOKE` depth ≠ 1**; **the six ops that
write no state (`VETO`, `PIERCE`, `CHART`, `TILT`, `WARP`, `REVEAL`) are the only ops legal at `CLASH_LEGAL`,
`CLASH_CHART`, `CLASH_ROLL` and `CLASH_RESULT`** — which is what makes capture resolution re-entrant and
therefore safe for the AI to search speculatively; and **every state-writing row has a single-entry inverse**,
which is §2.9.

### 2.7 Everything else the types reference

```ts
/** A predicate over the resolution context. Compiled from the 53+16 PREDICATE_TABLE rows. */
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
  | { noActionThisTurn: true } | { charge: { min: 0|1|2 } }
  | { class: PieceClass[] } | { rung: { min?: Rung; max?: Rung } };

export type MarkFilter  = { ids: MarkId[] } | { class: 'rotation'|'counter'|'field'|'square'|'side' }
                        | { all: true };
export type TypeSpec    = BattleType | 'move' | 'attacker' | 'target';   // 'move' = Protean's runtime type
export type FormeSpec   = { species: SpeciesId } | { megaOf: SpeciesId } | { evoOf: SpeciesId };
export type AbilitySpec = AbilityId | 'copy-target' | 'none';
export type ItemSpec    = ItemId | 'steal-target';
export type InvokePool  = 'metronome-flagged' | 'own-slots' | 'target-slots' | 'last-used';

/** One generated row per mark. 165 rows (§1.9 correction 4), emitted by compiler pass 1, ~0.6 KB gz. */
export interface MarkRow {
  id: MarkId; name: string;
  scope: 'piece' | 'square' | 'side' | 'board';   // ALSO the Region for this mark's condition handlers (§2.4)
  class: 'rotation' | 'counter' | 'field' | 'hazard' | 'screen' | 'modifier';
  defaultDur: number | 'persist';     // from condition.duration; measured max 5
  maxLayers: 1 | 2 | 3;               // from the move (Spikes 3, Toxic Spikes 2, else 1)
  data?: number;                      // payload initialiser, from §1.8 row 14
  tick?: Effect;                      // what it does at ON_CHECKUP or ON_ENTER
  restack?: Effect;                   // what a second application does — ON_RESTACK, §2.3
  mod?: Op[];                         // standing modifier while present (Burned's TILT(atk,−1))
  glyph: number;                      // index into the 6 class glyphs + 20 named-mark glyphs
}

/** The ONLY channel from engine to view. Serialisable, replayable, and what the Why panel renders. */
export type EffectEvent =
  | { t:'tempoRoll'; faces:[number,number,number] }
  | { t:'clash'; attacker:PieceId; defender:PieceId; slot:0|1|2|3; atkType:BattleType;
      defType:BattleType; mult:0|0.5|1|2; charted?:{from:number;to:number;source:string};
      rung0:Rung; face:number; cap:Rung;
      ladder:{ label:string; d:number }[];        // every contribution, in application order
      rung:Rung; outcome:'REPELLED'|'BACKLASH'|'CLEAN'|'SURGE'|'CRITICAL'; }
  | { t:'blocked'; attacker:PieceId; defender:PieceId; scope:VetoScope; explain:string }
  | { t:'charted'; from:number; to:number; source:string }
  | { t:'removed'; piece:PieceId; cause:string }
  | { t:'relocated'; piece:PieceId; from:Square; to:Square; mode:string }
  | { t:'marked'; mark:MarkId; where:Square|'board'|Side; dur:number|'persist' }
  | { t:'restacked'; mark:MarkId; layers:number }
  | { t:'unmarked'; marks:MarkId[] }
  | { t:'boosted'; piece:PieceId; d:Partial<Record<Stat,number>>; clamped:boolean }
  | { t:'counters'; piece:PieceId; from:number; to:number }
  | { t:'became'; piece:PieceId; species?:SpeciesId; type?:BattleType; cls?:PieceClass }
  | { t:'equipped'; piece:PieceId; item?:ItemId; ability?:AbilityId; consumed:boolean }
  | { t:'charge'; piece:PieceId; slot:number; to:number }
  | { t:'warped'; from:Rung; to:Rung; source:string }
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

/** The AI's ordering/quiescence oracle. An 18x18x6 baked table, 1 944 bytes. */
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
`Object.keys`.

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
`dispatch.test.ts` asserts that a state serialised, reloaded and re-run emits a byte-identical
`EffectEvent[]`.

### 2.9 The op journal — why the ISA gives the AI its undo for free

This section is new, and it fixes a defect that would have cost the AI four plies.

Pass 2's `Rules` interface offers exactly one mutation path: `apply(s, a) → { next, events }`, immutable,
returning a fresh `PokeState`. That is correct for the server, the replay and the UI, and **catastrophic for
search**. Measured (`syscomp3-7-clone.mjs`, deep-cloning pass 2's own §12.1 state shape — 32 pieces each with
a 7-byte boost vector and a `MarkSet`, plus 64 square `MarkSet`s, 2 side and 1 board):

| Path | Cost per node | Implied ceiling |
|---|---|---|
| deep clone of the dense state | **20.8 µs** | **48 000 nodes/s** |
| deep clone of the sparse state (§12.1, 1 416 bytes) | 5.1 µs | 196 000 nodes/s |
| **journal: 6 writes + rewind** | **53 ns** | **18.9 M nodes/s** |

`recon-tech.md` measured a properly engineered searcher at **7.1 M nodes/s** and sized the whole difficulty
ladder and latency target on it. Pass 2's only mutation path is **148× short of that**, which at the measured
EBF of 3.8–4.2 is about **four plies** — the difference between depth 9 and depth 5. The journal is 392×
faster than the dense clone and 96× faster than the sparse one, and it is the only path that reaches the
number the AI section quotes.

**The fix is not a rewrite; it is the ISA's own structure.** Every state-writing op has a bounded inverse,
because every op writes a fixed number of fields with a known previous value:

```ts
/** One 4-int journal entry per field written. Flat, growable, exactly position.ts's own pattern. */
const enum J { OP = 0, TARGET = 1, FIELD = 2, OLD = 3, STRIDE = 4 }

export interface Journal { buf: Int32Array; sp: number; frames: number[]; }

export interface Rules {
  generate(s: PokeState): Action[];
  /** Immutable. Server, replay, UI. */
  apply(s: PokeState, a: Action): { next: PokeState; events: EffectEvent[] };
  /** Mutable. Search only. Pushes a frame, mutates in place, returns the events. */
  makeAction(s: PokeState, a: Action): EffectEvent[];
  /** Pops the last frame, replaying every entry backwards. Exact, O(writes). */
  unmakeAction(s: PokeState): void;
  terminal(s: PokeState): Terminal | null;
  staticClash(attacker: BattleType, defender: BattleType, face: number): ClashEstimate;
}
```

Four properties make this safe rather than merely fast:

1. **`apply` is defined *in terms of* `makeAction`**, not beside it: `apply` clones once, calls
   `makeAction`, and never unmakes. So there is **one** resolution code path and the immutable API cannot
   drift from the mutable one — which is the bug this pattern usually introduces. `journal.test.ts` asserts
   `unmakeAction(makeAction(s, a))` restores a byte-identical serialisation for 10 000 random actions from 200
   random positions, and that `apply` agrees with `makeAction` event-for-event.
2. **It is the pattern the repository already uses.** `position.ts` maintains a flat `Int32Array undo` with a
   fixed `UNDO_STRIDE` per ply, snapshots `ep`, `rights`, `halfmove`, `hashHi`, `hashLo`, `fullmove`, and
   `unmakeMove()` restores them — and `repetitionCount()` reads those same snapshots. The Pokémon journal
   is the same idea one layer up, and the two nest: a `makeAction` frame wraps a `makeMove`.
3. **The RNG needs no journal entry.** `RngState` is a 4-tuple of numbers, so a frame stores it as four
   entries and restoring is a copy. Because the Tempo Roll is drawn once per *turn* (§7.4) rather than once
   per capture, the interior of a turn draws no randomness at all except rider coins, which is the same
   property that makes the search deterministic within a turn.
4. **The Zobrist key is journaled by `position.ts` for free.** Pokémon words are mixed with
   `Position.xorHash(hi, lo)`, and `makeMove` snapshots the whole key while `unmakeMove` restores the
   snapshot — so, quoting `zobrist.ts`'s own doc comment, *"words mixed in after a `makeMove` are undone by
   the matching `unmakeMove` without the extension tracking them."* The existing design anticipated this
   exactly.

**A consequence worth stating because it deletes a module.** Pass 2 specifies a *separate* repetition
accumulator. It is unnecessary: because `repetitionCount()` compares the `hashHi`/`hashLo` snapshots in its own
undo journal, and because Pokémon facts are mixed into those very fields, **the existing detector becomes
Pokémon-aware the moment the words are mixed, with zero new code** — and `tempo` is excluded automatically
because it is never mixed. One caveat, stated so nobody trips on it: `repetitionCount()`'s scan floor is
`ply − halfmove`, i.e. the *chess* 50-move clock. Our progress set (§7.11) is a strict superset of chess's, so
our clock resets more often and the floor is *conservative* — the scan can look back past our own progress
horizon, which costs a few extra hash comparisons and can never produce a false claim, because the hashes
themselves carry the Pokémon state. `repetition.test.ts` asserts both directions.
---

## 3. The compiler

Runs at **build time** in `tools/compile/`. Reads `@pkmn/dex` + `@pkmn/sim` + `data/curated/*.json`, emits
`src/data/generated/*`. Deterministic: same inputs ⇒ byte-identical output, asserted in CI. It replaces
`scripts/gen-data.ts`, whose output it is a strict superset of.

### 3.1 Six passes

```
pass 1  ADMIT      filter by isNonstandard; assign stable uint16 ids; build the 165-row mark table
pass 2  DERIVE-C1  read declarative fields              -> Effect[]   (425 moves + 230 items complete)
pass 3  DERIVE-C2  parse handler names AND receiver paths -> Trigger + Region per handler  (2-D, §2.4)
pass 4  DERIVE-C3  scan handler source, CALL channel      -> Op[] + Guard[] + params
pass 5  DERIVE-C4  scan handler source, RETURN/ASSIGN     -> Op[] + Guard[]   (14 rows, §1.8)   <- NEW
pass 6  PATCH      apply data/curated/*.json as a DIFF; emit; assert totality
```

Passes 2–5 **accumulate into the same `Effect[]`**; they do not compete. Pass 6 is a patch layer, and that is
the architectural point: **a curated entry is a diff against the compiler's proposal, not an authoring task.**
The generator writes `build/compile-report.json` recording, for all 1 797 entries, which pass produced each op
— so §1.6's ledger is regenerated and re-asserted on every build rather than being a claim in a document.

Pass 5 is new this pass, and it is 14 rows against a channel that carries 494 handlers (§1.8). It runs *after*
the call channel deliberately: where both channels speak (93 measured entries), the call channel's ops are
the payload and the return channel's are the guards and the vetoes, which is the correct precedence — Wonder
Guard's `onTryHit` returns `false` *guarded by* a `runEffectiveness` predicate the call channel found.

### 3.2 Pass 2 — declarative derivation

```ts
function deriveC1(m: DexMove): Effect[] {
  const region = REGION_OF_TARGET[m.target]                             // 15-row table, §2.4
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
  if (m.callsMove)               ops.push({ op:'INVOKE', pool:'metronome-flagged', depth:1 });
  if (m.stallingMove)            ops.push({ op:'MARK', mark: PROTECT, dur:1 }, { op:'MARK', mark: STALL, data:3 });

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

  // --- riders: 212 measured. READ `secondaries` ONLY: `secondary` is the same object (§1.9 #1). ---
  for (const s of (m.secondaries ?? []))
    out.push({ when:'ON_CAPTURE', where: s.self ? 'SELF' : 'TARGET',
               guard: { coins: coinsOf(s.chance ?? 100) },
               ops: [ ...(s.status         ? [{op:'MARK', mark: markOf(s.status)}] : []),
                      ...(s.volatileStatus ? [{op:'MARK', mark: markOf(s.volatileStatus), dur:1}] : []),
                      ...(s.boosts         ? [{op:'BOOST', d: s.boosts}] : []),
                      ...(s.self?.boosts   ? [{op:'BOOST', d: s.self.boosts}] : []) ] });

  // --- scalars with no op: they parameterise the Clash. Counts corrected per §1.9. ---
  //  multihit           -> WARP(reroll n, keep best)          31 moves
  //  priority >= +1     -> TEMPO('react')                     42 moves (19 damaging, 23 Status)
  //  priority <= -1     -> TEMPO('act-last')                  14 moves (10 damaging)
  //  flags.charge       -> MARK('charging', dur 2)            17 moves
  //  flags.recharge     -> MARK('recharging', dur 1)          10 moves
  //  willCrit           -> WARP(from any, to 3, once-per-turn) 5 moves
  return out;
}
```

Five field-level guards that are non-negotiable, each measured by me:

- **`m.basePower || 60`.** **43 damaging moves have `basePower === 0`** (Gyro Ball, Low Kick, Seismic Toss,
  Flail, Electro Ball, Fissure…). Without the guard they compile to a strength-0 attack, which reads to a
  player as a bug.
- **Read `secondaries` and *not* `secondary`.** §1.9 correction 1: in `@pkmn/sim` the singular field is the
  identical object already inside the array, in all 204 cases, so reading both applies 204 riders twice.
  Measured totals: **15 moves inflict a non-volatile status as a primary effect; 141 do it as a rider**
  (brn 47, par 45, psn 28, frz 13, slp 4, tox 4) plus **62 flinch riders**, out of **212 riders**. A status
  system reading only `move.status` covers 15 moves and misses 203. **`frz` has 13 rider applications and zero
  primary ones**, so a freeze mechanic built from `move.status` is dead on arrival — one independent reason to
  fold Frozen into Asleep (§7.7).
- **`ignoreImmunity` is read inverted.** Measured: `true` on **270 of 271** admitted Status moves and on
  exactly **three** damaging moves (`Bide`, `Future Sight`, `Thousand Arrows: {Ground:true}`). It is not an
  exception list; it is the dataset *stating a rule*: **support moves bypass type immunity.** That single
  inversion is the largest balance lever in the dex and it bounds the untouchable-piece problem from data with
  no special case (§7.8).
- **Hazard layer counts come from the move**, not from a designer: Spikes 3, Toxic Spikes 2, Stealth Rock 1,
  Sticky Web 1, and persistence from the *absence* of `condition.duration` (39 such marks).
- **`condition` must be read at all.** §1.9 correction 5: 123 moves carry a `condition` object, and the
  shipped `MoveEntry` schema has no field for it, so today the durations do not exist in the game. `DUR(m)` is
  `m.condition?.duration`, and the mark table's `defaultDur` column is its only consumer.

### 3.3 Passes 3, 4 and 5 — handler derivation

```ts
function deriveC2(e: SimEntry): Partial<Effect>[] {
  return walkHandlers(e).map(({ path, name }) => {                // path: entry|condition|self|secondary
    const { scope, phase, stem } = parseHandlerName(name);        // §1.3; 148/150 parse
    return { when:  TRIGGER_OF_STEM[stem][phase],                 // 81 stems x 5 phases
             where: REGION_2D[path][scope] };                     // §2.4 — 4 x 6, condition defers to the
  });                                                             //   mark table's own `scope` column
}

function deriveC3(src: string): { ops: Op[]; guards: Guard[] } {   // the CALL channel
  const ops: Op[] = [], guards: Guard[] = [];
  for (const { recv, method, args } of extractCalls(src)) {        // 2 845 sites across the dataset
    const mut = MUTATION_TABLE[method];                            // 45 rows -> the 15 measured op families
    if (mut) { ops.push(mut.build(parseArgs(args), recv)); continue; }
    const pred = PREDICATE_TABLE[method];                          // 53 rows -> Guards
    if (pred) { guards.push(pred.build(args)); continue; }
    if (!LOG_TABLE[method] && !PLUMBING_TABLE[method]) report.unclassified.push(method);
  }
  return { ops, guards };
}

function deriveC4(name: string, src: string): { ops: Op[]; guards: Guard[] } {   // the RETURN/ASSIGN channel
  const body = src.slice(src.indexOf('{'));
  const out = { ops: [] as Op[], guards: [] as Guard[] };
  for (const row of RETURN_GRAMMAR)                               // 14 rows, §1.8, keyed on handler name
    if (row.name.test(name)) for (const hit of body.matchAll(row.re)) row.emit(hit, out);
  for (const hit of body.matchAll(ASSIGN_RE))                      // move.X = / *State.X =
    ASSIGN_GRAMMAR[hit[1]]?.(hit, out);
  return out;
}

parseArgs(a) = /^'/.test(a)        ? markOf(literal(a))        // 'flinch', 'spikes', 'raindance'
             : /^\{/.test(a)       ? boostVector(a)            // { atk: 12 }
             : /maxhp\s*\/\s*\d+/.test(a) ? countersOfFraction(a)
             : RUNTIME;                                        // resolved against the Clash context
```

The two `CHART` rows of the return grammar, written out because they are the new ones:

```ts
// RETURN_GRAMMAR rows 9a and 9b — the chart-rewrite class (§1.8 row 9, 7 entries)
{ name: /^onEffectiveness$/, re: /return\s+typeMod\s*\+\s*(?:this\.dex\.getEffectiveness\('(\w+)'|(-?\d+))/,
  emit: (m, out) => out.ops.push(m[1] ? { op:'CHART', union: m[1] as BattleType }
                                      : { op:'CHART', d: Number(m[2]) as -2|-1|1|2 }) },
{ name: /^onEffectiveness$/, re: /return\s+(0|1)\s*;/,
  emit: (m, out) => out.ops.push({ op:'CHART', set: Number(m[1]) as 0|1 }) },
```

**Table budget for the entire back end: 45 mutation rows + 53 predicate rows + 14 return-grammar rows + 6
assignment rows + 81 stem rows + 15 target rows + 24 region-2D cells + 7 region-resolver rows = 245 rows.**
That is the whole hand-written compiler, including the 42 residue rows §1.7 added and the 20 rows pass 5 added.
Compare: **1 797 content entries.** The ratio — **one table row per 7.3 content entries** — is the entire
argument of this document.

### 3.4 Pass 6 — the patch layer and the CI gates

```jsonc
// data/curated/overrides.json  — 125 entries, the WHOLE hand-written content surface
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
  "ironball": {
    "reason": "compiler derives CHART{set:1} from the return; the board wants the state VISIBLE, so the
               grounding is a persistent mark whose `mod` carries the same CHART (see 7.9b)",
    "replace": [{ "when":"ON_ENTER","where":"SELF","ops":[{"op":"MARK","mark":"grounded","dur":"persist"}] },
                { "when":"ALWAYS","where":"SELF","ops":[{"op":"BOOST","d":{"spe":-1}}] }]
  },
  "tintedlens": {
    "reason": "chainModify(2) guarded on typeMod<0 reads as a TILT; the board effect is a WARP",
    "replace": [{ "when":"CLASH_RESULT","where":"SELF","ops":[{"op":"WARP","from":[0],"to":1}] }]
  }
}
```

The generator **fails the build** if:

1. any admitted entry produces no `Effect[]` (**totality**);
2. an override names an entry that no longer exists, **or whose compiler proposal has changed since the
   override was written** (`proposalHash`) — this is how a `@pkmn/dex@0.11` bump surfaces *semantic* drift
   instead of silently keeping a stale patch;
3. an **82nd** handler stem, a **46th** mutation verb, a **15th** return-grammar row, or an unknown
   `isNonstandard` value appears;
4. any op references a `MarkId` outside the generated 165-row mark table;
5. **`INVOKE` appears with `depth !== 1`, or any op named `SUMMON` exists** — gate 5 *is* the termination
   proof, enforced by CI rather than by discipline;
6. the derived share falls below 88% or the curated list exceeds 140 entries (regression gate on §1.6);
7. **the unclassified call-site share exceeds 1%** (currently 0.4% after §1.7's rows);
8. **any handler is classified into neither channel** — i.e. the five-way partition of §1.8 does not sum to
   1 675. This is the gate that would have caught `CHART`: a handler with no call, no matching return-grammar
   row and no assignment is *unexplained*, and the build says so by name.

### 3.5 Bundle budget — measured on the real files, not scaled

**[SUPERSEDES pass 2 §3.5]**, which was explicitly "scaled by size" from another document's measurement. I
re-encoded the repository's own generated bundle. The headline is a problem pass 2 did not report:

**The shipped critical path is 268 KB gzipped, 4.5× the 60 KB gate the design wants** — because
`Dex.load()` (`src/data/dex.ts`, verified) `await Promise.all`s **all five** bundles, learnsets included:

| Shipped bundle | gz | On the critical path today? |
|---|---|---|
| `moves.json` | 76.4 KB | yes |
| `species.json` | 75.1 KB | yes |
| `learnsets.json` | 74.0 KB | **yes** — and it is only needed by the draft |
| `items.json` | 21.4 KB | yes — needed at M4 |
| `abilities.json` | 21.2 KB | yes — needed at M4 |
| `typechart.json` | 0.3 KB | yes |
| **total** | **268.4 KB** | |

Measured decomposition, so the fix is a list rather than a hope:

| Lever | Measured saving (gz) | How |
|---|---|---|
| move `desc` out of the critical path | **26.2 KB** | lazily loaded on "read more"; `shortDesc` (7.8 KB) is enough for a tooltip |
| ability + item `desc` out | **17.7 KB** | same |
| species: base formes only on the critical path | **39 KB** | 1 025 of 1 367 formes; alternates load with the draft |
| species: columnar instead of row-objects | **16.7 KB** | measured: 1 367 rows 75.1 KB → columnar 58.4 KB; base-only columnar with names **25.0 KB**, without names 15.7 KB |
| learnsets off the critical path | **74.0 KB** | a fourth `once()` call the draft awaits; a one-line change to `Dex.load()` |
| moves: compiled `Effect[]` instead of raw fields | **~4 KB net** | measured: move scalars columnar 6.1 KB (9.8 KB with `flags` + `handlers`); 950 packed 20-byte effect records gzip to **1.8 KB** |

The resulting budget, every figure measured rather than estimated:

| Payload | gz | Basis |
|---|---|---|
| `species.bin` — 1 025 base formes, columnar, with names | **25.0 KB** | measured re-encode of the real file |
| `moves.bin` — 950 packed `Effect[]` records | **1.8 KB** | measured on a 20-byte-per-move synthetic pack |
| move ids + names (needed for the ART menu and the log) | **9.9 KB** | measured |
| `typechart.bin` — 18 × 18 `Int8Array` | **0.3 KB** | measured |
| `marks.bin` — 165 rows | **0.6 KB** | measured |
| **M1 critical path** | **37.6 KB** | against a 60 KB gate: 37% headroom |
| + `abilities.bin` + `items.bin` (effect records) | +2.5 KB | |
| + ability/item names + `shortDesc` | +12.0 KB | measured 5.7 + 6.3 |
| **full-content critical path (M4 onward)** | **≈ 52 KB** | |
| lazy: all `desc` strings | 43.9 KB | on demand |
| lazy: the 342 alternate formes | 39 KB | with the draft |
| lazy: learnsets, delta-varint | 43.8 KB | with the draft's Custom toggle only |

Pass 2's ≈49 KB estimate turns out to have been *approximately right for the wrong reason* — it scaled from an
unrelated measurement and happened to land near the real 52 KB. The number that matters is the one it did not
report: **the bundle as shipped today is 5× over, the cause is prose plus eager learnsets, and the fix is four
one-line changes to `dex.ts` plus a columnar emit.** `budget.test.ts` gates it at 60 KB from M0.

---

## 4. Thirty traces, end to end

Each row: the measured dex fields, which channel fired, the emitted `Effect[]`, and the board behaviour. These
are compiler outputs, not illustrations. Traces 28–30 are new this pass and are the `CHART` class.

**1. Earthquake — the spread move.**
`Ground · Physical · bp 100 · acc 100 · pp 10 · target allAdjacent · no handlers` → **C1 only.**
```
[{ when:'ON_ACT', where:'RING1_ALL', ops:[{op:'CLASH'}], power:4, charge:2 }]
```
**Board:** an ART action. The piece does not move; it resolves a Clash against **all 8 neighbours, friend and
foe**, on one die face. The designated primary target uses the full type chart and can produce BACKLASH or a
bonus; splash targets resolve neutral and can never kill the attacker (§7.5 step 9, following `recon-tcg.md`'s
"don't apply Weakness and Resistance for Benched Pokémon"). Ground→Flying is 0×, so Flying neighbours are
simply not in the region — Earthquake reads correctly for free. Power tier 4, so it needs a Charge counter
(§7.9a).

**2. Stealth Rock — the hazard.**
`Rock · Status · target foeSide · sideCondition 'stealthrock' · pp 20 · ignoreImmunity true`; its behaviour is
in `condition.onSideStart` / `condition.onSwitchIn` → **C1 + C2, and it is the trace that proves the 2-D
Region derivation (§2.4).**
```
[{ when:'ON_ACT', where:'FOE_ZONE', ops:[{op:'MARK', mark:STEALTHROCK, layers:1, dur:'persist'}], charge:4 }]
```
**Board:** paints a 3-square segment of the enemy's third rank from their own back rank — **rank 6 for a White
caster, rank 3 for a Black one** (caster's file ± 1, clamped). The mark's generated row carries
`tick: ON_ENTER → MEND(−1) scaled by Rock-vs-defender`: a Flying or Ice piece landing there takes **2
counters** (Rock→Ice is 2×, verified), a Steel piece takes **0**. Persistent until Defog / Rapid Spin / Court
Change. Layer count, persistence and type scaling all come from data. **Note what pass 2's 1-D region
derivation would have done:** `condition.onSwitchIn`'s name scope is `SELF`, so the hazard would have fired on
its own caster. The `condition` row of `REGION_2D` sends it to `MARK_TABLE[stealthrock].scope = 'square'`,
which is the only reading that works.

**3. Extreme Speed — the priority move.**
`Normal · Physical · bp 80 · priority +2 · target normal` → **C1 only.**
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'CLASH'}], power:3, charge:1 },
 { when:'ALWAYS', where:'SELF',  ops:[{op:'TEMPO', kind:'react'}] }]
```
**Board:** may be declared as a **Reaction** when an enemy begins a Clash against this piece: it resolves
first, and if it captures the attacker the attacker's Clash never happens. One charge, at most one Reaction per
piece per enemy turn. Measured pool: **42 moves at priority ≥ +1**, of which **19 are damaging** (these) and
**23 are Status** (Helping Hand, Follow Me, Ally Switch, Quick Guard — a Status Reaction resolves its ops but
cannot capture, §7.9). Pass 2 sized this pool at 21; it is twice that.

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
rung to CRITICAL regardless of matchup, and because it is a `WARP` it is exempt from the Band Cap (§7.5), which
is the correct exemption — an OHKO ignoring the ladder is the point of an OHKO. Draft-restricted to one Ace per
side (§8.3). Sheer Cold's `ohko: 'Ice'` becomes a `guard` that fails against Ice pieces. Four moves, one op,
no bespoke code.

**6. Bullet Seed — the multi-hit.**
`Grass · Physical · bp 25 · multihit [2,5] · pp 30 · flags bullet` → **C1 only.** `flags.bullet ⇒ RAY_LOS`.
```
[{ when:'ON_ACT', where:'RAY_LOS', ops:[{op:'CLASH'},{op:'WARP', reroll:[2,5], keep:'best'}],
   power:1, charge:5 }]
```
**Board:** a ranged attack at Chebyshev ≤ 2 along a ray, first occupied square only. It re-rolls the ladder
`n ∈ [2,5]` times **from the same public triple, walking forward**, and keeps the best rung. That makes
multi-hit the natural counter to a bad face *and* to Protect and Substitute — which is what multi-hit is for.
Skill Link forces `n = max`; Loaded Dice raises the minimum. Measured pool: **31 moves** (pass 2 said 22, the
gen-9 figure).

**7. U-turn — the self-switch.**
`Bug · Physical · bp 70 · selfSwitch true · target normal · no handlers` → **C1 only.**
```
[{ when:'ON_ACT',     where:'MELEE', ops:[{op:'CLASH'}], power:2, charge:4 },
 { when:'ON_CAPTURE', where:'SELF',  ops:[{op:'RELOCATE', to:'origin'}] }]
```
**Board:** capture, then **return to the square you came from** — the exact mechanic `DIRECTION.md` names as
the faithfulness standard, falling out of one boolean field. Tactically enormous: a hit-and-run that never
leaves the attacker on the exposed square. Also clears the rotation-class status marks (§7.7), which is the
games' own switch rule and gives U-turn a second reason to exist.

**8. Swords Dance — the boost.**
`Normal · Status · target self · boosts {atk:+2} · pp 20 · flags dance` → **C1 only.**
```
[{ when:'ON_ACT', where:'SELF', ops:[{op:'BOOST', d:{atk:+2}}], charge:4 }]
```
**Board:** an ART with no relocation. `+2 atk` is **+2 to the Clash roll for physical captures**, which under
the ladder converts a neutral matchup into a bonus-move matchup on a face of 4. Iron Defense (`{def:+2}`) is a
visibly *different* effect because the 7-vector is kept (§12.3). `flags.dance` is what Dancer copies. Note the
Band Cap (§7.5 step 5a) means stacking boosts makes you *reliable*, never *faster*: no amount of Swords Dance
turns a resisted matchup into tempo.

**9. Trick Room — the weird one.**
`Psychic · Status · target all · pseudoWeather 'trickroom' · priority −7 · condition.duration 5 · pp 5` →
**C1 + C2** (the move has no handlers; `condition.onFieldStart` supplies the fingerprint, and its Region comes
from `MARK_TABLE[trickroom].scope = 'board'`).
```
[{ when:'ON_ACT', where:'BOARD', ops:[{op:'MARK', mark:TRICKROOM, dur:5}], charge:1 }]
```
**Board:** `TRICKROOM`'s generated row inverts exactly one comparison — **which moves may Reaction-interrupt.**
Normally `priority ≥ +1` reacts; under Trick Room `priority ≤ −1` reacts instead, so for five turns Counter,
Avalanche, Focus Punch and Circle Throw are the pre-emptors and Quick Attack is not. One mark, one flipped
comparison, and an otherwise-dead archetype (**14 measured negative-priority moves**) becomes live for a
window. It is also the Stadium slot: exactly one field effect exists at a time and a new one replaces the old
(`recon-tcg.md`'s Stadium rule), and **a side may not re-cast the field already in play**, which closes a
permanent-buff repetition hole.

**10. Baton Pass — the state transfer.**
`Normal · Status · target self · selfSwitch 'copyvolatile' · pp 40 · onHit (a switch request, no mutation)`
→ **C1 gives the relocation; the transfer semantics are 1 of the 125 curated rows.**
```
[{ when:'ON_ACT', where:'SELF',
   ops:[{op:'RELOCATE', to:'origin'},
        {op:'MARK', mark:LEGACY, dur:'persist', params:{carry:'boosts+marks', cap:2}}], charge:5 }]
```
**Board:** the piece retreats to its origin square and **leaves its accumulated boosts and marks on the square
it vacated**; the next friendly piece to end a move there picks them up. Bounded: once per piece per game,
transferred boosts capped at +2 total, and the `LEGACY` mark is part of the repetition hash so a
pass-and-repass cycle cannot draw by accident.

**11. Protect — the staller, and the trace that needs `ON_RESTACK`.**
`Normal · Status · target self · volatileStatus 'protect' · priority +4 · stallingMove true ·
condition.duration 1 · onHit: pokemon.addVolatile('stall')`, and the `stall` condition's own
`onStart() { this.effectState.counter = 3; }` plus `onRestart` → **C1 + C3 + C4 (row 14) + `ON_RESTACK`.**
```
[{ when:'ON_ACT',     where:'SELF', ops:[{op:'MARK', mark:PROTECT, dur:1},
                                         {op:'MARK', mark:STALL, data:3}], charge:2 },
 { when:'ON_RESTACK', where:'SELF', ops:[{op:'MARK', mark:STALL, data:'x3'}] }]
```
**Board:** uncapturable for one opponent reply. The `STALL` mark carries **Showdown's own escalation** —
success probability `(1/3)^consecutive`, reset by using any other move — so n consecutive Protects cost `3^n`
and stalling is self-limiting with no rule I had to invent. The `data:3` initialiser is read from
`effectState.counter = 3` (§1.8 row 14) and the tripling is the `ON_RESTACK` row — **without the trigger pass 2
added no escalation at all, and the Protect family becomes an infinite stall.** The six punish variants are six
`ON_SURVIVE` rows in the mark table (Spiky Shield → attacker `MEND(−1)`; Baneful Bunker → `MARK(POISONED)`;
King's Shield → `BOOST({atk:−1})`), i.e. data.

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
`Ghost · Special · bp 80 · flags bullet · secondaries [{chance:20, boosts:{spd:−1}}]` → **C1 only.**
```
[{ when:'ON_ACT',     where:'RAY_LOS', ops:[{op:'CLASH'}], power:3, charge:3 },
 { when:'ON_CAPTURE', where:'TARGET', guard:{coins:'1 of 4'}, ops:[{op:'BOOST', d:{spd:-1}}] }]
```
**Board:** Gengar captures at range 2 along a ray **without moving**, and one time in four the target's guard
drops. This is the largest single archetype — **212 measured riders** — and it is one compiler path. The rider
is a TCG coin flipped *after* commitment, which is legitimate precisely because it can never cost a piece
(§7.5 step 7). Exactly one `Effect` per rider, because `secondary` is not read (§1.9 #1).

**15. Soak — the identity change.**
`Water · Status · acc 100 · target normal · onHit: target.setType('Water')`. **No type-change field exists
anywhere in `@pkmn/dex`, and none in the repo's shipped bundle either** → **C3 only. Invisible to a dex-only
compiler.**
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'BECOME', type:'Water'}], charge:4 }]
```
**Board:** **one of the two highest-leverage effects in the game.** An enemy piece's declared type becomes
Water: you have rewritten its position in the type chart, and therefore what may capture it and what it may
capture. A Steel rook that repelled 10 of 18 attacking types becomes a Water rook that resists 3. Six moves do
this. (The other high-leverage effect is trace 28, and it rewrites the chart rather than the piece.)

**16. Belly Drum — the headline demo.**
`@pkmn/dex` reports **no `boosts` field**; verified, neither does the repo's `moves.json`. C3 extracts both
statements from the source:
```
[{ when:'ON_ACT', where:'SELF', ops:[{op:'MEND', counters:-1}, {op:'BOOST', d:{atk:+12}}], charge:2 }]
```
**Board:** take a damage counter, gain the maximum attack boost (clamped to +6 by the shared `BOOST` clamp) —
"halve your HP, maximise your Attack", correctly, with **zero authoring**. Any design that reads only
`@pkmn/dex` ships this inert.

**17. Rest — the second headline demo.**
`@pkmn/dex` reports **no `status`**. C3 extracts `setStatus('slp')`, C4 row 14 extracts the literal
`statusState.time = 3`, and C3 extracts `heal(maxhp)`:
```
[{ when:'ON_ACT', where:'SELF', ops:[{op:'MARK', mark:ASLEEP, dur:3}, {op:'MEND', counters:+3}], charge:1 }]
```
**Board:** clear every damage counter and fall Asleep for up to three of your own turns — a genuine, legible,
dangerous decision on a chess board, and the duration is a literal in Showdown's source rather than a number I
chose. Rest also has `onTry` returning `false` at full HP (C4 row 3), so the ART is not offered to an undamaged
piece, which is the real rule and stops it being a free nap.

**18. Thousand Arrows — the immunity breaker.**
`Ground · bp 90 · target allAdjacentFoes · volatileStatus 'smackdown' · ignoreImmunity {Ground:true} ·
onEffectiveness` → **C1 + C4 row 9.**
```
[{ when:'ON_ACT',      where:'RING1_FOES', ops:[{op:'CLASH'},{op:'MARK', mark:GROUNDED, dur:'persist'}], power:3 },
 { when:'CLASH_CHART', where:'SELF', guard:{vsType:'Flying'}, ops:[{op:'CHART', set:1}] }]
```
**Board:** the only *damaging* move in the dex with a typed `ignoreImmunity`, and it does exactly what it does
in the games — it hits Flying pieces and grounds them permanently. Note the correction to pass 2, which mapped
this to `PIERCE(['type'])`: piercing would make the capture legal *and leave it reading 0×-shaped*. The source
says `return 0`, i.e. **neutral**, so `CHART{set:1}` is the faithful compile and it is one row of the return
grammar rather than a hand-written special case.

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
`onTryHit: if (target.runEffectiveness(move) <= 0 || !target.runImmunity(move)) return false;` → **C4 row 2
derives it** (a `VETO` whose guard the call channel supplies). But I override the *bound*, per
`recon-tcg.md`, and the override is 3 lines:
```
[{ when:'CLASH_LEGAL', where:'SELF',
   ops:[{op:'VETO', scope:'absolute'}], params:{ unlessRung:'>=2', unlessClass:['pawn','king'] } }]
```
**Board:** Shedinja **cannot be captured by a Queen, Rook, Bishop or Knight**, and **can always be captured by
any Pawn or King**. That is the printed TCG card ("immune to Evolved Pokémon and Pokémon-ex, Basics get
through") and it is Stratego's *always supply the key, over-supplied*: each side has eight pawns and a king.
Permanent, legible, and it makes Shedinja a playable nightmare rather than a ban.

**21. Levitate — the honest curated row.**
**No handlers in `@pkmn/sim`, only `flags.breakable`; verified in the shipped bundle as
`signalClass:"fields"`, which is the bundle claiming a derivability it does not have** (§1.9 #6). Ground
immunity is inside the engine's immunity check. The compiler *knows* it is a defence (from the flag) and
*cannot* know against what, so it emits `coverageClass: 'curated'` with `archetype:'UNDERDETERMINED'`, the
build report lists it, and the curated row supplies:
```
[{ when:'CLASH_LEGAL', where:'NONE', ops:[{op:'VETO', scope:'element'}], params:{type:'Ground', oneShot:true} }]
```
**Board:** the first Ground capture attempted against this piece is illegal and **pops the ward**; the second
succeeds. Air Balloon's real behaviour is the template ("Pops when holder is hit"), so the bound is canon
rather than invented. Five more abilities are in exactly the same position (`Battle Armor`, `Shell Armor`,
`Multitype`, `RKS System`, `Tera Shell`) — a finding `recon-data-substrate.md` predicted for Levitate alone.

**22. Gyro Ball — the variable-power curated row, and why 48 moves are curated.**
`basePowerCallback: floor(25 * target.getStat('spe') / pokemon.getStat('spe')) + 1`. The compiler reads the
function perfectly; it cannot decide what Speed means on a board where nothing has a Speed stat. So:
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'CLASH'},
    {op:'TILT', scope:'atk', d:'+1 when the defender has more spe boosts than me'}], power:3, charge:1 }]
```
**Board:** a tier-3 melee capture with a +1 when the target is the faster piece. A Pokémon expert will notice
it is an approximation; that is the honest cost, it is 48 moves of 950 (measured: **53 `basePowerCallback` and
11 `damageCallback` functions**), and each is one line.

**23. Screech — the trace that found a bug in an earlier resolver.**
`Normal · Status · bp 0 · acc 85 · pp 40 · target normal · boosts {def:−2} · ignoreImmunity true ·
flags protect/reflectable/mirror/sound/bypasssub/allyanim/metronome · no handlers` → **C1 only.**
```
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'BOOST', d:{def:-2}}], charge:5, tilt:-1 }]
```
**Board:** an ART that lowers an *enemy* piece's defensive Clash roll by 2 for the rest of the game (boosts do
not decay). Because it is a Status move, `ignoreImmunity` is true, so **you may Screech the Ghost piece your
Normal army cannot touch**, and then a *different* piece kills it. Pass 1's resolver folded the defender's
contribution in with a `min()` clamp that made a negative guard unable to raise the rung, silently inerting all
**31 measured foe-defence-lowering moves** (`Screech, Metal Sound, Leer, Tail Whip, Tickle, Fake Tears, Acid
Spray, Crunch, Shadow Ball, Psychic, Focus Blast, Flash Cannon, Energy Ball, Earth Power, Bug Buzz, Iron Tail,
Liquidation, Razor Shell, Crush Claw, Rock Smash, Apple Acid, Grav Apple, Fire Lash, Lumina Crash, Luster
Purge, Seed Flare, Shadow Bone, Spicy Extract, Thunderous Kick, Triple Arrows, Acid`). Pass 2 fixed it with
the `deficit`/`guard` split, which I keep verbatim (§7.5 step 2) and re-verified: the count is 31.

**24. Choice Band — the item whose cost is the interesting half.**
`isChoice: true · fling {basePower:10} · onStart / onModifyMove / onModifyAtk`, and the source is
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
rather than designed. Choice Specs is the same two effects on the special side; Choice Scarf trades the `TILT`
for `BOOST({spe:+2})`. All three are illegal on King and Queen (§8.3).

**25. Focus Sash — the survive-once ward, and the exploit it must not enable.**
No `isBerry`, no taxonomy field but `fling`. One handler, and the source *is* the specification (C4 row 8):
```js
onDamage(damage, target, source, effect) {
  if (target.hp === target.maxhp && damage >= target.hp && effect && effect.effectType === 'Move') {
    if (target.useItem()) return target.hp - 1;   //  WARP(any-lethal -> survive), then consume
  }
}
```
```
[{ when:'CLASH_RESULT', where:'SELF', guard:{pristine:true},
   ops:[{op:'WARP', from:[1,2,3], to:-1, once:true}, {op:'EQUIP', item:null, consume:true}] }]
```
**Board:** the first capture that would remove this **pristine** piece is downgraded to REPELLED — the attacker
bounces back to its origin and the Sash shatters visibly. `target.hp === target.maxhp` maps exactly onto
`pristine` (zero damage counters and never yet marked), so the trigger is the real one, not an analogue.

**The `from:[1,2,3]` is the load-bearing detail and it is a balance rule, not a transcription.** Rung 0 —
BACKLASH — is deliberately *not* in the `from` set. Were it included, a Sash pawn could attack a Queen at 0.5×,
survive its own backlash, and take the Queen for free: the single worst exploit in the design space. The rule,
stated once and applied to every survive-once effect (Sturdy, Sash, Endure, Tera Shell): **a shield protects
you from being killed; it does not protect you from killing yourself.** Rock Head is the one named exception,
and it is authentic — Rock Head's entire job in the games is to ignore recoil.

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
exactly what Fake Out is in the games. It is also the cheapest demonstration of why `STUNNED` unifies paralysis
and flinch (§7.7): **45 par riders + 62 flinch riders = 107 measured applications, one rule, one visual — the
pin rotates 90°.**

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

**28. Freeze-Dry — the trace that added an op, and the most on-thesis move in the dex. (NEW)**
`Ice · Special · bp 70 · acc 100 · pp 20 · target normal · handlers ['onEffectiveness']`. There is **no field
anywhere** that says this beats Water; the whole semantics is `if (type === 'Water') return 1;` → **C4 row 9.**
```
[{ when:'ON_ACT',      where:'MELEE', ops:[{op:'CLASH'}], power:2, charge:4 },
 { when:'CLASH_CHART', where:'SELF', guard:{vsType:'Water'}, ops:[{op:'CHART', d:+1}] }]
```
**Board:** an Ice piece attacking a Water piece normally reads Ice→Water = **0.5×**, `rung0 = 0`, whose modal
outcome is **BACKLASH — both pieces die**. With Freeze-Dry in a slot, that same attack reads **2×**,
`rung0 = 2`, whose modal outcome is **SURGE — capture and move again**. One move flips the worst matchup on
the board into the best one, and it flips it **for one specific slot against one specific type**, which is
precisely how a coverage move works in Pokémon.

Why this is the trace that justifies the 19th op, in one comparison: as a `TILT(+2)` — which is what pass 2's
17-row return table would have produced from `return 1` — the attack stays at `rung0 = 0` and the *best*
outcome the ladder can reach from there is CLEAN (§7.5 step 5a). The Ice piece would still never earn tempo
against Water, and on three of six faces it would still die. As a `CHART`, it is what the move is.

Measured, this is not a one-species curio: **23 species learn Freeze-Dry**, including **Lapras** — which is
the video's own worked example of the one-type draft decision (`BRIEF.md` §2 rule 2 names Lapras explicitly).
So the draft question "Lapras as Water or as Ice?" acquires a real second-order answer: taken as **Ice**, its
defensive profile is the worst on the board (`ARM = 0.324`, §9.1) but Freeze-Dry answers the type that would
otherwise farm it. That is a genuine, discoverable, dataset-derived draft interaction that no one designed.

**29. Flying Press — the chart union. (NEW)**
`Fighting · Physical · bp 100 · target any · handlers ['onEffectiveness'] + basePowerCallback` → **C4 row 9
gives the chart union; the tier stays curated.**
```
[{ when:'ON_ACT',      where:'RAY_ANY', ops:[{op:'CLASH'}], power:4, charge:2 },
 { when:'CLASH_CHART', where:'SELF', ops:[{op:'CHART', union:'Flying'}] }]
```
**Board:** the attack is read as Fighting **and** Flying at once, multiplying both chart rows. Verified:
against Grass, 1 × 2 = **2×**; against Steel, 2 × 0.5 = **1×**; against Ghost, 0 × 1 = **0×** (still illegal).
A single move that changes *which column of the chart you are in* is the most interesting thing a coverage slot
can do, and `{union}` is one field of one op. It is also `target: 'any'` and therefore `RAY_ANY` — a
blocker-ignoring ranged attack at Chebyshev ≤ 3, which is the correct flavour for a move whose animation is
literally a flying body slam.

**30. Tar Shot and Iron Ball — a chart edit that lives on the defender. (NEW)**
Tar Shot: `Rock · Status · target normal · volatileStatus 'tarshot' · pp 15`, whose *condition* carries
`onEffectiveness(typeMod, target, type, move) { if (move.type !== 'Fire') return; … return typeMod + 1; }` →
**C1 for the mark, C4 row 9 for the mark's `mod`, and the 2-D Region derivation (§2.4) to know it lives on the
marked piece.**
```
// the move
[{ when:'ON_ACT', where:'MELEE', ops:[{op:'MARK', mark:TARSHOT, dur:'persist'}], charge:3 }]
// MARK_TABLE[TARSHOT].mod, generated
[{ op:'CHART', d:+1 }]  with guard { atkType:['Fire'] }
```
**Board:** you spend a turn painting an enemy piece, and thereafter **every Fire piece on your side attacks it
one band better** — for the rest of the game, and visibly, because the mark renders as a black smear on the
pin. Against a Grass piece (Fire→Grass already 2×) it is wasted; against a **Water** piece (Fire→Water 0.5×,
BACKLASH) it converts your Fire army from suicide attackers into clean capturers. That is a *team* play in a
game that otherwise struggles to have any, and it is one mark plus one op.

Iron Ball is the same shape read from the other side: `onEffectiveness → return 0` for Ground into Flying, i.e.
`CHART{set:1}`. Curated (1 of the 3 items added this pass) because the compiler's literal reading is an
invisible per-Clash rewrite, and the board wants the state on the piece: the item compiles to a persistent
`grounded` **mark** carrying the same `CHART{set:1}` in its `mod`, plus `BOOST({spe:−1})` for the real item's
movement cost. Same semantics, visible.
---

## 5. The same vocabulary is the ability system and the item system

This is the payoff. **An ability is an `Effect[]` with a non-`ON_ACT` trigger. An item is an `Effect[]` with a
consumption counter and a transfer rule.** There is no ability system and no item system — there is one effect
system with three sources. Measured: **45 of the 150 handler names appear on all three kinds**, which is the
empirical evidence that they *are* the same thing.

### 5.1 Abilities

| Ability | Channel | Emitted `Effect[]` | Board behaviour |
|---|---|---|---|
| **Rough Skin** (6 species) | C3: `damage(source.baseMaxhp/8)` + `checkMoveMakesContact` | `{ON_SURVIVE, TARGET, guard:{contact}, [MEND(−1)]}` | whatever captures it by contact takes a damage counter |
| **Static** (33) | C3: `trySetStatus('par')` + `randomChance(3,10)` | `{ON_SURVIVE, TARGET, guard:{contact, coins:'1 of 4'}, [MARK(STUNNED)]}` | the contact capturer loses its next activation |
| **Intimidate** (46) | C3: `boost({atk:-1})`, scope `Foe` | `{ON_ENTER, RING1_FOES, [BOOST({atk:-1})]}` | arriving lowers adjacent enemies' Clash rolls |
| **Moxie** (16) | C3: `boost({atk: length})` at `onSourceAfterFaint` | `{ON_CAPTURE, SELF, [BOOST({atk:+1})]}` | snowballs on every capture, clamped +6 |
| **Sturdy** (48) | **C4 row 8**: `onDamage → return target.hp - 1` | `{CLASH_RESULT, SELF, guard:{pristine}, [WARP([1,2,3]→−1, once)]}` | the first capture that would take it fails; the attacker stays put |
| **Thick Fat** (33) | C3: `chainModify(0.5)` + type guard | `{CLASH_ROLL, SELF, guard:{atkType:[Fire,Ice]}, [TILT(def,+2)]}` | +2 defensive roll against Fire and Ice |
| **Mold Breaker** (26) | **C4 row 13**: `move.ignoreAbility = true` | `{CLASH_LEGAL, SELF, [PIERCE(['element','class','absolute'])]}` | its captures ignore all 81 `flags.breakable` defences |
| **Protean** (7) | C3: `setType(move.type)` | `{CLASH_LEGAL, SELF, guard:{oncePerGame}, [BECOME({type:'move'})]}` | once per game, becomes the type of the move it uses, then locked |
| **Drizzle** (3) | C3: `this.field.setWeather('raindance')` | `{ON_ENTER, BOARD, [MARK(RAIN, dur:5)]}` | takes the single Stadium slot for 5 turns |
| **Regenerator** (27) | C3: `heal(baseMaxhp/3)` at `onSwitchOut` | `{ON_EXIT, SELF, [MEND(+1)]}` | heals a counter whenever it moves away |
| **Speed Boost** (14) | C3: `boost({spe:1})` at `onResidual` | `{ON_CHECKUP, SELF, guard:{noActionThisTurn}, [CHARGE('all', +1)]}` | +1 Charge per patient turn (§7.9a) — *literally* reward for patience |
| **Magic Guard** (10) | **C4 row 8**: `onDamage → return false` for non-move effects | `{CLASH_LEGAL, SELF, [VETO('indirect')]}` | immune to hazards, weather, status ticks, thorns |
| **Clear Body** (19) + 5 more | **C4 row 6**: `onTryBoost → delete boost[stat]` | `{ON_TAG, SELF, [VETO('boost')]}` | its Clash rolls cannot be lowered by enemy debuffs — the 31 Screech-class moves bounce off it |
| **Comatose / Immunity / Limber / Insomnia** (10) | **C4 row 4**: `onSetStatus → return false` | `{ON_TAG, SELF, [VETO('mark')], params:{marks}}` | immune to the named status marks |
| **Overcoat / Magma Armor / Sand Veil** (13) | **C4 row 5**: `onImmunity → return false` for `'sandstorm'` | `{ON_TAG, SELF, [VETO('indirect')], params:{weather}}` | ignores the named weather's chip |
| **Super Luck / Sniper** (2) | **C4 row 7**: `onModifyCritRatio → return critRatio + 1` | `{CLASH_ROLL, SELF, [TILT('crit-window', +1)]}` | **raises the Band Cap** — the only way a neutral matchup reaches CRITICAL (§7.5 step 5a) |
| **Tinted Lens** (13) | C3 reads `chainModify(2)`; **curated** because the board effect is a `WARP` | `{CLASH_RESULT, SELF(attacker), [WARP([0]→1)]}` | its resisted captures no longer kill it — the named anti-suicide tech |
| **Rock Head** (24) | **C4 row 8**: `onDamage → return null` for recoil | `{CLASH_RESULT, SELF(defender), [WARP([0]→1)]}` | the single named exception that survives BACKLASH |
| **Disguise / Ice Face** (6) | **C4 row 9**: `onEffectiveness → return 0`; **curated** for the rung | `{CLASH_CHART, SELF, guard:{pristine}, [CHART(set:1)]}` + `{CLASH_RESULT, SELF, [WARP([1,2,3]→−1, once)]}` | the first hit is read as neutral *and* fails; the disguise visibly breaks |
| **Shadow Tag** (6) | C3: `tryTrap` (§1.7's correction) | `{CLASH_LEGAL, KING_RING, [VETO('bind')], params:{exceptKing:true}}` | adjacent enemies may not move *away*; **never binds the enemy King** |
| **Sticky Hold** (12) | **C4 row 1**: `onTakeItem → return false` | `{CLASH_LEGAL, SELF, [VETO('item-theft')]}` | its item cannot be stolen or knocked off — one of **98** handlers in this class |
| **Frisk / Forewarn / Anticipation** (62) | log-only (3 of the 181) | `{ON_ENTER, NONE, [REVEAL('item'/'slots'/'threats')]}` | permanent board-analysis affordances: highlight what can legally capture this piece |
| **Run Away** (36) | inert by design | `[]` + real `shortDesc` + "flavour only" badge | **refunds 1 draft point**, so it is a bargain rather than a trap |

Note what did **not** need building: no ability hook interface, no ability registry, **no 115 primitive
functions**. `recon-abilities-items.md` costs ~1 700 LOC there; my ability layer is **0 LOC plus 45 JSON rows**,
because the ops already exist for the move layer. Note also that **six of the rows above are derived by C4 and
only C4** — Sturdy, Clear Body's family, the status-immunity family, the weather-immunity family, Super Luck's
family and Magic Guard. Pass 2 lists five of those six as *curated*; they are derived, and the reason is
§1.8's 14 rows.

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
| **Focus Sash** | **C4 row 8** | `{CLASH_RESULT, SELF, guard:{pristine}, [WARP([1,2,3]→−1, once), consume]}` |
| **Air Balloon** | C3 (`target.item=''`) + C4 row 2 | `{CLASH_LEGAL, SELF, [VETO('element'), consume], params:{Ground}}` — **the template for every ward** |
| **Ring Target** | curated (no handler at all) | `{CLASH_LEGAL, SELF, [PIERCE(['type'])]}` — inverted: it pierces *its own holder's* immunities. The immunity breaker the format guarantees |
| **Iron Ball** | **C4 row 9**, curated for visibility | `{ON_ENTER, SELF, [MARK(GROUNDED,'persist')]}` + `{ALWAYS, SELF, [BOOST({spe:−1})]}`; the mark's `mod` is `CHART{set:1}` vs Ground (trace 30) |
| **Rocky Helmet** | C3: `damage(baseMaxhp/6)` at `onDamagingHit` | `{ON_SURVIVE, TARGET, guard:{contact}, [MEND(−1)]}` |
| **Choice Band** | C1 `isChoice` + C3 `chainModify(1.5)` + `addVolatile('choicelock')` | `{CLASH_ROLL,SELF,[TILT(atk,+1)]}` and `{ON_ACT, SELF, [MARK(CHOICELOCK), TEMPO('lock-slot')]}` |
| **Choice Scarf** | same, `onModifySpe` | `{ALWAYS, SELF, [BOOST({spe:+2}), MARK(CHOICELOCK)]}` — illegal on King and Queen (§8.3) |
| **Eviolite** | C1 name + C3 `chainModify(1.5)` guarded on `baseSpecies.nfe` | `{CLASH_ROLL, SELF, guard:{nfe}, [TILT(def,+1)]}` |
| **Expert Belt** | C3: `chainModify` guarded on `typeMod > 0` | `{CLASH_ROLL, SELF, guard:{superEffective}, [TILT(atk,+1)]}` — it literally pays you for knowing the chart |
| **Weakness Policy** | C1 `boosts:{atk:2,spa:2}` + C3 `useItem()` | `{ON_SURVIVE, SELF, guard:{superEffective}, [BOOST({atk:+2,spa:+2}), consume]}` |
| **Scope Lens / Razor Claw / Leek / Lucky Punch** | **C4 row 7**: `return critRatio + 1` | `{CLASH_ROLL, SELF, [TILT('crit-window', +1)]}` — an op pass 2 declared and never read |
| **Quick Claw** | C3: `onFractionalPriority` + `randomChance(1,5)`; **C4 row 10** for the return | `{ALWAYS, SELF, guard:{coins:'1 of 4'}, [TEMPO('react')]}` — **the coin is revealed in the Checkup before your turn**, never after you commit |
| **All 47 Mega Stones, 34 Plates, 17 Memories, Griseous Orb** | **C4 row 1**: `onTakeItem → return !item.megaStone?.[…]` | `{CLASH_LEGAL, SELF, [VETO('item-theft')]}` — 98 handlers, one grammar row |
| **Draco Plate** + 61 `forcedForme`/`onPlate`/`onMemory`/`onDrive` | **C1 alone — the field carries the type** | `{ALWAYS, SELF, [BECOME({type:'Dragon'})]}` |
| **Venusaurite** + 46 real Mega Stones | **C1 alone — `megaStone` names the exact target forme** | `{ON_PROMOTE, SELF, [BECOME({forme:'Venusaur-Mega'})]}` |
| **TR00–TR99** (100) | excluded class | `[]` — reused as the icon set for the signature-move picker |

Re-verified on the shipped bundle: **531 of 536 items carry at least one machine-readable taxonomy field** —
`fling` 443, `itemUser` 108, `isBerry` 77, `naturalGift` 77, `forcedForme` 61, `megaStone` 47, `zMove` 35,
`onPlate` 34, `isPokeball` 28, `isGem` 18, `onMemory` 17, `onDrive` 4, `isChoice` 3 — and **all 77 berries carry
`naturalGift.type`**, which *is* the resisted type for every resist berry. Only **5 items in the entire dex**
carry no structured signal whatsoever.

### 5.3 The item economy: Format Kits

Choosing any of ~350 held items for each of 16 pieces is `350^16` and paralysing. Instead, **a format declares
a Kit: an ordered list of 12 items, and each side gets one of each.** 16 pieces, 12 items ⇒ four pieces hold
nothing. That one constraint caps the state space, forces real allocation decisions ("who gets the Sash?"),
guarantees both sides face the same toolbox, and makes the item layer *learnable* — a returning player already
knows every item on the board. I adopt `recon-abilities-items.md` §4.3's **Standard 12** verbatim, including
**Ring Target in slot 7**, because a format must guarantee each side ends the draft with an immunity breaker:

| slot | item | teaches |
|---|---|---|
| 1 | Leftovers | counter regeneration |
| 2 | Life Orb | counters as a cost, and it self-limits capture chains |
| 3 | Focus Sash | `pristine` and survive-once |
| 4 | Rocky Helmet | attacking is not free |
| 5 | Choice Scarf | lock-in trade-offs and movement |
| 6 | Air Balloon | one-shot wards, the template for all immunity |
| 7 | **Ring Target** | **immunity is beatable** — the answer to hard problem 6 |
| 8 | Expert Belt | it pays you for knowing the chart |
| 9 | Eviolite | drafting un-evolved pieces; legality from `species.nfe` |
| 10 | Sitrus Berry | consumables |
| 11 | Occa Berry (player picks the type) | type-resist tech; params from `naturalGift.type` |
| 12 | Heavy-Duty Boots | the hazard layer |

Later formats swap the Kit wholesale (Weather Kit; Signature Kit of 12 `itemUser`-locked items where you must
draft their owners; a **Chart Kit** of Iron Ball, Ring Target, Safety Goggles and the type lenses, which is the
format that makes §7.9b's chart layer the centrepiece). That is how the other ~340 admitted items enter play —
**as formats, not as an inventory screen.** Nothing is missing; it is queued, and the compiler already emitted
all of it.

Items are **destroyed on capture** (looting makes every capture a resource decision on top of a chess decision
and lets the winner snowball). Theft is confined to Magician and Pickpocket, countered by the 98-handler
`VETO('item-theft')` class, plus the Knock Off / Trick / Thief move layer. Abilities and items are **public,
always, both sides** — `recon-tcg.md` is right that this is not a cost but the design: the TCG puts every
persistent effect face-up and confines hidden information to the hand. Our analogues of the hand are the draft
and the charge budget. `Illusion` is the single sanctioned exception (it renders as a decoy species until its
first Clash).

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

  return [];   // ability/item: coverageClass 'inert' + real shortDesc as tooltip
               //             + a visible "flavour only" badge + 1 draft point refunded
}
```

Three guarantees:

1. **No content is ever a no-op a player mistakes for a bug.** A damaging move is always at least an ordinary
   capture at a real strength tier; an unclassified Status move is always a small visible self-buff. Splash,
   Celebrate, Happy Hour and Teatime land here and that is the *right* answer — Splash should do nothing.
2. **The fallback is legal-and-boring by construction, never illegal-or-broken.** It emits only `CLASH` or
   `BOOST`, so unclassified content cannot corrupt state.
3. **Inert content is honest rather than hidden**, and it *refunds draft budget*, which is also how `Truant`
   and `Slow Start` stop being traps: Slaking becomes a bargain with a drawback rather than an undraftable joke.

**The test that makes the coverage claim auditable rather than asserted.** This is the single most valuable
test in the project:

```ts
// src/data/coverage.test.ts
const report = loadCompileReport();                      // emitted by tools/compile
test('every admitted entry compiles to a legal effect list', () => {
  for (const e of ALL_ADMITTED) {                        // 1797 entries
    const fx = compiled(e.id);
    expect(fx, e.id).toBeDefined();                                          // totality
    expect(['C1','C2','C3','C4','curated','inert']).toContain(e.coverageClass);
    if (e.coverageClass === 'inert') expect(INERT_ALLOWLIST).toContain(e.id); // 68, named
    if (e.signalClass === 'fields' && !e.handlers?.length)                    // §1.9 #6
      expect(CURATED_ALLOWLIST).toContain(e.id);        // flags-only must never claim derivability
    for (const f of fx) {
      expect(TRIGGERS).toContain(f.when);
      expect(REGIONS).toContain(f.where);
      for (const op of f.ops) {
        expect(OPS).toContain(op.op);
        if (op.op === 'INVOKE') expect(op.depth).toBe(1);                    // termination
        if (op.op === 'MARK')   expect(op.mark).toBeLessThan(MARK_TABLE.length);  // 165
        expect(op.op).not.toBe('SUMMON');                                    // monovariant
      }
    }
    if (e.kind === 'move' && e.category !== 'Status')
      expect(fx.some(f => f.ops.some(o => o.op === 'CLASH')), e.id).toBe(true);
  }
  expect(report.derivedShare).toBeGreaterThan(0.88);              // regression gate on §1.6
  expect(report.curated.length).toBeLessThanOrEqual(140);
  expect(report.unclassifiedSiteShare).toBeLessThanOrEqual(0.01); // gate 7
  expect(report.stems.length).toBeLessThanOrEqual(81);            // gate 3 — an 82nd stem fails the build
  expect(report.mutationVerbs.length).toBeLessThanOrEqual(45);    // gate 3 — a 46th verb fails the build
  expect(report.returnRows.length).toBeLessThanOrEqual(14);       // gate 3 — §1.8's grammar is closed
  expect(report.handlersExplained).toBe(1675);                    // gate 8 — the partition must sum
});
```

Gate 8 is the one that matters most, and it is new: **it is the gate that would have caught `CHART`.** A
handler that calls nothing, matches no return-grammar row and assigns nothing is *unexplained*, and the build
prints its name. Pass 2 had no such gate, which is why seven `onEffectiveness` handlers were silently absorbed
into a `TILT`.

---

## 7. The rules of Pokémon Chess — a thin layer over the ISA

Everything above is Pokémon. Everything below is chess, and it touches the ISA only through `CLASH`, `CHART`,
`TILT`, `VETO`, `PIERCE`, `WARP` and `TEMPO`. The rules module imports exactly two Pokémon concepts: `TypeId`
and the 18 × 18 chart.

### 7.1 Board, army, setup

Standard 8 × 8 board, standard chess geometry, standard starting squares, from the existing
`src/engine/board.ts` (which already exports `STARTING_SQUARES`, `STANDARD_ARMY = {pawn:8, knight:2, bishop:2,
rook:2, queen:1, king:1}`, `RAYS`, `KNIGHT_MOVES`, `KING_MOVES`, `BETWEEN` and `reachableSquares`).
**A legal army is 16 pieces: 1 King, 1 Queen, 2 Rooks, 2 Bishops, 2 Knights, 8 Pawns.** Castling, en passant
and the two-square pawn advance are all present and unchanged, deliberately: a chess player's entire existing
knowledge transfers, and `chess.js` remains a valid differential-test oracle for the movement layer (§13.4).

Each piece declares **exactly one type** at draft, chosen from its real `species.types` (Nidoking = Poison,
Slowking = Psychic, Lapras = Water *or* Ice — the player picks). **Stellar is excluded**: measured, it has 0
species and is 1× against everything both ways, so it would be a strictly dominant defensive declaration; the
shipped `typechart.ts` already gets this right, exporting `DRAFTABLE_TYPES = BATTLE_TYPES` (18). The working
chart is **18 × 18 = 324 ordered pairs**: measured **8 immune (2.5%), 61 resisted (18.8%), 204 neutral
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
in Pokémon, and the video's "one type only" rule is preserved *where it is load-bearing* — on defence, which is
what makes a piece's identity legible to the opponent.

**§7.9b is the second-order version of the same idea**, and it is why the chart layer matters: a coverage slot
changes *which row* of the chart you attack from, and a `CHART` move changes *the cell itself*. Freeze-Dry on an
Ice piece is not a fourth attacking type — it is the Ice row, edited.

Consequences, all deliberate:
- The auto-picker (§8.6) **must** produce a same-type melee move for slot 0; if the species has none, the
  18 × 6 type-kit table supplies one. This is checked at build time for all 1 367 formes.
- `recon-abilities-items.md` §8's open question 1 is answered: **slot 0 is *the* signature move** for
  flag-keyed abilities (`Iron Fist`, `Bulletproof`, `Punk Rock`, `Long Reach`, `Sharpness`); a charged slot
  supplies its own flags when it is the slot being used.
- The UI obligation is absolute: the ART menu shows each slot's type chip and, against the hovered target, its
  exact outcome (§10.4) **including any `CHART` rewrite that slot carries** — a Freeze-Dry slot must annotate
  Water pieces with a gold star, or the whole mechanic is invisible.

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
                               (unless an op relocates it). Spends 1 slot charge. Requires counters <= 1,
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
               -> mark durations decrement, expire at 0 (firing ON_EXIT)
               -> SCHEDULE entries whose delay hit 0 fire
               -> SIMULTANEOUS removal of every piece at 3 damage counters

 4. CLOSE    progress accounting (§7.11); push the repetition hash; test terminal conditions
             toMove := the other side
```

Two clauses in step 2 matter especially:

- **`if some piece not in acted has a legal action`.** Without it, a SURGE by the last mobile piece grants a
  bonus sub-move that the baton rule (T2) makes unusable, and the turn loop offers the player a phase with
  exactly one legal action (`DECLINE`). That is a UI dead end that reads as a bug. Now the bonus is simply not
  granted, and the `clash` event says why.
- **`a NEW exposure`.** See §7.12 R5.

**Where do "Pokémon moves" fit relative to chess?** The answer that makes this work: **the ordinary chess
capture already *is* a Pokémon move.** Capturing means using your Melee slot — no charge, no extra decision, no
tax on chess. The additions are the charged ART actions, and each costs your whole turn. A ranged ART
(`RAY_LOS`/`RAY_ANY`) buys the genuinely new power — capture without occupying the square — and pays a turn and
a charge for it.

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
> before any decision in that turn. Coins are flipped after commitment only for riders, which can never remove
> a piece on the turn they are flipped.**

| Instrument | When | What it can decide | Canon |
|---|---|---|---|
| **Tempo Roll** — three public d6 faces at turn start | before every decision | the Clash ladder for each of the turn's up to three sub-moves | the video's d6, moved *before* the decision as every surviving dice-chess variant does |
| **Rider coin** — 1–4 coin flips, after commitment | after a capture resolves | applying a status mark, a boost, or one damage counter | the TCG: 397 of 433 coin-flip attacks in the current era gate only a rider |
| **Seeded selection** | at resolution, shown before it applies | Metronome's move, a `RANDOM_FOE` target, Quick Claw's pre-emption (revealed in the Checkup *before* your turn) | Showdown's own `sample`/`randomChance` |

Rider chances are snapped to the TCG's alphabet of powers of one half. Measured over all 950 admitted moves,
**212 riders** (§1.9 #1) in these buckets: `100% → 63, 30% → 55, 10% → 53, 20% → 23, 50% → 14, 40% → 3,
70% → 1`. The snap is `{1 → always, 0.7–0.5 → 1 coin, 0.4–0.25 → 1 of 4, 0.2–0.1 → 1 of 8}`, presented as
"flip a coin", "flip two coins, both heads", "flip three coins".

**Exactly what happens to the video's two die rules.** `BRIEF.md` §2 rule 4 is "6 = critical hit ⇒ capture and
move again; 1 = miss ⇒ the attack fails and both pieces die". The ladder is a *generalisation* of that die, not
a replacement:

| The video's rule | Under the ladder | Status |
|---|---|---|
| **6 ⇒ capture and move again** | face 6 moves you up one band. On a **neutral** matchup that is exactly SURGE (capture + move again); on a **super-effective** matchup it is CRITICAL. That covers **255 of the 316 legal ordered type pairs**. | **kept, verbatim, for 81% of pairs** |
| 6 on a **resisted** matchup | CLEAN — you capture and *survive*, but you earn no tempo. | **deliberately withheld.** A resisted attacker must never earn tempo, because "type knowledge is the only reliable route to tempo" is the pillar the whole design rests on. **The Band Cap (§7.5 step 5a) is what actually enforces this**; pass 2 stated the rule and its arithmetic contradicted it |
| **1 ⇒ the attack fails and both pieces die** | face 1 moves you down two bands. On neutral and resisted matchups that is REPELLED: the attacker bounces back to its origin with a damage counter and **the defender lives**. | **deliberately corrected**, and this is a fix to a **bug in the source**, not a deviation from its soul. As filmed, a "miss" still killed the defender, so *every legal capture removed its target unconditionally* and defending a piece deterred nothing at all — Rifle Chess's documented failure mode, "it is of no use to guard pieces". A missed attack that kills its target is not a miss. |
| 1 on a **super-effective** matchup | BACKLASH — both pieces die. | **kept**: the video's most dramatic outcome survives exactly where it is most dramatic, on the attack you were confident about. |

Three consequences worth naming:

1. **Protection becomes a real concept** — the single biggest structural improvement over the filmed ruleset.
2. **`recon-variants.md`'s biggest measured lever is taken in full** (≈ 5× on σ_dice at equal rate), and
   `recon-tech.md`'s measurement says the same choice makes the AI ~150× cheaper: full chance-node enumeration
   costs 121–159× at depth 6, while input randomness costs **+10%**.
3. **Because all of a turn's dice are public, resolution is deterministic *within* a turn.** That is what makes
   the suicide guard in §7.12 R3 an exactly computable predicate instead of a probabilistic fudge — and it is
   the single cleanest fix for the on-camera bug.

### 7.5 The Clash — capture resolution, every case

One resolver, ~130 lines, the only place in the codebase where an outcome is decided. The stage order is the
**TCG's printed pipeline**: attacker bonuses → type modifier → defender reductions, and **defender hooks may
only ever lower the outcome**. This is a direct correction to `recon-abilities-items.md` §2.4, which sums both
sides into one roll and lets a defensive bonus silently erase a super-effective reading.

```
CLASH(A: attacker, D: defender, slot, face):

 0. CONFUSION BRAKE   (on the ATTACKER; the only post-commitment coin that can cost tempo)
      if A has the Confused mark:
           flip a coin (rng);  tails -> no capture, A does not move, THE TURN ENDS IMMEDIATELY
      // It can cost you your turn but never a piece, so it is inside the §7.4 rule.

 1. LEGALITY   (booleans only; no dice)
      t   := slot === 0 ? A.declaredType : moveTypeOf(A.slots[slot])
      vetoes  := run(CLASH_LEGAL, D) ++ run(CLASH_LEGAL, board)   // Levitate, Air Balloon, Wonder Guard,
                                                                  //   Protect, Disguise, BIND, Sticky Hold
      pierces := run(CLASH_LEGAL, A)                              // Mold Breaker, Scrappy, Ring Target,
                                                                  //   Thousand Arrows, Infiltrator
      live := vetoes \ pierces

 1b. THE CHART READING   (the new stage; still no dice)
      m := chart[t][D.declaredType]                               //  0 | 0.5 | 1 | 2
      // log2 domain, because that is what onEffectiveness speaks: -1 = 0.5x, 0 = 1x, +1 = 2x
      lg := m === 0 ? IMMUNE : log2(m)
      for each CHART op in run(CLASH_CHART, A) ++ run(CLASH_CHART, D):
           if op.union: lg := lg + log2(chart[op.union][D.declaredType])   // Flying Press
           if op.set  != null: lg := op.set - 1                            // Iron Ball, Thousand Arrows
           if op.d    != null: lg := (lg === IMMUNE ? IMMUNE : lg + op.d)  // Freeze-Dry, Tar Shot
      m := lg === IMMUNE ? 0 : clamp(2^lg, 0.25, 4)
      // CHART is deliberately NOT an immunity breaker: a d-form CHART on an immune pair stays immune, which
      // is Showdown's own behaviour (Freeze-Dry does not hit a Ghost with a Normal move). Only `set` and
      // PIERCE cross 0x, and both say so explicitly.
      if m === 0 and D is a King:  m := 0.5                       // R6: a King is never unreachable.
      if m === 0:  live += 'type'
      if live is non-empty:
           if every live veto is one-shot:  consume them; A's action is spent; return REPELLED_WARD
           else:                            THE MOVE IS NOT GENERATED  (never offered, searched or animated)

 2. ROLL ASSEMBLY - the attacker's side of the ledger (everything here may only RAISE the roll)
      //  The defender's contribution is measured FIRST, then split: a defender stronger than baseline
      //  becomes a step-5 reduction; a defender WEAKER than baseline is an attacker bonus.
      guardRaw := D.boosts[physical ? def : spd] - D.counters + SUM run(CLASH_ROLL, D)
      //                                          ^^^^^^^^^^ counters SUBTRACT: a hurt piece defends worse
      deficit := max(0, -guardRaw)      // Screech, Tail Whip, Leer, ... (31 measured moves)
      guard   := max(0,  guardRaw)      // Thick Fat, Eviolite, Fur Coat, Reflect

      might := A.boosts[physical ? atk : spa]
             + powerTilt(effect.power)                             // T1 -1, T2 0, T3 +1, T4 +1, T5 +2
             + effect.tilt                                         // from accuracy, when it is a number
             + SUM run(CLASH_ROLL, A)                              // items, abilities, weather, STAB, terrain
             + deficit
      crit  := SUM run(CLASH_ROLL, A) restricted to scope 'crit-window'   // Scope Lens, Super Luck, Sniper
      C := face + might                                            // face is the PUBLIC Tempo Roll face

 3. ATTACKER WARPS (may only RAISE)
      willCrit -> C := 12 and crit := crit + 1 ; OHKO -> WARP recorded ; Tinted Lens -> recorded for step 6

 4. TYPE MODIFIER  (the rung you start on)
      rung0 := m <= 0.5 ? 0 : m === 1 ? 1 : 2
      step  := C <= 1 ? -2 : C === 2 ? -1 : C <= 5 ? 0 : C <= 8 ? +1 : +2
      rung  := clamp(rung0 + step, -1, 3)

 5. DEFENDER REDUCTIONS (may only LOWER)
      rung := clamp(rung - guard, -1, 3)          // guard is non-negative by construction (step 2)

 5a. THE BAND CAP   (new; may only LOWER)
      rung := min(rung, rung0 + 1 + crit)
      // The roll may lift you at most ONE band above the band your TYPE put you in -- plus one more per
      // point of crit-window. So:
      //   * a RESISTED attacker (rung0 = 0) can reach CLEAN and NEVER SURGE.   <- the design's pillar
      //   * a NEUTRAL attacker (rung0 = 1) can reach SURGE, and CRITICAL only with a crit effect.
      //   * a SUPER-EFFECTIVE attacker (rung0 = 2) can reach CRITICAL on the roll alone.
      // `step = +2` therefore exists to punch through `guard`, not to skip a band, which is exactly the
      // right shape: over-investing in `might` makes you RELIABLE, never FASTER.

 6. DEFENDER WARPS (may only LOWER) then the recorded attacker warps of step 3
      rung := fold(run(CLASH_RESULT, D), rung)      // Sturdy, Focus Sash, Filter, Shell Armor, Rock Head
      rung := fold(recordedAttackerWarps, rung)     // Tinted Lens ([0] -> 1), OHKO, Burst
      // WARPs are EXEMPT from the Band Cap, deliberately: an OHKO, a guaranteed crit and a Burst are
      // "ignore the ladder" effects by definition, and each is separately bounded (charges, Ace, once).
      // survive-once effects are STRICTLY ONE-DIRECTIONAL: they convert only rung in {1,2,3} -> -1.
      // They NEVER convert rung 0 (BACKLASH).  "A shield protects you from being killed;
      // it does not protect you from killing yourself."

 7. (deliberately empty - the Confusion brake is step 0)

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

**Why the Band Cap is a fix and not a nerf.** Pass 2 asserts, in the same document, both of these:

> *"a resisted attacker can never earn tempo at all"* (§7.5, the stated pillar)
> *"`step := C <= 1 ? -2 : C === 2 ? -1 : C <= 5 ? 0 : C <= 8 ? +1 : +2`"* (§7.5, the arithmetic)

They contradict each other. `might` is a sum of `powerTilt` (up to +2), `effect.tilt`, every `CLASH_ROLL` tilt
(Expert Belt, Charcoal, Guts, STAB, weather), the attacker's `atk` boost (up to +6) and `deficit` (up to +6).
`might ≥ 3` is a first-week occurrence — a T5 move plus one Swords Dance is +4 — and at `might ≥ 3`, faces 3–5
give `C ≥ 6` hence `step = +1`, and at `might ≥ 7` faces 2+ give `step = +2`. From `rung0 = 0` that is
**rung 2 = SURGE: a resisted attacker earning a bonus move**, which deletes the pillar and, with it, the reason
type knowledge beats chess strength. One `min()` restores it, and the cap has three further virtues:

1. **It changes none of the published numbers.** At `might = 0` the cap binds exactly nowhere: face 6 gives
   `step = +1 = rung0 + 1`. Every distribution in the table below is unaltered.
2. **It subsumes two of pass 2's hand-written balance bounds.** §9.3's "Huge Power / Pure Power are capped at
   Clash value 8 so they can never manufacture a CRITICAL" is now a consequence of a general rule rather than a
   two-ability special case; and the evasion/`might`-stacking route to a free CRITICAL closes with it.
3. **It gives `crit-window` its job**, which repairs the orphan op of §1.9 correction 3 and makes the game's
   rarest outcome (CRITICAL, which pierces every ward) require either a super-effective read or a deliberate
   crit investment. Both are skill expressions; a big `might` number is not.

**The five outcomes, complete, plus the sixth that never reaches the resolver:**

| Rung | Name | Defender | Attacker | Bonus sub-move |
|---|---|---|---|---|
| −1 | **REPELLED** | untouched | bounces to origin, **+1 damage counter** (a King takes none — its cost is the spent action) | no |
| 0 | **BACKLASH** | removed | **removed** | no |
| 1 | **CLEAN** | removed | survives, takes the square | no |
| 2 | **SURGE** | removed | survives | **yes** |
| 3 | **CRITICAL** | removed | survives, +1 might, pierces all wards | **yes** |
| — | **BLOCKED** | untouched | never moved | the move is not generated |

**Every effectiveness case, spelled out** (`tilt = 0`, `might = 0`, `crit = 0`; each cell re-derived by hand
from the `step` table this pass, and all four distributions plus all four aggregates reproduce exactly, so the
ladder is internally consistent as published):

| Matchup | REPELLED | BACKLASH | CLEAN | SURGE | CRITICAL | P(bonus) |
|---|---|---|---|---|---|---|
| **0× immune** (8 pairs, 2.5%) | — | — | — | — | — | move is illegal |
| **0.5× resisted** (61 pairs) | 33.3% | **50.0%** | 16.7% | 0 | 0 | **0** |
| **1× neutral** (204 pairs) | 16.7% | 16.7% | **50.0%** | 16.7% | 0 | 1/6 |
| **2× super** (51 pairs) | 0 | 16.7% | 16.7% | **50.0%** | 16.7% | **2/3** |

Aggregate over the 316 legal ordered pairs: **P(bonus move) 0.2152, P(attacker dies) 0.2310, P(defender
survives) 0.1719, P(defender removed) 0.8281.** Compare the video's rules as filmed (`recon-variants.md` §2.4):
extra move 27.4%, mutual destruction 29.5%, defender removed **100%**.

**Why the ladder and not the video's flat d6.** Three reasons, in order of weight:

1. **It makes type knowledge dominate the die instead of the reverse.** `recon-tech.md`'s sharpest criticism of
   the original rules is that `P(crit) + P(miss) = 1/3` for *every* attacker while the static per-type value
   spread is only ±15%, so the die outweighs the chart. Under the ladder the matchup shifts the *entire*
   distribution: a super-effective attacker earns tempo two turns in three, and — **with the Band Cap** — a
   resisted attacker can never earn tempo at all, no matter how it is buffed. Type knowledge becomes the only
   reliable route to tempo, which is the concept's whole thesis.
2. **It restores protection** (§7.4 consequence 1).
3. **It is one comparison table plus one clamp**, so it is a tuning knob rather than a rewrite:
   `{−2,−1,0,0,0,+1}` and `cap = rung0 + 1 + crit` ship first and the batch simulator (§9.4) moves both.

**[DEVIATION from `recon-variants.md` §6.3]**, which recommends abolishing the per-capture die entirely
(deterministic mutual destruction, crit/flinch at 1/18). I keep one d6 and keep probabilistic BACKLASH, because
(a) `DIRECTION.md` is explicit that the TCG's coin flips *legitimise* randomness as how the Pokémon board game
already works and that the richer option wins; (b) making the die public captures most of the variance
reduction that document wanted — by its own argument, variance a player can plan around costs far less than its
nominal size; and (c) a fully deterministic chart makes every position a calculation and deletes the story
generator. I accept its measurement that the original configuration was ~25× too loud, and my numbers are
quieter on every axis.

### 7.6 Damage counters — what "damage" means when capture is binary

**Capture stays binary. There is no HP.** But ~200 admitted entries exist purely to do or undo small amounts of
damage: 94 measured `heal`/`damage`/`directDamage` call sites, 13 drain moves, 12 recoil moves, 32 heal moves,
87 status applications, 4 hazards, every thorns ability, Leftovers, Life Orb, Shell Bell, 9 pinch berries,
Regenerator, Wish. Mapping all of that onto stat boosts is the "thematically wrong ⇒ defect" failure.

**Damage counters** are the TCG's own instrument, adopted with its own name and its own visual (stacked pips):

| Counters | State | Effect |
|---|---|---|
| 0 | fresh (`pristine` while never yet marked) | — |
| 1 | hurt | −1 to this piece's Clash roll when defending |
| 2 | badly hurt | −2 defending; **may not use charged ART actions** |
| 3 | **Knocked Out** | removed at the owner's next Checkup, simultaneously with every other KO |

Fraction → counter table, applied to every `heal(maxhp/N)` / `damage(maxhp/N)` the scanner extracts. This is the
one design decision the compiler cannot make, and it is four rows:

| Source fraction | Counters |
|---|---|
| ≥ 1/2 | ±3 (Recover, Rest, Belly Drum's cost) |
| 1/3 … 1/2 | ±2 (Regenerator ⅓, Brave Bird's recoil) |
| 1/6 … 1/3 | ±1 (Rocky Helmet ⅙, Life Orb 1/10) |
| < 1/6 | ±1 (Leftovers 1/16) |

Deliberately coarse: four buckets keep the distinct outcomes small enough to render as three pips and small
enough to hash into the repetition key (2 bits per piece — exactly the bucketing `recon-tech.md` recommends).

**The King never takes damage counters.** It is immune to every indirect effect — hazards, weather, status
ticks, thorns, item drain, Perish — and can leave the board only through a Clash. This is
`recon-variants.md`'s R6 applied to the counter layer, and it forecloses a second, degenerate win route.

Counters give the design **three answers at once**: the chip/heal economy has something real to bite on; the
untouchable-piece problem gets a third independent solution (you cannot capture a Levitating Flying piece with
Ground, but you can Stealth Rock it, Toxic it, and knock it out); and `REPELLED` costs something, so a failed
attack is a real risk rather than a free retry.

### 7.7 Status: two classes, two markings

Adopted from `recon-tcg.md`, because the TCG's physical marking encodes the games' volatile/non-volatile split
for free.

| Mark | Class | Board effect | Clears |
|---|---|---|---|
| **Asleep** (folds `slp` and `frz`) | rotation | the piece cannot act | at your Checkup flip a coin, heads wakes; **hard cap 3 turns**; a Fire-typed capture or a `thawsTarget` move clears it immediately |
| **Stunned** (unifies `par` and `flinch` — measured **45 par riders + 62 flinch riders = 107 applications**) | rotation | the piece loses exactly its next activation, then self-clears | automatically |
| **Confused** | rotation | when this piece attempts a capture, flip a coin; tails: no capture, no move, **your turn ends** | at your Checkup flip a coin |
| **Poisoned** (`psn`, 3 primary + 28 rider) | counter | +1 damage counter at your Checkup | a cure berry, Heal Bell, Natural Cure, promotion |
| **Badly Poisoned** (`tox`, 1 + 4) | counter | +2 damage counters at your Checkup | same |
| **Burned** (`brn`, 1 primary + **47** rider) | counter | +1 damage counter at your Checkup, and −1 to this piece's physical Clash rolls | same |

Rotation-class marks are **mutually exclusive, newest wins**, and clear when the piece WITHDRAWs (U-turn, Volt
Switch, Baton Pass) or promotes. Counter-class marks **stack and persist**. Visually: the rotation class rotates
the piece's pin 90°; the counter class stacks pips. Both are free from the mark table's `class` column, which is
also why the glyph budget is per class rather than per mark (§1.9 #4).

**[DEVIATION from the games, following `recon-tcg.md`]**: paralysis does not halve movement and has no hidden
25% failure chance (a permanent hidden failure chance is the worst mechanic in either canon for a chess
variant); the Speed halving is routed to `BOOST({spe:−1})`, which the movement rule already reads. Frozen is
folded into Asleep — justified twice over, since **`frz` has 13 rider applications and zero primary ones** in
the admitted set.

### 7.8 Immunity and wards — the untouchable-piece problem, bounded five ways

One rule, three sources, five bounds.

**Sources.** (1) The type chart's 0× makes a capture **illegal and permanent** — this is the video's most
memorable rule and the most valuable Pokémon fact a chess player can learn, so it is not softened. (2) An
ability or item ward (Levitate, Flash Fire, Bulletproof, Air Balloon, …) is **one-shot**: the first attempt is
illegal and *pops the ward*, and Air Balloon's real text ("Pops when holder is hit") is the canon template.
(3) Wonder Guard is **class-scoped** per the printed TCG card: uncapturable by Queen, Rook, Bishop and Knight;
always capturable by any Pawn or King.

**Bounds, all five load-bearing:**

1. **Support moves ignore immunity, from data.** Measured: `ignoreImmunity` is true on 270 of 271 Status moves.
   So an immune piece can always be poisoned, burned, put to sleep, debuffed, hazard-trapped or type-changed.
   This is the largest single lever in the dataset and it costs no special case.
2. **Damage counters route around immunity entirely** (§7.6).
3. **The key is over-supplied, per Stratego.** A format's draft validator requires each side to end with at
   least one immunity breaker: a `Scrappy`/`Mind's Eye` piece, a `Mold Breaker` family piece, a Ring Target
   holder, or a piece with `Thousand Arrows`/`Smack Down`. Ring Target is in the Standard 12 Kit, so the floor
   is met by default.
4. **Immunity is arithmetically local.** Measured: each defending type is immune to at most **two** attacking
   types (only Ghost), so no piece is anywhere near Betza's Iron Ghost. A Flying piece is untouchable by 1 of 18
   attacking types — and only by *Melee* attacks of that type, since a coverage slot solves it (§7.2).
5. **The chart itself is editable, and that is the fifth bound** (§7.9b, new this pass). `CHART{set:1}` —
   Iron Ball, Thousand Arrows — reads an immune pair as **neutral**, which is a weaker and better-shaped answer
   than piercing: the capture becomes possible without becoming *good*. Two of the eight immune pairs
   (`Ground→Flying`, and `Electric→Ground` via Ring Target) therefore have a *canon* answer that is neither an
   ability nor a ban.

### 7.9 Priority, reactions, charging, recharging, trapping

- **`priority ≥ +1` → Reaction.** Declare when an enemy begins a Clash against this piece; it resolves first
  and can pre-empt the attack. Spends a charge; at most one Reaction per piece per enemy turn; **a Reaction may
  never be used to escape an exposure** (§7.12). Measured pool: **42 moves**, of which **19 damaging** (Bullet
  Punch, Aqua Jet, Extreme Speed, Fake Out, Sucker Punch, First Impression…) and **23 Status** (Helping Hand,
  Follow Me, Rage Powder, Ally Switch, Quick Guard, Baby-Doll Eyes…). **A Status Reaction resolves its ops but
  cannot capture** — which is exactly what those 23 moves do in the games, and it is why the split matters:
  pass 2 sized the whole mechanic at 21 moves and had no rule for the Status half.
- **`priority ≤ −1` → act-last** (14 moves, 10 damaging), and they become the *reactors* while Trick Room is up
  (trace 9).
- **`flags.charge` (17 moves: Fly, Dig, Dive, Solar Beam, Phantom Force) → `MARK('charging', dur 2)`.** Turn one
  the piece is **untargetable** (it lifted off or burrowed) — which is `condition.onInvulnerability` returning
  `false`, C4 row 12, so it is derived; turn two the Clash resolves automatically against whatever is there.
- **`flags.recharge` (10 moves: Hyper Beam, Giga Impact) → `MARK('recharging', dur 1)`.** Resolves at power
  tier 5, then the piece cannot act next turn.
- **Trapping** (`partiallytrapped` 10 moves + 8 hard-trap tagged moves + `BIND` abilities): the trapped piece
  may not move *away* from the trapper but may always capture it or move within its ring. Bounds: `KING_RING`
  region only (a compiler invariant, §2.4), **never the enemy King**, hard cap 3 turns for inescapable
  variants, and the trapper is itself immobilised for Jaw Lock-class effects.

### 7.9a The Charge counter — the action economy's governor

Adopted from `recon-tcg.md`'s Energy-Zone recommendation, which is canon rather than invented:

> **Adopt TCG Pocket's Energy Zone shape as a per-piece Charge counter (0–2)** that gains 1 on any turn the
> piece does not act and resets on a capture, gating the strongest moves.

| | |
|---|---|
| **State** | one integer per piece, `charge ∈ {0,1,2}`, public, drawn as up to two chevrons under the plinth |
| **Accrual** | at your Checkup, every one of your pieces that **took no action this turn** gains 1, capped at 2 |
| **Reset** | a piece that **makes a capture** drops to 0. A piece that acts without capturing keeps what it has |
| **What it gates** | an ART whose slot is at **power tier ≥ 4** requires `charge ≥ 1` and spends it. Measured: **166 of 679 damaging moves are tier 4 or 5** — Hyper Beam, Earthquake, Explosion, Fire Blast, Close Combat, Draco Meteor. Tier 1–3 ARTs, and every Status ART, cost nothing but the slot charge |
| **What it does *not* gate** | ordinary chess. Slot 0 is free forever. This is non-negotiable: chess must always work |

Five things this one integer buys:

1. **It prices the ART economy dynamically.** A piece that has been quietly holding a square for two turns can
   unload an Earthquake; a piece that just took a rook cannot. The strongest ARTs are available exactly when the
   board has been *slow*, which is when a burst of power is interesting rather than oppressive.
2. **It is an anti-snowball on capture chains**, thematically: a piece that captures resets to 0, so the
   SURGE-chain fantasy cannot end in a tier-5 area attack.
3. **It subsumes three mechanics that were three special cases.** `flags.charge` (17 moves) becomes "costs 1
   charge counter *and* a turn of untargetable set-up"; `flags.recharge` (10 moves) becomes "spends both
   counters"; **Speed Boost** becomes `CHARGE('all', +1)` — literally what it does, reward for patience —
   instead of the `spe` boost `recon-abilities-items.md` §6.11 independently warned against.
4. **It is a legible tell.** Two chevrons under an enemy Bishop means "that piece can Earthquake this turn",
   visible from across the board before you walk into it.
5. **It costs the termination proof nothing.** `charge ∈ [0,2]` per piece, so it is finite; and because it can
   *increase*, §7.11 explicitly lists Charge accrual as **not** a progress event, so stand-still-and-charge
   still draws.

**Trade-off accepted:** a player learns one more counter. Mitigated by a different visual grammar (chevrons on
the plinth versus pips on the bezel), by the ART menu greying out tier-4/5 slots with the reason written on them
("needs ⚡1"), and by it not existing at all in M1 — it ships with the ART actions in M3.

### 7.9b The chart layer — the rules consequence of the 19th op

This section is new, and it is the most interesting rule in the document because I did not design it: it is
what §1.8 row 9 does once `CHART` exists.

**The rule.** Some effects rewrite the *type reading* of a Clash before the die is spent. There are exactly
three forms, they resolve at step 1b, they are public, and they are shown in the pre-commitment outcome
annotation like everything else:

| Form | Rule text as a player reads it | Content |
|---|---|---|
| **one band better, against a named type** | "against Water, this move reads one band better" | **Freeze-Dry** (Ice→Water 0.5× becomes 2×); **Tar Shot**'s mark (every *Fire* attacker reads one band better against the marked piece) |
| **read as neutral** | "this matchup is read as 1×, whatever the chart says" | **Iron Ball**, **Thousand Arrows** (Ground into Flying); **Disguise**, **Ice Face** (the first hit) |
| **union with a second type** | "this move attacks as Fighting **and** Flying at once" | **Flying Press** |

**Four properties make this safe** — each one is why `CHART` is a distinct op rather than a re-use:

1. **It is pre-die and pre-commitment.** `CHART` resolves at step 1b, before any face is spent, so it changes
   the annotation on the square *before you click*. A chart rewrite you discover after committing would violate
   §7.4's one line; a chart rewrite you can see is a plan.
2. **It cannot cross 0× except by saying so.** The `d` form leaves an immune pair immune (Freeze-Dry does not
   let Normal hit Ghost), which is Showdown's own behaviour and preserves the untouchability rule that
   `DIRECTION.md` calls the concept's most surprising consequence. Only the `set` form crosses 0×, and it lands
   on **neutral**, never on super-effective — so immunity-breaking never becomes immunity-*punishing*.
3. **It composes with defence.** Because step 1b precedes steps 2 and 5, a Freeze-Dry against a boosted Water
   rook is a super-effective attack the rook's `guard` can still pull down. That is the interaction a `WARP`
   implementation would have destroyed.
4. **It is bounded by the slot economy, not by a new rule.** Freeze-Dry is one of four slots on one piece with
   `charges = 4`; Tar Shot costs a whole turn and a charge to paint one enemy; Flying Press is tier 4 and so
   needs a Charge counter. No new bound was invented, which is the test a mechanic derived from data should pass.

**Why this is the most on-thesis content class in the dex.** The premise of Pokémon Chess is that *type
knowledge is the edge*. Every other system in this document changes how well you fight; the chart layer changes
**what the chart says**, which is the one thing a player thought was fixed. Three degrees of leverage now exist,
and they form a genuine skill ladder:

| Degree | Mechanism | Learned by |
|---|---|---|
| know the chart | pick the right attacker | any player, in a few games |
| **change your row** | a coverage slot: attack with a different type (§7.2) | a player who reads the ART menu |
| **change the cell** | a `CHART` move: Freeze-Dry, Tar Shot, Flying Press | a player who knows what Freeze-Dry is |
| change your column | `BECOME`: Soak on them, Tera on you (§7.10) | a player planning two turns ahead |

And it repays the draft. Measured: **23 species learn Freeze-Dry, including Lapras** — the video's own example
of the one-type choice. Lapras as **Water** is a solid 4-ARM defensive piece; Lapras as **Ice** is the worst
defensive type on the board (`ARM = 0.324`, §9.1) *whose signature slot deletes the matchup that would farm it*.
That is a real draft decision produced by the dataset, and the tutorial's draft track teaches it (§10.13).

### 7.10 Promotion, evolution, and the one Ace transformation

**Promotion is evolution, and it is one code path with `BECOME`.** A pawn reaching the last rank:

1. **Evolves** along its real `evos` chain if it has one. Branching lines (Eevee's nine) are a player choice
   from the real branch list — `Dex.evolutionLineOf` and `Dex.evolutionsOf` already exist in `src/data/dex.ts`;
   the required `evoItem` is consumed from the side's promotion pool if held, otherwise the branch is
   unavailable, which is exactly what a Fire Stone is for. Trade evolutions (Machoke → Machamp) are available in
   the match because there is no trading inside a match; the meta-game layer honours the real condition (§14).
2. **Re-declares its type** from the *new* species' real typing. Charmander (Fire) → Charizard may be declared
   Fire **or Flying**, and that is a genuine decision with a chart consequence.
3. **Chooses a chess class** from {Queen, Rook, Bishop, Knight}, as in chess, with a suggestion from
   `Dex.roleAffinity` (already implemented).
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
- **Burst** (the Z-move shell): declare before a Clash; the Clash resolves as CRITICAL via a `WARP`, piercing
  every ward and exempt from the Band Cap. A panic button and a finisher.

Tera and Burst are **mutually exclusive** — you get one, which makes the choice sharp. Dynamax/Gigantamax is
cut (it is an HP mechanic, and 4% roster coverage makes it a draft trap); the 34 Gmax sprites survive as
promotion art.

### 7.11 Termination — the bound, proved

**Claim 1 — a turn is at most 3 sub-moves.** By construction: `TEMPO('grant-bonus')` is emitted only by ladder
rungs 2 and 3, `sub < 2` gates the loop, and CI gate 5 forbids any other producer.

**Claim 2 — even without the cap, a turn is finite.** `TEMPO('grant-bonus')` requires a successful capture;
every capture removes at least one enemy piece; **no op in the ISA places a piece on the board** (`SUMMON` does
not exist; CI gate 5 fails the build if it appears; Revival Blessing compiles to `MEND`, Substitute to a mark).
Therefore the enemy piece count `N` is monotonically non-increasing, `N ≤ 16` always, and a chain of length `L`
requires `L − 1` distinct captures, so `L ≤ 17` — and `L ≤ 16` once the King is excluded as a chain target,
because T3 ends the turn the instant the King is exposed. **This argument is entirely independent of the RNG.** ∎

**Claim 3 — the game terminates.** Progress resets the no-progress clock, and progress is defined only over
**monotone-finite resources**: a capture (≤ 31), a knock-out (≤ 31), a pawn advance or promotion (≤ 96), a
**slot** charge spent (≤ 2 × 16 × 12 = 384), an item or ward consumed (≤ 64), a hazard layer laid (≤ 14).
Total progress events `P ≤ 620`. The no-progress rule draws at 100 consecutive sub-moves without one, so a game
is at most `100 × (P + 1) ≈ 62 100` sub-moves. Crude but *proved*, and the practical caps bite far sooner.

Note explicitly what is **not** progress, because each exclusion closes a named loop:

| Not progress | The loop it closes |
|---|---|
| healing, or adding/removing a damage counter | Leftovers versus poison, which would otherwise reset the clock forever |
| applying or curing a status | Toxic / Lum Berry ping-pong across two pieces |
| **gaining or spending a Charge counter** (§7.9a) | stand-still-and-charge. `charge` is the one resource that can *increase*, so it must be excluded by name or the proof fails |
| **applying a `CHART` mark** (Tar Shot) | paint-and-repaint. Tar Shot is `persist` and idempotent, so a re-application is an `ON_RESTACK` no-op rather than a clock reset |
| moving a piece back and forth | ordinary shuffling, exactly as in chess |
| a **REPELLED** outcome that consumes no ward | attack-bounce-attack. It is nonetheless self-limiting: REPELLED gives the attacker a damage counter, and 3 counters is a knock-out, which *is* progress — so at most 3 REPELLEDs per piece before the clock advances. **Exception, deliberate:** a King takes no counters (§7.6), so a King can be REPELLED indefinitely; it is still bounded by the clock, since a REPELLED King makes no progress at all |

**The caps shipped for feel rather than for termination:**

- **T1 — hard cap `L ≤ 3`.** Also bounds the capture animation budget at 700 + 420 + 420 = **1 540 ms**.
- **T2 — the baton rule: the bonus sub-move must be made by a piece that has not yet acted this turn.**
  *[English Progressive Chess.]* This kills the "one super-typed piece mows the board" fantasy outright and
  makes a chain a **team combo** — a much better read on the board and much better Pokémon flavour.
- **T3 — creating a *new* exposure of the enemy King ends your turn.** *[Marseillais Chess; Scottish
  Progressive Chess.]* This is what makes king capture safe, and the guarantee is stated as an invariant rather
  than as a rule: **the enemy King can only ever be captured on a turn where its exposure was already on the
  board when that turn began**, so the defender always gets a full turn to answer any threat to their King.
  Proved in §7.12 R5.

**Draws and non-progress:**

| Rule | Detail |
|---|---|
| **Threefold repetition** | on the **repetition hash**: placement + declared types + damage counters + boosts + Charge counters + piece marks + square marks + side marks + board marks + slot charges + castling + ep + side to move. **Two fields are excluded and both exclusions are load-bearing:** the **PRNG counter** (it advances monotonically, so including it makes repetition unreachable by construction and the rule silently never fires) and **`tempo`, this turn's three revealed faces** (re-rolled every turn, same fatal effect). Conversely, including counters, marks and charges is load-bearing the other way: without them, Protect/Recover cycles hash-collide and produce *false* draws. The rule: **the hash covers every field a player can influence and no field the RNG writes.** Implementation: §2.9 — mix each fact with `zobristWords(label)` into `Position.xorHash`, and the **existing `Position.repetitionCount()` becomes Pokémon-aware with no new module**, because it compares the very fields the words are mixed into. `repetition.test.ts` asserts both directions. |
| **No progress** | 100 consecutive sub-moves with no progress event ⇒ draw. *[Progressive Chess recounts the 50-move rule in sub-moves.]* |
| **Perpetual exposure loses** | repeatedly exposing the enemy King with no progress ⇒ the exposing player loses. *[Shogi.]* Closes the "chase forever with bonus-move tempo" degeneracy. |
| **No legal action ⇒ that player loses** | under king capture there is no being *forced* into check, so orthodox stalemate cannot arise; total immobility is a loss. *[Shogi/xiangqi; Really Bad Chess.]* |
| **Both sides reduced to lone Kings** | draw. *[Archon.]* |
| **Scheduler horizon** | max `condition.duration` in the entire dataset is **5** (measured `{1:34, 2:15, 3:5, 4:10, 5:20, persist:39}`), and at most one pending `SCHEDULE` entry per (side, kind) — a second Future Sight while one is pending simply fails. Queue is O(pieces), horizon provably ≤ 5 turns. |
| **Ranked adjudication** | at a 300-turn cap, the **Prize track** decides: 6 slots, premium pieces fill 2 (`recon-tcg.md`'s Rule Box idea). This is jishōgi material adjudication wearing Pokémon's own clothes, and the track doubles as the material HUD all game. |

### 7.12 Check, checkmate, king capture — one coherent model

**Checkmate is not a well-formed predicate under these rules, and that — not sloppiness — is the actual root
cause of the on-camera bug.** Orthodox legality asks "does the resulting position leave my King attacked?", but
"attacked" here means "there exists a capture that would succeed", which depends on the *opponent's* future
Tempo Roll. Across the prior art, **every variant where check is hard to compute switches to king capture**:
Fog of War (hidden information), Duck Chess (post-move mutation), ICC Atomic (collateral), single-die Dice Chess
(RNG). We are in that family.

**And the shipped code proves it independently.** `src/engine/variant.ts` keeps checkmate, and its `result()`
decides mate via `this.position.isInCheck()` — a method on the deliberately Pokémon-ignorant `position.ts`,
which is therefore **type-blind**. So the shipped game will declare checkmate when the only "mating" attacker is
a Normal piece aimed at a Ghost king — a capture that is *illegal* — and will equally miss that a 0.5×
"mating" piece dies if it tries. Making `isInCheck` type-aware does not fix it, because whether an attack
*succeeds* depends on the opponent's future roll. That is this section's argument, arrived at from the
implementation rather than from theory.

> **R1 — Win condition.** A player wins the moment the opposing King leaves the board, by any means (CLEAN,
> BACKLASH, CRITICAL, or an effect). There is no checkmate terminal state.
> *[Fog of War; Duck Chess; Losing Chess; single-die Dice Chess; ICC Atomic.]*
>
> **R2 — No check-legality.** A move that leaves your own King capturable is **legal**. A King may move to an
> attacked square. Castling through or out of attack is legal. *[Duck Chess.]*
>
> **R3 — Suicide guard, and it is exact here.** A move is **illegal** if, *under this turn's revealed Tempo
> Roll*, its resolution necessarily removes your own King. Because all of a turn's dice are public, this is a
> decidable predicate rather than a probabilistic fudge — a strict improvement on Atomic's version of the same
> rule, and only possible because §7.4 pre-reveals. A move that merely *risks* your King (because the opponent
> may reply) is legal, and the UI must show the exact probability before the click.
> *[Atomic Chess rule 5, verbatim.]*
>
> **R4 — Simultaneous royal death.** If one resolution removes both Kings, **the mover wins.** Deaths apply
> defender-then-attacker (§7.5 step 8) and the game ends the first moment a King leaves the board.
> *[Lichess Atomic.]* A draw here would create a degenerate strategy: a losing player hunting mutual
> annihilation for half a point.
>
> **R5 — A *newly created* exposure ends the turn.** Precisely: after each sub-move resolves, if any of your
> pieces can now capture the enemy King *from an attacking square that could not do so at the start of your
> turn*, your turn ends immediately (the resolution completes; only the remaining sub-moves are forfeit). An
> exposure that was **already** on the board when your turn began does **not** end your turn, and may be cashed
> in by any sub-move.
>
> **The safety property is provable.** *Claim:* the enemy King can only ever be captured on a turn where its
> exposure was already on the board at the start of that turn — so the defender always gets a full turn to
> answer any threat to their King. *Proof:* suppose the King is captured by sub-move `k`. If `k = 0`, the
> exposure existed at turn start by definition (sub-move 0 is chosen from the action list computed in step 1,
> before anything has moved). If `k > 0`, then sub-moves `0…k−1` all resolved without ending the turn, so by R5
> none created a new exposure; therefore the exposure sub-move `k` exploits was present at turn start. ∎
> `exposure.test.ts` asserts the property directly by search rather than asserting the rule.
>
> **R6 — Kings are never immune and never confer immunity.** A King's declared type governs its own attacks and
> the multiplier when it is captured, but **0× never applies to a King as defender: it is read as 0.5×**, which
> puts `rung0 = 0`, so the modal outcome of killing a King is **BACKLASH — the killer dies too**, and a King is
> never unreachable. **Wired into §7.5 step 1b** as `if m === 0 and D is a King: m := 0.5`, after the `CHART`
> stage so a chart rewrite cannot re-immunise a King. Kings also never take damage counters (§7.6), and a King
> attacker that is REPELLED takes none either — the cost of a failed royal attack is the spent action.
> *[Stratego's "always supply the key".]*
>
> **R7 — Check is advice, not law.** Every turn the engine computes and displays which of your pieces are
> capturable, by what, at which rung, and with what probability — and specifically a persistent
> **"YOUR KING CAN BE TAKEN"** banner naming the attacker and the exact outcome under each of the opponent's six
> possible faces. Mate-like positions are *labelled* ("your King cannot escape") but are not terminal.
>
> **R8 — Guarded mode.** Casual and tutorial default: the move list hides actions that leave your King
> capturable with probability ≥ p (default p = 1/6). Off in ranked. Two legality paths in the engine, sharing
> one predicate with the AI's move generator. **The filter may never empty the action list**: if every action is
> filtered, Guarded mode degrades to showing the safest available actions with the banner up, because a UI that
> offers nothing reads as a crash.

**Cost accepted, stated plainly:** king capture removes stalemate as a drawing resource and shifts endgame
theory (on no-check Atomic, K+R vs K becomes a forced win where it is a book draw). R7 and R8 are the
mitigations, and Chess960's rationale applies to us for free: because the army is drafted, opening memorisation
is neutralised on both sides before the chart even applies.

### 7.13 Every bug in `BRIEF.md` §2, resolved

| Bug (from the video) | Resolution |
|---|---|
| **Capture-in-check is broken** — a piece died capturing while its own King was in check, and the turn ended with the King still in check | **Correct behaviour under R1/R2, and the player is warned three ways.** There is no "in check" state to be illegal: the exposure is a *risk*, R7's banner names it with exact odds under all six enemy faces, and Guarded mode filters the move out entirely for players who want that. The move that produced the bug on camera is legal, loses, and *reads as losing*. Additionally, R3 makes the deterministic version — a capture that necessarily removes your own King, e.g. via Explosion or a certain BACKLASH — flatly illegal, and because §7.4 pre-reveals the dice, "necessarily" is computable. The shipped `variant.ts` currently answers this with `captureIsSafe()`'s conservative "could" quantifier, which is the right call *given a hidden die*; §13.2a is the migration. |
| **Infinite / runaway turns** | Bounded three ways: the monovariant proof (`L ≤ 16`, RNG-independent, §7.11 Claim 2), the shipped caps T1/T2/T3, and CI gate 5, which fails the build if any op can add a piece or if `INVOKE` depth ever exceeds 1. The whole termination argument is one grep: `TEMPO('grant-bonus')` appears in exactly one place. |
| **King capture vs checkmate** | One model, king capture (R1). Checkmate becomes a UI label. The shipped code's type-blind `isInCheck()` mate test (§7.12) is independent evidence that the alternative does not survive contact with the type chart. |
| **Suicide-capture as a tactic** | **A feature, priced, and made a decision rather than an accident.** Mutual destruction comes from the chart at 0.5× — knowable, plannable, chosen — and the public Tempo Roll means you know *before committing* whether this face gives BACKLASH (faces 3–5), REPELLED (1–2) or a clean steal (6). The draft absorbs the value distortion because a bad offensive type is correctly cheaper (§9.1). It is honestly labelled in the UI as a **chess** rule, since `recon-tcg.md` establishes that neither canon supports it. And it now has a *counter that is content rather than a rule*: Freeze-Dry, Tar Shot and Tinted Lens each delete a specific mutual-destruction matchup (§7.9b). |
| **Draw / stalemate undefined** | Fully specified in §7.11: threefold on the **repetition hash** (every field a player can influence, no field the RNG writes), 100-sub-move no-progress with a named progress set and six named excluded loops, perpetual exposure loses, no legal action loses, lone Kings draw, ranked adjudication by Prize track. |
| **Zero-effectiveness immunity creates untouchable pieces** | Bounded **five** ways (§7.8), of which three are free from data: 270 of 271 Status moves ignore immunity; damage counters route around it; and `CHART{set:1}` (Iron Ball, Thousand Arrows) reads an immune pair as *neutral*, which is canon and does not touch the chart itself. Plus the coverage-slot rule (§7.2) means "immune" only ever means "immune to that piece's Melee slot". |
| **(implied) A King could be untouchable** — the video never hit this, but 0× plus king capture makes it inevitable | **R6, wired into the resolver at step 1b rather than asserted**, and deliberately placed *after* the `CHART` stage so that no chart rewrite can re-immunise a King. The modal outcome of killing a King is BACKLASH — the killer dies too. Kings also take no damage counters, closing the alternative degenerate route. |

### 7.14 The small print, so nothing has to be asked

**The derived scalars, in full.**

| Scalar | Definition | Measured distribution |
|---|---|---|
| `power` tier | `bp ≤ 45 → 1`, `46–75 → 2`, `76–95 → 3`, `96–120 → 4`, `121+ → 5`, `bp === 0 → 2` | over the **950 admitted** moves: 679 damaging, of which **T1 151, T2 223, T3 139, T4 104, T5 62**. Tier 4+5 = **166**, exactly the set the Charge counter gates |
| `powerTilt` | `[T1 −1, T2 0, T3 +1, T4 +1, T5 +2]` | — |
| `accuracyTilt` | returns a **discriminated union**, never a bare number: `true → {tilt:+1}`; `95–100 → {tilt:0}`; `85–94 → {tilt:−1}`; `70–84 → {tilt:−2}`; `50–69 → {gate:'>=4'}`; `< 50 → {gate:'>=5'}`. A `tilt` lands in step 2's `might`; a `gate` becomes a **`Guard`** and therefore makes the action *ungenerated* on a face that fails, rather than merely worse | `true` on 169 moves; the `< 50` set is exactly the 4 OHKO moves |
| `charges` | `clamp(round(pp / 5), 1, 5)`; slot 0 is `Infinity` | **1→208, 2→319, 3→174, 4→159, 5→90** |
| `coins` from `secondaries[i].chance` | `100 → always`, `50–99 → 1 coin`, `25–49 → 1 of 4`, `< 25 → 1 of 8` | **212 riders**, buckets `100%→63, 30%→55, 10%→53, 20%→23, 50%→14, 40%→3, 70%→1` |
| `counters` from an HP fraction | `≥ 1/2 → 3`, `1/3–1/2 → 2`, `1/6–1/3 → 1`, `< 1/6 → 1` | — |
| `crit` window | `SUM TILT('crit-window')`, clamped `[0, 2]` | 11 measured `onModifyCritRatio` handlers + 5 `willCrit` moves |

**Chess mechanics that interact with the Clash.**

- **A pawn's forward push never Clashes** — pawns capture diagonally, exactly as in chess. A blocked pawn is
  blocked; there is no "attack the square ahead".
- **En passant is a normal Clash** against the passed pawn, resolved on its own square, using the capturing
  pawn's slot 0. All five rungs apply; on BACKLASH both pawns are removed and the capturer's square is vacated.
  It must be taken on the sub-move immediately following the double push, as in chess.
- **Castling never captures**, so it never Clashes. It is legal out of, through and into an exposure (R2).
  An **ART action does not relocate the rook or the king, so it does not forfeit castling rights** — a detail
  that matters in play (§17, turn 3).
- **Promotion happens on arrival, before the exposure test**, so a pawn that promotes into a piece attacking
  the enemy King ends the turn by T3 as any other exposure does.
- **A Clash resolved by an ART does not relocate the attacker** unless an op says so; `MELEE`-region ARTs are
  the exception a player must learn once — the piece strikes an adjacent square along its own pattern and
  **stays where it is**, so an ART capture leaves the captured square *empty*.

**Which face does what.**

- Sub-move `k` (0-indexed) uses `tempo[k]`. `DECLINE` forfeits the remaining faces.
- **A Reaction resolves on the face the attacker is currently using** — the same public number — because the
  reacting player has no face of their own during the enemy's turn. This keeps every roll public and makes a
  Reaction a fully computable decision for both sides.
- **Multi-hit** (31 moves) rolls `n` times, where `n` is `2`, `3`, or a `[2,5]` range resolved by the current
  face (`face ≤ 2 → 2`, `3–4 → 3`, `5 → 4`, `6 → 5`). Hit `i` uses `tempo[(k + i) mod 3]`, and the **best rung
  achieved is the outcome**. Population Bomb's 10 is capped at 5.
- **A rider coin is flipped once per rider per Clash**, after the rung is applied, and can never change the rung.

**Ordering rules inside one resolution.** Ops apply in the order the compiler listed them, which is Showdown's
own field order (§3.2). Where two pieces would be removed, the defender is removed first (this is what makes
R4's "the mover wins" well-defined). Where two marks of the rotation class would apply, the newest wins. Where
two `TILT`s of the same scope apply, they sum. Where two `CHART`s apply, they compose in log space in dispatch
order (§2.8) — attacker's before defender's — and the composed result is clamped to `[0.25, 4]` before step 4
reads it. Where two `WARP`s apply, defender warps resolve before attacker warps, each may only move the rung in
its permitted direction, and both are exempt from the Band Cap.

**Formes and identity.** A piece's `species` may change (Mega, Stance Change, promotion-evolution) but its
`PieceId` never does, so per-piece state, animation identity, replay and the Zobrist keying all survive the
change — which is exactly why `position.ts` gives every piece a persistent id, and exactly what
`variant.ts`'s own `Loadout` keying anticipated.
---

## 8. The draft

### 8.1 The architectural seam that `DIRECTION.md` demands

```ts
export type PoolSource =
  | { kind: 'full-dex' }                                  // sandbox, casual, playtesting
  | { kind: 'collection'; owned: OwnedIndividual[] };      // progression and ranked

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
contain it. Enforced by module boundaries: `src/rules/` may not import `src/meta/`, and an ESLint
`no-restricted-imports` rule fails CI if it tries.

### 8.2 The draft loop: slot-first, never a 1 025-item browser

Adopting `recon-visual.md`'s slot-first solution, which is the right answer:

1. The 16 slots are presented in a fixed order (King, Queen, Rooks, Bishops, Knights, then Pawns).
2. For **the one slot being filled**, five candidates are offered, with a guaranteed spread: at least one
   Pokémon of a type you do not yet cover, at least one under half your remaining per-slot budget, at most one
   Legendary/Mythical, and at most one Ace-restricted piece.
3. Each candidate card shows: sprite, both real types (pick one), the 1–4 ability radio, the auto moveset with
   one swappable slot, its point cost, and — the load-bearing part — an **18-cell Coverage Strip** that animates
   the gaps this pick would close. **A slot carrying a `CHART` move annotates the strip differently**: Lapras-as-
   Ice shows Water as *covered* with a hatched cell, because Freeze-Dry covers it while the Ice row does not.
   That single visual is how §7.9b becomes a draft decision instead of a surprise.
4. **One reroll** per slot. Search is an escape hatch behind a toggle, not the default.
5. Quick Draft (accept all suggestions) completes a legal army in **under 60 seconds**; a themed preset
   (Kanto, Mono-Steel, Gym Leader) completes it in one click. The repository already ships
   `src/game/autodraft.ts`, which is the Quick Draft path's first implementation.

### 8.3 Requirements the validator enforces

| Requirement | Rule | Why |
|---|---|---|
| Legal army | exactly 1/1/2/2/2/8 | chess; already `STANDARD_ARMY` in `board.ts` |
| Budget | `Σ cost ≤ budget`, quarter-pawn granularity | `recon-variants.md`'s point-buy, as a *usability* device — never as a balance guarantee |
| Type spread | ≥ 10 distinct declared types among your 16 | the video's "at least one of every type on the board" is impossible for one side; across both armies the candidate generator makes the union of 18 overwhelmingly likely, and a format can require it in mirror-pool play |
| Immunity breaker | ≥ 1 (Scrappy family, Mold Breaker family, Ring Target holder, or a `Thousand Arrows`/`Smack Down`/`Iron Ball`) | Stratego's over-supplied key; §7.8 bounds 3 and 5 |
| Ace limit | ≤ 1 Ace piece | ACE SPEC, a shipped first-party precedent: OHKO moves, Wonder Guard, Imposter, Shadow Tag, Huge/Pure Power, the four Ruin abilities |
| Ruin limit | ≤ 1 Ruin ability | they do not stack |
| Choice items | illegal on King and Queen | a +2-range Queen covers the board |

### 8.4 Draft supply, measured

Over the **1 025 admitted base formes**: Water 154, Normal 131, Grass 127, Flying 109, Psychic 102, Bug 92,
Poison 83, Fire 81, Ground 75, Rock 74, Fighting 73, Dragon 70, Electric 69, Dark 69, Steel 65, Ghost 65,
Fairy 64, **Ice 48**. Mono-typed 499, dual-typed 526 — so **51% of the roster presents a real type *decision* at
draft**, which is the single cheapest source of depth in the whole game.

Ice is both the scarcest and the most defensively fragile type, so it is priced low and rationed by supply
rather than by a rule — and §7.9b gives it the one genuinely interesting reason to be drafted anyway.

### 8.5 Point costs

`cost(piece) = round(4 · V(type, class)) / 4`, with `V` from §9.1, plus modifiers that are all data-derived:
`+0.5` for a `tags` Legendary/Mythical/Paradox, `−0.25` if `species.nfe`, `−1` for an `INERT`/`STRIDE-penalty`
ability (Run Away, Truant, Slow Start — the refund that makes Slaking a bargain rather than a trap), `+0.25`
for a slot-0 move at power tier ≥ 4, and **`+0.25` for any slot carrying a `CHART` op** (measured: 7 entries, so
this touches a handful of species and is priced rather than banned).

Costs are **published on the card**. Knightmare Chess's precedent also gives a shipped answer to skill gaps: a
**voluntary handicap** — take a smaller budget.

### 8.6 Movesets: 4 slots, auto-picked, one swappable

`recon-moves.md` §6.3's measured scorer is adopted verbatim (STAB + stat fit + power + learner-count rarity +
utility, with a shape quota), including both of its measured fixes: allow "no melee move" when the best melee
score is negative (so Blissey stops getting Hyper Beam) and `−15` for `flags.recharge || flags.pledgecombo` (so
Charizard stops getting Blast Burn). Three additions of my own, two forced by §7.2 and one by §7.9b:

- **Slot 0 must be a move of the piece's declared type.** If the learnset union has none, the 18 × 6 type-kit
  table supplies one. Build-time assertion over all 1 367 formes.
- **Slots 1–3 must cover at least two types other than slot 0's**, so every piece has an answer to being
  type-countered. Measured feasibility: the median all-gens prevo-chain learnset union is **78 moves** (the
  repository's own `manifest.json` reports `learnsetMedianMoves: 78`, min 1, max 375).
- **A `CHART` move scores `+35`** — the same weight as a 2–3-learner signature move — because it is the highest
  board-impact class in the dex and there are only 7 of them. Consequence, checked: Lapras's auto-set contains
  Freeze-Dry whenever it is declared Ice, and does not when declared Water (Water already beats Fire and Ground).

Movesets come from the **all-gens prevo-chain union with a `changesFrom ?? battleOnly ?? baseSpecies` recursive
union**, not gen-9 legality — 593 of 1 417 species have no gen-9-legal moves, and Rotom-Wash proves union rather
than fallback is required. After all unions, 29 species still have under 8 moves (Ditto 1, Unown 1, Caterpie 5),
so the type-kit floor is mandatory. Legality is **baked**, so there is no runtime validation surface: the bundle
ships `species → uint16[]` and the engine can only pick from that array.

---

## 9. Balance

### 9.1 What a piece is worth

Base class values from the published sets rather than the folk 1/3/3/5/9: **P 1, N 3.2, B 3.3, R 5.0, Q 9.5**
(Berliner/AlphaZero). The type term uses `recon-variants.md` §3.2's model shape — which is the right shape,
because what you risk when you attack and what an attacker risks coming at you both scale with how much piece is
at stake — evaluated under this document's ladder:

```
V(piece) = m · (1 − α·LIAB(t) + β·ARM(t) − ε·BLOCK(t)) + τ · BONUS(t)
α = 0.9, β = 0.5, ε = 0.3, τ = 0.5 pawns          (starting values; fitted by self-play, never by hand)

LIAB(t)  = Σ_d ŵ_d · P(attacker dies | t attacks d)
ARM(t)   = Σ_a ŵ_a · P(attacker dies or is repelled or is blocked | a attacks t)
BLOCK(t) = Σ_d ŵ_d · [chart(t,d) = 0]
BONUS(t) = Σ_d ŵ_d · P(bonus sub-move | t attacks d)
```

Evaluated under the ladder with uniform weights, sorted by rook value:

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

**Spread: 1.18× between the best and worst type of the same class** (Steel rook 5.57, Bug rook 4.73), narrower
than `recon-variants.md`'s 1.46× because the ladder gives resisted attackers a 1/3 chance of merely being
repelled and super-effective attackers a 1/6 chance of backfiring. **The type edge therefore lives in tempo, not
material** — `BONUS` ranges from 0.139 (Normal) to 0.278 (Ground), a **2× spread in free moves earned** — which
is exactly where I want it: material advantage compounds slowly and is easy to misprice at draft, whereas tempo
is felt immediately, is visible on the board, and cannot be bought with points.

**The Band Cap is what makes this table *true in play* rather than only at move one**, and that is a second
reason it is a fix rather than a nerf. The table is computed at `might = 0`. Without the cap, `might` shifts the
whole distribution, so a boosted piece's realised `LIAB` and `BONUS` drift away from its priced values as the
game develops — a Bug rook with two Swords Dances stops being a Bug rook, and the point list silently stops
describing the board. With the cap, `might` moves *reliability* and never *band*, so `BONUS(t)` — the term that
carries the type edge — is invariant in `might`, and the priced value stays the played value.

Corrections to naive intuition this table preserves from `recon-variants.md`: the worst types are **Bug and
Grass** (7 self-destructive attacking matchups each), not Ice; Ice is a good attacker with the worst defence on
the board; Normal is the only type that can **never** earn a bonus move by typing.

### 9.2 How a type-literate player wins

Per capture, a player who attacks only at ≥ 1× and prefers 2× gains, against a player who attacks at the
chart's base rates: `ΔP(self-death) · u + ΔP(bonus) · τ`. With the measured among-legal shares (0.5× is 19.3%,
2× is 16.1%), `u ≈ 2.5`, `τ = 0.5`, that is **≈ 0.30 pawns per capture**, plus the tempo differential (0 versus
2/3 chance of a bonus move) which is worth more than the material term over a game. Meanwhile `σ_dice` is far
below the video's measured ≈ 5.5 pawns/game because the load-bearing face is known in advance and the stake per
face is one band of one ladder.

**Type knowledge is the edge, and it is fully deterministic**: with the Tempo Roll public, a player who knows
the chart can compute every outcome on the board exactly. §7.9b adds a second, deeper tier to that edge —
knowing that Freeze-Dry inverts Ice-into-Water, or that Tar Shot turns your whole Fire army from suicide
attackers into clean capturers, is knowledge a chess player cannot fake and a type-chart-only player does not
have either. That is the skill ceiling the concept needs and it costs one op.

### 9.3 The named danger list, each with its bound

| Danger | Bound |
|---|---|
| Total immunity / untouchable pieces | §7.8's five bounds |
| Focus Sash + mutual destruction (free queen for a pawn) | survive-once is **strictly one-directional**: it converts only rungs 1–3 to −1, never rung 0. "A shield protects you from being killed; it does not protect you from killing yourself." Rock Head is the single named exception |
| **Boost-stacking into free tempo** | **the Band Cap** (§7.5 step 5a). This is the general rule, and it replaces two of pass 2's special cases: Huge Power / Pure Power no longer need a bespoke "Clash value capped at 8", and the evasion route closes with it |
| Huge Power / Pure Power (+2 flat) | subsumed by the Band Cap: they win Clashes reliably and can never generate tempo from a matchup that did not already offer it |
| Shadow Tag / Arena Trap / Neutralizing Gas | `KING_RING` region as a *compiler invariant* (§2.4); never binds or suppresses the enemy King |
| Wonder Guard | class-scoped per the TCG card (§7.8) |
| Imposter (Ditto) | copies movement pattern and ability only; type stays Normal, class stays as drafted |
| Protean / Libero | once per game, then locked — which is what gen 9 itself did |
| Moody | banned in ranked, legal in a Chaos format: there is no decision to preserve |
| Evasion stacking (Double Team, Minimize) | total `eva` effect capped at +2 by the `BOOST` clamp; and it can no longer buy a band |
| OHKO moves, Wonder Guard, Ruin abilities | Ace-restricted: one per side |
| Thorns stacking | all thorns on one Clash resolve to **at most 1 damage counter total**; Aftermath and Innards Out are the two named exceptions that kill, and they trigger only after their own piece has died |
| **`CHART` stacking** | **new, and it is the danger the 19th op introduces.** Two `CHART` ops could in principle read a 0.5× matchup as 4×. Three bounds: (1) the composed result is clamped to `[0.25, 4]` and `rung0` reads `m ≥ 2` identically, so a second `+1` buys nothing; (2) the `d` form cannot cross 0×, so it can never manufacture legality; (3) only **7 entries in the dex** carry the op and the draft prices each at `+0.25`. Measured worst realistic case: a Freeze-Dry Lapras attacking a Tar-Shotted Water piece reads 2× rather than 4×, i.e. identical. The op is self-limiting because the rung ladder has a top |
| Capture chains | T1/T2/T3, plus Life Orb draining every link, plus the Charge reset — three *content-derived* contributions to termination rather than rules bolted on |

### 9.4 The instrument, not the argument

Every number above is a starting value fitted by the **headless batch simulator** (`src/sim/`, shipped at M6),
which reports: outcome distribution, game length in turns and sub-moves, capture-outcome frequencies, per-type
win rate, first-player advantage, bonus-chain length histogram, draw-cause breakdown, **and — added this pass —
the realised Band Cap bind rate** (what fraction of Clashes had the cap actually lower the rung), because that
one number tells you whether `might` inflation is a real pressure or a theoretical one. Betza's four "balanced"
armies scored +62%/−71% over 400 engine games after master playtesting pronounced them equal; **hand-balancing
asymmetric armies does not work**, so the ladder band edges, α/β/ε/τ, the Charge gate and the point list are all
outputs of self-play, and army *pairings* are screened Chess18-style: generate, evaluate, publish, ban or
handicap the tails.

---

## 10. Legibility, onboarding, and the tutorial

The owner reports that it is currently unclear which piece is a king, queen, pawn or bishop. That is the single
most important defect in the project, and `recon-visual.md` has already measured *why* the current approach
cannot work: a Unicode glyph badge is ~10 px inside a 40 px cell where the six solid chess glyphs differ only in
interior detail; `ROLE_SPRITE_SCALE` collapses six roles into three size tiers; and ring weight is 1.2 px versus
1.4 px. (Verified in the shipped `src/ui/pieceRoles.ts`, which is exactly those three channels.) I adopt its
solution wholesale and add the compiler's contribution.

### 10.1 Three channels that never compete

| Channel | Carries | Why it cannot be confused with the others |
|---|---|---|
| **Outer silhouette** | **chess role — dominant** | shape survives greyscale, colour-blindness, 34 px cells and peripheral vision; nothing else in the design uses silhouette |
| **Enamel field colour + a type glyph** | Pokémon type | the 18 fixed colours from `typeColors.ts` stay the palette's spine; the glyph is the second channel because 7 type pairs collapse under deuteranopia |
| **Bezel metal (bone vs ink) + board half** | owner | a lightness channel, measured at 15.2:1 separation between the two armies |

**Silhouettes are derived from movement**, which is what makes them learnable in one game rather than memorised:
pawn = circle; bishop = diamond (its diagonals); rook = crenellated square (its orthogonals); knight = stepped L
(literally its move); queen = coronetted octagon (the rook's square ∪ the bishop's diamond); king = crowned
heraldic shield that **overflows its cell**. Six inline SVG paths, never a font.

Redundancy ladder by container query, so the channels switch on as space allows: ≤ 34 px silhouette + army metal
only; 34–44 px add the enamel field; 44–64 px add the type glyph and the counter pips; ≥ 64 px add the plinth
archetype glyph and the charge chevrons. Board squares move to cool slate `#5C6575` / `#818A9B` separated by a
1 px ink inlay, because measured against the current tan board **all 18 type colours fall below 3:1**.

**Answering the question directly — how a player tells a king from a pawn from a bishop at a glance, given every
piece is also a Pokémon.** Role is carried by the *outline of the token*, which is the largest and lowest-
frequency feature in the cell and the only channel nothing else uses; the Pokémon sprite sits *inside* that
outline, at 66–92% of the cell depending on role, so it can never compete with it; type is the *fill* behind the
sprite plus a corner glyph (measured: the top-left 8×8 of an icon is fully empty in 91% of sprites, so a corner
crest is nearly free); and owner is the *metal of the bezel*, a pure lightness difference measured at 15.2:1.
Three orthogonal visual variables — shape, fill, lightness — one per question, and the king additionally breaks
the cell boundary, which makes it the only piece whose silhouette is visible in peripheral vision.

### 10.2 What my rules add to the piece

Every one of these is state the rules create, so it must be on the piece rather than in a panel:

| State | Rendering |
|---|---|
| damage counters (0–3) | 3 pips on the bezel's lower arc, filling clockwise; at 3 the pin desaturates and a KO cross appears until the Checkup removes it |
| rotation status (Asleep / Stunned / Confused) | the **pin rotates 90°**, with a small symbol; mutually exclusive, newest wins |
| counter status (Poisoned / Burned) | a coloured pip on the pin's rim, stacking |
| slot charges remaining | up to 3 small dots on the plinth, one per charged slot, dimming as spent |
| **Charge counter (0–2)** | up to two **chevrons** under the plinth — a different shape and position from both pips and dots |
| ward intact | a thin second bezel ring; it visibly *shatters* when popped |
| Tera'd | the enamel field is repainted in the new type's colour with a faceted overlay |
| bound / trapped | a chain arc drawn on the two squares between the binder and the bound piece |
| **`CHART` mark (Tar Shot, Grounded)** | **a black smear / an iron shackle drawn *across the bezel*, plus the affected type's glyph in the smear** — because a chart edit is the one piece of state whose whole point is that it changes what a *different* piece can do to this one |
| earned a bonus move | §10.3 — board state, not piece state |

### 10.3 The five outcomes, and the bonus move as persistent state

Outcomes are encoded by **form, direction, symmetry and death count**, never by hue — measured: the natural
outcome hues sit only ΔE 11–19 from the nearest type colour and two collapse under protanopia.

| Outcome | Form | Deaths | Duration |
|---|---|---|---|
| **SURGE / CRITICAL** | 8-ray star outward from the defender's square (CRITICAL adds a second, counter-rotating ring) | 1 | 700 ms, then persistent state below |
| **CLEAN** | a single slash inward, in the direction of the attack | 1 | 520 ms |
| **BACKLASH** | twin mirrored cracks flying apart | **2** | 760 ms |
| **REPELLED** | hexagonal ward, the attacker slides back to its origin | 0 | 620 ms |
| **BLOCKED** (illegal) | a dashed grey ring, drawn **from the moment you pick the piece up** | 0 | static — immunity is never a surprise |

The bonus move is **persistent board state, not a flourish**: a gold ring breathes around the piece that earned
it, the board frame turns gold, the stage dims 18%, the HUD shows two turn chips, and **the pieces eligible to
take it (the baton rule, T2) are lit while every other piece is dimmed**. A flourish can be missed; a board that
stays different cannot.

The Tempo Roll gets three instruments with distinct silhouettes and rotation axes, learnable in one game: a
40 px **Tempo Die** tumbling in the rail at turn start showing three faces left to right (spent faces grey out);
a 22 px **Clash Die** that stamps the target square with the face actually used; a 20 px **TCG coin** spinning on
its edge for riders.

**The Band Cap needs one visual, and it is cheap.** When the cap lowers a rung, the Clash Die stamp is drawn
with a **flat ceiling bar** above it and the Why panel says *"the roll wanted SURGE; a resisted matchup can only
reach CLEAN"*. This matters: without it, a player who has stacked two Swords Dances and watches a resisted
capture refuse to grant a bonus concludes the game is broken. One glyph turns an invisible clamp into a taught
rule.

### 10.4 The affordance that teaches the chart

When a piece is picked up, every reachable square is annotated with its **resolved outcome** for the currently
selected slot, using the outcome forms above as small static stamps: gold star = SURGE, white slash = CLEAN,
twin cracks = BACKLASH, hex = REPELLED, dashed grey = BLOCKED. Switching slots (the type chips) re-annotates
instantly. **This is the whole onboarding strategy**: a player who knows nothing about Pokémon reads shapes and
plays correctly from move one; the chart is learned inductively because the same shape keeps appearing for
Fighting-into-Steel. A Pokémon player, conversely, gets the chess role from silhouettes and the legal-move
highlight from the board.

**And it is where `CHART` pays for itself as a UI element.** Because a chart rewrite resolves at step 1b —
before any die is spent — the annotation is *already correct*: selecting the Freeze-Dry slot repaints Water
pieces from twin cracks to a gold star, in place, with no extra code. A player learns what Freeze-Dry does by
watching the stamps change, which is the same mechanism that teaches them the chart. Had `CHART` been modelled
as a post-commitment `WARP`, the annotation would have lied.

### 10.5 FX derived from the ISA — 58 assets for 1 797 entries

The compiler is also the VFX pipeline:

```
visual(effect) = REGION_GEOMETRY[effect.where]      // 16 spatial forms: melee lunge, ray, ring, board wash…
               × OP_ANIMATION[dominantOp(effect)]   // 19 verbs: MARK stamps, MEND drips, CHART chart-flips…
               × TYPE_SKIN[type]                    // 18 palettes + 18 glyphs, from typeColors.ts
               × INTENSITY[effect.power]            // 5 scales
```

**16 + 19 + 18 + 5 = 58 authored assets** cover every move, ability and item, and there is **no per-move VFX
table to fall out of date** — a new move compiled from a dependency bump gets correct effects automatically.
`CHART`'s animation is the one new asset and it is the most legible in the set: **the 18-cell Coverage Strip in
the HUD flips the affected cell, and the affected cell's colour washes across the target square.** You see the
chart change.

Rendering follows `recon-tech.md`'s measured architecture: keep the 64-button DOM board and its aria labels,
move pieces into one transform-positioned layer keyed by piece id (the shipped `App.tsx` renders each
`BoardPiece` as a child of its square's button, so a piece physically cannot travel between squares until this
lands — it is the first UI task, ~2 days), add two Canvas2D layers (`fx-under` for hazards and terrain,
`fx-over` for explosions and weather), vendor sprites same-origin at build time (the Showdown CDN sends no
`Access-Control-Allow-Origin`, verified 8/8, which forecloses every canvas pixel operation), cap live particles
at 240, and run a single rAF ticker with fixed phase order. Reduced-motion replaces each outcome animation with
its static silhouette stamp held 1 200 ms — which is why the four forms were designed to be distinguishable as
stills.

### 10.6 Progressive disclosure of the depth

- The **piece card** (hover / long-press) is four lines: name and role; declared type; the 13-archetype glyph
  for its ability and the 12-glyph Kit item, each with the real `shortDesc` on hover; and the four slots with
  their type chips. The player learns **18 type glyphs + 13 ability archetypes + 12 Kit items = 43 symbols**,
  not 1 797 effects.
- The **Why panel** is the legibility answer under load, and it is free because the engine already emits it:
  every resolution produces an ordered `EffectEvent[]`, and the panel renders that list as sentences —
  "*Freeze-Dry rewrites Ice→Water from RESISTED to WEAKNESS; face 6 + Expert Belt (+1) → 7; the roll may lift you
  one band above your type, so SURGE; Lapras captures and moves again.*" Nothing in the UI narrates from a
  second source of truth. The `charted` and capped lines are new event types (§2.7) precisely so the panel can
  say those two sentences.
- **Progressive disclosure by milestone, not by menu.** The rules arrive in the order §15 ships them, and the
  tutorial is gated the same way: a player who has never seen an ART action is never shown a Charge chevron,
  because in M1 there is no such thing.

### 10.7 The tutorial — why it is *cheap* here, which is the whole design

`DIRECTION.md` directive 7 makes an interactive tutorial a **shipped, required feature**, and it says the thing
that should scare a designer: *"this game has three rulesets stacked on each other — chess, the type chart, and
the variant on top — and no player arrives knowing all three."*

The naive cost of a tutorial that guarantees the player *causes* a specific outcome is a scripting engine: a
parallel, cheating code path that forces a die, suppresses a rule, and drifts out of sync with the real game
within a month. **This design does not need one, and the reason is three properties it already has:**

| Property this design already has | What it buys the tutorial |
|---|---|
| the engine is **pure, deterministic and seeded** (`rng.ts`, already shipped with `RngState` serialisation and `fork(label)`) | a lesson is a **seed**. To make face 1 come up, search for a seed whose first Tempo Roll starts with 1. There is no forced-die code path, because there is nothing to force |
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
  | { kind:'causeChart' }                                  // the Freeze-Dry lesson, §10.13
  | { kind:'reachSquare'; piece:PieceId; square:Square };
```

`tutorial.test.ts` runs every lesson headlessly and asserts that (a) the goal is **achievable** from the given
position and seed, and (b) the lesson's `beats` reference only event types the engine actually emits during a
successful run. **A lesson that has rotted fails CI**, which is the property that makes a tutorial survive a
year of rule changes. This is the same discipline as `coverage.test.ts`, applied to onboarding.

### 10.8 The two tracks, and the branch that is not remedial

The branch is a single question on first launch — **"Which of these would you rather skip?"** with two
equal-weight cards, *"I know how chess pieces move"* and *"I know the Pokémon type chart"* — and both, or
neither, can be chosen. Framing it as *what you may skip* rather than *what you need taught* is the whole trick.

| Track | Lessons | The thing it must not assume |
|---|---|---|
| **Pokémon player** (skips the chart) | how each of the six silhouettes moves, taught by the silhouette itself: the diamond moves diagonally, the crenellated square moves orthogonally, the stepped L *is* the knight's move. Then: the goal is the enemy King. Then five mate-in-one puzzles | that they know what "develop", "file" or "fork" means. No chess vocabulary appears before it is shown |
| **Chess player** (skips the geometry) | the three heuristics every human already half-knows (Water beats Fire, Fire beats Grass, **nothing hits Ghost with Normal**), then that the board *tells you the answer* before you commit. Never a table | that they will read a 324-cell chart. Directive 5 forbids trying |
| **Shared** (nobody skips) | §10.9's five outcome lessons, §10.10's two die lessons, then hazards, status, the ART menu, and §10.13's chart lesson | — |

Directive 5's instruction — *do not attempt to teach 324 type interactions* — is honoured structurally rather
than by restraint: **the tutorial teaches the player where to look, and §10.4's outcome annotation is the thing
they look at.** A player who never learns a single matchup still plays correctly, because every reachable square
is stamped with the outcome it would produce. The chart is then learned *inductively*, over games, from the same
gold star appearing every time Fighting meets Steel.

### 10.9 The five outcome lessons — each one *caused*, not watched

Each is one `Lesson` row; the seed is chosen so the intended face is the first face of the Tempo Roll. Every
type fact below was verified against the chart this pass.

| # | Lesson | Position | Seed guarantees | What the beat says, after it happens |
|---|---|---|---|---|
| 1 | **CLEAN** | your **Bidoof *(Normal)*** pawn can take a **Rattata *(Normal)*** pawn. Normal→Normal is 1× (verified) — chosen deliberately over Machop-into-Rattata, because Fighting → Normal is 2× and would teach lesson 2 by accident | first face 3–5 | "Normal into Normal — neither type has an edge. An ordinary capture, exactly as in chess. Notice the single slash: one death, and it points the way your piece moved." |
| 2 | **SURGE, and spend the bonus** | Machop *(Fighting)* can take Onix *(Rock)*. Fighting→Rock is 2× (verified) | first face 3–5 | "**WEAKNESS ×2.** You captured *and* the board turned gold — you move again. Now pick a **different** piece: a bonus move must be made by a piece that has not acted." Goal is `spendBonusSubMove`, so the lesson is not complete until they use it |
| 3 | **BACKLASH** | your Bellsprout *(Grass)* is offered a Skarmory *(Steel)* rook — a rook for a pawn, and the square is stamped with **twin cracks**. Grass→Steel is 0.5× (verified) | first face 3–5 → rung 0 | "Grass into Steel is **RESISTANCE**. Your attack bounced back and killed you both. The board told you: twin cracks mean two deaths. Sometimes that trade is still worth it — this one was, you took a rook." |
| 4 | **REPELLED** | the same Bellsprout, one turn later | first face 1 | "Same pieces, one face lower. This time you just bounced — you took a damage counter, and Skarmory is untouched. A failed attack is not free." |
| 5 | **BLOCKED — the most important moment in the tutorial** | your Gengar *(Ghost)* bishop, and a Bidoof *(Normal)* pawn undefended on its diagonal. Ghost→Normal is 0× (verified). `allow` restricts the action list so the player *will* try it | — | The square is drawn with a **dashed grey ring from the moment they pick Gengar up**, and the click is refused with a panel: "*Ghost cannot touch Normal. Not 'unlikely' — impossible, in the games too. This is the one rule that will feel like a bug the first time. Use a different piece, or a different move: Gengar's Sludge Bomb is Poison, and Poison into Normal is 1× (verified).*" Goal is `attemptBlocked`, so **the lesson requires the refusal to happen** |

Directive 2 calls lesson 5 the most important single moment because untouchability is the concept's most
surprising consequence. Directive 6 then requires the same explanation *permanently, outside the tutorial* —
which §10.4 already delivers, because the dashed grey ring and its one-line reason are properties of the board,
not of the tutorial.

### 10.10 Teaching the die (directive 3)

- **"You were right and it still went wrong"** — the player's Machop *(Fighting)* can take a rook that is
  *(Rock)*, a 2× matchup they have just been taught to look for. But the revealed first face is **1**, which
  drops two bands from `rung0 = 2` to **rung 0 — BACKLASH**: they would take the rook and die doing it. The
  square is stamped with twin cracks, not a gold star, and the lesson is complete only when they find the
  *other* move. Beat: "*You read the type chart correctly and the die still said no. That is exactly why the die
  is on the table before you choose — a bad face is not bad luck, it is information, and information is a
  plan.*"
- **"A crit rescued you"** — the mirror: a losing position where the first face is **6**, turning a neutral
  capture into a SURGE and a lost piece into a two-capture turn.

The pairing converts variance from *"the game cheated"* into *"the game told me and I planned around it"*.
Under a post-commitment die neither lesson is teachable.

### 10.11 First-time hints, and never nagging

- **Contextual first-time hints in real games**, one per mechanic, each shown **once ever**, each anchored to
  the thing that just happened, each dismissible permanently from its own body: first mutual destruction, first
  bonus sub-move, first hazard tick, first status, first ward pop, first Charge chevron, **first `CHART`
  rewrite**, **first Band Cap bind**, first promotion-evolution, first Tera. They are the same `Lesson.beats`
  rows fired by the same `EffectEvent` types, with `position`/`seed`/`goal` absent — **one authoring format, not
  two.**
- **Completion is tracked per lesson, not per tutorial.** A returning player opens a Lessons list and replays
  any single one; the list is grouped by track and shows which are new since they last played. Skippable
  entirely from the first screen, and the skip is remembered.
- **Nothing is ever gated behind the tutorial.** The sandbox is the default entry point with no account, so the
  game is playable seconds after load whether or not a lesson was ever opened.

### 10.12 Practice mode and puzzles

Distinct from the sandbox: **no stakes, no free play, a stated goal.** Four families, all data, all generated
*by the batch simulator* rather than hand-authored — which is what makes a hundred of them affordable:

| Family | Prompt | How it is generated |
|---|---|---|
| **Type puzzles** | "Win this in one move using a type advantage" | the simulator logs every position where exactly one action produces a CRITICAL or a King capture. Filter, dedupe by hash, publish |
| **Refusal puzzles** | "You have three captures available and two of them will kill you. Find the third" | logged from positions where ≥ 2 legal captures resolve to BACKLASH under the revealed roll |
| **Chain puzzles** | "Take three pieces this turn" | logged from positions with an `L = 3` chain available, which also teaches the baton rule by making it the obstacle |
| **Chart puzzles** *(new)* | "Your Ice bishop cannot touch that Water rook. Take it anyway." | logged from positions where the *only* winning action uses a `CHART` slot — Freeze-Dry, Tar Shot, Flying Press or a Ring Target. These are the puzzles that teach §7.9b, and there is no other way to teach it |

The puzzle corpus is a *by-product* of the tool §9.4 already requires. One instrument, two uses.

### 10.13 Teaching the draft and the meta-game

Drafting is a separate skill and gets its own track, entered the first time the player drafts:

1. **"Why one type per piece is a decision"** — the player is handed **Lapras** and asked to declare Water or
   Ice, with the Coverage Strip animating both futures. Measured: **526 of 1 025 base formes are dual-typed**, so
   51% of picks are a real choice. **And this is where the chart layer is taught, in the one place it is a
   decision rather than a surprise:** choosing Ice shows Water as a *hatched* covered cell, and the beat reads
   "*Ice is the worst defensive type on the board — and Lapras learns Freeze-Dry, which is the one move that
   deletes the matchup that would punish it. Taken as Water you are safe. Taken as Ice you are dangerous.*"
   (Verified: 23 species learn Freeze-Dry and Lapras is one of them.)
2. **"Read the matchup"** — shown the opponent's revealed army (it is public), the player picks the candidate
   that closes the largest gap in the 18-cell Coverage Strip.
3. **"An army, not a pile of favourites"** — the validator's requirements (§8.3) are taught as consequences: the
   player is *allowed* to build an army with no immunity breaker, shown the Coverage Strip's warning, and then
   dropped into a rigged game against a Levitate Flying piece they cannot touch. One game teaches it permanently.
4. **Collection and ladder lessons** fire at first contact, not at sign-up: the first post-match reward explains
   rarity from real `tags`; the first evolution explains that it transforms *your* individual; the first Gym
   Leader match explains that a mono-type army is a solvable puzzle and shows the Coverage Strip against that
   type.

---

## 11. The AI opponent

`recon-tech.md` measured this problem thoroughly and I take its architecture, because its measurements are
directly about this ruleset's shape.

**Search.** Alpha-beta negamax + PVS + quiescence in a Web Worker, no `SharedArrayBuffer`. A **ply is a
sub-move**: the node carries `(sideToMove, subsLeft, actedMask)`, does not negate on a bonus sub-move, scores
mates as `29000 − subMoveCount`, and counts progress and repetition in sub-moves. Measured on a variant searcher
with the real chart, illegal captures, mutual destruction and bonus chains: **7.1 M nodes/s in plain JS at EBF
3.8–4.2** — depth 8 in 148 ms, depth 9 in 601 ms. Target: **p95 ≤ 1.3 × budget with a 350 ms floor**, depth 8–9
at a 1-second budget.

**The mutation path is `makeAction`/`unmakeAction` over the op journal (§2.9), and this is not optional.**
Measured this pass: a deep clone of the state per node costs **20.8 µs (48 000 nodes/s)** and a sparse clone
**5.1 µs (196 000 nodes/s)**, against the journal's **53 ns (18.9 M nodes/s)**. Pass 2's `Rules` interface
offered only the immutable `apply`, which is **148× short of the number its own AI section quotes** — about four
plies at the measured EBF. The journal costs 19 rows of inverse (one per state-writing op), nests inside
`position.ts`'s existing `makeMove`/`unmakeMove` undo array, and gets the Zobrist restore for free because
`makeMove` already snapshots the whole key. `apply` is then *defined as* clone-then-`makeAction`, so there is one
resolution path and no drift.

**Randomness.** This is where §7.4 pays off twice. The Tempo Roll is revealed at the *turn boundary*, so within
a turn the search is fully deterministic — measured cost of input randomness: **+10% at depth 6, +0% at depth
8**, versus **121–159×** for full chance-node enumeration and a measured *negative* result for Ballard star1
pruning. At the boundary the opponent's next roll is a 6-way chance node, and the searcher collapses it to three
representative faces `{1, 4, 6}` with weights `{1/6, 4/6, 1/6}` plus a static EV bias — the bias is the
load-bearing half, since naive modal collapse mis-valued a measured position at +1012 where sound search said
+1906. Rider coins are collapsed to their expectation, because they cannot remove a piece.

**Move ordering and quiescence.** No SEE; instead a precomputed
`staticClash(attackerType, defenderType, face) → { P(die), P(bonus), Δmaterial }` table — 18 × 18 × 6 = 1 944
bytes — used both for ordering and for quiescence pruning. Critically: **do not prune losing captures**, since
capturing a queen with a pawn at 0.5× (both die) is often excellent in this variant.

**`CHART` costs the AI exactly one table lookup, and this is a design constraint I checked before adding the
op.** `staticClash` is keyed on `(attackerType, defenderType, face)`. A `CHART` op changes the *effective*
`defenderType` reading, so it is a **key rewrite, not a new dimension**: the searcher computes
`effType = chartOf(slot, defender)` once per move-generation (a 7-entry lookup, since only 7 entries in the dex
carry the op) and indexes the same 1 944-byte table. No new table, no branching factor increase, and the
`CHART` marks (Tar Shot, Grounded) are already in the Zobrist key because every mark is. Had `CHART` been
modelled as a chance node or a post-resolution rewrite, it would have cost a dimension; as a pre-roll key
rewrite it is free.

**Evaluation, tiered.** Incremental material and per-type count vectors at every node (measured 4 ns); mobility,
threat and king safety lazily inside a ±250 cp margin; army-level coverage/immunity/supply terms once per root.
Weights fitted by self-play, never by hand. Damage counters enter the eval as a fractional material term (a
2-counter piece is worth ~0.7 of itself **and hands +2 to its attacker**, so the term is larger than pure
material would suggest), slot charges as a small tempo term, and the **Charge counter** as a *threat* term rather
than a material one — a piece at charge 2 with a tier-5 area slot is a standing threat to eight squares, which
the quiescence search must see or it will walk into an Earthquake. `exposedAtStart` is carried in the node so
R5's new-exposure test is a set difference rather than a second `isAttacked` sweep (the shipped
`position.isAttacked` / `attackersOf` / `isAttackedIgnoring` are exactly the primitives needed, and
`isAttackedIgnoring` is already what `variant.ts` uses for the same job).

**Transposition.** One-shot wards make capture legality state-dependent, which measurably costs about a ply
(depth 9: 601 ms → 2 069 ms with the TT reduced to a best-move cache). Paid for as `recon-tech.md` prescribes: a
factorised ~6 500-key Zobrist (52 KB) built on the existing `zobristWords()` seam, epoch-splitting the probe key
on ward state, and mandatory TT-move revalidation.

**Difficulty is a corrupted copy of the AI's own effectiveness table**, which is the right dial for this game
because it makes the AI *misjudge types* exactly as `DIRECTION.md` asks: measured 5% corruption scores 47%,
15% → 45%, 30% → 37%, 50% → 30%, and a fully type-blind AI still scores 25% because it still plays real chess.
Corruption is structured rather than uniform (beginner AIs know the starter triangle; intermediates get the 8
immunities and Steel's resistances wrong). **A beginner AI also does not know the chart layer**: the 7 `CHART`
entries are simply absent from its `chartOf`, so it walks its Water rook next to a Freeze-Dry Lapras — which is
the most human mistake in the game and costs one line of the difficulty config. Second and third dials: army
quality (Really Bad Chess's approach) and a contempt/risk knob that changes how the AI values BACKLASH trades.

**Gym Leaders** need care: a mono-type army measured **36%** against a mixed army at equal search over 40 games,
a ~100–150 Elo composition handicap. So each Gym Leader gets a compensating search budget and a hand-checked
army, and the batch simulator verifies each gate lands in a 45–55% band before it ships.

---

## 12. The data model

### 12.1 Real signatures, compatible with what exists

```ts
// src/rules/state.ts
import type { PieceClass, Side, Square } from '../engine/board.ts';
import type { BattleType } from '../data/schema.ts';
import { Position } from '../engine/position.ts';     // chess substrate, unchanged
import type { RngState } from '../engine/rng.ts';

export type MarkId    = number;   // index into the generated 165-row mark table
export type MoveId    = number;   // uint16 into moves.bin
export type SpeciesId = number;   // uint16 into species.bin (1025 base + 342 lazy formes)
export type AbilityId = number;
export type ItemId    = number;   // 0 = none / consumed
export type PieceId   = number;   // Position's persistent id — survives moves and promotion

/** Sparse marks. Measured: a dense 165-byte array per scope costs 18.9 KB per state; this costs 1 416 B. */
export type PackedMark = number;  // (markId << 8) | durationOrLayers ; 0 = empty slot

/** Per-piece Pokémon state. Keyed by Position's piece id; Position itself stays Pokémon-ignorant. */
export interface PokePiece {
  readonly id: PieceId;
  species: SpeciesId;             // mutable: Mega, Stance Change, promotion-evolution
  declaredType: BattleType;       // THE central field. Exactly one. Defence only (§7.2)
  ability: AbilityId;             // public
  item: ItemId;                   // public; 0 once consumed or destroyed
  slotMoves: Uint16Array;         // length 4; slot 0 is the Melee slot (§7.2)
  slotCharges: Uint8Array;        // length 4; slot 0 is 255 = unlimited
  counters: 0 | 1 | 2 | 3;        // damage counters (§7.6). Always 0 for a King
  charge: 0 | 1 | 2;              // the Charge counter (§7.9a). Gates power-tier 4-5 ARTs
  boosts: Int8Array;              // length 7 [atk,def,spa,spd,spe,acc,eva], each clamped ±6
  marks: Uint16Array;             // length 8 PackedMarks — measured max simultaneous marks is 5
  flags: number;                  // PRISTINE | WARD_INTACT | CHOICE_LOCKED | USED_ACE | ACTED | KO_PENDING
}

export interface PokeState {
  chess: Position;                              // existing module: geometry, legality, castling, ep, hash
  pieces: PokePiece[];                          // dense array indexed by PieceId; never a Map (§2.9)
  squareMarks: Uint16Array;                     // 64 x 2 PackedMarks — hazards live here
  sideMarks: Uint16Array;                       // 2 x 8 — screens, Tailwind, Safeguard, Perish
  boardMarks: Uint16Array;                      // 4 — the single Stadium slot: weather | terrain | room
  schedule: ScheduledEffect[];                  // <= 1 per (side, kind); horizon provably <= 5
  tempo: readonly [1|2|3|4|5|6, 1|2|3|4|5|6, 1|2|3|4|5|6];   // PUBLIC (§7.4). EXCLUDED from the
                                                //   repetition hash - it is RNG output (§7.11)
  sub: 0 | 1 | 2;                               // sub-moves already taken this turn
  actedThisTurn: number;                        // bitmask over PieceId — the baton rule (T2)
  exposedAtStart: Square[];                      // attacker squares that could take the enemy King at
                                                //   turn start. R5's "NEW exposure" test reads this
  progress: number;                             // sub-moves since the last progress event (§7.11)
  ace: [boolean, boolean];                      // Tera-or-Burst budget per side
  prizes: [number, number];                     // the material HUD and the ranked tiebreak
  rng: RngState;                                // the shipped 4-tuple; advances only on the Tempo Roll,
                                                //   rider coins and seeded picks
  journal: Journal;                             // §2.9 — search only; empty on the immutable path
}
```

Four decisions with a non-obvious rationale, stated so nobody removes them as redundant:

- **`pieces` is a dense array, not a `Map`.** Measured: the `Map`-of-objects shape pass 2 specifies costs 20.8 µs
  to clone; a dense array of typed-array-bearing objects costs 5.1 µs, and the journal makes both irrelevant on
  the hot path. `PieceId` is already a small dense integer from `position.ts`, so the array is the natural
  representation and it is what the journal indexes.
- **`marks` is sparse.** Measured: a dense 165-byte-per-scope encoding costs **18.9 KB per state**; the packed
  `(markId << 8) | dur` form costs **1 416 bytes for the whole state** (13.4×), which is what goes on the wire,
  into snapshots and into the TT. The measured maximum simultaneous marks on one piece is 5, so 8 slots is
  generous.
- **`exposedAtStart`** exists because R5 is a statement about a *delta*, and recomputing turn-start exposure
  lazily inside the search would cost the `isAttacked` scan twice per node.
- **`charge` is separate from `slotCharges`** because they are different resources with different lifetimes —
  one is per-move ammunition from `pp`, the other is per-piece patience (§7.9a) — and collapsing them would
  delete exactly the mechanic that governs the action economy.

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
```

Six action kinds. `EffectEvent[]` is the *only* channel from engine to view: the engine advances state instantly
and emits serialisable events; a Presenter lays them on a fixed beat grid; nothing in the engine ever awaits an
animation, and any input calls `settle()` first.

### 12.3 Two decisions inside the model that are load-bearing

**Boosts stay a 7-vector.** **[DEVIATION from `recon-abilities-items.md` §2.4]**, which collapses all six stats
and every stat stage into one `Vigour ∈ [−3,+3]`. I reject the collapse because the fidelity is *free* — the
compiler reads `{atk:2}` off Swords Dance and `{def:2}` off Iron Defense with zero authoring — and the collapse
would make those two moves the same effect, destroy Unaware, Contrary, Simple, Clear Body, Power Trick, the 7
stat-swap moves and every `spe` mechanic, and violate `DIRECTION.md`'s "systematic but thematically wrong is a
defect". The legibility problem the collapse solves is real, and I solve it **in the UI**: the Clash needs
exactly two numbers, so the interface shows two.

```ts
might(P, slot)     = P.boosts[physical(slot) ? ATK : SPA] + Σ TILT('atk')
guard(P, incoming) = P.boosts[physical(incoming) ? DEF : SPD] − P.counters + Σ TILT('def')
crit(P, slot)      = Σ TILT('crit-window')      // clamped [0,2]; raises the Band Cap (§7.5 step 5a)
```

`spe`, `acc` and `eva` surface as three badges, not numbers. Seven fields in the engine, three numbers and three
badges on screen: progressive disclosure, exactly as asked. Note the sign on `counters` — negative, so a hurt
piece defends *worse*; pass 1 had it positive, which inverted its own damage-counter rule, and pass 2 fixed it.

**Kings have no counter track** (§7.6), so there is no second win route and no cheap royal chip-down.
---

## 13. Technical architecture

### 13.1 File tree

```
tools/compile/                     # BUILD TIME ONLY. Never shipped. Replaces scripts/gen-data.ts.
  index.ts                         # the six passes, deterministic, emits build/compile-report.json
  admit.ts                         # pass 1: isNonstandard policy, stable ids, the 165-row mark table
  derive-fields.ts                 # pass 2: C1  (§3.2)
  derive-fingerprint.ts            # pass 3: C2  — the 81-stem grammar + the 2-D REGION table (§2.4)
  derive-calls.ts                  # pass 4: C3  — 45 mutation + 53 predicate rows
  derive-returns.ts                # pass 5: C4  — 14 return rows + 6 assignment rows   <- NEW
  patch.ts                         # pass 6: overrides as diffs, proposalHash drift detection
  emit.ts                          # packs Effect[] to bytes; asserts the eight CI gates (§3.4)
  tables/{stems,mutations,predicates,returns,assigns,regions,fractions}.ts

data/curated/
  overrides.json                   # 125 rows — THE ENTIRE hand-written content surface
  item-classes.json                # the 60 inert-by-design items, named
  type-kits.json                   # 18 types x 6 moves — the moveset floor (§8.6)
  formats/*.json                   # pools, budgets, Kits, bans, requirements, Ace lists
  lessons/*.json                   # §10.7 Lesson rows: the whole tutorial, as data
  puzzles/generated.json           # §10.12, emitted by src/sim/ — never hand-authored

src/data/                          # EXISTS — extended, not replaced
  schema.ts                        # + Effect, Op, Trigger, Region, MarkRow, coverageClass, condition.duration
  dex.ts                           # + learnsets moved off the critical path (§3.5); public API otherwise same
  effects.ts                       # NEW: typed lazy access to the compiled effect tables
  generated/                       # + moves.bin, abilities.bin, items.bin, marks.bin, species.bin (columnar)
  coverage.test.ts                 # NEW: the §6 test — the most valuable test in the project

src/engine/                        # EXISTS — unchanged
  board.ts  position.ts  typechart.ts  rng.ts  zobrist.ts
  variant.ts                       # becomes the `classic` rules profile (§13.2a)

src/rules/                         # NEW: the thin layer
  state.ts                         # §12 types, clone/serialise, Zobrist mixing via position.xorHash
  journal.ts                       # §2.9 — the 19 inverses, makeAction/unmakeAction
  clash.ts                         # §7.5 — the ONLY place an outcome is decided (~130 lines)
  chart.ts                         # §7.9b — step 1b: the CHART composition, in log space
  turn.ts                          # §7.3 turn loop, sub-moves, Checkup, T1/T2/T3
  ops.ts                           # the 19 op implementations (~380 LOC total)
  regions.ts                       # the 16 region resolvers over board.ts geometry
  marks.ts                         # mark application, durations, ON_RESTACK, tick dispatch
  triggers.ts                      # the 14-trigger dispatch table
  legality.ts                      # generate(), Guarded-mode filter, R3 suicide guard
  terminal.ts                      # §7.11 draws, king capture, adjudication
  profiles.ts                      # 'standard' | 'classic' (ladder off, all-Normal) | 'guarded'

src/ai/          search.ts  eval.ts  order.ts  staticClash.ts  worker.ts  difficulty.ts
src/sim/         batch.ts  report.ts
src/draft/       draft.ts  price.ts  validate.ts
src/game/        autodraft.ts       # EXISTS — becomes Quick Draft
src/tutor/       lesson.ts  runner.ts  hints.ts  progress.ts  puzzles.ts    # ~450 LOC: lessons are data

src/ui/                            # EXISTS — extended per §10 and recon-visual/recon-tech
  App.tsx  BoardPiece.tsx  pieceRoles.ts  PokemonIcon.tsx  typeColors.ts  GameBoard.tsx  outcomes.ts
  silhouettes.tsx  fx/{layers.ts,ticker.ts,presenter.ts,ops.ts,regions.ts,skins.ts}
  panels/{WhyPanel,PieceCard,TempoRail,CoverageStrip,PrizeTrack}.tsx
```

### 13.2 Integration with what already exists — verified against the real code

- **`board.ts` is untouched.** `regions.ts` is written entirely in terms of its exports — `RAYS`,
  `KNIGHT_MOVES`, `KING_MOVES`, `BETWEEN`, `SLIDING_DIRECTIONS`, `PAWN_ATTACKS`, `reachableSquares`,
  `kingDistance` — including `RAY_LOS`/`RAY_ANY`, which are ray walks with a `kingDistance` clamp, and
  `FOE_ZONE`, which is `fileOf`/`squareAt` arithmetic. `reachableSquares`'s own doc comment already anticipates
  this layering: *"whether that square is a legal target depends on rules this module deliberately does not
  know — for a Pokémon Chess capture, occupancy by an enemy is necessary but not sufficient."*
- **`position.ts` is untouched** and becomes the chess substrate: `generateMovesInto(Int32Array)` supplies
  candidates, which `legality.ts` filters through `CLASH_LEGAL`. Under `profiles.classic` the filter is the
  identity and the module *is* chess, which is what makes the `chess.js` oracle test meaningful. Its
  `isAttacked`, `attackersOf` and `isAttackedIgnoring` are exactly R5's and R3's primitives, and its
  `makeMove`/`unmakeMove` undo array is the pattern §2.9 extends.
- **`zobrist.ts`'s documented seam is used as designed**: `zobristWords('type/Fire/12')`,
  `zobristWords('counters/2/12')`, `zobristWords('mark/burned/12')`, `zobristWords('charge/2/12')`, mixed with
  `position.xorHash()` when a fact becomes true and again when it stops. `makeMove`/`unmakeMove` already
  snapshot and restore the whole key, so search gets undo for free — quoting the file's own comment.
- **`repetitionCount()` needs no replacement** (§2.9): it compares the `hashHi`/`hashLo` snapshots in its own
  undo array, so mixing Pokémon words makes it Pokémon-aware with zero new code, and `tempo` is excluded because
  it is never mixed. Pass 2's "separate accumulator" is deleted from the plan.
- **`rng.ts` is used as-is**, and only in three places: the Tempo Roll (`d6` × 3 via `roll(6)`), rider coins
  (`chance`), and seeded selection. `fork(label)` keeps the draft's stream from perturbing the match's, and
  `RngState` is the 4-tuple the journal snapshots.
- **`typechart.ts` is used as-is.** `effectiveness()`, `captureOutcome()`, `outcomeOfMultiplier()` and
  `TYPE_PROFILES` already exist; `chart.ts` (§7.9b) sits above `effectiveness()` and never modifies it — the
  chart itself is immutable, and a `CHART` op edits only the *reading* of one Clash, which is what keeps
  `TYPE_PROFILES` valid as the draft's Coverage Strip source.
- **`dex.ts`'s API is unchanged**, with one measured change to `load()`: learnsets move off the critical path
  (§3.5, worth 74 KB gz). `effects.ts` sits beside it with the same lazy-`once` pattern.
- **`schema.ts` gains** the `Effect`/`Op`/`Trigger`/`Region`/`MarkRow` types, a `coverageClass` field and —
  measured as missing (§1.9 #5) — a `condition` field carrying `duration`. Its existing `SignalClass` is
  retained as a compiler *input*, and `coverageClass` supersedes it as the *output*, because `signalClass`
  currently reports Levitate as `fields`.
- **`App.tsx` is extended, not replaced** (~2 days): pieces move out of the square buttons into one
  transform-positioned layer keyed by piece id, and two Canvas2D layers are added underneath and above. This is
  a prerequisite for any capture animation at all, because today a `BoardPiece` is a child of its square's
  `<button>` and physically cannot travel.
- **`outcomes.ts` is re-keyed, not rewritten.** It already presents each outcome with label + glyph + colour +
  detail and its own comment says "never colour alone" — the right instinct. Its `CaptureOutcome` key becomes
  `Rung`, because REPELLED and BACKLASH are different outcomes that today both map to "not very effective".

### 13.2a Relationship to the shipped provisional rules layer (`src/engine/variant.ts`)

The repository ships a **playable** Pokémon Chess (`variant.ts` 520 lines + `variant.test.ts` 467 lines,
`GameBoard.tsx`, `autodraft.ts`, `outcomes.ts`) implementing the video's four rules plus the die. Its header
says its "PROVISIONAL" decisions await "the full specification being written in `docs/design/`". This section is
that revisiting, stated as a migration. **Most of `variant.ts` is right and is kept.**

**What is kept, and validates the design:**

| Shipped in `variant.ts` | §-reference | Note |
|---|---|---|
| `Loadout = ReadonlyMap<number, PokemonLoadout>` keyed by **persistent piece id** | §12.1 | the same decision for the same stated reason ("ids survive movement and promotion — which is exactly the shape evolution needs"). `PokemonLoadout` widens into `PokePiece`; the `Map` becomes a dense array for the journal's sake (§2.9) |
| **one declared type per piece**, even for dual-typed species | §7.1 | identical, with the same Lapras justification |
| type-illegal captures are **never generated** (`if (outcome === 'immune') continue`) | §7.5 step 1b, §2.2 | identical, and it is why `VETO` is a separate op |
| `VariantRules` as an explicit config object with `diceEnabled` | §13.1 `profiles.ts` | `RulesProfile` extends it; `diceEnabled: false` is already the spine of the `classic` profile |
| `maxExtraMovesPerTurn: 2` (a turn is at most three actions) | §7.11 **T1** | the same bound, and the same monovariant argument in its doc comment |
| the guard that a chain does not stall — `canContinue` checks the piece has a legal move before granting | §7.3 step 2 | the same instinct; §7.3 generalises it to the baton rule's eligibility set |
| immutable `play()` returning a new game, with search intended to use `makeMove`/`unmakeMove` | §2.9 | its own comment says "AI search will use the mutable path on `Position` directly instead" — §2.9 is that path, extended to the Pokémon layer, which is the piece it could not have known it needed |
| `ResolvedMove` carrying the roll, the multiplier, the cause and the removed ids | §2.7 `EffectEvent` | a single-outcome ancestor of the `clash` event; the Why panel is already possible |
| `outcomes.ts` presenting each outcome with label + glyph + colour + detail, "never colour alone" | §10.3 | already CVD-aware |

**The five PROVISIONAL decisions this specification changes:**

| # | `variant.ts` today | This spec | Why |
|---|---|---|---|
| 1 | **Checkmate is the win condition**; capturing a king is filtered out of `legalMoves()` outright | **King capture** (§7.12 R1); checkmate becomes a UI label | There is a **concrete defect** behind it: `result()` decides mate via `position.isInCheck()`, which lives in the deliberately Pokémon-ignorant `position.ts` and is therefore **type-blind**. The shipped game will declare checkmate when the only "mating" attacker is a Normal piece aimed at a Ghost king — a capture that is *illegal* — and will equally miss that a 0.5× "mating" piece dies if it tries. Making `isInCheck` type-aware does not fix it, because success depends on the opponent's future roll |
| 2 | **The die is rolled inside `play()`**, after commitment; `legalMoves()` explicitly may not depend on it | **The Tempo Roll is public at turn start** (§7.4) | the doc comment's own objection to a roll deciding a game — *"reads as unfair rather than exciting"* — is correct, and pre-revealing is the answer to it. It also buys `recon-tech.md`'s measured **~150× AI saving** and is what makes changes 3 and 5 possible |
| 3 | `captureIsSafe()` forbids any capture that **could** leave your own king attacked under mutual destruction | **R2/R3**: leaving your king capturable is legal; only a resolution that *necessarily* removes your own king is illegal | The conservative rule is the right call *given a hidden die* — with an unknown roll, "could" is the only computable quantifier. Once the roll is public, **"necessarily" becomes exactly decidable**, so the rule tightens to Atomic's actual formulation without ever letting a hidden roll lose a game. Same bug fixed, strictly less collateral |
| 4 | the extra move **must be played by the capturing piece** (`mover.id !== pending.pieceId → skip`) | **T2, the baton rule**: the bonus sub-move must be played by a piece that has **not** yet acted this turn | the shipped rule reads well ("the piece pressing its advantage") but it is the "one super-typed piece mows the board" degeneracy `recon-variants.md` §1.3 documents in every extra-move variant. English Progressive Chess's rule turns a chain into a **team combo**, which is better flavour *and* better legibility — §17 turn 6 shows the difference |
| 5 | the extra move is **mandatory** (no way to decline) | `{kind:'decline'}` in the action space (§12.2) | `recon-tech.md`'s ruling: a mandatory extra move is an undesigned zugzwang mechanic players will report as a bug, and the AI needs the branch to evaluate chains honestly |

**Two additive changes, not corrections:** `Resolution` grows from four values to the **five rungs plus BLOCKED**
(§7.5), so `OUTCOME_PRESENTATION` must be re-keyed from `CaptureOutcome` to `Rung`; and `GameResult` grows the
terminal set of §2.7 (`king-captured`, `immobile`, `perpetual`, `adjudicated`).

**Migration shape, and it is small:** `variant.ts` becomes the **`classic` profile** of `src/rules/`. Its
four-outcome resolver is the special case `profiles.classic` selects, which keeps the currently playable game
working *throughout* the migration and keeps `classic-vs-chessjs.test.ts` meaningful. `PokemonChess` is renamed
to the `Rules` interface's six methods (`generate`/`apply`/`makeAction`/`unmakeAction`/`terminal`/`staticClash`)
with its current bodies as the first implementation. **M1 is therefore not "build the rules layer" but "evolve
the shipped one"** — which is why its 9-day estimate is credible.

### 13.3 Determinism and the network property

A whole game is `{ formatId, seed, actions: Action[] }`. The same engine module runs in Node and the browser, so
the server validates every action with the identical code, replays are free, spectating is free, reconnect is
replay, and desync is a state-hash comparison. Nothing in `src/rules/` may touch `Date`, `Math.random` or the
DOM; an ESLint rule and a CI check enforce it. **The server owns the Tempo Roll** — with public dice, that is
also the only thing worth cheating on, and it is exactly one value per turn.

### 13.4 Tests

| Test | What it protects |
|---|---|
| `coverage.test.ts` (§6) | the whole content claim, 1 797 entries, on every build — **including gate 8, the handler-partition sum, which is the gate that would have caught `CHART`** |
| `compile-determinism.test.ts` | byte-identical output for identical inputs |
| `classic-vs-chessjs.test.ts` | under `profiles.classic`, perft to depth 5 from 20 positions must equal `chess.js` — the variant reduces to chess exactly |
| `clash.table.test.ts` | all 324 ordered type pairs × 6 faces × 4 tilt values against a hand-written expectation table (7 776 rows, generated once and reviewed). **Regression cases: a defender at 2 counters is *easier* to capture; a `def −2` defender hands +2 to the attacker; a Confused *attacker* ends its own turn on tails; a King is capturable at 0.5× by a type it would otherwise be immune to; and — new — a resisted attacker at `might = 6` still cannot exceed CLEAN (the Band Cap)** |
| `chart.test.ts` | **new.** All 7 `CHART` entries: Freeze-Dry makes Ice→Water read 2× and *only* against Water; Flying Press composes to 2× vs Grass, 1× vs Steel and **0× vs Ghost**; `CHART{d}` never crosses 0×; `CHART{set:1}` on Ground→Flying yields exactly neutral, never super-effective; two stacked `CHART`s clamp at 4× and therefore at `rung0 = 2`; a `CHART` cannot re-immunise a King (R6 is applied after step 1b) |
| `journal.test.ts` | **new.** `unmakeAction(makeAction(s,a))` restores a byte-identical serialisation for 10 000 random actions from 200 random positions, and `apply` agrees with `makeAction` event-for-event — the invariant that keeps the two mutation paths from drifting |
| `dispatch.test.ts` | §2.8: a state serialised, reloaded and re-run emits a byte-identical `EffectEvent[]` — the desync guard |
| `tutorial.test.ts` | §10.7: every `Lesson` row's goal is achievable from its position and seed, and every `beat` references an event type the engine emits on a successful run. **A rotted lesson fails CI** |
| `termination.test.ts` | property: no turn exceeds 3 sub-moves; no action sequence increases total piece count; `INVOKE` depth is always 1 |
| `progress.test.ts` | property: the Leftovers-vs-poison loop, the stand-still-and-charge loop and the Tar-Shot-repaint loop all reach the no-progress draw |
| `repetition.test.ts` | two positions differing only in damage counters, marks, charges or `CHART` marks hash differently; identical positions with different RNG counters and different `tempo` hash the same |
| `legality.r3.test.ts` | R3: every action that necessarily removes your own King under the revealed roll is absent from `generate()` |
| `exposure.test.ts` | T3: after any sub-move that creates a *new* exposure, `generate()` returns only `decline`; and by search, the King is never capturable from an exposure created this turn |
| `guarded.test.ts` | **new.** R8's filter never returns an empty action list |
| `ai-regression.test.ts` | fixed-node search returns the known best action in 40 tactical positions, **including 5 that require seeing a `CHART` slot** |
| `budget.test.ts` | critical-path gzip ≤ 60 KB (measured 37.6 at M1, ≈52 at M4); entry chunk ≤ 110 KB; **learnsets are not in the initial load**; no `@pkmn/*` in the client bundle |
| visual fixtures (5, from `recon-visual.md`) | greyscale role legibility, CVD sweep, token contrast, outcome-silhouette pixel diff, worst-case frame budget |

---

## 14. The meta-game, and the netcode

The seam is §8.1 and everything here sits above it.

- **Ownership is of individuals**, per `DIRECTION.md`'s recommendation: three separate Pikachu, each fieldable.
  Duplicates are immediately useful, the 16-piece floor clears trivially, and it matches how Pokémon works. An
  owned individual carries `{ speciesId, declaredTypePreference, ability, slotSwap, nickname, cosmetics,
  record }` — deliberately *not* per-individual power, so collection depth never becomes raw strength.
- **Starter grant: 20 individuals** covering ≥ 12 types with a legal 16-piece army pre-built, so a new account
  plays immediately. Post-match rewards: **3 candidates on a win, 1 on a loss** (progress every match, win or
  lose). Expected collection: ~23 after 1 match, ~45 after 10, ~130 after 50, ~500 after 500, with rarity gated
  by real data (`tags`, `bst`, `tier`, `nfe`) and a pity counter on Legendary/Mythical.
- **Evolution is the headline progression axis** and it is the *same* `BECOME` op: an individual evolves when it
  has been fielded in N wins or meets its real `evoItem`/`evoCondition`, and evolving **transforms the
  individual** rather than consuming one and creating another — so your Charizard is *your* Charmander.
  Branching lines are a real choice; trade evolutions are the meta-game's one genuine reason for trading.
- **Fairness against collection depth** — the problem most likely to kill the game. Three answers, layered:
  ranked play is **point-buy budgeted** (a 20-Pokémon account and an 800-Pokémon account field armies of equal
  cost); ranked formats are **type-scoped seasons** (a Steel-legal season limits the value of hoarding); and the
  **Mirror Pool** queue drafts both sides from one shared pool of 40 candidates, where collection size is worth
  exactly zero.
- **Ladder:** Glicko-2 internally, the eight Kanto badges in canon order as the displayed identity, Elite Four
  above, Champion as a top-N leaderboard. "Highest badge earned" is stored separately from "current tier" so the
  ladder can be brutal without the profile feeling punitive. **Gym Leader promotion matches** gate each tier: a
  mono-type AI army is a legible, solvable type puzzle, which teaches the chart by making you use it (with the
  36% handicap compensated per §11). Note a happy consequence of §7.9b: **a mono-type Gym Leader army is exactly
  what a `CHART` move is for.** Misty's all-Water army is a nightmare for an Electric-poor collection — until you
  bring one Freeze-Dry Ice piece, which is the most satisfying possible answer to a gym.
- **Sandbox first, no account:** full dex, both armies free, AI-vs-AI, adjustable strength, a position editor,
  shareable seeds, and the batch simulator (§9.4) exposed as a player-facing curiosity.

**Netcode, concretely**, because the engine's purity makes it small. The wire protocol is five messages, and a
whole game is `{formatId, seed, actions: Action[]}`:

| Message | Direction | Payload |
|---|---|---|
| `join` | C→S | `{formatId, ratingCert}` |
| `state` | S→C | `{seed, army[2], turn, tempo, hash}` — sent once, then never again except on reconnect |
| `act` | C→S | `{turn, sub, action: Action, clientHash}` |
| `applied` | S→C | `{turn, sub, action, events: EffectEvent[], hash, tempoNext?}` |
| `terminal` | S→C | `{result: Terminal, prizes, ratingDelta}` |

- **The server owns the Tempo Roll and is the only source of `rng`.** It resolves every action with the identical
  `src/rules/` module the client runs, so there is no reimplementation to drift.
- **Desync detection is free**: every `act` carries the client's state hash and every `applied` returns the
  server's. A mismatch resyncs by replaying the action list, which is also how reconnect works.
- **Turn timers**: 60 s per turn plus a 3 min reserve, with **bonus sub-moves drawing on a separate 20 s budget**
  so a three-capture turn cannot be lost to the clock. 60 s reconnect grace, then forfeit; abandonment inside the
  first three turns is a no-rating cancel.
- **Matchmaking pairs on rating *and* pool depth.** The ranked default is the **Mirror Pool** queue. Collection
  queues exist for players who want to field what they own, and pair within a depth band. Target queue time
  30 s, widening the rating window by 50 Glicko points every 10 s to a cap; below a healthy population the queue
  offers a Gym Leader match instead of waiting.
- **Chat is a fixed quick-chat vocabulary** for public matchmaking, free text only between mutual friends.
  Pokémon's audience includes children and free text between strangers is a moderation liability we are not
  equipped to carry.
- **Trading is server-authoritative, atomic, both-sides-lock, friend-gated, with a 24 h cooldown per pair** — and
  it exists mainly because **trade evolutions are real** (Machoke → Machamp).

---

## 15. Milestones — each one complete and playable

| # | Ship | Contents | Effort |
|---|---|---|---|
| **M0** | **The compiler, headless** | passes 1–6, the 245 table rows, `build/compile-report.json`, `coverage.test.ts` green over all 1 797 entries **with gate 8 (the handler partition) enforced**, `condition.duration` emitted, the columnar species bundle, and `budget.test.ts` green at 37.6 KB. No game yet — but the content claim is *proved* before any rule depends on it, and the 268 KB bundle problem is fixed before it is inherited. | 6 d |
| **M1** | **Playable hot-seat Pokémon Chess** — *by evolving the shipped `variant.ts`, not replacing it* (§13.2a) | `src/rules/` complete: turn loop, **Tempo Roll (change 2)**, the five-rung Clash **with the Band Cap**, damage counters, Checkup, **king capture (change 1)**, R2/R3 (change 3), the **baton rule (change 4)**, `decline` (change 5), draws, promotion, and **the journal (§2.9) from day one** because retrofitting it later means rewriting every op. Melee slot only — **no ART actions, no Charge counter, no abilities, no items.** Full chess plus the type chart plus the ladder. Silhouette pieces, five outcome animations, the outcome-annotation affordance, the Why panel. Playable at every commit, because `variant.ts`'s resolver becomes the `classic` profile on day one and the new ladder lands beside it. | 9 d |
| **M2** | **The AI** | worker search over `makeAction`/`unmakeAction`, staticClash, tiered eval, three difficulty tiers by corrupted chart, `ai-regression.test.ts`. | 6 d |
| **M2b** | **The tutorial and practice mode** | `src/tutor/`, the two tracks, the five outcome lessons, the two die lessons, first-time hints, per-lesson completion, `tutorial.test.ts`. Ships **immediately after the AI** and **before** moves, abilities and items — because the M1 ruleset is already the hardest thing to teach, and a tutorial written against a stable rule set is one that does not get rewritten twice. Puzzles arrive with the simulator at M6. | 5 d |
| **M3** | **Moves, including the chart layer** | ART actions, all 16 regions, the Charge counter, slot charges, riders, hazards, status, the 14 triggers, **`CHART` and §7.9b** (which is one resolver stage, one mark `mod`, one Coverage-Strip animation and `chart.test.ts`), FX from the ISA. The 950-move layer arrives *as data* — this milestone is mostly UI and region geometry. Each new mechanic adds one hint row and one lesson row, never a system. | 8 d |
| **M4** | **Abilities and items** | trigger dispatch for the remaining hooks, the Standard 12 Kit, wards, the draft's ability radio. Again mostly data: the ops already exist. | 5 d |
| **M5** | **Draft and formats** | slot-first draft, point-buy, requirements, presets, Coverage Strip, `PoolSource` parameterisation. | 6 d |
| **M6** | **Sandbox and the batch simulator** | AI-vs-AI, seeds, position editor, the §9.4 metric set including **the Band Cap bind rate** — then retune the ladder, α/β/ε/τ, the Charge gate and the point list from measurements, and emit the §10.12 puzzle corpus (four families) as a by-product. | 5 d |
| **M7** | **Tera, Burst, Mega, evolution-promotion** | the remaining `BECOME` payloads and their art. | 4 d |
| **M8** | **Collection and progression** | local-first profile, rewards, evolution-through-play, Pokédex. | 8 d |
| **M9** | **Server and multiplayer** | authoritative validation with the same module, friends, friendly games, matchmaking, ranked with badges, Gym Leaders. | 15 d+ |

The order is deliberate, and there are four arguments in it:

- **M0 before M1.** If the compiler cannot reach total coverage, that must be known before a ruleset is built on
  the assumption that it can. M0 ships no game and is still the most valuable six days in the plan. It is one day
  longer than pass 2 budgeted, and the day buys pass 5, gate 8 and the bundle fix.
- **The journal ships in M1, not in M2.** This is the one ordering change from pass 2 and it is not negotiable:
  `makeAction`/`unmakeAction` is an inverse per op, so writing the ops without it means writing all 19 twice.
- **M1 is a complete game without moves, abilities or items.** The Melee slot means ordinary chess plus the chart
  is already the game — five outcomes, damage counters, king capture, draws, promotion, the outcome annotation,
  the Why panel. It is 15 days in and you can hand it to a stranger.
- **M2b before M3.** Teaching comes before content. The alternative — build all 950 moves, then work out how to
  explain them — is how a maximalist game becomes unplayable. Writing the tutorial against the M1 rule set forces
  the M1 rule set to be *teachable*, and every milestone after it pays a one-lesson, one-hint tax.

Honest total: **~54 days to M7** (a complete single-player game with all content, a tutorial and practice mode),
**~15+ more** for the server, ladder and Gym Leaders.

---

## 16. Faithfulness ledger — 24 named pieces of content

The test `DIRECTION.md` sets is: *a Pokémon player must recognise this as that thing behaving the way it behaves.*
Each row names the canon it comes from. Every type multiplier quoted here was verified against the chart this
pass.

| Content | In Pokémon | On the board | Why a player calls it right |
|---|---|---|---|
| **Freeze-Dry** (23 species) | an Ice move that is **super effective against Water** — the game's most famous chart exception — *games* | its slot reads Ice→Water at **2× instead of 0.5×**, so the same attack flips from *both pieces die* to *capture and move again* | It is the exception, in the exact place the exception lives. And the fidelity is not decorative: on a board where 0.5× means mutual destruction, "Freeze-Dry beats Water" is the difference between an Ice piece being a liability and being a weapon. Measured: there is **no field** in the dataset that says this — it exists here only because the compiler reads `if (type === 'Water') return 1;` out of Showdown's source |
| **Flying Press** (Hawlucha) | a Fighting move that also counts as Flying, so its effectiveness is the **product of both types** — *games* | the Clash is read as Fighting **and** Flying at once: 2× vs Grass, 1× vs Steel, still **0× vs Ghost** (all verified) | The product rule is the mechanic, and it is one field (`{union:'Flying'}`) rather than a table. That it stays illegal against Ghost is the detail a Pokémon player checks first |
| **Tar Shot** | lowers Speed and makes the target **take more damage from Fire** — *games* | paints a persistent mark; thereafter **every Fire piece on your side reads one band better** against that piece | It is a debuff that helps your *other* pieces, which is exactly how Tar Shot is used, and it is the only team-wide chart edit in the game |
| **Levitate** (42 species) | immune to Ground moves — *games* | Ground captures against this piece are **illegal**; the first attempt pops the ward and the second lands | It is exactly the immunity, and the one-shot bound is not invented: it is **Air Balloon's printed text** ("Pops when holder is hit") applied uniformly. `DIRECTION.md` names this mapping itself as the standard for "good" |
| **Iron Ball** | grounds the holder; a Flying holder **takes neutral Ground damage** — *games* | a visible `grounded` mark that reads Ground into this piece as **exactly 1×**, plus `−1 spe` | The word in the item's own text is *neutral*, not *legal*, and the `CHART{set:1}` form is the only one of the three that says neutral. It is also the answer to the untouchable-piece problem that costs no ability and no ban |
| **U-turn** (9 self-switch moves) | hit, then switch out — *games* | capture, then **return to the square you came from**; rotation-class statuses clear | One boolean field (`selfSwitch`) becomes the most tactically distinctive capture in the game. `DIRECTION.md` names it as the faithfulness exemplar |
| **Sticky Web / Spikes / Stealth Rock / Toxic Spikes** | hazards on the opponent's side that punish whatever arrives — *games* | paint a 3-square band of the enemy's third rank; fires when an enemy **ends a move** there; **Stealth Rock scales with the arriving piece's type** (Ice takes 2 counters, Steel takes 0 — Rock→Ice is 2×, verified) | Layer counts (3/2/1/1), persistence, the type scaling and now the **second-layer behaviour** (`ON_RESTACK`) are all read from the dex |
| **Rough Skin / Rocky Helmet** | the attacker takes damage on contact — *games* | whatever captures this piece **by contact** takes a damage counter | The `contact` flag is real data; the counter is the TCG's damage counter. "Attacking is not free" is why you draft Garchomp |
| **Choice Band / Specs / Scarf** | +50% to one stat, but you are locked into one move — *games* | +1 Clash roll (or +2 movement), and the piece is **locked to the slot it first used** for the rest of the game | The lock is the item's whole identity, and on a chess board "you may only ever do that one thing again" is a sharper cost than a number |
| **Focus Sash** | survives one otherwise-fatal hit at full HP — *games* | the first capture that would remove this **pristine** piece fails; the attacker stays put; the Sash is consumed | Identical trigger (`target.hp === target.maxhp` maps exactly onto `pristine`), and the one-directional rule ("a shield does not protect you from killing yourself") is what stops it becoming a free-queen exploit |
| **Wonder Guard** (Shedinja) | only super-effective moves can hurt it — *games*; the TCG card prints it as **immune to Evolved Pokémon, Basics get through** | uncapturable by Queen, Rook, Bishop and Knight; **always** capturable by any Pawn or King; hazards and status still kill it | Both canons are honoured: the games' "nearly everything bounces" feel with the TCG's own bound. Shedinja dies to Stealth Rock, which is exactly how Shedinja dies |
| **Sticky Hold / Ability Shield / Mega Stones** | the item cannot be removed — *games* | theft, Knock Off and Trick are **illegal** against it | Measured: **98 handlers** in the dex exist only to say "no" to `onTakeItem`. One grammar row honours all of them, which is why the item layer has real texture instead of a blanket rule |
| **Belly Drum** | halve your HP, maximise your Attack — *games* | take a damage counter, gain the maximum attack boost | The numbers are read out of Showdown's own source (`directDamage(maxhp/2)`, `boost({atk:12})`), so it is the real trade rather than an approximation |
| **Trick Room** | for five turns, slower Pokémon move first — *games* | for five turns, **negative-priority moves are the ones that may interrupt**, and positive-priority moves cannot | It inverts initiative, which is what Trick Room *is*, and it brings 14 measured negative-priority moves to life for a window. Duration 5 is the dex's own number |
| **Baton Pass** | switch out and pass your stat boosts to the incoming Pokémon — *games* | retreat to your origin and **leave your boosts and marks on the square you vacated**; the next friendly piece to arrive inherits them | The "hand off what you built" fantasy survives on a board with no bench, and the +2 cap is the bound that keeps it from being a value loop |
| **Terastallization** | the Pokémon's type changes, once per battle, at a cost — *games*; the TCG prints Tera cards **off-type with a re-derived Weakness** | once per side per game, a piece's declared type becomes another of its legal types; **your turn ends** | Semantics from the games, price from the TCG's Mega Evolution rule ("When 1 of your Pokémon becomes a Mega Evolution Pokémon, your turn ends") |
| **Poisoned / Burned** | damage every turn; burn also weakens physical attacks — *games*; the TCG marks them with **stackable counters** | +1 damage counter at your Checkup (Toxic +2); Burned also −1 to physical Clash rolls; three counters is a Knock Out | The TCG's own instrument, name and visual. It is also why an immune piece is never safe |
| **Paralysis / flinch** | par halves Speed and sometimes stops you; flinch costs you the turn — *games*; the TCG's Paralyzed **costs exactly the next turn, then clears** | one mark, **Stunned**: the piece loses its next activation, then clears | The TCG's version, chosen deliberately: a permanent hidden 25% failure chance is the worst possible mechanic in a chess variant. **107 measured applications** collapse into one rule and one visual |
| **Protect** | blocks the incoming move; using it repeatedly fails more and more often — *games* | uncapturable for one reply; consecutive uses succeed with probability `(1/3)^n` | The escalation formula is **Showdown's own**, extracted from `effectState.counter = 3` plus the `onRestart` handler, so stalling is self-limiting without an invented rule. It needs the 14th trigger to work at all |
| **Earthquake / Explosion** | hits everything adjacent, including your own team — *games* | Clashes against all 8 neighbours, friend and foe; Explosion then removes the caster | Friendly fire is the whole reason Earthquake is a decision in doubles, and it becomes a new chess idea for free |
| **Expert Belt** | +20% to super-effective moves — *games* | +1 Clash roll **only when the matchup is super-effective** | An item that pays you for knowing the type chart, which is this game's entire thesis wearing a held-item sprite |
| **Soak** (and Magic Powder, Forest's Curse, Trick-or-Treat) | changes the target's type to Water — *games* | the enemy piece's **declared type becomes Water**, permanently and publicly, and its enamel field repaints | On a board where type is identity, rewriting an enemy's type rewrites what may capture it. Invisible to any design built on `@pkmn/dex`, which carries no type-change field at all |
| **Screech / Metal Sound / Leer** (31 measured moves) | lowers the target's Defence by two stages — *games* | the enemy piece hands **+2 to every attacker's Clash roll** for the rest of the game | Boosts do not decay in the games either, and a defence debuff being an *investment in someone else's attack* is how Screech is used in a real double battle. It is also legal against a piece you cannot touch, because 270 of 271 Status moves carry `ignoreImmunity` |
| **Sucker Punch** | goes first, but **fails unless the target is attacking** — *games* | may be declared as a Reaction **only against a piece that is attacking you**; one charge, one chance | The restriction is the move. A priority attack with no condition is Quick Attack; the read is what makes Sucker Punch famous, and it survives translation without an invented clause |
| **The Charge counter** | *TCG Pocket*'s Energy Zone; and the games' `flags.charge` / `flags.recharge` two-turn moves | 0–2 chevrons per piece, +1 per turn the piece stays still, reset to 0 on a capture, required to fire the 166 measured tier-4/5 moves | When the franchise itself built a digital board game with a small action budget, this is the shape it chose. It also *is* Hyper Beam's recharge and Solar Beam's wind-up, stated once instead of as two special cases |

Two rows of honesty, both required by `recon-tcg.md`:

- **Mutual destruction is not Pokémon-authentic.** Neither canon has an attack that kills the attacker on a bad
  matchup. It is Kamikaze Chess (Laws, 1928) and Stratego's equal-rank rule, and it is the video's rule. The UI
  labels it as a **chess** rule in the Why panel rather than implying it is Pokémon. *Note what §7.9b buys here:*
  the three canon counters to mutual destruction (Freeze-Dry, Tar Shot, Tinted Lens) are all **content**, so a
  player's answer to the one unfaithful rule is itself faithful.
- **The bonus move for a super-effective capture *is* Pokémon-authentic**, via the TCG: a ×2 Weakness is worth
  exactly one turn of tempo in the modal case (measured: 1 306 of 3 683 current-era attacks against the median
  110 HP target). "Super effective ⇒ move again" is the TCG's Weakness translated into a binary-capture game, and
  the UI uses the TCG's own vocabulary — **WEAKNESS** and **RESISTANCE** — on the capture banner. The Band Cap is
  the same discipline: the TCG's Weakness is worth **one** tempo step, never two.

---

## 17. A worked game

**Format:** Standard, `full-dex` pool, Standard 12 Kit. Seed `pokechess/demo-1`. Every chess move and every FEN
below was validated with `chess.js` this pass (`syscomp3-10-game.mjs`); every type value was verified against the
chart (`syscomp3-6-chart.mjs`).

**White (Bone army).** King **Slowking** *(Psychic)* e1 · Queen **Nidoqueen** *(Ground)* d1 ·
Rooks **Steelix** *(Steel)* a1, **Forretress** *(Steel)* h1 · Bishops **Alakazam** *(Psychic)* c1,
**Gengar** *(Ghost)* f1 · Knights **Rapidash** *(Fire)* b1, **Garchomp** *(Dragon)* g1 ·
Pawns a2–h2: Bidoof *(Normal)*, Zubat *(Flying)*, Sandshrew *(Ground)*, Roselia *(Grass)*,
**Machop** *(Fighting)*, Magnemite *(Steel)*, Pikachu *(Electric)*, **Lapras — declared *Ice*, slots
`Ice Shard | Freeze-Dry | Sparkling Aria | Life Dew`**.
Forretress holds **Heavy-Duty Boots**; Machop holds **Expert Belt**; Gengar holds **Focus Sash**.

**Black (Ink army).** King **Tyranitar** *(Rock)* e8 · Queen **Gardevoir** *(Psychic — a draft decision that
decides this game)* d8 · Rooks **Onix** *(Rock)* a8, **Skarmory** *(Steel, ability Sturdy)* h8 ·
Bishops **Chandelure** *(Ghost)* c8, **Starmie** *(Water)* f8 · Knights **Zebstrika** *(Electric)* b8,
**Mudsdale** *(Ground)* g8 · Pawns a7–h7: Rattata *(Normal)*, Ekans *(Poison)*, Cubone *(Ground)*,
**Bellsprout** *(Grass)*, Charmander *(Fire)*, Gastly *(Ghost)*, **Wooper *(Water)***, Snorunt *(Ice)*.

Note the draft asymmetry the game turns on: Black has **three Water declarations available** (Starmie, Wooper,
and Snorunt could have been Water) and took two. White has one **Ice** piece with **Freeze-Dry** in slot 1.
Neither player can see the other's slots at draft — but both armies are public from move one, so this is a read
Black could have made and did not.

### Turn 1

**White — Tempo Roll `[4, 3, 5]`.** A middling turn: no face reaches the +1 band, so no neutral capture would
earn tempo. White develops: **e2–e4**, Machop *(Fighting)* to e4.
**Black — Tempo Roll `[2, 6, 1]`.** Face 1 is a 2 — the worst face — but Black has no captures anyway.
**e7–e5**, Charmander *(Fire)* to e5. The centre is contested by a Fighting pawn and a Fire pawn, and neither is
super-effective on the other (verified 1×), so neither wants to be the one to strike.

### Turn 2

**White `[6, 2, 4]`.** A 6 on face 1 is the best face in the game — any neutral capture becomes a SURGE and any
super-effective capture a CRITICAL. White has no capture yet, so it *develops toward one*: **Ng1–f3**, Garchomp
*(Dragon)* to f3, now eyeing e5.
**Black `[3, 3, 6]`.** **Ng8–f6**, Mudsdale *(Ground)* to f6, attacking e4. Ground into Fighting is 1×, and
Black's faces are 3 and 3 — the flat band — so a capture next turn would be an ordinary CLEAN trade.

### Turn 3

**White `[5, 1, 3]`.** White uses the turn for an **ART action** — the low second face makes this a support turn.
**Forretress (h1) uses Stealth Rock.** It does not move; it spends 1 of its 4 charges; the `FOE_ZONE` region
paints the enemy's third rank on the caster's file ± 1, clamped at the edge: **g6 and h6 are now under Stealth
Rock.** Two rule details that matter later: an ART does not relocate the rook, so **White's castling rights
survive**; and Forretress holds Heavy-Duty Boots, so it is immune to Black's hazards in turn.
**Black `[4, 4, 2]`.** Black advances instead of trading: **d7–d5**, Bellsprout *(Grass)* to d5. This opens the
d7 square — which White notices.

### Turn 4 — the first chain

**White `[6, 4, 3]`.**

- **Sub-move 1: e4xd5.** Machop *(Fighting)* captures Bellsprout *(Grass)*. Fighting into Grass is 1× (verified),
  so `rung0 = 1`; face 6 gives `step = +1`; Machop holds Expert Belt but the matchup is not super-effective so
  the belt is silent. `might = 0`, so the Band Cap sits at `rung0 + 1 = 2` and does not bind. **rung 2 = SURGE.**
  Bellsprout is removed, Machop takes d5, the board frame turns gold and White has a bonus sub-move.
- **The baton rule bites.** Machop has acted, so the bonus sub-move must be made by a *different* piece. The
  board dims every piece except those that have not yet acted.
- **Sub-move 2: Bf1–b5.** Gengar *(Ghost)* develops with the bonus, using face 4. And because d7 is now empty,
  the b5–c6–d7–e8 diagonal is open: **Gengar attacks Tyranitar, Black's King.**
- **T3 fires.** Gengar's arriving square, b5, was not in `exposedAtStart` — nothing could take Tyranitar when
  White's turn began — so this is a **newly created** exposure, and **White's turn ends immediately** (R5); a
  third sub-move would have been forfeit if one had been earned. This is the rule that makes king capture safe:
  Black is guaranteed a full turn to answer. Note the counterfactual: had Black's King *already* been exposed at
  the start of White's turn, White could have played sub-move 2 freely, because the threat White would be
  "creating" would be one Black had already had a turn to deal with.
- The HUD shows Black's persistent **"YOUR KING CAN BE TAKEN — Gengar (Ghost) from b5; Ghost into Rock is 1×
  (verified); CLEAN on faces 3–6, BACKLASH on 2, REPELLED on 1."**

**Black `[2, 5, 4]`.** Black must answer, and Black's first face is a 2 — the worst face — so a capture would
resolve one band *down*. **c7–c6**, Cubone *(Ground)* to c6: it blocks the diagonal **and** attacks Gengar. Black
also silently notes that with a face of 3–5 next turn, Cubone into Gengar (Ground into Ghost, 1× verified) is a
CLEAN capture of a bishop with a pawn.

### Turn 5

**White `[2, 6, 5]`.** Face 1 is a 2. Every capture on the board resolves one band worse than usual, so **White
declines all of them** — this is the lesson the public roll teaches in one turn: *a bad face is not bad luck, it
is information, and information is a plan.* White also cannot leave Gengar on b5. **Bb5–a4**, Gengar retreats
along the diagonal, still eyeing c6 and keeping the Sash intact.
**Black `[3, 3, 6]`.** **g7–g6**, Wooper *(Water)* to g6 — and g6 is under Stealth Rock. The hazard's `ON_ENTER`
tick fires: Rock into Water is 1× (verified), so Wooper takes **1 damage counter**, and one pip lights on its
bezel. Had that been Snorunt *(Ice)*, Rock into Ice is 2× (verified) and it would have taken **2**.

### Turn 6 — the second chain

**White `[6, 4, 3]`.**

- **Sub-move 1: Nf3xe5.** Garchomp *(Dragon)* captures Charmander *(Fire)*. Dragon into Fire is 1× (verified);
  face 6 gives `step = +1`; **SURGE.** Bonus sub-move earned.
- **Sub-move 2: d5xc6.** The baton passes to Machop *(Fighting)*, which has not acted this turn, and it captures
  Cubone *(Ground)* on c6 with face 4: `rung0 = 1`, `step = 0`, **CLEAN.** Two captures in one turn by two
  different pieces — the chain is a *team* combo, never a rampage. Under the shipped `variant.ts` rule (change 4)
  this second capture would have been **illegal**, because the extra move belonged to Garchomp; the whole turn
  would have ended after one capture.
- No exposure, and no third bonus, so the turn ends. White is up two pawns with both knights and a bishop active.

**Black `[5, 5, 3]`.** **Bf8–g7**, Starmie *(Water)* to g7, apparently threatening Garchomp on e5. It is a
**bluff, and the board says so**: Water into Dragon is 0.5× (verified), so if Starmie takes Garchomp the resolver
reads `rung0 = 0`, and on Black's faces of 5 that is **BACKLASH — both pieces die.** Black's own UI draws that
square with twin cracks rather than a slash. A chess player reading only the geometry sees a threat; a player
reading the shapes sees a trade offer.

**Position after 6 turns:** `rnbqk2r/pp3pbp/2P2np1/4N3/B7/8/PPPP1PPP/RNBQK2R w KQkq - 1 7` (validated legal, 35
legal chess moves) — with, in addition to the FEN, one damage counter on Wooper, Stealth Rock persisting on
g6/h6, Forretress at 3 of 4 charges, and Gengar's Focus Sash unspent.

### The mid-game exchange this design exists for

Move 25. Position `5rk1/1b3ppp/4p3/2rq4/1P1n4/6P1/P4PBP/4R1K1 w` (validated legal, 27 legal chess moves), with
the Pokémon layer:

- **White:** King **Slowking** *(Psychic)* g1 · Rook **Steelix** *(Steel)* e1 · Bishop **Gengar** *(Ghost)* g2 ·
  Pawn **Machamp** *(Fighting, promoted from Machop, Expert Belt)* b4 · pawns a2, f2, g3, h2.
- **Black:** King **Tyranitar** *(Rock)* g8 · Queen **Gardevoir** *(Psychic)* d5 · Rook **Skarmory**
  *(Steel, Sturdy)* c5 · Knight **Gogoat** *(Grass)* d4 · Bishop **Chandelure** *(Ghost)* b7 · Rook f8 ·
  pawns e6 *(Snorunt, Ice)*, f7, g7, h7.

**White's Tempo Roll: `[6, 6, 4]`.** Both of the first two faces are sixes. What follows is fully determined — no
hidden roll, nothing to hope for:

- **Sub-move 1 — b4xc5, face 6** (validated legal). Machamp *(Fighting)* captures Skarmory *(Steel)*. Fighting
  into Steel is **2×** (verified), so `rung0 = 2`. Expert Belt fires because the matchup is super-effective:
  `+1`. Face 6 plus 1 is 7, `step = +1`, so `rung = 3`; the Band Cap sits at `rung0 + 1 = 3` and does not bind:
  **CRITICAL.** Skarmory has **Sturdy**, which is `WARP([1,2,3] → −1, once)` — and a CRITICAL **pierces every
  ward and every survive-once defence**, so Sturdy does not save it. The banner reads **WEAKNESS ×2 —
  CRITICAL**, the 8-ray star plays, the board frame turns gold, and Machamp gains `+1 atk`. *A pawn has just
  taken a rook and kept the tempo.*
- **Sub-move 2 — Bg2xd5, face 6** (validated legal). The baton passes to Gengar *(Ghost)*, which captures
  Gardevoir. **Here is the whole game:** Black declared Gardevoir as **Psychic** at draft. Ghost into Psychic is
  **2×** (verified), so `rung0 = 2`; face 6 gives `step = +1`; **CRITICAL** again. Had Black declared Gardevoir
  as **Fairy** — its other real type — Ghost into Fairy is **1×** (verified), the capture would have been a
  CLEAN, White would have earned no further tempo, and the turn would have ended one sub-move sooner. *The draft
  decision, made twenty-five moves earlier, is what turned a good turn into a devastating one.*
- **Sub-move 3 — Re1xe6, face 4** (validated legal). The baton passes again, to Steelix *(Steel)*, which captures
  the e6 pawn *(Snorunt, Ice)*. Steel into Ice is **2×** (verified): `rung0 = 2`, face 4 gives `step = 0`,
  **SURGE.** That would grant a fourth sub-move — but **T1 caps the turn at three**, so the turn ends here.
  Three captures, by three different pieces, in one turn: rook, queen and pawn, for nothing.
- **T3 check:** after each sub-move the engine tested whether Tyranitar became capturable. It never did
  (d5–e6–f7–g8 was blocked by the e6 pawn, and after Rxe6 by White's own rook), so no sub-move was forfeited.

**Black's reply. Tempo Roll `[4, 2, 5]`.** Black is losing on material and has one instrument left: a deliberate
mutual destruction. **Nd4xe6, face 4.** Gogoat *(Grass)* captures Steelix *(Steel)*. Grass into Steel is **0.5×**
(verified), so `rung0 = 0`; face 4 gives `step = 0`; **BACKLASH — both pieces are removed.** The twin-crack
animation plays and e6 is left empty. Black has spent a knight to delete the rook that just ate its pawn, and
**it chose that outcome knowing it exactly**, because the face was on the table before the click.

Had Black's first face been a **6** instead of a 4, the same capture would have read `step = +1`, `rung = 1`,
**CLEAN** — Gogoat would have taken the rook and *lived*. Same pieces, same types, one face apart. And note what
the Band Cap guarantees here, which is the difference from pass 2's arithmetic: **no amount of buffing could have
made that capture a SURGE.** Gogoat with two Swords Dances and a Life Orb still tops out at CLEAN, because Grass
into Steel is resisted and the roll may lift you one band, never two. Black can save its knight; it can never
profit from a bad matchup.

### The act that shows off the chart layer

Five moves later. Position `6k1/5ppp/3r4/4P3/8/6P1/P4P1P/4R1K1 w` (validated legal, 20 legal chess moves). White
has promoted nothing and lost the exchange down to bare bones, but **Lapras — declared Ice, Freeze-Dry in slot
1 — has walked up the board and stands on e5.** Black's remaining rook is **Starmie *(Water)*** on d6.

**White's Tempo Roll: `[4, 5, 2]`.** Face 1 is a 4 — the flat band. White has exactly two ways to take that rook,
and the board draws them differently:

| Action | Reading | Outcome on face 4 | What the square shows |
|---|---|---|---|
| **exd6** — the ordinary chess capture, slot 0 (`Ice Shard`, Ice) | Ice into Water = **0.5×** (verified) → `rung0 = 0`, `step = 0` | **BACKLASH — both pieces die.** A pawn for a rook, and White has no pawn to spare | twin cracks |
| **Freeze-Dry on d6** — an ART, slot 1, 1 of 4 charges | `CHART{d:+1}` guarded on `vsType:'Water'` fires at step 1b: Ice into Water reads **2×** → `rung0 = 2`, `step = 0` | **SURGE — the rook is removed, Lapras survives, and White moves again** | a gold star |

White plays the ART. Three rule details fire together, and each is one line of §7:

1. **The ART does not relocate the attacker** (§7.14). Lapras stays on e5; **d6 is left empty**. A chess player's
   instinct — that a capture means occupying the square — is wrong here, and the ART menu says so before the
   click.
2. **The bonus sub-move goes to a different piece** (T2). Lapras has acted, so the baton passes: **Re1–e4**,
   using face 5, doubling on the open file.
3. **The Why panel narrates it from the engine's own events**: *"Freeze-Dry rewrites Ice→Water from RESISTANCE
   ×0.5 to WEAKNESS ×2. Face 4 is neutral. The roll may lift you one band above your type: SURGE. Lapras captures
   without moving, and a different piece may move again."*

**This is the moment the whole document is arguing for.** The mechanic is not something I designed — it is five
lines of Showdown source (`if (type === 'Water') return 1;`) that **no field in the dataset records**, which a
`@pkmn/dex`-based compiler cannot see, which a call-site census cannot see either, and which pass 2's return
table would have compiled into a harmless +2 on the roll. Read correctly, it is a move that inverts the worst
matchup in the game for one slot on one piece, it costs one charge, it is visible on the square before you
commit, it repays a draft decision the video itself used as its example, and **a Pokémon player knows exactly
what it does before anyone explains it.** That is the whole test in `DIRECTION.md`, passed by a compiler rather
than by a designer.
---

## 18. The ten hard problems of `BRIEF.md` §5, answered

**1. Content coverage at scale.**
A six-pass **compiler** (§3) over **four** measured signal channels (§1.1): declarative fields; the handler-name
grammar (**81 stems, 148 of 150 names parse**, the two failures being exactly `onTry` and `onWeather`); handler
source read as **calls** (2 845 sites, 1 072 mutations, 45 verbs); and — new this pass — handler source read as
**returns and assignments** (§1.8: **494 of 1 675 handlers, 29.5%, make no method call at all**, and 14 grammar
rows cover every one). The taxonomy is **19 ops × 14 triggers × 16 regions**, and the ops were *measured* — they
are the fifteen mutation clusters the dataset is already written in, plus three the engine embodies, plus
**`CHART`**, which a call-site census structurally cannot see because it is expressed as a return value. The
corroboration that matters: **three independently written scanners agree on the mutation-site count to within one
site in a thousand (1 072 / 1 071 / 1 071), and my walker reproduced the handler census exactly (1 675 functions,
440.4 KB, 150 names).** Result: **1 604 of 1 797 admitted entries (89.3%) derived with zero authoring; 125
curated (7.0%), each a diff against the compiler's proposal, all named in §1.6; 68 deliberately inert (3.8%), all
named; 0 missing.** The generic fallback (§6) makes an unclassified damaging move an ordinary capture at tier
`basePower || 60` and an unclassified status move a small visible self-buff, so nothing is ever a silent no-op.
900 unbalanced special cases are avoided because there are no special cases: there are **245 table rows** and 125
data patches — **one table row per 7.3 content entries** — and CI fails the build on any unassigned entry, an 82nd
stem, a 46th verb, a 15th return row, an unclassified share above 1%, any op that could add a piece, **or any
handler the four channels cannot explain** (gate 8, which is the gate that would have caught `CHART` and which is
new this pass).

**2. Turn structure.**
Written out as pseudocode in §7.3. **One action per turn**, from `{MOVE, ART, ACE, DECLINE}` plus `REACT` during
the enemy's turn, and up to two bonus sub-moves earned by SURGE/CRITICAL and taken by *different* pieces.
**No HP; capture stays binary**, but pieces carry **0–3 damage counters** (§7.6) — the TCG's own instrument —
which are what the ~200 chip/heal entries act on, which hand their value to whoever attacks the piece, and which
knock it out at 3 during the Checkup. **Using a Pokémon move does cost your turn — except the one you use every
time you capture:** slot 0, the Melee slot, is uncharged and is what an ordinary chess capture *is*, so the move
layer never taxes chess. Charged slots 1–3 (`charges = clamp(round(pp/5),1,5)` — measured 1→208, 2→319, 3→174,
4→159, 5→90 — giving ~9–12 uses per piece per game) are the ART actions: ranged captures, hazards, status, boosts,
weather, and the chart rewrites of §7.9b. The action economy has a second governor: the **Charge counter**
(§7.9a, `recon-tcg.md`'s Energy Zone), one integer per piece in `[0,2]` that accrues on a turn the piece stays
still, resets on a capture, and is **required to fire the 166 measured tier-4/5 moves** — so the biggest ARTs are
available exactly when the board has been slow, and never at the end of a capture chain. The Checkup runs at the
end of your turn in the TCG's published order, in the §2.8 deterministic dispatch order, with simultaneous
removal.

**3. Termination.**
Proved three ways in §7.11. The bound that matters: `TEMPO('grant-bonus')` is emitted **only** by ladder rungs 2
and 3, both require a capture, every capture removes an enemy piece, and **no op in the ISA can place a piece on
the board** — `SUMMON` does not exist and **CI gate 5 fails the build if it ever appears**. So the enemy piece
count is monotonically non-increasing and a chain has length `L ≤ N + 1 ≤ 17`, and `≤ 16` once the King is
excluded — entirely independent of the RNG. Shipped caps for feel: `L ≤ 3`, the baton rule, and
exposure-ends-the-turn. Game-level: the no-progress clock resets only on monotone-finite resources (≤ 620 total),
so a game is at most ~62 100 sub-moves; healing, status churn, counter churn, **Charge accrual** and **`CHART`
re-painting** and ward-free REPELLEDs are each explicitly *not* progress and each closes a named loop (§7.11's
table). Scheduler horizon is provably ≤ 5 because the measured maximum `condition.duration` in the entire dataset
is 5 (histogram `{1:34, 2:15, 3:5, 4:10, 5:20, persist:39}`), and at most one `SCHEDULE` entry may be pending per
`(side, kind)`. And the **Band Cap** (§7.5 step 5a) closes a termination-adjacent hole pass 2 left open: without
it, `might` inflation raises the *rate* at which bonus sub-moves are granted without bound, which does not break
the proof but does break the tuning the proof's caps were chosen against.

**4. Check, checkmate, mutual destruction, king capture.**
One model, R1–R8 in §7.12: **king capture, no check-legality, an exact suicide guard, mover-wins on simultaneous
royal death, a *newly created* exposure ends the turn, Kings never immune and never chip-killable, check as advice
with a persistent banner, and a Guarded mode for casual play that may never empty the action list.** Checkmate is
not a well-formed predicate when "attacked" depends on the opponent's future roll, which is the actual root cause
of the on-camera bug — and the shipped code proves it independently: `variant.ts`'s `result()` tests mate via the
deliberately type-blind `position.isInCheck()`, so it will declare checkmate when the only attacker is a Normal
piece aimed at a Ghost king, a capture that is *illegal*. Two improvements on the prior art: because §7.4
pre-reveals the whole turn's dice, R3's "a move that *necessarily* kills your own King is illegal" is an **exactly
decidable predicate**, which Atomic could assert only because it has no dice at all; and R5 is stated as the
*invariant* rather than as a rule — **the enemy King can only be captured on a turn where its exposure was already
on the board at turn start** — which is proved in §7.12 and tested by search rather than by asserting the rule.
The video's specific bug is resolved in §7.13, row 1.

**5. Balance.**
A piece is worth `V = m·(1 − 0.9·LIAB + 0.5·ARM − 0.3·BLOCK) + 0.5·BONUS`, evaluated under this ladder in §9.1 —
measured spread **1.18×** between the best and worst type of a class, and a **2× spread in tempo earned** (Ground
0.278 versus Normal 0.139). The design deliberately routes the type edge into **tempo rather than material**,
because tempo is felt immediately, is visible, and cannot be bought at draft. **The Band Cap is what makes the
price list true in play rather than only at move one**: because `might` can no longer shift a band, `BONUS(t)` —
the term carrying the type edge — is invariant in `might`, so a boosted Bug rook is still priced as a Bug rook.
A type-literate player gains ≈ 0.30 pawns per capture in material plus the tempo differential; the die contributes
far less variance than the video's rules because the load-bearing face is public and the stake per face is one
band. Immunity, mutual destruction, boost-stacking, the Focus-Sash exploit, Huge Power, Shadow Tag, Wonder Guard,
Imposter, Moody, evasion, thorns and **`CHART` stacking** each have a named bound in §9.3 — and two of pass 2's
named bounds are now *consequences* of the Band Cap rather than special cases. The draft is **not** trusted as a
balance mechanism — Betza's hand-balanced armies later scored +62%/−71% over 400 engine games — so point-buy is a
usability device, army pairings are screened Chess18-style, and every coefficient is fitted by the batch simulator
(§9.4), which now also reports the Band Cap bind rate.

**6. Draft.**
**Slot-first** (§8.2): you are never shown 1 025 Pokémon; you are shown **five candidates for the one slot you
are filling**, with a guaranteed spread, one reroll, and search as an escape hatch. Ability is a 1-to-4 radio
(measured: 357 species offer no choice, 378 offer two, 631 offer three, 1 offers four). Item is 1 of a 12-item
**Format Kit**, so both sides face the same toolbox and the layer is learnable. Moveset is auto-picked with one
swappable slot from eight alternatives, and a `CHART` move scores `+35` so the seven that exist actually appear.
Legality is baked, so there is no runtime validation surface. "One type each" is a real decision for the **51% of
the roster that is dual-typed** (measured 526 of 1 025), and §7.9b gives that decision a second-order answer the
Coverage Strip can draw (Lapras as Ice covers Water with a *hatched* cell). The every-type goal is enforced as
≥ 10 distinct types per side plus a candidate generator that makes the union of both armies cover 18, since 18
types over 16 pieces is impossible for one side. Quick Draft finishes a legal army in under a minute; presets
finish it in a click, and `src/game/autodraft.ts` already ships the first version. **And the draft is
parameterised by `PoolSource`, which the match rules cannot see** — the seam `DIRECTION.md` requires, enforced by
a lint rule rather than by convention.

**7. Rendering and performance.**
`recon-tech.md` measured this and I take its architecture (§10.5): keep the 64-`<button>` DOM board (129 nodes,
0.39 ms to rebuild) and its accessibility tree, move pieces into one transform-positioned layer keyed by piece id
(a prerequisite for *any* capture animation, because today a `BoardPiece` is a child of its square's `<button>`),
add two Canvas2D layers (Canvas is 17× cheaper per moving thing: 10 000 particles at 0.84 ms/frame versus DOM's
5.38 ms at 4 000). Reject Pixi on a measured 231 KB gzipped bundle. **Vendor sprites same-origin at build time** —
the Showdown CDN sends no `Access-Control-Allow-Origin` (verified 8/8), which forecloses every canvas pixel
operation and the offline requirement. Budgets, CI-gated: critical-path data ≤ 60 KB gz, entry chunk ≤ 110 KB gz,
frame p95 ≤ 10 ms on a worst-frame replay, ≤ 240 live particles, ≤ 250 board DOM nodes, and a heap gate asserting
*no growth* over moves 50→100. **The budget is measured this pass rather than scaled (§3.5), and it found a real
problem: the shipped critical path is 268 KB gz — 4.5× the gate — because `Dex.load()` eagerly awaits all five
bundles including the 74 KB learnsets.** The same architecture, re-encoded on the real files, lands at **37.6 KB
for M1** and **≈52 KB with all content**; the savings are enumerated with measured values, and `budget.test.ts`
gates it from M0.

**8. AI opponent.**
§11: alpha-beta + PVS + quiescence in a Worker, **a ply is a sub-move**, mates scored as `29000 − subMoves`,
`staticClash` (a 1 944-byte table) replacing SEE for ordering and quiescence, tiered lazy evaluation, and a
factorised Zobrist with epoch-splitting to pay for state-dependent capture legality. The stochastic-capture
problem is solved by the *ruleset*: because the Tempo Roll is revealed at the turn boundary, the interior of a
turn has **no chance nodes at all** — measured +10% at depth 6 versus 121–159× for full enumeration — and the
boundary node collapses to three representative faces with a static EV bias. Measured throughput 7.1 M nodes/s at
EBF 3.8–4.2 gives depth 8–9 inside a 1-second budget. **And the mutation path is the op journal, not `apply`,
which pass 2 got wrong by a measured 148×:** cloning the state costs 20.8 µs/node (48 000 nodes/s) against the
journal's 53 ns (18.9 M nodes/s), so the immutable-only interface would have cost about four plies. The journal is
19 inverses, one per state-writing op, nesting inside `position.ts`'s existing undo array — the ISA gives the
search its make/unmake for free, which is the clearest single payoff of designing the content substrate first.
`CHART` costs the search exactly one 7-entry lookup and no new table dimension, which I checked before adding the
op. Difficulty is a **corrupted copy of the AI's own effectiveness table** (measured 5% → 47%, 30% → 37%,
type-blind → 25%), and a beginner AI simply does not know the seven chart-rewriting entries, which is the most
human mistake available.

**9. Legibility.**
Role first, and by **silhouette** (§10): six SVG shapes derived from how each piece moves, which survive
greyscale, colour-blindness and a 34 px cell — the measured reasons the shipped `pieceRoles.ts` approach (a 10 px
Unicode glyph, three size tiers, 1.2 px versus 1.4 px rings) cannot work. Three orthogonal visual variables, one
per question: **shape = role, fill = type, bezel lightness = owner**, with the king additionally overflowing its
cell so it is identifiable in peripheral vision. The chart is taught **inductively and without a manual** by
annotating every reachable square, the moment you pick a piece up, with the outcome form it would produce — gold
star, white slash, twin cracks, hex ward, dashed grey — and this is also how §7.9b teaches itself, because a
`CHART` op resolves *before* the die and therefore repaints the annotation rather than surprising you after the
click. Under load, the **Why panel** renders the engine's own `EffectEvent[]` as sentences, so there is exactly
one source of truth for "why did that happen"; the `charted` event and the Band Cap's ceiling glyph exist
precisely so it can explain the two least obvious rules in the game. The learnable vocabulary is **18 type glyphs
+ 13 ability archetypes + 12 Kit items = 43 symbols**, not 1 797 effects.

And onboarding is a designed surface (§10.7–§10.13). **A lesson is a row of data** — a position, a seed, a
machine-checkable goal, and beats keyed to `EffectEvent` types — which is possible only because the engine is pure
and seeded, the Tempo Roll is public *before* the decision, and the Why panel already renders the engine's own
events. So there is **no scripting engine and no cheating code path**: to make face 1 come up, pick a seed whose
first roll starts with 1. Two equal-weight tracks branch on *what you may skip*; five lessons make the player
**cause** each capture outcome (including being **refused** a 0× capture, which directive 2 calls the most
important moment in the tutorial); two lessons teach the die by having a miss lose a won position and a crit
rescue a lost one; a fourth puzzle family teaches the chart layer, which nothing else can; first-time hints reuse
the same authoring format; and the puzzle corpus is generated *by the batch simulator* §9.4 already requires.
`tutorial.test.ts` asserts every lesson is still winnable, so **a rotted lesson fails CI**. M2b ships it *before*
the 950-move layer, deliberately.

**10. Scope order.**
§15, and the order is the argument, in four claims: **M0 is the compiler, headless, with the coverage test green
— before any rule depends on it** (six days that ship no game, and that also retire the 268 KB bundle problem
before it is inherited); **the journal ships in M1, not later**, because 19 ops written without their inverses is
19 ops written twice; **M1 is a complete, playable, hot-seat game with the Melee slot only** — full chess plus the
type chart plus the ladder plus damage counters plus king capture plus draws plus promotion plus the five outcome
animations, which is already a game you can hand to a stranger, 15 days in; and **M2b, the tutorial, ships before
the 950-move layer**, because the alternative — build all the content, then work out how to explain it — is how a
maximalist game becomes unplayable. Everything after that (moves and the chart layer, abilities and items, draft,
sandbox, transformations, collection, server) **adds depth to a working thing** rather than filling in a skeleton,
which is possible only because the ISA was built first: M3 and M4 are largely data arriving rather than systems
being invented, and each pays a one-lesson, one-hint tax to stay teachable. Honest effort: **~54 days to M7**
(a complete single-player game with all content, a tutorial and practice mode), **~15+ more** for the server,
ladder and Gym Leaders.

---

## 19. Deviations, trade-offs, risks

### 19.1 Where I deviate from a recon document, and why

| Document | Its position | Mine | Why |
|---|---|---|---|
| `recon-data-substrate.md` §2–3 | `@pkmn/sim` gives you fields + a handler fingerprint + handler source | agreed, and **there is a fourth channel it does not name**: 494 handlers express their whole semantics as a `return` value or a field assignment, so the *source* must be read for returns as well as for calls | measured (§1.8). This is not a disagreement with the document — it is the next measurement past it, and it is where the 19th op was |
| `recon-abilities-items.md` §2.4 | one `Vigour ∈ [−3,+3]` scalar replaces all stats and stages | a 7-vector of boosts, shown as three numbers and three badges | the fidelity is free (the compiler reads `{atk:2}` and `{def:2}`), the collapse deletes Unaware/Contrary/Simple/Power Trick and makes Swords Dance and Iron Defense identical, and the legibility problem it solves is a UI problem |
| `recon-abilities-items.md` §2.4 | attacker and defender hooks sum into one roll | the TCG's printed order: attacker bonuses → **the chart reading** → defender reductions, with defender hooks able only to *lower* the outcome | `recon-tcg.md` asked for exactly this correction, and it stops a defensive bonus silently erasing a WEAKNESS reading. §7.9b inserts one stage before the roll, which is where a chart edit belongs |
| `recon-abilities-items.md` §2.6 | 115 hand-written primitive functions (~1 700 LOC) | 0 LOC; the 115 are parameterisations of the 19 ops, and the 13 archetypes become the UI glyph vocabulary | the ops already exist for the move layer. Six of its rows are now *derived* rather than curated because of §1.8 |
| `recon-abilities-items.md` §6.1 | *every* ward is one-shot, including the type chart's 0× | the type chart's 0× is **permanent**; ability/item wards are one-shot; Wonder Guard is class-scoped; and `CHART{set:1}` is a *content* answer to immunity | 0× is the video's most memorable rule and it is only 2.5% of pairs with ≤ 2 attacker types per defender; §7.8's five bounds are sufficient, three of them free from data |
| `recon-abilities-items.md` §6.4 | Huge Power / Pure Power get a bespoke "Clash value capped at 8" | subsumed by the **Band Cap**, which is general | a general rule that closes a class of holes beats a named bound on two abilities; and the general rule was needed anyway, because §7.5's own arithmetic contradicted its own pillar |
| `recon-moves.md` §0 | exclude the 35 Z-moves and 52 Max-moves from the corpus | compile all 950, exclude from *play* by a format flag | costs ~1.8 KB and keeps the CI assertion at "every move in the dex compiles" |
| `recon-moves.md` §2.7 | `+2 spe` grants an extra square of movement | `spe` is initiative and tie-breaks only; extra reach comes only from Choice Scarf, which is banned on King and Queen | movement-range growth breaks both the chess geometry and the AI's move generator, and `recon-abilities-items.md` §6.11 independently reached the same conclusion about Speed Boost |
| `recon-variants.md` §6.3 | abolish the per-capture die; γ = φ = 1/18 | keep one d6, made **public before every decision**, and keep probabilistic BACKLASH | `DIRECTION.md` explicitly legitimises randomness via the TCG and says the richer option wins; making the die public captures most of the variance reduction by that document's own argument; a fully deterministic chart deletes the story generator |
| `recon-variants.md` §4.2 T2 | a piece may not *earn* a second bonus in one turn | the bonus sub-move must be *made* by a piece that has not yet acted this turn | the weaker form still lets one piece make every sub-move; the stronger form makes chains team combos and reads far better on the board |
| `recon-tcg.md` (type chart) | keep the games' 18 × 18 chart, borrow the TCG's vocabulary | agreed, adopted — **and note that the chart is immutable while a *reading* of it is not** (§7.9b) | the TCG's 10-type collapse is internally inconsistent (8.2% of card names contradict themselves). `CHART` never edits `typechart.ts`; it edits one Clash, which is what keeps `TYPE_PROFILES` valid for the draft |
| `recon-tcg.md` (area targets) | area and splash targets resolve neutral | adopted, with one refinement: the player designates **one primary target** which uses the full chart | keeps Earthquake interesting while retaining the balance and AI benefit |
| `recon-tcg.md` ("one tempo step") | a ×2 Weakness is worth exactly one turn of tempo | **adopted as a hard rule** — the Band Cap makes it structural rather than emergent | this is the strongest external justification for the Band Cap: the TCG's own magnitude discipline says the type modifier is worth *one* step, and pass 2's arithmetic allowed two |
| `recon-tcg.md` (Energy Zone) | a per-piece Charge counter (0–2) gating T4/T5 moves | **adopted in full** (§7.9a), with accrual tightened from "does not capture" to "does not act" | canon rather than invented, it subsumes `flags.charge`, `flags.recharge` and Speed Boost, and it is one integer. Tightening to "does not act" is needed because a piece that spends its turn on a free Status ART has not been patient |
| `recon-data-substrate.md` §6 | hotlink Showdown's CDN | vendor same-origin at build time | measured elsewhere: the CDN sends no CORS header, so hotlinking forecloses canvas effects and offline play |
| `recon-data-substrate.md` §7 | emit a `signalClass` per entity so coverage is auditable | agreed, **and `signalClass` as currently shipped is not sufficient**: it reports Levitate as `fields` on the strength of one flag. `coverageClass` supersedes it, with a `flags-only` input state | verified on the real bundle (§1.9 #6). The idea is right; the implementation currently asserts a derivability it does not have, which is the exact failure the field exists to prevent |
| `recon-tech.md` §Part B | freeze a four-method `Rules` interface (`generate`/`apply`/`terminal`/`staticClash`) | **six methods**: `makeAction`/`unmakeAction` are added | measured: `apply`-only caps the search at 48 000 nodes/s against its own 7.1 M target. Its advice to freeze the interface early is right, which is exactly why the sixth and fifth methods must be in it from day one |
| `proposal-systems-first.md` | 94.8% derived, 93 curated; 14 triggers; `Stamina` | 89.3% derived, 125 curated; 14 triggers (different membership); damage counters | its ledger counted flags-only abilities as derived and missed the engine-implemented items; "damage counters" is the TCG's own name and instrument, and my version removes the piece rather than leaving a zombie occupant |

### 19.2 Where I deviate from pass 2 of this document

| Pass 2 | This pass | Severity |
|---|---|---|
| 18 ops; "zero of the residue require a nineteenth op" | **19 ops.** The claim was true of the *call* channel and false of the ISA: `onEffectiveness` calls nothing, so a method census cannot see it. 7 entries — Freeze-Dry, Flying Press, Thousand Arrows, Tar Shot, Disguise, Ice Face, Iron Ball — rewrite the type reading, and its 17-row return table would have compiled `return 1` into a `TILT` | **design gap.** Freeze-Dry, the most on-thesis move in the dex, would have shipped as "+2 to the roll" and still lost the Ice piece half the time |
| 13 triggers, `ON_RESTACK` absent | **14 triggers.** 27 measured handlers (`onRestart` 21, `onFieldRestart` 4, `onSideRestart` 2) fire only on re-application, and pass 2 depends on that behaviour twice — Protect's stall escalation and Spikes' layers — while having no trigger for it | **rules defect.** Without it a second Spikes is a no-op and the Protect family is an infinite stall |
| Region derived from the handler *name's* scope | **Region derived from `(receiverPath, nameScope)`**, a 4 × 6 table whose `condition` row defers to the mark's own `scope` | **rules defect** affecting **429 of 1 675 handlers (25.6%)**: Stealth Rock's hazard would fire on its own caster, Reflect would protect one piece instead of an army |
| `step` can reach `+2`, so `rung0 + step` can reach SURGE from a resisted matchup | **the Band Cap**: `rung := min(rung, rung0 + 1 + crit)` | **rules defect**, and it contradicted pass 2's own stated pillar. Changes none of the published distributions; subsumes two named ability bounds; gives `crit-window` a job |
| `TiltScope` includes `accuracy`, `evasion`, `crit-window`; the resolver reads none of them | **`TiltScope` is `atk | def | crit-window`**; accuracy → `atk`, evasion → `def`, and `crit-window` raises the Band Cap | **rules defect** silently inerting 11 measured handlers plus Scope Lens, Razor Claw, Leek, Lucky Punch, Super Luck, Sniper, Compound Eyes, Keen Eye, Illuminate, No Guard, Sand Veil, Snow Cloak, Tangled Feet, Wonder Skin |
| "416 riders"; "read `secondaries[]` *and* `secondary`" | **212 riders; read `secondaries` only.** Measured: `move.secondary` is the *identical object* already inside `move.secondaries` in all 204 cases | **content defect.** A compiler following the prose applies 204 riders twice — every Thunderbolt gets two paralysis rolls |
| priority ≥ +1 on 21 moves, ≤ −1 on 6; multihit 22; `flags.charge` 13; `flags.recharge` 8 | **42 (19 damaging + 23 Status), 14 (10 damaging), 31, 17, 10** | **content defect.** Pass 2 quoted gen-9 damaging counts as admitted-set counts, so the Reaction mechanic is twice the size it budgeted and needs a rule for the 23 Status members (§7.9) |
| the mark table is 116 rows | **165 rows** (155 dataset + 10 synthetic), measured across moves *and* abilities *and* items including handler-source marks | **content defect.** `MarkSet.bits` needs 6 words not 4, and the glyph budget must be per class (6) plus ~20 named marks, not one glyph per mark |
| `Rules` is four methods, `apply` immutable | **six methods**, with `makeAction`/`unmakeAction` over an op journal, and `apply` *defined as* clone-then-`makeAction` | **architecture defect.** Measured 20.8 µs/node versus 53 ns — 392× — so the immutable-only path caps search at 48 000 nodes/s against its own quoted 7.1 M, about four plies |
| `pieces: Map<PieceId, PokePiece>`; dense `MarkSet` per scope | dense **array**; **sparse packed marks** | measured: the state drops from 18.9 KB to **1 416 bytes** (13.4×), which is what goes on the wire and into the TT |
| a *separate* repetition accumulator | **none needed.** `Position.repetitionCount()` compares the hash snapshots in its own undo array, so mixing Pokémon words makes it Pokémon-aware with zero new code | a module deleted from the plan, plus one caveat named (its scan floor is the chess halfmove clock, which is conservative and safe) |
| bundle budget ≈ 49 KB, "scaled by size" | **measured**: shipped critical path **268 KB gz** (`Dex.load()` awaits all five bundles), re-encode lands at **37.6 KB (M1) / ≈52 KB (all content)**, with each saving measured; and **`condition.duration` is absent from the shipped bundle entirely** | **budget defect.** Pass 2's estimate happened to be near the right answer for the wrong reason, and it did not notice that the number in the repository is 5× the gate |
| curated set 119 | **125**, and the gate stays at ≤ 140 | three abilities and three items pass 2 counted as derived need a row; a coverage claim should only ever be revised downward under scrutiny |

Two of pass 2's own claims I **re-measured and confirmed**, which is why the architecture is unchanged rather
than rebuilt: the handler census (1 675 functions, 440.4 KB, 150 names, 148 parsing, 81 stems) reproduced
exactly with an independently written walker, and the mutation-site count (1 072) reproduced to one site.

### 19.3 What I traded away, explicitly

- **Per-move fidelity on 48 variable-power moves.** Gyro Ball does not truly scale inversely with Speed; it is a
  tier-3 hit with a conditional +1. A Pokémon expert will notice. Traded for a curated set that fits on one
  screen.
- **HP, and with it every magnitude in Pokémon.** Capture is binary and damage is four buckets. This is what
  makes Dynamax inexpressible and makes 20 of the 77 berries into flavour. It is also what keeps the game
  chess-shaped.
- **Hidden information.** Abilities and items are public. That costs Illusion's surprise (it keeps a reduced
  version), and Frisk/Forewarn/Anticipation become board-analysis tools. `recon-tcg.md` is right that this is the
  design rather than a cost — but it *is* a departure from the games.
- **Stalemate as a drawing resource**, and some endgame theory with it (K+R vs K becomes a forced win). The price
  of king capture; R7 and R8 are the mitigations.
- **340 items are queued rather than shipped**, entering play as Format Kits over time. They are all compiled;
  none is missing; but on day one you see 12.
- **A narrower material spread between types (1.18×) than a pure type-driven design would give.** Deliberate: the
  type edge moved into tempo. If measurement says the edge is too weak, the lever is the ladder's band edges, not
  the chart.
- **Two of the video's four rules are changed rather than kept.** "1 = miss ⇒ both die" becomes REPELLED on
  neutral and resisted matchups (§7.4), because as filmed it made defending a piece deter nothing; and a 6 on a
  *resisted* matchup rescues you without granting tempo. Both are corrections to demonstrable debt, but a purist
  reading of `BRIEF.md` §2 rule 4 will call them deviations and they should be counted as such.
- **The Band Cap costs a ceiling.** A player who stacks `might` can no longer convert it into tempo, which makes
  boost-stacking a *reliability* strategy rather than a *tempo* strategy. Some players will find that flat. The
  compensation is that `crit-window` items and abilities become the deliberate route to CRITICAL, which is a
  better place for the game's rarest outcome than "have a big number".
- **`CHART` adds one op and one resolver stage to the hottest code path in the game.** The cost is measured and
  small (a 7-entry lookup at move generation, no new table dimension), but it is not zero, and it is one more
  thing that must be right in `clash.ts`. `chart.test.ts` exists because of that.
- **One more counter on the piece.** The Charge counter buys a governed action economy at the cost of a third
  numeric channel on a pin that already carries damage pips and slot charges.
- **The tutorial cannot teach a rule the engine will not produce.** Because lessons are seeds rather than
  scripts, a lesson can only demonstrate outcomes that are *reachable* — there is no way to force a 1-in-216
  situation for pedagogy. In practice this costs nothing (every outcome in §10.9 is reachable in one roll) but it
  is a real constraint, and it is the price of having no cheating code path.

### 19.4 Risks, and what would falsify them

| Risk | Now | Mitigation / falsifier |
|---|---|---|
| The compiler's op-to-board mapping is systematically right but **thematically wrong somewhere large** | **high — still the top risk** | The one risk that cannot be retired by measurement, because it is a taste judgement. Mitigations: §16's 24-row ledger as a standing review artefact; the rule that any mapping a Pokémon player calls wrong is filed as a **defect**, not a preference; and the fact that a wrong mapping is a *data* fix in `overrides.json` rather than a code change. **Note what this pass says about the risk's shape**: the one large thematic error found in pass 2 was not a mis-mapping but a *missing channel* — the compiler was reading three of four places semantics live. Gate 8 now fails the build on any handler the four channels cannot explain, which converts "we might be missing a class" from a worry into a build error |
| **A fifth channel exists that gate 8 will find and I have not designed for** | **medium, and now instrumented** | The five-way partition of §1.8 (949 call / 356 return / 138 assign / 181 log / 51 empty) sums to 1 675 exactly, so today there is no residue. But `@pkmn/sim` could express semantics a sixth way in a future version — via a getter, a class field, or a `Symbol`. Falsifier: gate 8's count drifts below 1 675 on a dependency bump, which fails the build by design rather than shipping inert content |
| Damage counters make the game slower and drawier than chess | medium | M6 reports game length and draw causes; if draws exceed 20%, the first lever is the counter threshold (3 → 2), not the ladder |
| Three sub-moves per turn is too much tempo to plan against | medium | T1 is a constant; measured `P(L ≥ 3)` under this ladder is a few percent, and the Band Cap lowers it further by removing the buffed-resisted route. Self-play at M6 decides; fallback `L ≤ 2` |
| **The Band Cap makes buffs feel inert** | **medium, new** | It is the one change this pass makes that a player could dislike rather than merely not notice. Falsifier: M6 reports the **bind rate** (what fraction of Clashes the cap actually lowered); if it exceeds ~15%, `might` inflation is real and the answer is to lower `powerTilt` rather than to raise the cap, because raising the cap re-opens the pillar |
| Public dice reduce drama: knowing the outcome may feel flat | medium-low | The drama moves to *which* face you spend where, and §10.10's two die lessons depend on the property. Falsifier: playtests report mechanical turns; the lever is a fourth face drawn face-down for riders only |
| The tutorial rots as the rules change | medium, and gated | `tutorial.test.ts` runs every lesson headlessly and fails CI if a goal has become unreachable or a beat references an event the engine no longer emits |
| Two more counters to learn (damage counters *and* Charge) | medium | Different shape, position and grammar: counter pips on the bezel's lower arc, charge chevrons under the plinth, slot charges as dots. Neither exists in M1. Falsifier: playtesters misread a chevron as a pip, in which case Charge becomes a single ring-fill |
| **The chart layer is too subtle to notice** | **medium-low, new** | Only 7 entries carry it, so a player might never meet one. That is *why* §8.6 scores a `CHART` move at +35 (so Lapras-as-Ice actually gets Freeze-Dry), why §10.12 has a fourth puzzle family, why §10.13's draft lesson is built on Lapras, and why the Coverage Strip hatches the covered cell. Falsifier: M6 reports how many games contain a `charted` event; if it is under ~20%, raise the score weight or widen the Kit |
| **The op journal has a bug and search silently diverges from `apply`** | **medium, new and gated** | This is the standard failure of make/unmake designs. Two structural defences: `apply` is *defined as* clone-then-`makeAction`, so there is one resolution path; and `journal.test.ts` asserts byte-identical restoration over 10 000 random actions from 200 positions plus event-for-event agreement between the two entry points |
| The 268 KB bundle is not actually fixable to 37.6 KB | low | Every saving in §3.5 was measured by re-encoding the real files, not estimated. The riskiest line is the columnar species emit (75.1 → 25.0 KB), and that was measured directly |
| Sprite licensing | medium | vendored assets are gitignored and generated at build time, with a prominent non-affiliation notice and an `ATTRIBUTION.md`; Type Glyph mode is a first-class zero-asset fallback |

### 19.5 What the third pass changed, in one table

For a reader who knows pass 2 and wants only the delta.

| # | Change | Why it was needed |
|---|---|---|
| 1 | **§1.8: C4, the return/assignment channel, measured** — 494 of 1 675 handlers (29.5%) make no method call; a 14-row grammar covers all of them | pass 2's ledger classified *call sites*, so a third of the handler surface was structurally invisible to it. This is the method fix; everything below is a consequence |
| 2 | **§2.2, §7.9b: the 19th op, `CHART`** — the chart-rewriting class (Freeze-Dry, Flying Press, Thousand Arrows, Tar Shot, Disguise, Ice Face, Iron Ball), with the rules layer, the visual, the AI cost and the draft price it implies | pass 2 asserted "zero require a nineteenth op" about the call channel and read it as a statement about the ISA. `TILT` writes the roll, `WARP` rewrites a decided rung, and nothing wrote `rung0` — which is the one thing the seven most chart-relevant entries in the dex do |
| 3 | **§7.5 step 5a: the Band Cap** | pass 2's own arithmetic contradicted its own load-bearing pillar at `might ≥ 3`, which is a first-week board state. Fixed by one `min()`, changes no published number, and subsumes two named ability bounds |
| 4 | **§2.2: `TiltScope` 5 → 3, `crit-window` given a job; §2.3: `ON_RESTACK` as the 14th trigger; §2.4: Region derivation made 2-D** | three defects that silently inerted 15 entries, 27 handlers and 429 handlers respectively |
| 5 | **§2.9, §11, §12.1: the op journal** — `makeAction`/`unmakeAction`, 19 inverses, a dense piece array and sparse packed marks | measured: pass 2's immutable-only `Rules` caps the AI at 48 000 nodes/s against the 7.1 M its own section quotes. It is also the cleanest evidence for the thesis — 19 ops means 19 inverses, so the search gets undo from the content design |
| 6 | **§1.9: seven census corrections** — riders 212 not 416 (with the aliasing proof), priority 42/14, multihit 31, marks 165, `condition.duration` missing from the bundle, `signalClass` over-claiming on Levitate, plus the confirmations | one of them (riders) would have double-applied 204 rider effects; the rest are numbers the design is sized against |
| 7 | **§3.5: the bundle budget measured on the real files**, finding the shipped critical path at 268 KB gz against a 60 KB gate, with each saving measured; **§3.4 gate 8**, the handler-partition sum; **§13.2 integration verified line by line against the shipped `board.ts`/`position.ts`/`zobrist.ts`/`dex.ts`/`variant.ts`** | pass 2's §3.5 was scaled by analogy and its §13.2 was accurate but not verified. Gate 8 is the gate that would have caught change 2, and it is the only structural defence against a fifth channel |

### 19.6 The one-paragraph summary

Measure the vocabulary the Pokémon dataset is already written in — **1 675 handler functions across four
channels, whose 2 845 call sites collapse onto fifteen mutation families (a count three independently written
scanners agree on to within one site in a thousand) and whose 494 call-free handlers collapse onto fourteen
return-grammar rows** — add the three verbs Showdown's engine embodies rather than calls, and you get a
**19-op ISA** that a six-pass compiler can target: **89.3% of 1 797 content entries derived with no authoring,
125 named curated diffs, 68 named inert entries, nothing missing, 245 table rows for 1 797 entries, and a test
that says so on every build — including a gate that fails if any handler the four channels cannot explain
appears, which is exactly the gate that found the nineteenth op.** Then the game is thin: one type per piece on
defence and the move's type on offence; an ordinary chess capture is your uncharged Melee slot; the type chart
sets which rung of a five-rung ladder you start on and a **publicly revealed** d6 moves you at most **one band**
along it, so no hidden roll can ever cost you a piece and no amount of buffing can make a bad matchup profitable;
super-effective earns tempo and resisted kills you both; **seven pieces of real content edit the chart itself,
which is the deepest thing a game about the type chart can offer and which no field in the dataset records**; the
biggest moves need a turn of patience; a bonus move must be taken by a *different* piece; a *new* threat to the
King ends your turn, so the King can only ever fall to a threat that survived a full reply; the King is captured
rather than mated. Every piece says "bishop" by silhouette before it says "Ghost" by colour, and every square you
can reach tells you what would happen there before you commit — including when a slot has rewritten the chart,
because a chart edit resolves before the die. And because every op has an inverse, the same nineteen ops that
make the content data also give the AI its make/unmake, the replay its undo, and the tutorial its lessons: a
position, a seed and a goal. The content system is the game's spine. It is the reason all 950 moves, 311
abilities and 536 items are *in* the game rather than in the specification, and it is the reason the tutorial,
the AI, the animation layer and the draft each cost a table rather than a project.
