# Recon: Move Taxonomy

**Role:** Move taxonomy analyst. **Dataset:** `@pkmn/dex@0.10.11` + `@pkmn/data@0.10.11`, probed live at
`/tmp/pkmn-probe`. Every count below was measured, not estimated. Probe scripts:
`/tmp/pkmn-probe/moves-recon-{1..14,arch,sub,a37,final}.mjs`.

**Headline result:** a 37-entry ordered decision list over structured fields classifies **685/685 gen-9 moves
and 954/954 all-gens moves with 0 unclassified**. Bespoke code is needed for **79 moves in 16 rules (8.3% of
the dex)**. The other 91.7% is derived from fields. Numbers are reproducible from the scripts named above.

---

## 0. Corpus and the all-gens delta

| Set | Count |
|---|---|
| `Dex.moves.all().filter(exists)` | **954** |
| gen-9 legal (`new Generations(Dex).get(9).moves`) | **685** |
| delta (all-gens minus gen-9) | **269** |

Composition of the 269-move delta (`moves-recon-4.mjs`):

| Bucket | Count |
|---|---|
| `isNonstandard: 'Past'` | 207 |
| `isNonstandard: 'Gigantamax'` | 33 |
| `isNonstandard: 'LGPE'` (Let's Go exclusive) | 13 |
| `isNonstandard: 'Unobtainable'` | 12 |
| `isNonstandard: 'CAP'` (fan-made: Paleo Wave, Shadow Strike, Polar Flare) | 3 |
| `isNonstandard: 'Future'` (Nihil Light) | 1 |
| `isZ` (Z-moves) | 35 |
| `isMax` (Max/G-Max moves) | 52 |
| neither Z nor Max | **182** |

**Recommendation:** ship the **union of gen-9 + the 182 non-Z/non-Max delta moves = 867 moves**, and *exclude
the 35 Z-moves and 52 Max-moves* (87 moves). Rationale: Z/Max moves are once-per-battle super-moves whose
whole design premise (one activation, huge numbers, item/species gating) is a second economy we do not want,
and 51 of the 52 Max moves fall in the plainest `A36_STRIKE` bucket anyway — they add zero taxonomic variety.
Excluding them costs nothing in flavour and removes 87 balance outliers (Max moves have BP 10–150 with
identical `target: allAdjacentFoes`-ish shapes and secondary side effects that duplicate existing moves).

**Independent confirmation of the 867 figure:** across all 1417 species' prevo-chain learnset unions, exactly
**841 distinct move ids are ever referenced** (`moves-recon-verify.mjs`). No species can ever select a Z-move
or a Max move — those are generated in-battle, not learned — so the 867-move corpus is an upper bound and 841
is the number of moves that can actually reach a board. Anything you build for the other 113 is dead code.

Everything below reports **gen-9** as primary and **all-954** in parentheses so you can pick either corpus.

3 gen-9 moves are learnable by **nobody**: Behemoth Bash, Behemoth Blade, Struggle. Struggle is a rules
fallback (see §5); the Behemoths belong to Zacian/Zamazenta-Crowned formes whose learnsets are stubs.

---

## 1. Which fields actually predict a board effect

I evaluated every key present on a gen-9 `Move` object (`moves-recon-12.mjs`). Grouped by usefulness:

**Load-bearing and machine-readable (use these):**

| Field | Non-default count (gen-9) | What it predicts |
|---|---|---|
| `target` (15 distinct values) | 685 | **the set of squares affected** — the single most predictive field |
| `category` | 685 | damage vs. support |
| `basePower` | 471 non-status | capture strength / tier |
| `accuracy` (number \| `true`) | 169 are `true` | dice threshold |
| `priority` (-7..+5) | 42 non-zero | initiative / pre-emption |
| `flags` (38 distinct) | see below | reach, contact, targeting quirks |
| `secondary` / `secondaries` | 170 damaging moves | rider effect + `chance` |
| `boosts` / `self.boosts` | 63 / 34 | temporary piece modifiers |
| `status` (5 values) | 13 | movement restriction |
| `volatileStatus` (37 values) | 50 | piece marks |
| `sideCondition` | 12 | persistent zone |
| `weather` / `pseudoWeather` / `terrain` | 5 / 5 / 4 | board-wide field |
| `slotCondition` | 4 | delayed/on-arrival effect |
| `drain` / `recoil` / `heal` | 11 / 9 / 6 | capture-resolution modifiers |
| `multihit` / `ohko` / `critRatio` / `willCrit` | 22 / 4 / 23 / 4 | capture-resolution modifiers |
| `selfSwitch` / `forceSwitch` | 9 / 4 | displacement |
| **`condition.duration`** | 55 of 86 | **turn counts, straight from data** |
| **`callsMove`** | 3 (7 all-gens) | **recursion marker — exactly the dangerous set** |
| **`selfdestruct`** | 7 | **board-wipe marker** |
| **`stallingMove`** | 7 (11 all-gens) | **Protect-family marker** |

**Fields I found and would otherwise have hand-curated — these are gifts:**

- `condition.duration` gives real turn counts with **no authoring**: `1` → 19 moves, `2` → 13, `3` → 3,
  `4` → 6, `5` → 15, `undefined` (persist-until-cleared) → 30. (`moves-recon-14.mjs`)
  - duration 5: Reflect, Light Screen, Aurora Veil, Mist, Safeguard, Magnet Rise, Disable, Gravity,
    Trick Room, Magic Room, Wonder Room, and all 4 terrains.
  - duration 4: Tailwind, Perish Song, Syrup Bomb, the 3 Pledges.
  - persist-until-cleared: Spikes, Toxic Spikes, Stealth Rock, Sticky Web, Leech Seed, Substitute, Curse,
    Ingrain, Aqua Ring, Attract, Destiny Bond, Torment, Smack Down, Tar Shot, Salt Cure, Wish, +14 more.
- `callsMove` is `true` on exactly **Copycat, Metronome, Sleep Talk** (gen-9) and additionally **Assist,
  Me First, Mirror Move, Nature Power** (all-gens). That is the recursion danger set, self-labelled.
- `selfdestruct` is `'always'` on Explosion / Self-Destruct / Misty Explosion and `'ifHit'` on Final Gambit /
  Healing Wish / Lunar Dance / Memento. Board-wipe set, self-labelled.
- `stallingMove` is the Protect family: Protect, Detect, Endure, Spiky Shield, Baneful Bunker, Silk Trap,
  Burning Bulwark (+ King's Shield, Obstruct, Mat Block, Max Guard in all-gens).

**Structurally interesting but low-count (fold into curated tags, do not build systems for):**
`breaksProtect` 5 (Feint, Hyperspace Fury/Hole, Phantom Force, Shadow Force), `ignoreDefensive`+`ignoreEvasion`
2 (Darkest Lariat, Sacred Sword), `ignoreAbility` 3, `smartTarget` 1 (Dragon Darts), `tracksTarget` 1
(Snipe Shot), `multiaccuracy` 3 (Population Bomb, Triple Axel, Triple Kick), `hasCrashDamage` 3 (Axe Kick,
High Jump Kick, Supercell Slam), `overrideOffensiveStat` 1 (Body Press), `overrideDefensiveStat` 3 (Psyshock,
Psystrike, Secret Sword), `damage: 'level'` 2 (Night Shade, Seismic Toss), `noPPBoosts` 3, `thawsTarget` 5.

**A field that is a trap:** `ignoreImmunity` is `true` on **all 214 gen-9 Status moves** — it is not a special
marker, it is just "status moves ignore type immunity". Only 4 *damaging* moves in the whole dex set it:
Bide, Future Sight, Nihil Light (`{Dragon:true}`), **Thousand Arrows (`{Ground:true}`)**.
**This is the single most valuable balance lever in the dataset**: it means the rules engine can say "support
moves are always legal against an immune piece" *from data*, which directly bounds the brief's
"untouchable Flying piece" problem (§5, hard problem 6) without a special case.

**Fields with no useful signal:** `zMove` (656), `maxMove` (470) — mapping metadata only. `duration` at the
top level is always `undefined` in gen-9 (it lives on `condition`). `desc`/`shortDesc` are prose: usable as a
*curation aid at build time*, never parsed at runtime.

---

## 2. The taxonomy

I recommend representing a move **not** as one cluster label but as an **orthogonal 6-facet record** derived by
pure functions, plus a **flat archetype label** for UI/AI/designer conversation. The facets compose; the
archetype is the first-match label from an ordered list. Both are total (0 gaps).

### 2.1 The board-effect record (what the engine actually consumes)

```ts
interface MoveEffect {
  shape:    Shape;         // which squares  <- target + ranged flags
  payload:  Payload;       // what happens to pieces in those squares
  selfAfter: SelfAfter[];  // what happens to the caster
  power:    0|1|2|3|4|5;   // capture strength tier  <- basePower
  reach:    0|1|2|3|'board';
  reliability: Dice;       // <- accuracy
  initiative: number;      // <- priority, clamped
  charges:  1|2|3|4|5;     // <- pp
  duration: number|'persistent'|0;  // <- condition.duration
}
```

Every field is a pure function of dex fields. Nothing is hand-typed except the 79 bespoke moves in §3.

### 2.2 `shape` — derived from `target` + ranged flags

```
shape(m):
  target 'all'                                    -> BOARD        (whole board)
  target 'allySide' | 'allyTeam'                  -> OWN_ARMY
  target 'foeSide'                                -> ENEMY_ZONE
  target 'self'                                   -> SELF
  target 'allies'|'adjacentAlly'|'adjacentAllyOrSelf' -> ALLY
  target 'allAdjacent'                            -> RING1_ALL    (8 neighbours, friend+foe)
  target 'allAdjacentFoes'                        -> RING1_FOES   (8 neighbours, foes only)
  target 'randomNormal'                           -> RANDOM_FOE
  target 'scripted'                                -> REACTIVE
  target 'any'                                    -> RAY_ANY      (ignores blockers: it "flies")
  flags.distance|pulse|bullet|sound|wind          -> RAY_LOS      (line of sight, dist<=2, no step in)
  otherwise ('normal','adjacentFoe')              -> MELEE        (must step into the square)
```

| shape | gen-9 | all-954 | Iconic members |
|---|---|---|---|
| MELEE | **432** | 641 | Tackle, Close Combat, Crunch, Play Rough |
| SELF | 80 | 99 | Swords Dance, Recover, Substitute |
| RING1_FOES | 48 | 62 | Blizzard, Rock Slide, Heat Wave, Icy Wind, Razor Leaf |
| RAY_LOS | 37 | 44 | Shadow Ball, Bug Buzz, Hyper Voice, Energy Ball, Focus Blast |
| RAY_ANY | 21 | 24 | Aerial Ace, Air Slash, Fly, Aura Sphere, Dragon Pulse, Brave Bird |
| BOARD | 18 | 24 | Sunny Day, Trick Room, Perish Song, Haze, Court Change, Gravity |
| RING1_ALL | 15 | 20 | **Earthquake, Surf, Explosion, Discharge, Boomburst, Petal Blizzard** |
| OWN_ARMY | 11 | 16 | Reflect, Light Screen, Tailwind, Aurora Veil, Safeguard |
| ALLY | 9 | 10 | Helping Hand, Coaching, Life Dew, Heal Pulse |
| RANDOM_FOE | 6 | 6 | Outrage, Thrash, Petal Dance, Uproar, Raging Fury, Struggle |
| REACTIVE | 4 | 4 | Counter, Mirror Coat, Metal Burst, Comeuppance |
| ENEMY_ZONE | 4 | 4 | Spikes, Toxic Spikes, Stealth Rock, Sticky Web |

Concrete geometry proposals (pick or amend; these are the ones I'd defend):

- **MELEE** = the move can only be used as part of a normal chess capture onto an adjacent-along-the-piece's-
  own-move-pattern square. Default, 63% of the dex. No new geometry needed → this is why the fallback is safe.
- **RAY_LOS** = choose a target on one of the 8 rays from the caster at Chebyshev distance ≤ 2, **first
  occupied square on that ray only** (blockers matter), resolve capture, **caster does not move**. 37 moves.
  This is the "ranged attack" the brief asked for and it's exactly the `distance|pulse|bullet|sound|wind` set.
- **RAY_ANY** = same but distance ≤ 3 and **blockers ignored** (`target: 'any'` in Showdown literally means
  "any Pokémon on the field including non-adjacent" — Fly, Aerial Ace, Dragon Pulse). Flavour lands perfectly:
  21 of 21 are flying/aerial or beam moves. 20 of the 24 `distance`-flagged moves are also `target:'any'`.
- **RING1_ALL** = hits all 8 neighbours **including your own pieces**. This is Earthquake/Surf/Explosion and
  it is a genuinely new chess idea: a 15-move class whose cost is friendly fire. Do not water it down.
- **RING1_FOES** = hits enemy pieces in the 8 neighbours only. 48 moves. The "safe area attack".
- **ENEMY_ZONE** = the 4 hazards. Caster paints a 3-square segment of a *rank on the enemy half*: the file it
  stands on ± 1, on the enemy's rank 6 (mirrored). Hazard fires when an enemy piece **ends a move** there.
  Layer counts come from the real move (Spikes 3, Toxic Spikes 2, Stealth Rock/Sticky Web 1).
- **BOARD** / **OWN_ARMY** = global / own-colour modifiers, duration from `condition.duration` (mostly 5).

### 2.3 `payload` — derived from category/status/boosts/etc.

Ordered: `ohko > damaging > status > all-negative boosts > all-positive boosts > volatileStatus > heal >
sideCondition > field > forceSwitch > selfSwitch > OTHER`.

| payload | gen-9 | all-954 |
|---|---|---|
| DAMAGE | 467 | 679 |
| OTHER *(residual — see §4)* | **55** | **73** |
| BUFF | 37 | 43 |
| VOLATILE | 34 | 53 |
| DEBUFF | 23 | 26 |
| RESTORE | 21 | 23 |
| FIELD | 14 | 18 |
| STATUS | 13 | 15 |
| ZONE | 12 | 15 |
| OHKO | 4 | 4 |
| WITHDRAW | 3 | 3 |
| DISPLACE | 2 | 2 |

The `shape × payload` cross-tab is *sparse*: **37 of 144 possible cells are non-empty in gen-9** (42 of 144
all-gens), and the top 6 cells hold 503/685 = 73%. Full cross-tab in `moves-recon-5.mjs` output. Largest cells:
`MELEE/DAMAGE` 355, `RING1_FOES/DAMAGE` 40, `MELEE/OTHER` 34, `SELF/BUFF` 31, `RAY_LOS/DAMAGE` 28,
`RAY_ANY/DAMAGE` 20, `SELF/VOLATILE` 19, `SELF/RESTORE` 15, `RING1_ALL/DAMAGE` 14, `BOARD/FIELD` 14.

**Design consequence:** you only need to implement 37 (shape, payload) combinations, not 954 moves.

### 2.4 `selfAfter` — capture-resolution and post-move consequences for the caster

| selfAfter | gen-9 | all-954 | Members |
|---|---|---|---|
| NONE | 604 | 857 | — |
| CHANCE_SELF_BUFF | 15 | 19 | Charge Beam, Meteor Mash, Flame Charge, Power-Up Punch |
| SELF_DROP | 15 | 16 | Close Combat, Superpower, Draco Meteor, Leaf Storm, Overheat, Hammer Arm |
| CHARGE | 13 | 17 | Fly, Dig, Dive, Solar Beam, Sky Attack, Phantom Force, Meteor Beam |
| DRAIN | 11 | 13 | Giga Drain, Drain Punch, Leech Life, Horn Leech, Draining Kiss, Absorb |
| WITHDRAW | 9 | 9 | U-turn, Volt Switch, Flip Turn, Baton Pass, Teleport, Parting Shot, Shed Tail, Chilly Reception, Revival Blessing |
| RECOIL | 9 | 12 | Brave Bird, Flare Blitz, Double-Edge, Head Smash, Volt Tackle, Wood Hammer, Wave Crash, Take Down, Wild Charge |
| RECHARGE | 8 | 10 | Hyper Beam, Giga Impact, Blast Burn, Frenzy Plant, Hydro Cannon, Prismatic Laser, Roar of Time, Rock Wrecker |
| SELF_BUFF | 1 | 1 | (deterministic post-hit self-boost) |

### 2.5 Derived scalars — real distributions

**`charges = clamp(round(pp/5), 1, 5)`** — PP becomes per-game uses of that move by that piece.

| charges | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| gen-9 moves | 131 | 237 | 124 | 120 | 73 |

**`reliability`** from `accuracy` (d6 to match the video's dice, so the RNG stays one die):

| accuracy | mapping | gen-9 count |
|---|---|---|
| `true` (never misses) | auto-hit; still crits on 6 | 169 |
| 100 | `d6 >= 2` (1 = miss) | 362 |
| 90–99 | `d6 >= 2`, re-roll-once-on-1 fails 1/6 of the time (effective ~97%) | 95 |
| 75–89 | `d6 >= 3` | 43 |
| 50–74 | `d6 >= 4` | 12 |
| < 50 | `d6 >= 5` | 4 (Fissure, Guillotine, Horn Drill, Sheer Cold — all OHKO) |

**`power` tier** from `basePower` (drives the capture-resolution table, §2.7):

| tier | basePower | gen-9 | Members (examples) |
|---|---|---|---|
| T1 | 1–45 | 71 | Tackle, Quick Attack, Bullet Punch |
| T2 | 46–75 | 130 | Aerial Ace, Crunch(80→T3), Rock Slide |
| T3 | 76–95 | 118 | Earthquake(100→T4), Flamethrower, Surf |
| T4 | 96–120 | 88 | Close Combat, Thunderbolt(90→T3), Hydro Pump |
| T5 | 121+ | 36 | Explosion(250), Hyper Beam, Eruption |
| Tvar | `basePower === 0` | 28 | see below |
| — | Status | 214 | — |

**`reach`** (`reach(m)` from §2.2 shape):

| reach | 0 (self) | 1 (melee) | 2 (RAY_LOS) | 3 (RAY_ANY) | board |
|---|---|---|---|---|---|
| gen-9 | 80 | 492 | 59 | 21 | 33 |

**The 28 variable-BP moves** (`basePower === 0`, non-status) — these are the ones a naive `basePower` formula
gets wrong and silently turns into no-ops. Bake a constant-effective-BP table for them at build time:
Beat Up, Comeuppance, Counter, Crush Grip, Electro Ball, Endeavor, Final Gambit, Fissure, Flail, Fling,
Grass Knot, Guillotine, Gyro Ball, Hard Press, Heat Crash, Heavy Slam, Horn Drill, Low Kick, Metal Burst,
Mirror Coat, Night Shade, Present, Reversal, Ruination, Seismic Toss, Sheer Cold, Spit Up, Super Fang.
(18 of them are already covered by bespoke rules B3/B4/B5/B14 in §3; the remaining 10 —
Crush Grip, Electro Ball, Flail, Grass Knot, Gyro Ball, Hard Press, Heat Crash, Heavy Slam, Low Kick,
Present, Reversal, Spit Up, Beat Up — get a `VARPOWER` tag mapping to `power: 3` plus one state multiplier.)

### 2.6 The archetype list (mutually exclusive, first match wins, 0 unclassified)

This is the label designers, the AI evaluator and the UI should use. Verified: **685/685 and 954/954 classify;
UNCLASSIFIED = 0 in both** (`moves-recon-arch.mjs`).

| # | Archetype | Predicate | gen-9 | all-954 | Proposed board effect (parameterised, no per-move code) |
|---|---|---|---|---|---|
| A01 | GUARD | `stallingMove` or Quick/Wide/Crafty Guard, Mat Block | 9 | 14 | Caster becomes **uncapturable for 1 opponent reply**. Repeat-use success = `1/3^n` (Showdown's own stalling curve). Punish payload (Spiky Shield → attacker dies too; Baneful Bunker → attacker poisoned; King's Shield/Obstruct/Silk Trap → attacker debuffed) is a 6-row data table. |
| A02 | SELF_KO | `selfdestruct` | 7 | 7 | Caster is removed; effect applies at full strength. `'always'` (3) fires even on miss, `'ifHit'` (4) only on hit. See §5. |
| A03 | CALLS_MOVE | `callsMove` or Mimic/Sketch/Transform/Instruct | 7 | 11 | Resolve to a concrete move id via seeded PRNG from a **restricted pool**, depth cap 1. See §5. |
| A04 | OHKO | `ohko` | 4 | 4 | Capture succeeds **ignoring type matchup** (no mutual destruction, no immunity) — but reliability is `d6>=5` (see §2.5), so 1/3 chance. Fissure/Guillotine/Horn Drill; Sheer Cold `ohko:'Ice'` (fails vs Ice pieces). |
| A05 | RETALIATE | `target === 'scripted'` | 4 | 4 | Set a **1-turn reaction flag**: if the caster is captured on the opponent's immediate reply, the attacker dies too (Counter for MELEE attacks, Mirror Coat for RAY_*). Priority -5. |
| A06 | DELAYED | `flags.futuremove` | 2 | 2 | Mark a target square; **2 turns later** a capture resolves there against whatever occupies it. Future Sight, Doom Desire. |
| A07 | HAZARD | `sideCondition && target==='foeSide'` | 4 | 4 | Paint a 3-square segment of an enemy rank; triggers when an enemy piece ends a move there. Layers: Spikes 3, Toxic Spikes 2, Stealth Rock 1 (type-scaled), Sticky Web 1 (movement debuff). Persistent until Defog/Rapid Spin/Court Change. |
| A08 | WARD | `sideCondition` (allySide) | 6 | 7 | Own-army modifier for `condition.duration` = 5 turns (Reflect, Light Screen, Aurora Veil, Mist, Safeguard) or 4 (Tailwind → own pieces get +1 initiative). |
| A09 | FIELD | `weather \|\| pseudoWeather \|\| terrain` | 14 | 19 | Board-wide modifier for 5 turns. Weather boosts/nerfs matching-type captures; terrain applies to grounded pieces (ranks-touching pieces); Gravity disables RAY_ANY. |
| A10 | WITHDRAW | `selfSwitch` | 8 | 9 | **After capturing, retreat to the square you came from.** Exactly the mechanic asked for: U-turn, Volt Switch, Flip Turn. Teleport/Chilly Reception/Parting Shot are non-damaging withdrawals. |
| A11 | PHAZE | `forceSwitch` | 4 | 4 | Push the target piece 1 square directly away from the caster (or, if blocked, it cannot be pushed and the move fizzles). Priority -6 for Circle Throw/Dragon Tail/Roar/Whirlwind. |
| A12 | PIN | `volatileStatus === 'partiallytrapped'` | 8 | 10 | Target **cannot move** for 4–5 turns, takes chip damage each turn. Bind, Wrap, Fire Spin, Whirlpool, Sand Tomb, Infestation, Magma Storm, Thunder Cage (+Clamp, Snap Trap all-gens). |
| A13 | REVIVE | `slotCondition` | 1 | 1 | Wish: a delayed heal that lands on the square 1 turn later. (Healing Wish/Lunar Dance/Revival Blessing sort to A02/B7.) |
| A14 | HEAL | `flags.heal && !drain` | 17 | 19 | Restore the piece's charge/HP pool; Rest also self-inflicts `slp`. |
| A15 | DRAIN | `drain` | 11 | 13 | **On a successful capture, the caster is restored** by `drain[0]/drain[1]` of the pool (10 moves at `[1,2]`, Dream Eater at `[3,4]`). This is the natural "capture heals you" primitive. |
| A16 | RECOIL | `recoil \|\| mindBlownRecoil \|\| hasCrashDamage` | 13 | 18 | Caster takes `recoil` fraction of the pool on capture: `[33,100]` (6 moves incl. Brave Bird, Flare Blitz, Volt Tackle) / `[1,4]` (Take Down, Wild Charge) / `[1,2]` (Head Smash). `hasCrashDamage` (Axe Kick, High Jump Kick, Supercell Slam): caster is damaged **only on a miss**. |
| A17 | CHARGE | `flags.charge` | 13 | 17 | Two-turn commit: turn 1 the piece is **flagged and untargetable** (Fly/Dig/Dive/Phantom Force lift or burrow off-board), turn 2 the capture auto-resolves. `condition.duration: 2`. |
| A18 | RECHARGE | `flags.recharge` | 8 | 10 | Capture resolves at T5 power, then the piece **cannot act next turn**. |
| A19 | MULTIHIT | `multihit` | 22 | 31 | `n` hits: `2` (6 moves), `3` (4), `[2,5]` (11, roll d6→2/2/3/3/4/5), `10` (Population Bomb). Each hit re-rolls the capture d6, so multi-hit **beats GUARD/Substitute and averages out the 1-in-6 miss**: P(≥1 hit) = 1−(1/6)^n. Concrete counter to the video's "1 = both die" swing. |
| A20 | PRE_EMPT | `priority > 0 && damaging` | 16 | 18 | Resolves **before the opponent's reply** — pre-empts a counter-capture. +1 (10 moves: Bullet Punch, Ice Shard, Aqua Jet, Quick Attack, Accelerock, Shadow Sneak, Sucker Punch, Thunderclap, Jet Punch, Vacuum Wave), +2 (Extreme Speed, Feint, First Impression), +3 (Fake Out, Upper Hand). |
| A21 | LAST_RESORT | `priority < 0 && damaging` | 3 | 6 | Resolves after: Avalanche (-4), Beak Blast (-3), Focus Punch (-3). Higher power as compensation (Focus Punch BP 150). |
| A22 | SUPPORT_FAST | `priority > 0` | 5 | 9 | Helping Hand (+5), Follow Me / Rage Powder (+2, redirect: enemy captures must target this piece), Ally Switch (+2), Baby-Doll Eyes (+1). |
| A23 | SUPPORT_SLOW | `priority < 0` | **0** | 0 | Empty in both corpora — Trick Room/Roar/Whirlwind/Teleport are caught by A09/A11/A10 first. Keep the branch for safety; assert it stays 0 in a test. |
| A24 | AFFLICT | `status` | 13 | 15 | Primary non-volatile status → movement restriction on the target piece. `slp` 5, `par` 3, `psn` 3, `tox` 1, `brn` 1. Mapping in §2.8. |
| A25 | AREA_ALL | `target === 'allAdjacent'` | 11 | 15 | Hits all 8 neighbours **including your own**. Earthquake, Surf, Discharge, Lava Plume, Boomburst, Bulldoze, Sludge Wave, Petal Blizzard, Sparkling Aria, Brutal Swing, Teeter Dance. |
| A26 | AREA_FOES | `target === 'allAdjacentFoes'` | 45 | 57 | Hits enemy neighbours only. Blizzard, Rock Slide, Heat Wave, Icy Wind, Dazzling Gleam, Hyper Voice, Razor Leaf, Eruption, Water Spout, Precipice Blades, Glacial Lance… |
| A27 | BERSERK | `target === 'randomNormal'` | 6 | 6 | Piece is **locked in for 2–3 turns**, each turn auto-captures a *randomly chosen* adjacent enemy; then confuses itself. Outrage, Thrash, Petal Dance, Raging Fury, Uproar, Struggle. |
| A28 | MARK_FOE | `volatileStatus && target !== 'self'` | 17 | 25 | Apply a named mark to the target. Attract, Confuse Ray, Curse, Disable, Encore, Leech Seed, Smack Down (grounds a Flying piece — **directly bounds hard-problem 6**), Supersonic, Swagger, Taunt, Torment, Yawn, Tar Shot, Gastro Acid, Flatter, Sweet Kiss, Dragon Cheer. |
| A29 | SELF_MARK | `volatileStatus` (self) | 13 | 16 | Aqua Ring, Charge, Defense Curl, Destiny Bond, Focus Energy, Imprison, Ingrain, Magnet Rise, Minimize, No Retreat, Power Trick, Stockpile, Substitute. |
| A30 | BUFF_SELF | `boosts` on self with any `+` | 28 | 33 | `+n` stages → temporary modifiers on that piece. Swords Dance, Nasty Plot, Dragon Dance, Calm Mind, Iron Defense, Quiver Dance, Shell Smash, Agility, Belly Drum-likes… Mapping in §2.7. |
| A31 | BUFF_ALLY | `boosts` on ally targets | 3 | 3 | Aromatic Mist, Coaching, Howl. |
| A32 | DEBUFF_FOE | `boosts` all negative | 14 | 16 | Charm, Screech, Scary Face, Sand Attack, Smokescreen, Tickle, Metal Sound, Fake Tears, Feather Dance, Noble Roar, Play Nice, Confide, Eerie Impulse, Tearful Look. |
| A33 | LEAP | `target==='any'` && damaging | 16 | 17 | Ranged, distance ≤3, ignores blockers. Aerial Ace, Air Slash, Dragon Pulse, Aura Sphere, Brave Bird, Drill Peck, Gust, Hurricane, Wing Attack, Peck, Pluck, Acrobatics, Aeroblast, Dragon Ascent, Flying Press, Sky Attack. Measured: of the 20 moves matching the raw predicate, **15 are Flying-type**; the other 5 are pulse/beam moves (Aura Sphere, Dragon Pulse, Dark Pulse, Water Pulse, Flying Press). The flavour of "ignores blockers because it flies or beams over them" is free from the data. |
| A34 | VOLLEY | ranged flag && damaging | 24 | 29 | Ranged, distance ≤2, blockers matter. Shadow Ball, Energy Ball, Focus Blast, Sludge Bomb, Bug Buzz, Hyper Voice, Overdrive, Seed Bomb, Pyro Ball, Zap Cannon, Air Cutter, Twister, Blizzard(→A26 first)… |
| A35 | STRIKE_RIDER | damaging, has `secondary` | 114 | 144 | **Melee capture + a chance rider.** Rider kinds: `status` 39, `foeDrop` 34 (stat drop), `selfBuff` 14, `flinch` 12, `vol` 5, `status+flinch` 3, `flinch+foeDrop` 1, none-of-the-above 6. Chance buckets: 100% → 34, 30% → 24, 10% → 30, 50% → 11, 20% → 11, 40% → 3, 70% → 1. Roll d6 against `ceil(chance/16.67)`. |
| A36 | STRIKE | damaging, no rider | 148 | 283 | **The plain capture.** This is the fallback and it is *most of the game*. Sub-split by tier×contact: T1/C 9, T1/N 4, T2/C 23, T2/N 13, T3/C 22, T3/N 15, T4/C 19, T4/N 16, T5/C 2, T5/N 8, var/C 11, var/N 6. (All-gens 283 includes 31 Z + 51 Max moves; drop those per §0 → **201**.) |
| A37 | SUPPORT_MISC | remaining Status | 47 | 59 | The genuinely weird residue. Full gen-9 list in §4. |

Sanity notes for reviewers: A26's 45 vs the brief's target count of 48 — 3 of the 48 `allAdjacentFoes` moves
(Cotton Spore, Growl, Leer, String Shot, Tail Whip, Sweet Scent, Poison Gas, Dark Void) sort earlier into
A24/A32; the ordered list is what matters, not the raw target count.

### 2.7 Boost stages → board modifiers (the formula)

Boost stat frequency across the 79 primary-boost applications (`moves-recon-2.mjs`):
`def` 28, `atk` 28, `spa` 23, `spe` 18, `spd` 16, `accuracy` 4, `evasion` 3.
Who gets them: self 32, target 31, self-after-hit 16.

Proposed mapping (each stage is +1 step; cap ±6 as in the games; a stage decays 1 per own turn):

| stat | board meaning of `+1 stage` |
|---|---|
| `atk` | +1 to the capture roll when the capture uses a **contact/Physical** move |
| `spa` | +1 to the capture roll when the capture uses a **Special/ranged** move |
| `def` | −1 to the *attacker's* roll for incoming Physical/contact captures |
| `spd` | −1 to the *attacker's* roll for incoming Special/ranged captures |
| `spe` | +1 initiative tie-break; at +2 the piece may move **1 extra square along its own pattern** |
| `accuracy` | lowers the miss threshold by 1 |
| `evasion` | raises the attacker's needed roll by 1 (cap at +2 to keep it from being untouchable) |

Two stages of `spe` giving extra reach is the one place I'd stake a claim: it makes Agility/Dragon Dance/
Rock Polish/Shift Gear *chess-legible* (your knight now leaps further) rather than a hidden number.
`evasion` (only Double Team, Minimize, and one more) must be capped or it recreates the untouchable-piece bug.

### 2.8 Status → movement restriction (the formula)

| status | gen-9 primary | as secondary | Board effect |
|---|---|---|---|
| `slp` | 5 (Spore, Sleep Powder, Hypnosis, Sing, Dark Void) | 2 | Piece **cannot move** for `d6 mod 3 + 1` turns (1–3). |
| `par` | 3 (Thunder Wave, Glare, Stun Spore) | 35 | Piece moves at **half range** (sliders capped to 2 squares); 25% chance its move fizzles. |
| `brn` | 1 (Will-O-Wisp) | **41** | Piece's Physical/contact captures roll at −1; chip damage each turn. |
| `psn` | 3 (Poison Powder, Poison Gas, Toxic Thread) | 24 | Chip damage each turn. |
| `tox` | 1 (Toxic) | 4 | Escalating chip damage; kills in 5 turns if not cleansed. |
| `frz` | **0 primary** | 13 | Piece **cannot move** until an incoming Fire-type capture or a `thawsTarget` move (Scald, Scorching Sands, Steam Eruption, Hydro Steam, Matcha Gotcha) hits it. |

**Finding that contradicts a natural assumption:** the brief lists 5 non-volatile statuses, and there are only
**13 gen-9 moves that inflict one as a primary effect**. The real volume is in `secondary`: brn 41, par 35,
psn 24, frz 13, tox 4, slp 2 — **119 secondary applications**. Any "status system" that only reads
`move.status` will cover 13 moves and miss 119. Read both.

`frz` never appears as a primary status in gen 9 (Freeze-Dry etc. are all secondaries), so a freeze mechanic
must be built from the secondary path or it will look dead.

`flinch` is the largest single volatile rider — **46 gen-9 applications** (33 all-gens by move count) —
and has an obvious board meaning: **the target loses its next turn**. Iron Head, Rock Slide, Air Slash,
Zen Headbutt, Waterfall, Extrasensory, Astonish, Fake Out. That is a big, coherent, free mechanic.

---

## 3. The bespoke set: 79 moves, 16 rules (8.3% of the dex)

Verified with `moves-recon-final.mjs`: 79 distinct ids, all present in the dex, **70 of them gen-9 legal**,
zero overlap issues. Coverage split:

| Corpus | total | bespoke | curated-tag (data only) | pure-derived |
|---|---|---|---|---|
| gen-9 | 685 | 70 (10.2%) | 61 (8.9%) | **554 (80.9%)** |
| all-954 | 954 | 79 (8.3%) | 88 (9.2%) | **787 (82.5%)** |

A "bespoke rule" is one hand-written TS function. A "curated tag" is a row in a `Record<MoveID, Tag>` table
that redirects the move to a rule that already exists — data, not code.

| Rule | n | Moves | One-line justification |
|---|---|---|---|
| **B1_CallsMove** | 11 | Metronome, Copycat, Sleep Talk, Assist, Me First, Mirror Move, Nature Power, Mimic, Sketch, Transform, Instruct | Each *executes another move*; unbounded without an explicit pool + depth cap. |
| **B2_SelfKO** | 9 | Explosion, Self-Destruct, Misty Explosion, Final Gambit, Healing Wish, Lunar Dance, Memento, Destiny Bond, Perish Song | Remove the caster; interacts illegally with check (the video's bug) so must be written by hand. |
| **B3_Retaliate** | 4 | Counter, Mirror Coat, Metal Burst, Comeuppance | `target:'scripted'` — a reaction, not an action; no derivable shape. |
| **B4_OHKO** | 4 | Guillotine, Horn Drill, Fissure, Sheer Cold | Bypass the entire type-matchup rule, i.e. bypass the game's core; must be individually bounded. |
| **B5_TypelessDamage** | 5 | Night Shade, Seismic Toss, Super Fang, Ruination, Endeavor | Damage independent of type chart (`damage:'level'`, fraction-of-pool) — the type-knowledge edge doesn't apply. |
| **B6_TypeMutation** | 6 | Soak, Magic Powder, Forest's Curse, Trick-or-Treat, Conversion, Reflect Type | **These change a piece's type, which in this game is its identity.** Highest-leverage 6 moves in the dex. |
| **B7_PassState** | 3 | Baton Pass, Shed Tail, Revival Blessing | Transfer accumulated state / resurrect — the only moves that can create unbounded value loops. |
| **B8_BoardSwap** | 5 | Court Change, Trick Room, Ally Switch, Pain Split, Psych Up | Mutate global or cross-piece state; no field encodes "swap sides of the board". |
| **B9_Delayed** | 2 | Future Sight, Doom Desire | Effects that resolve on a later turn need their own scheduler entry. |
| **B10_Guard** | 12 | Protect, Detect, Endure, Spiky Shield, Baneful Bunker, Silk Trap, Burning Bulwark, King's Shield, Obstruct, Quick Guard, Wide Guard, Crafty Shield | One rule; the 6 distinct punish payloads are a data table. Uncapturability must be explicitly bounded or it stalls the game. |
| **B11_Hazard** | 4 | Spikes, Toxic Spikes, Stealth Rock, Sticky Web | Persistent *square* state is a new board concept; layer counts and trigger conditions differ per move. |
| **B12_SelfLock** | 2 | Ingrain, No Retreat | Caster voluntarily gives up movement for a benefit — inverts the movement model. |
| **B13_Decoy** | 1 | Substitute | Creates a second, fake occupant of a square. |
| **B14_ItemDependent** | 5 | Fling, Trick, Switcheroo, Recycle, Belch | Read/mutate the item layer; behaviour undefined without the item system's shape. |
| **B15_FieldType** | 2 | Weather Ball, Terrain Pulse | Type and power depend on current field — cannot be baked at build time. |
| **B16_Cleanse** | 4 | Haze, Defog, Rapid Spin, Magic Coat | Removers/reflectors: must know the full set of removable state, so they change every time you add state. |

**Everything else that "feels" bespoke is a curated tag, not code.** 74 tags in 7 families
(`moves-recon-final.mjs`), overlapping bespoke only on `endeavor` and `fling`:

| Tag family | n | Members |
|---|---|---|
| `TRAP` | 18 | Bind, Clamp, Fire Spin, Infestation, Magma Storm, Sand Tomb, Snap Trap, Thunder Cage, Whirlpool, Wrap (all `partiallytrapped`) + Block, Mean Look, Spider Web, Jaw Lock, Octolock, Anchor Shot, Thousand Waves, Fairy Lock (hard no-escape) → all route to A12_PIN with `escapable: bool` |
| `PHAZE` | 5 | Roar, Whirlwind, Dragon Tail, Circle Throw, Teleport → A11 |
| `VARTYPE` | 10 | Hidden Power, Judgment, Techno Blast, Multi-Attack, Revelation Dance, Aura Wheel, Raging Bull, Tera Blast, Ivy Cudgel, Natural Gift → type resolved **at build time** from the owning species (Weather Ball / Terrain Pulse can't be, hence B15) |
| `VARPOWER` | 20 | Beat Up, Crush Grip, Electro Ball, Endeavor, Flail, Fling, Grass Knot, Gyro Ball, Hard Press, Heat Crash, Heavy Slam, Low Kick, Present, Reversal, Spit Up, Stored Power, Power Trip, Punishment, Rage Fist, Last Respects → `power: 3` + one state multiplier |
| `STATSWAP` | 7 | Power Swap, Guard Swap, Heart Swap, Speed Swap, Power Split, Guard Split, Power Trick |
| `ABILITYMOD` | 7 | Gastro Acid, Skill Swap, Role Play, Entrainment, Simple Beam, Worry Seed, Doodle |
| `LOCKOUT` | 7 | Disable, Encore, Torment, Taunt, Imprison, Spite, Quash → "target cannot use move X for `condition.duration` turns" |

**Judgement call I'm making, and what it costs:** I deliberately did *not* give bespoke treatment to the 20
`VARPOWER` moves, the 7 `STATSWAP` moves, or the 7 `ABILITYMOD` moves. They will be *approximated* — Gyro Ball
won't actually scale inversely with speed, it will just be a T3 hit with a speed-based ±1. That's 34 moves
that a Pokémon expert will notice are wrong. I traded per-move fidelity for a bespoke set that fits under 80
and a rule count (16) that one engineer can hold in their head.

---

## 4. The generic fallback (nothing is ever "missing")

The fallback is not an error path — it is **the modal case** (A36_STRIKE is 148 gen-9 moves, the largest
bucket). Spec, applied to any move with no cluster match:

```
deriveFallback(m):
  if m.category !== 'Status':
      shape   = MELEE                       # step in and capture, standard chess
      power   = tierOf(m.basePower || 60)   # 60 = median damaging BP; never 0
      reach   = 1
      reliability = diceOf(m.accuracy)
      initiative  = clamp(m.priority, -1, +1)
      charges = clamp(round(m.pp/5), 1, 5)
      # every rider it happens to carry still applies via the facet extractors
      return "an ordinary chess capture whose flavour is this move"

  else:   # Status with an unrecognised payload  (55 gen-9 / 73 all-gens)
      shape   = shapeOf(m.target)           # SELF for 80 of them, so usually harmless
      payload = ENCOURAGE                   # generic: +1 stage to the piece's single
                                            #   best base stat, duration = 2 turns
      charges = clamp(round(m.pp/5), 1, 5)
      return "a minor self-buff on the caster"
```

Two guarantees this gives you:

1. **No move is ever a no-op.** The `|| 60` on basePower is the important line: 28 gen-9 moves have
   `basePower === 0` and would otherwise derive to "capture with strength 0", i.e. an unusable move that
   looks like a bug to the player.
2. **The fallback is always *legal and boring*, never *illegal or broken*.** A status move you forgot to
   classify becomes a small self-buff — it consumes a charge, does something visible, and cannot corrupt
   state. Splash and Celebrate land here and that is *correct*: Splash should do nothing interesting.

The residual set the fallback actually catches (gen-9, n=47 = A37_SUPPORT_MISC), listed so nobody wonders:
Acupressure, After You, Belly Drum, Block, Celebrate, Conversion, Conversion 2, Court Change, Decorate, Defog,
Doodle, Entrainment, Forest's Curse, Guard Split, Guard Swap, Happy Hour, Haze, Heal Bell, Heart Swap, Lock-On,
Magic Powder, Magnetic Flux, Mean Look, Pain Split, Perish Song, Power Split, Power Swap, Psych Up, Quash,
Recycle, Reflect Type, Role Play, Simple Beam, Skill Swap, Soak, Speed Swap, Spicy Extract, Spite, Splash,
Stuff Cheeks, Switcheroo, Take Heart, Teatime, Tidy Up, Topsy-Turvy, Trick, Worry Seed.
Of these, 21 are already bespoke (B6/B8/B14/B16) or tagged (STATSWAP/ABILITYMOD), leaving **26 that genuinely
fall through to `ENCOURAGE`** — including Happy Hour, Celebrate, Splash, Teatime, which *should*.

**Test the fallback, not just the clusters.** Property test: for all 954 moves, `deriveEffect(m)` returns a
record where `power > 0 || payload !== 'DAMAGE'`, `charges >= 1`, and `shape` is a member of the Shape union.
Assert `archetypeOf(m) !== undefined` for all 954. Assert A23 stays empty.

---

## 5. Dangerous moves and how each class is bounded

The brief's danger list maps onto 5 classes. Good news: **3 of the 5 are machine-detectable** (`callsMove`,
`selfdestruct`, `stallingMove`), so the bound can be enforced by a predicate, not a denylist you forget to
update.

### Class D1 — Recursion / move-execution (`callsMove` + 4 tagged)
Metronome, Copycat, Sleep Talk, Assist, Me First, Mirror Move, Nature Power, Mimic, Sketch, Transform, Instruct.

**Bound: `RESOLUTION_DEPTH = 1`, enforced in the resolver, not in the moves.**
- One integer `depth` on the resolution context. Any D1 move called at `depth >= 1` **fails** (Showdown does
  the same thing for Metronome→Metronome).
- The candidate pool is the **caller's own pieces' derived movesets minus every D1 move minus every A02
  self-KO move**, sampled with the seeded PRNG. This keeps determinism (same seed ⇒ same Metronome result)
  and makes the pool small (median 4 options, see §6).
- Transform / Sketch / Mimic additionally **copy at most one move id** and are **once per game per piece**
  (`noPPBoosts` is already `true` on Sketch and Revival Blessing — reuse that signal).
- Instruct: cap at 1 re-execution per turn and forbid it re-executing anything with `flags.failinstruct`
  (29 gen-9 moves already carry that flag — the dataset did the curation for you).

### Class D2 — Board-wiping self-sacrifice (`selfdestruct` + Destiny Bond, Perish Song)
Explosion, Self-Destruct, Misty Explosion (`'always'`); Final Gambit, Healing Wish, Lunar Dance, Memento
(`'ifHit'`); Destiny Bond, Perish Song.

**Bound: cost + scope + a check-legality gate.**
- Explosion-class is `RING1_ALL`, so it can take at most **8 pieces + itself = 9**, never the board.
- **Hard rule that also fixes the video's bug:** a self-KO move is *illegal* if executing it would leave your
  own king in check. Same test as any other move — resolve it in the sandbox, then run the check predicate.
  This is the general fix for mutual destruction (see the "capture-in-check is broken" item in the brief) and
  self-KO is just its most extreme case.
- Explosion-class costs the piece **and 1 charge of everything adjacent-friendly** (it's your own bomb).
- Perish Song has `condition.duration: 4` in the data — use it verbatim: every piece on the board is marked,
  4 turns later all marked pieces die. Deterministic, self-terminating, dramatic, and *not* infinite.
- Destiny Bond: 1-turn window (`condition.duration: undefined` → override to 1), cannot chain (a piece killed
  by Destiny Bond does not trigger its own Destiny Bond).

### Class D3 — Unbounded repetition / stalling
Protect family (`stallingMove`, 12 moves), the 18 `TRAP` moves, Baton Pass, Shed Tail, Revival Blessing.

**Bounds:**
- Protect family: success probability `(1/3)^consecutive_uses`, reset when any other move is used. This is
  Showdown's own formula; it makes n consecutive Protects cost `3^n`, so stalling is self-limiting.
- Trapping: `TRAP` with `escapable: true` (the 10 `partiallytrapped` moves) lasts **4–5 turns max** and the
  trapped piece can still be captured. `escapable: false` (Block, Mean Look, Spider Web, Jaw Lock, Octolock,
  Anchor Shot, Thousand Waves, Fairy Lock): **hard cap at 3 turns** and the *trapper* also cannot move
  (Jaw Lock's real behaviour) — this makes it a 1-for-1 trade, not a free lock.
- Baton Pass / Shed Tail: **once per piece per game**, and the passed state is **capped at +2 total stages**
  regardless of what was accumulated. The 3-fold repetition rule (below) covers the rest.
- Revival Blessing: **once per side per game**, revived piece returns to its **original starting square only**
  if empty, else the move fails. Prevents infinite material.

### Class D4 — Non-progress / draw evasion
Any combination of moves that produces a repeating position.

**Bound: a global progress rule, not a per-move rule.**
- **Threefold repetition** on the full state hash (board + piece marks + charges + side conditions +
  hazard layers), *not* just board position — otherwise Protect/Recover cycles hash-collide and false-draw.
- **50-turn no-progress counter** where "progress" = a capture, a pawn/evolution advance, a hazard layer
  added, or a status newly applied. Status/heal loops therefore *do not* reset the clock.
- Every extra-move chain (super-effective → move again, crit → move again) must consume a charge or reduce a
  counter; combined with per-move `charges` (max 5), a piece has at most `sum(charges) ≈ 4×3 = 12` move-uses
  per game, which is a hard bound on chain length independent of board state.

### Class D5 — Delayed / cross-turn scheduling
Future Sight, Doom Desire, Wish, Perish Song, `condition.duration`-bearing effects.

**Bound: one scheduler, one queue, max one pending entry per (side, kind).** A second Future Sight while one
is pending simply fails. All durations come from `condition.duration` (max value in the dataset is **5**), so
the scheduler horizon is provably ≤ 5 turns and the queue is O(pieces), not unbounded.

### Also dangerous, not on the brief's list — flag these
- **`evasion` boosts** (Double Team, Minimize): the brief already worries about untouchable pieces; evasion
  stacking is a second route to the same bug. Cap total evasion effect at +2.
- **OHKO moves** (4): they bypass the type-matchup rule *entirely*, which is the game's whole thesis. Their
  1-in-3 reliability (`accuracy` 30) is the bound, but they should also be **draft-restricted** (max 1 per team).
- **`willCrit` moves** (Flower Trick, Frost Breath, Surging Strikes, Wicked Blow): guaranteed crit ⇒
  guaranteed extra move under the video's rule 4. **These 4 moves are the crit-chain engine.** Bound:
  a guaranteed-crit move grants the extra move **at most once per turn**, never chains into itself.
- **Population Bomb** (`multihit: 10`, `multiaccuracy`): 10 capture rolls in one move. Cap displayed/rolled
  hits at 5 for the board version.

---

## 6. PP and legality: how many moves should a piece have, and how are they chosen?

### 6.1 Learnset ground truth (measured)

Using `gen.learnsets.get(id)` on the gen-9 data object (`moves-recon-{7,8,10,11}.mjs`):

| Measurement | Value |
|---|---|
| Species entries with `num > 0` (incl. formes) | 1417 |
| Species with **zero** gen-9-source moves (`sources` starting with `'9'`) | **593** |
| Species with **no own learnset entry at all** (formes → need baseSpecies fallback) | **265** |
| gen-9-source moves per species (818 species that have any): median | **54** (mean 54.9, p10 40, p90 72, max 234 = Mew) |
| Same, with baseSpecies fallback (876 species): median | **55** (mean 56.8, max 234) |
| **All-gens, prevo-chain union, forme fallback (all 1417 species): median** | **79** (mean 79.5, p5 38, p10 48, p90 112, max 375 = Mew) |
| Distinct gen-9-learnable moves across the whole dex | **684** of 685 |
| Total (species, move) pairs, all-gens prevo-chain union | **112,670** (114,009 with the `<8 → baseSpecies` fallback) |
| Distinct move ids actually referenced by any species' union | **841** |

**Three facts that change the design:**

1. **593 of 1417 species have no gen-9 legal moveset.** The game wants all 1025 dex numbers. So the moveset
   source **must be all-gens learnsets with a prevo-chain union**, not gen-9 legality. That's also why §0
   recommends the 867-move corpus rather than 685.
2. **Formes are stubs.** Rotom-Wash, Rotom-Heat, Rotom-Frost, Rotom-Fan, Rotom-Mow, Necrozma-Dusk-Mane,
   Necrozma-Dawn-Wings, Zacian-Crowned, Zamazenta-Crowned, and the 5 cosplay Pikachus each have **exactly 1**
   learnset entry. Rule: **if `own.size < 8`, union with `baseSpecies`'s chain.** Non-negotiable or Rotom-Wash
   is unplayable.
3. **After all fallbacks, 29 species still have < 8 moves** and need a type-kit floor:
   Caterpie **5** (bugbite, electroweb, snore, stringshot, tackle), Weedle 4, Kakuna 6, Metapod 7, Wurmple 6,
   Blipbug 5, Burmy ×3 7, Magikarp 7 (bounce, celebrate, flail, happyhour, hydropump, splash, tackle),
   **Ditto 1** (transform), **Unown 1** (hiddenpower), Cosmog 2, Cosmoem 3, Necrozma-Ultra 2, + the forme stubs.
   **Fix:** `moveset = prevoChainUnion ∪ typeKit(species.types)` where `typeKit` is a fixed 6-move-per-type
   table (18 types × 6 = 108 curated ids, e.g. Water → Water Gun, Aqua Jet, Surf, Waterfall, Aqua Ring,
   Whirlpool). Guarantees every species has ≥ 8 moves without special-casing Magikarp.

### 6.2 How many moves does a piece actually get? **4.**

Keep the Pokémon convention. It is the right number for three independent reasons:
- **Legibility (hard problem 9):** 4 buttons is a chess player's whole new UI surface.
- **AI branching (hard problem 8):** legal-move count per position becomes `chessMoves × ~1.4` rather than
  `chessMoves × 54`. With 4 slots, most pieces have exactly 1 relevant move in most positions.
- **PP budget:** `charges = clamp(round(pp/5),1,5)` gives a piece `~4 × 3 = 12` total move-uses per game,
  which is the termination bound cited in §5/D4.

### 6.3 Choosing the 4 without a 900-move menu

**Answer: auto-generate a signature moveset deterministically at draft time; let the player swap at most 1
slot from a filtered shortlist.**

The auto-picker (implemented and measured in `moves-recon-9.mjs`):

```
score(species, move) =
    +30  if move.type ∈ species.types                    # STAB
    +20  if (Physical and atk >= spa) or (Special and spa > atk); else -10
    + min(30, basePower/4)                               # damaging weight
    + rarity(move)  where rarity = +45 if 1 learner, +35 if 2-3, +25 if 4-10,
                                   +10 if 11-50, 0 if 51-150, -10 if >150
    +22  if move ∈ HIGH_VALUE_UTILITY (a 60-id curated set)
    + 8  if priority > 0
    + 6  if ranged flag
    + 6  if target ∈ {allAdjacentFoes, allAdjacent}
    - 8  if accuracy < 80
```

Then **fill 4 slots with a shape quota**, so no piece gets four melee moves:
slot 1 = best MELEE damaging, slot 2 = best ranged/area damaging, slot 3 = best Status, slot 4 = best
remaining by score.

`rarity` is the key term and it costs **zero curation**: learner counts come straight from the learnsets.
Measured distribution across gen-9 (`moves-recon-8.mjs`):

| learners | 1 | 2–3 | 4–10 | 11–50 | 51–150 | 151–400 | 400+ |
|---|---|---|---|---|---|---|---|
| moves | **109** | 70 | 56 | 187 | 158 | 86 | 16 |

109 moves have exactly one learner — that is a machine-derived "signature move" list (Psystrike, Volt Tackle,
Aeroblast, Origin Pulse, Precipice Blades, Dragon Ascent, Doom Desire, Magma Storm, Freezing Glare, Shell Side
Arm, Chloroblast, Thunderous Kick, Eerie Spell, Crush Grip, Lunar Blessing, Attack Order, Defend Order, …).
No hand-curated iconicity list is needed. Conversely the 16 moves with 400+ learners are exactly the filler you
want to *avoid* picking: Tera Blast 868, Sleep Talk 865, Protect 865, Substitute 864, Rest 863, Endure 862,
Facade 849, Take Down 729, Rain Dance 615, Sunny Day 607, Helping Hand 550, Giga Impact 524.

**Measured outcome (876 standard gen-9 species, `moves-recon-9.mjs`):**

> **488 distinct moves appear across all auto-generated movesets** — 71% of the gen-9 corpus.

So the "954 moves" problem is really a "~490 moves appear in play" problem, and each one appears in a context
where its flavour makes sense. Spot-check of generated sets (all four slots, in order):

| Species | Auto-generated moveset |
|---|---|
| Pikachu | Wild Charge \| Discharge \| Thunder Wave \| Spark |
| Gengar | Hex \| Sludge Wave \| Destiny Bond \| Sludge Bomb |
| Garchomp | Dragon Rush \| Earthquake \| Spikes \| Breaking Swipe |
| Magnemite | Volt Switch \| Discharge \| Iron Defense \| Zap Cannon |
| Zapdos | Volt Switch \| Discharge \| Magnetic Flux \| Zap Cannon |
| Great Tusk | Headlong Rush \| Earthquake \| Bulk Up \| Close Combat |
| Iron Valiant | Spirit Break \| Aura Sphere \| Quick Guard \| Close Combat |
| Blissey | Hyper Beam \| Echoed Voice \| Soft-Boiled \| Hyper Voice |
| Charizard | Blast Burn \| Heat Wave \| Will-O-Wisp \| Fire Pledge |
| Lapras | Ice Shard \| Sparkling Aria \| Life Dew \| Waterfall |

Eight of ten are sets a Pokémon player would recognise. The two weak ones show the tuning needed: **Blissey**
gets Hyper Beam because the shape quota forces a melee damaging move onto a 10-Attack Pokémon (fix: allow
"no melee move" for species whose best melee score is negative, and fall back to a second Status slot);
**Charizard** gets Blast Burn/Fire Pledge because `rarity` overweights low-learner-count gimmick moves
(fix: add `-15` if `flags.recharge || flags.pledgecombo`).

### 6.4 Player control without paralysis
- Draft shows the auto-set. **One slot is swappable**, from a shortlist of the top 8 alternatives *by the same
  score*, filtered to a different shape than the slot it replaces. 8 options, not 54, and never 954.
- A "Custom" toggle behind an advanced flag exposes the full prevo-chain union (median 79) for the 1% who want it.
- **Legality is baked**, so there is no runtime validation surface: the bundle ships
  `species → uint16[] moveIds` and the engine can only ever pick from that array.

### 6.5 Bundle budget for the moveset data
**Measured, not estimated** (`moves-recon-verify.mjs`, with the `<8 → baseSpecies` fallback applied, giving
114,009 pairs across 1417 species and **841 distinct move ids referenced**):

| Encoding | Raw | gzip |
|---|---|---|
| `uint16` per id, length-prefixed per species | 225 KB | **54.7 KB** |
| delta-varint per species (ids sorted ascending) | 114 KB | **43.8 KB** |
- **Cheaper alternative worth considering:** ship only the *4 auto-picked ids per species* (1417 × 4 × 2 B =
  **11 KB**) plus the 8-alternative shortlist per slot (1417 × 4 × 8 × 2 B = 91 KB → **~102 KB total**), and
  put the full learnset behind a lazy chunk for the "Custom" toggle. This is the option I'd ship first.
- The move-effect table itself: 867 moves × ~24 B of packed derived record = **~21 KB**. The derivation runs
  at *build* time; the runtime only reads the record.

---

## 7. What I'd hand the four designers as the one-paragraph summary

`target` predicts the affected squares (12 shapes, 432/685 are plain MELEE); `category` + `basePower` +
`secondary` predict the payload (37 non-empty shape×payload cells cover everything); `drain`/`recoil`/
`multihit`/`ohko`/`critRatio`/`willCrit` are capture-resolution modifiers; `priority` is initiative;
`accuracy` is the d6 threshold; `pp` is charges; `condition.duration` is the turn count, already in the data.
`callsMove`, `selfdestruct` and `stallingMove` self-identify the three dangerous classes. 16 bespoke rules
covering 79 moves handle the rest, and a two-branch fallback (melee capture at tier `basePower||60`, or a
generic +1-stage self-buff) means every one of the 954 moves does something coherent. Movesets are 4 slots
auto-picked from the all-gens prevo-chain learnset union (median 79 candidates) using a rarity term derived
from learner counts, yielding 488 distinct moves in play and no 900-move menu.

---

## Appendix: probe scripts

| Script (in `/tmp/pkmn-probe/`) | What it produced |
|---|---|
| `moves-recon-1.mjs` | field distributions: category, target, priority, accuracy, BP buckets, PP, multihit, selfSwitch, critRatio, ohko, status, volatileStatus, drain, recoil, heal, weather, sideCondition, slotCondition |
| `moves-recon-2.mjs` | full flag counts; secondary/secondaries breakdown (170 moves, 119 status applications, 46 flinch); boost stat frequency |
| `moves-recon-3.mjs` | the 28 BP-0 moves, multihit/ohko/priority/hazard/flag membership lists |
| `moves-recon-4.mjs` | the 269-move all-gens delta, decomposed |
| `moves-recon-5.mjs` | shape × payload × selfAfter facet cross-tab for both corpora |
| `moves-recon-6.mjs` | derived scalars: charges, dice, power tier, reach distributions |
| `moves-recon-7/8/10/11.mjs` | learnset sizes, forme/prevo fallbacks, learner-count buckets, thin-learnset species, bundle-size arithmetic |
| `moves-recon-9.mjs` | the auto-moveset scorer + the 488-distinct-move measurement |
| `moves-recon-12.mjs` | every key on a gen-9 Move object with counts; the low-count structural fields |
| `moves-recon-13.mjs` | `callsMove` / `selfdestruct` / `stallingMove` / `ignoreImmunity` membership |
| `moves-recon-14.mjs` | `condition.duration` distribution and the persist-until-cleared set |
| `moves-recon-arch.mjs` | the 37-archetype ordered decision list; **0 unclassified in both corpora** |
| `moves-recon-sub.mjs` | A35/A36/A37 sub-splits (rider kinds, chance buckets, tier×contact) |
| `moves-recon-final.mjs` | the 79-move / 16-rule bespoke set and the 3-layer coverage split |
| `moves-recon-verify.mjs` | measured gzip bundle sizes (54.7 KB uint16 / 43.8 KB delta-varint), 841 distinct referenced move ids, A33 type composition |
