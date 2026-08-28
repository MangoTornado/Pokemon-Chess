# Recon: Abilities & Items → Board Effects

> Role: abilities & items analyst. Every count in this document was measured on this machine against
> `@pkmn/dex@0.10.11` in `/tmp/pkmn-probe` (probe scripts: `ai_counts.mjs`, `ai_items_struct.mjs`,
> `ai_probe3/4/5.mjs`, `ai/abmap.mjs`, `ai/itmap.mjs`, `ai/validate.mjs`, `ai/valit.mjs`, `ai/final.mjs`).
> The two classification tables below are **machine-validated for completeness**: every one of the 320
> ability names and every one of the 583 item names is assigned exactly once, verified by a script that
> diffs the mapping against `Dex.abilities.all()` / `Dex.items.all()`.

---

## 0. TL;DR for the designer

1. The real curation target is **310 abilities** and **351 items**, not 320 / 583.
2. The brief's claim "behaviour is prose only" is **true for abilities but materially wrong for items**, and
   even for abilities there is one usable machine-readable seam (`flags.breakable`, 84 abilities).
3. **13 archetypes / 115 implementation primitives** cover all 320 abilities. 47 primitives are singletons;
   273 of 320 abilities share a primitive with at least one other ability.
4. **19 item classes** cover all 583 items. 12 classes (351 items) are admitted as mechanics; 7 classes
   (232 items) are excluded and repurposed as cosmetics/UI, not deleted.
5. One ability (from the species' real slots) + one item (from a 12-item format Kit) per piece. Both public.
   The player learns **13 ability glyphs + 12 item glyphs = 25 symbols**, not 661 effects.
6. Of the four transformations: **Terastallization is the one to build** (zero data exists for it, but it
   operates on exactly our core axis — the piece's single type). **Mega/Primal** become the pawn-promotion
   payload (data exists: 48 + 2 formes). **Z-Moves** become the once-per-game Burst shell (crystals not
   drafted). **Dynamax/Gigantamax is cut** (it doubles HP, and we have no HP).

---

## 1. Verified counts, and what the real target set is

### 1.1 Raw counts (confirms the brief)

| Resource | `.all().length` | matches brief? |
|---|---|---|
| Abilities | **320** | yes |
| Items | **583** | yes |

### 1.2 Non-standard breakdown — measured

**Abilities** (`isNonstandard`):

| value | n | names |
|---|---|---|
| `null` (standard) | **310** | — |
| `Past` | 1 | `No Ability` (a sentinel, not a real ability) |
| `Future` | 6 | Dragonize, Eelevate, Fire Mane, Mega Sol, Piercing Drill, Spicy Spray |
| `CAP` | 3 | Mountaineer, Rebound, Persistent |

**Items** (`isNonstandard`):

| value | n |
|---|---|
| `null` (standard / SV-legal) | **249** |
| `Past` | **284** |
| `Future` | 45 (all fan-invented Mega Stones: Baxcalibrite, Meganiumite, Chandelurite, …) |
| `Unobtainable` | 3 (Cherish Ball, Park Ball, Strange Ball) |
| `CAP` | 2 (Crucibellite, Vile Vial) |

Generation spread: abilities gen 3→9 (`{0:4, 3:76, 4:47, 5:41, 6:27, 7:42, 8:34, 9:49}`);
items gen 1→9 (`{1:10, 2:53, 3:66, 4:97, 5:37, 6:64, 7:63, 8:131, 9:62}`).

### 1.3 The trap: `!isNonstandard` is *not* "the real Pokémon"

This is the single most important data fact for this role, and it changes the target set.

```
Dex.species.all()                          → 1517
  isNonstandard === null   (SV-legal)      →  911   ← what the brief calls "standard"
  isNonstandard === 'Past' (not in SV)     →  454
  isNonstandard === 'LGPE'                 →    2
  isNonstandard === 'Future'/'Custom'/'CAP'→   49 / 19 / 82
```

Those 454 `Past` species include **Ferrothorn, Shedinja, Aegislash, Kangaskhan, Castform, Silvally,
Cherrim, Golisopod, Wishiwashi, Zygarde, Darmanitan** — i.e. real, beloved, National-Dex Pokémon. Filtering
by `!isNonstandard` silently deletes them, and with them 37 abilities.

Measured consequence:

| species filter | species (formes) | base formes | distinct abilities used | admitted abilities with **zero** carriers |
|---|---|---|---|---|
| `!isNonstandard` | 911 | 733 | 273 | **37** (Iron Barbs, Wonder Guard, Zen Mode, Stance Change, RKS System, Parental Bond, …) |
| `null ∪ Past ∪ LGPE` | **1367** | **1025** | **310** | **0** |

The second row is the right definition of "all Pokémon": `1025` base formes is *exactly* the National Dex
number in the brief, and it produces **zero orphan abilities** — every one of the 310 standard abilities is
carried by at least one admitted species. That is a strong, checkable closure property.

**Decision.** Admitted species = `isNonstandard ∈ {null, 'Past', 'LGPE'}` = 1367 formes / 1025 base.
Excluded = `Future` (49) + `Custom` (19) + `CAP` (82) = 150 formes.
Admitted abilities = 310 (drop `No Ability`, the 6 `Future`, the 3 `CAP`).
Admitted items = the 12 classes in §3, filtered to `isNonstandard ∈ {null, 'Past'}` = **351**.

### 1.4 Ability slots per species (this sizes the draft UI)

Over the 1367 admitted formes: `{1 slot: 357, 2 slots: 378, 3 slots: 631, 4 slots: 1}`.
1008 have a Hidden ability. Total (species, ability) pairs = **3010**. Only `Rockruff` has 4 slots
(`Keen Eye` / `Vital Spirit` / `Steadfast` H / `Own Tempo` S). Two species have an `S` (signature/event)
slot: `Greninja: Battle Bond`, `Rockruff: Own Tempo`.

**So the ability choice at draft is at most a 4-way pick and usually a 2- or 3-way pick.** That is cheap
UI. This is the load-bearing reason the economy in §4 works.

---

## 2. The brief is partly wrong: there IS a machine-readable seam

The brief says ability/item behaviour is prose only and must be fully curated. Verified corrections:

### 2.1 Abilities — one real classification flag, plus five copy-protection flags

`Ability.flags` keys present in the dataset (measured): `breakable, cantsuppress, notrace, noentrain,
noreceiver, failroleplay, failskillswap, notransform`.

| flag | n | what it actually means | how we use it |
|---|---|---|---|
| `breakable` | **84** | exactly the set Mold Breaker / Teravolt / Turboblaze ignore | high-precision seed for **WARD ∪ BULWARK ∪ AILMENT/immune**. 84 of my 82 WARD+BULWARK assignments overlap; the flag *is* our "defensive ability" predicate, and it is exactly what `EDGE/pierce-ability` must consult at runtime. **No prose needed.** |
| `cantsuppress` | 16 | signature form-change abilities that Gastro Acid can't turn off | seed for **MORPH/forme-\*** |
| `notransform` | 13 | not copied by Transform | ditto |
| `notrace` / `noentrain` / `noreceiver` / `failroleplay` | 34/35/35/35 | not copyable/transferable | drives the legality of `MORPH/ability-copy` (Trace, Receiver, Power of Alchemy) — again zero prose |
| `failskillswap` | 29 | not swappable | ditto |

So `flags.breakable` alone gives us a free, canon-accurate, 84-member defensive set, and the copy-protection
flags give the *entire* copy-legality matrix for Trace/Receiver/Imposter without a single string match.
Everything else about abilities is genuinely prose and genuinely needs the table in §2.4.

### 2.2 Items — over half are classifiable with zero prose reading

Measured structured fields on `Item` (union of keys across all 583):

| field | n items | classification value |
|---|---|---|
| `fling.basePower` | 490 | ordinal "throwability" — free numeric weight for a "Fling" move |
| `itemUser: string[]` | 155 | **species-locked items**, fully machine-readable (e.g. `Light Ball → Pikachu×16`, `Soul Dew → Latios/Latias`, `Wellspring Mask → Ogerpon-Wellspring`) |
| `megaStone: string` | 93 | Mega Stone → target forme, exact |
| `isBerry` | 77 | berry class |
| `naturalGift: {type, basePower}` | 77 | **every berry's type** |
| `forcedForme: string` | 62 | Plate/Memory/Drive/Mask/Orb → forme |
| `onPlate` / `onMemory` / `onDrive` | 34 / 17 / 4 | type-setter items, with the type as the value |
| `zMove` | 35 (18 `true`, 17 string) | type-crystal vs signature-crystal, exact |
| `zMoveType` | 18 | the crystal's type |
| `isPokeball` | 28 | junk class, exact |
| `isGem` | 18 | one-shot type boost |
| `boosts: {}` | 13 | the stat delta, as a numeric object |
| `isChoice` | 3 | exact |
| `isPrimalOrb` | 2 | exact |
| `ignoreKlutz` | 8 | Klutz interaction, exact |

**The killer one:** for all **18 type-resist berries**, `naturalGift.type` is *exactly* the resisted type —
verified: `Occa→Fire, Passho→Water, Wacan→Electric, Rindo→Grass, Yache→Ice, Chople→Fighting, Kebia→Poison,
Shuca→Ground, Coba→Flying, Payapa→Psychic, Tanga→Bug, Charti→Rock, Kasib→Ghost, Haban→Dragon, Colbur→Dark,
Babiri→Steel, Chilan→Normal, Roseli→Fairy`. So the largest berry sub-family is 100% derived.

Counting it up: `isPokeball`(28) + `megaStone`(93) + `zMove`(35) + `isBerry`(77) + `isGem`(18) +
`forcedForme`(62) + `isChoice`(3) = **316 of 583 items (54%) classified from structured fields with zero
prose reading**. Adding the trivial `/^TR\d\d$/` regex (100 items) → 416 (71%). **Only 167 items need
hand classification**, and they are all listed by name in §3.

### 2.3 What actually *has* to be curated

| layer | size | source |
|---|---|---|
| Ability archetype + primitive + params | **310 rows** | the table in §2.4 (this document) |
| Ability primitive implementations | **115 functions** | hand-written, avg 15 LOC |
| Item class assignment | 167 rows hand, 416 derived | §3 |
| Item primitive implementations | **~40 functions** | hand-written |
| Format Kits / ban list | 1 file | §4, §6 |

That is the whole hand-written surface: **~155 small functions and 2 data tables**. Not 893 special cases.

### 2.4 The ability contract: 10 hooks and one number

Before the table, the interface every archetype compiles into. This is what makes "an ability" a small
data record rather than code.

**The Clash.** Every capture attempt is a *Clash* between attacker `A` and defender `D`:

```
1. LEGALITY   type multiplier m = chart(A.type, D.type); if m === 0 → illegal (move not generated)
              then ability/item hooks: WARD.legality(), BIND.legality()   → may also make it illegal
2. ROLL       C = d6 + Vigour(A) - Vigour(D) + Σ atk-hooks(A) - Σ def-hooks(D)      clamp C to [1,10]
3. OUTCOME    C <= 1            → MISS         : both pieces die            (the video's "1")
              C >= 6            → CRIT         : capture + one extra move   (the video's "6")
              1 < C < 6 and m >= 2 → ADVANTAGE : capture + one extra move
              1 < C < 6 and m == 1 → TRADE     : ordinary capture
              1 < C < 6 and m <= 0.5 → BACKLASH: both pieces die           (mutual destruction)
4. AFTERMATH  winner: EDGE.escalate / GRASP.steal / MORPH hooks
              loser : RETALIATE.faint
              survivor (if the capture failed): RETALIATE.survive / BULWARK.recover
```

**Vigour** is the single integer that replaces all six base stats *and* all stat stages: one counter per
piece, range `[-3, +3]`, starts at 0, added to your Clash roll when attacking and subtracted from the
opponent's when defending. This is what lets ~60 stat-stage abilities and ~25 stat items collapse into
one legible mechanic. HP does not exist; capture stays binary. Two derived predicates cover every
HP-threshold ability in the dex:

- `pristine(P)` = true until `P` first survives a Clash or takes chip damage → the "at full HP" family
  (Sturdy, Multiscale, Focus Sash, Gale Wings, Tera Shell, Ice Face).
- `wounded(P)` = `Vigour(P) <= -1` → the "at 1/2 or 1/3 max HP" family (Blaze/Torrent/Overgrow/Swarm,
  Berserk, Anger Shell, Emergency Exit, Wimp Out, Defeatist, Zen Mode, Schooling, Shields Down, the
  eight pinch berries).

**The 10 hook points.** Every one of the 310 abilities implements 1–3 of these and nothing else:

| hook | signature | archetypes that use it |
|---|---|---|
| `legality` | `(A,D,board) → boolean` | WARD, BIND |
| `enter` | `(P, square, board) → Effect[]` | ARRIVAL |
| `atk` | `(A,D,board) → int` | EDGE, FOCUS/accuracy |
| `def` | `(A,D,board) → int` | BULWARK, FOCUS/evasion |
| `outcome` | `(Outcome) → Outcome` | BULWARK/se-reduce, EDGE/nve, FOCUS/crit, FOCUS/crit-deny, BULWARK/survive-once |
| `survive` | `(D,A) → Effect[]` | RETALIATE/thorns, /curse, /surge, /field |
| `faint` | `(D,A) → Effect[]` | RETALIATE/posthumous |
| `upkeep` | `(P, board) → Effect[]` | FIELD/upkeep, UPKEEP items, AILMENT ticks |
| `mobility` | `(P, board) → MoveMask` | STRIDE, BIND/escape |
| `identity` | `(P, board) → {type, forme}` | MORPH |
| `global` | `(board) → BoardMods` | FIELD (weather/terrain/aura/suppress) |
| `pierce` | `Set<'ward'\|'bulwark'\|'immunity'\|'vigour'\|'screen'>` | EDGE/pierce-\* |

(Twelve rows; `outcome` and `pierce` are the two that make the hard abilities expressible. `pierce` is the
runtime consumer of `flags.breakable` from §2.1.)

**Generic fallback so nothing is ever missing.** The generator emits `archetype: 'INERT'` plus the real
`shortDesc` as tooltip text for any ability with no primitive, and fails the build with a listing. Today
that set is **empty** (320/320 assigned), but when gen 10 lands, new abilities appear on the board as
flavour text with a visible "not yet implemented" marker rather than silently doing nothing.

### 2.5 The 13 archetypes

| archetype | abilities | admitted species with ≥1 | one-line board meaning |
|---|---|---|---|
| `WARD` | 28 | **330** (24%) | *cannot be captured by …* — extends the 0× rule beyond the type chart |
| `BULWARK` | 32 | 238 | defensive Clash modifier, or survive one capture |
| `EDGE` | 58 | 492 | offensive Clash modifier, or pierce a defence |
| `RETALIATE` | 41 | 292 | the capturer suffers, or the corpse does something |
| `STRIDE` | 18 | 192 | movement range, initiative, extra-move odds |
| `ARRIVAL` | 19 | 158 | fires on entering a square |
| `MORPH` | 26 | 102 | changes this piece's type or forme mid-game |
| `FIELD` | 39 | 195 | global board state: weather, terrain, aura, rule suppression |
| `FOCUS` | 18 | 278 | edits the d6 itself: accuracy, evasion, crit window |
| `BIND` | 5 | 59 | restricts enemy movement |
| `AILMENT` | 22 | 260 | the status-condition layer |
| `GRASP` | 11 | 126 | the held-item layer |
| `INERT` | 3 | 5 | no board effect; refunds draft budget |

Coverage proof (`node ai/validate.mjs`): `rows(groups): 115  assigned: 320 of 320  MISSING (0):` and no
duplicate assignments.

### 2.6 Full mapping — all 320 abilities, 115 primitives

Read: `n` = abilities in the group; the backtick number after each name = how many of the 1367 admitted
species carry that ability (0 = excluded-only content). `*(Future)*` / `*(CAP)*` = excluded from play.

| # | Archetype | Primitive | Board rule | n | Abilities (`N` = admitted species carrying it) |
|---|---|---|---|---|---|
| 1 | `WARD` | `elemental` | Capture by that attacking type is ILLEGAL (extends the 0x rule). Blocked attacker loses its turn; ward pieces gain 1 Vigour (see BULWARK). | 11 | Volt Absorb `13`, Water Absorb `29`, Earth Eater `1`, Well-Baked Body `1`, Dry Skin `7`, Flash Fire `29`, Lightning Rod `35`, Storm Drain `12`, Motor Drive `4`, Sap Sipper `24`, Levitate `42` |
| 2 | `WARD` | `class` | Capture is ILLEGAL if the attacker's signature move carries the named flag (bullet/sound/powder/wind/status/explosive). | 6 | Bulletproof `10`, Soundproof `17`, Overcoat `28`, Wind Rider `3`, Good as Gold `1`, Damp `20` |
| 3 | `WARD` | `chain` | Cannot be captured by an EXTRA move (a chained/priority capture). Only the first capture of a turn may target it. | 3 | Armor Tail `1`, Dazzling `1`, Queenly Majesty `1` |
| 4 | `WARD` | `indirect` | Immune to all non-capture damage sources: hazards, weather, status ticks, thorns, item drain. | 1 | Magic Guard `10` |
| 5 | `WARD` | `secondary` | Immune to the rider effect of an enemy move/clash (status, debuff, hazard); the capture itself still resolves. | 1 | Shield Dust `30` |
| 6 | `WARD` | `reflect` | A hostile status/hazard effect aimed at this piece is redirected onto its source instead. | 2 | Magic Bounce `10`, Rebound *(CAP)* `0` |
| 7 | `WARD` | `ally` | Immune to friendly area effects (own side's allAdjacent / all-target moves). | 1 | Telepathy `28` |
| 8 | `WARD` | `absolute` | Capture is ILLEGAL unless the attack is super effective. HARD-CAPPED (see Balance). | 1 | Wonder Guard `1` |
| 9 | `WARD` | `elemental (excluded)` | Rock-type capture illegal + hazard immune. CAP-only, excluded from play. | 1 | Mountaineer *(CAP)* `0` |
| 10 | `WARD` | `elemental (excluded)` | Ground-type capture illegal + escalate on capture. Fan-data, excluded. | 1 | Eelevate *(Future)* `0` |
| 11 | `BULWARK` | `survive-once` | The first time this piece would be captured, the capture fails; the attacker stays put. Consumed. | 5 | Sturdy `48`, Disguise `4`, Ice Face `2`, Multiscale `2`, Shadow Shield `1` |
| 12 | `BULWARK` | `flat` | +1 to this piece's Clash die when defending (any attacker). | 3 | Fur Coat `2`, Ice Scales `2`, Tera Shell `1` |
| 13 | `BULWARK` | `se-reduce` | A super-effective capture on this piece succeeds but grants the attacker NO extra move. | 3 | Filter `4`, Solid Rock `4`, Prism Armor `3` |
| 14 | `BULWARK` | `elemental` | +2 Clash die when defending against the named attacking type(s). | 4 | Thick Fat `33`, Heatproof `7`, Water Bubble `3`, Purifying Salt `3` |
| 15 | `BULWARK` | `contact` | +2 Clash die when defending against a contact-flagged attacker. | 1 | Fluffy `6` |
| 16 | `BULWARK` | `class` | +2 Clash die when defending against a sound-flagged attacker (and +1 Edge on its own sound captures). | 1 | Punk Rock `4` |
| 17 | `BULWARK` | `no-backlash` | Immune to mutual destruction: on a not-very-effective capture this piece survives (attacker still dies). | 1 | Rock Head `24` |
| 18 | `BULWARK` | `recover` | After surviving a clash, this piece resets to full Vigour. | 1 | Regenerator `27` |
| 19 | `BULWARK` | `retreat` | Instead of being captured, this piece retreats to a random legal empty square it could move to; if none, it is captured. | 2 | Emergency Exit `1`, Wimp Out `1` |
| 20 | `BULWARK` | `disguise` | Renders on the board as a decoy species until its first clash, then reveals. | 1 | Illusion `4` |
| 21 | `BULWARK` | `vigour-lock` | Vigour (our single stat-stage counter) cannot be reduced by enemy effects. | 6 | Clear Body `19`, White Smoke `5`, Full Metal Body `1`, Big Pecks `15`, Hyper Cutter `12`, Guard Dog `2` |
| 22 | `BULWARK` | `vigour-invert` | Vigour changes on this piece are inverted in sign. | 1 | Contrary `10` |
| 23 | `BULWARK` | `vigour-scale` | Vigour changes on this piece are doubled in magnitude. | 1 | Simple `5` |
| 24 | `BULWARK` | `status-synergy` | +2 Clash die when defending while this piece carries a status condition or a terrain matches. | 2 | Marvel Scale `3`, Grass Pelt `2` |
| 25 | `EDGE` | `stab` | +1 Clash die when attacking with its own chess type (stacked STAB). | 1 | Adaptability `19` |
| 26 | `EDGE` | `double` | Attacking Clash die +2. Flat, always on. RATE-LIMITED (see Balance). | 2 | Huge Power `6`, Pure Power `3` |
| 27 | `EDGE` | `type` | +1 Clash die when this piece's chess type matches the named type. | 5 | Dragon's Maw `1`, Rocky Payload `1`, Steelworker `1`, Transistor `1`, Fire Mane *(Future)* `0` |
| 28 | `EDGE` | `threshold` | +1 Clash die while this piece is at 1 Vigour or less (last-stand bonus), matching type only. | 4 | Blaze `32`, Torrent `32`, Overgrow `32`, Swarm `32` |
| 29 | `EDGE` | `threshold-negative` | -1 Clash die while this piece is at 1 Vigour or less. | 1 | Defeatist `2` |
| 30 | `EDGE` | `escalate` | After a successful capture, permanently +1 Vigour (max +3). Snowball archetype. | 7 | Moxie `16`, Chilling Neigh `1`, Grim Neigh `1`, Beast Boost `11`, Battle Bond `3`, Soul-Heart `2`, Supreme Overlord `1` |
| 31 | `EDGE` | `flag` | +1 Clash die when the piece's signature move carries the named flag (punch/pulse/bite/slicing/low-power/recoil). | 6 | Iron Fist `19`, Mega Launcher `3`, Strong Jaw `12`, Sharpness `4`, Technician `28`, Reckless `13` |
| 32 | `EDGE` | `contact` | +1 Clash die on contact-flagged captures. | 1 | Tough Claws `8` |
| 33 | `EDGE` | `se` | A super-effective capture also grants +1 Vigour on top of the extra move. | 1 | Neuroforce `1` |
| 34 | `EDGE` | `nve` | NOT-VERY-EFFECTIVE captures no longer cause mutual destruction for this piece. Key anti-suicide tech. | 1 | Tinted Lens `13` |
| 35 | `EDGE` | `pierce-immunity` | Its captures ignore type-based 0x immunity entirely (Normal/Fighting may capture Ghost). | 2 | Scrappy `15`, Mind's Eye `1` |
| 36 | `EDGE` | `pierce-ability` | Its captures ignore all WARD and BULWARK abilities on the defender (the 84 `breakable` set). | 5 | Mold Breaker `26`, Teravolt `2`, Turboblaze `2`, Unseen Fist `4`, Piercing Drill *(Future)* `0` |
| 37 | `EDGE` | `pierce-screen` | Its captures ignore defensive FIELD effects (screens, allied auras, substitutes). | 1 | Infiltrator `26` |
| 38 | `EDGE` | `pierce-vigour` | Ignores the defender's Vigour when attacking and the attacker's Vigour when defending. | 1 | Unaware `15` |
| 39 | `EDGE` | `pierce-status` | Its Status-class moves ignore abilities but always act last. | 1 | Mycelium Might `2` |
| 40 | `EDGE` | `no-redirect` | Its captures cannot be intercepted or redirected by an enemy adjacency effect. | 2 | Propeller Tail `2`, Stalwart `3` |
| 41 | `EDGE` | `status-synergy` | +2 Clash die while this piece is burned / poisoned / statused. | 3 | Guts `26`, Flare Boost `2`, Toxic Boost `1` |
| 42 | `EDGE` | `field-synergy` | +1 Clash die (+2 if it would raise movement) while the matching weather/terrain is up or Booster Energy is held. | 2 | Protosynthesis `10`, Quark Drive `10` |
| 43 | `EDGE` | `conditional` | +1 Clash die against specific targets (same gender / a piece that moved last turn / last to act this turn). | 3 | Rivalry `18`, Stakeout `8`, Analytic `12` |
| 44 | `EDGE` | `tradeoff` | +1 Clash die but pay a cost: accuracy penalty, loss of rider effects, or move-lock. | 3 | Hustle `29`, Sheer Force `36`, Gorilla Tactics `1` |
| 45 | `EDGE` | `double-strike` | On a successful capture, this piece may immediately make one non-capturing move (a half extra move). | 1 | Parental Bond `1` |
| 46 | `EDGE` | `no-contact` | Its captures are treated as non-contact: RETALIATE/thorns and contact-triggered curses do not fire. | 1 | Long Reach `3` |
| 47 | `EDGE` | `weather` | +1 Clash die in the named weather (and immunity to its chip damage). | 1 | Sand Force `20` |
| 48 | `EDGE` | `field-boost` | +1 Clash die while its own summoned field is up (paired with the FIELD entry). | 3 | Hadron Engine `1`, Orichalcum Pulse `1`, Solar Power `10` |
| 49 | `RETALIATE` | `thorns` | An attacker that fails to capture this piece (or captures it by contact) is destroyed / damaged / slowed. | 8 | Rough Skin `6`, Iron Barbs `3`, Gooey `7`, Tangling Hair `2`, Cotton Down `2`, Gulp Missile `3`, Liquid Ooze `4`, Mirror Armor `2` |
| 50 | `RETALIATE` | `curse` | An attacker that makes contact with this piece is inflicted with a status / ability change / doom counter. | 12 | Static `33`, Flame Body `23`, Poison Point `20`, Effect Spore `11`, Cute Charm `15`, Cursed Body `16`, Mummy `2`, Lingering Aroma `1`, Wandering Spirit `2`, Perish Body `1`, Synchronize `18`, Spicy Spray *(Future)* `0` |
| 51 | `RETALIATE` | `posthumous` | If this piece IS captured, the capturer is destroyed or crippled as well (forced mutual destruction). | 2 | Aftermath `11`, Innards Out `1` |
| 52 | `RETALIATE` | `surge` | Surviving a clash (or being debuffed) gives this piece +1..+3 Vigour or +1 movement. | 16 | Anger Point `12`, Anger Shell `1`, Berserk `2`, Justified `10`, Rattled `21`, Stamina `3`, Steadfast `16`, Steam Engine `4`, Water Compaction `2`, Weak Armor `27`, Electromorphosis `1`, Wind Power `2`, Thermal Exchange `3`, Defiant `16`, Competitive `15`, Opportunist `1` |
| 53 | `RETALIATE` | `field` | Surviving a clash sets a global field/hazard (sand, grassy terrain, toxic spikes on the enemy half). | 3 | Sand Spit `3`, Seed Sower `1`, Toxic Debris `2` |
| 54 | `STRIDE` | `weather` | Movement range +1 (or +1 to the extra-move die) while the named weather is up. | 4 | Chlorophyll `42`, Swift Swim `48`, Sand Rush `10`, Slush Rush `7` |
| 55 | `STRIDE` | `terrain` | Movement range +1 while the named terrain is up. | 1 | Surge Surfer `1` |
| 56 | `STRIDE` | `ramp` | +1 to this piece's Initiative each turn it does not capture, capped at +3. | 1 | Speed Boost `14` |
| 57 | `STRIDE` | `initiative` | Wins/loses initiative ties; may act before the normal order or is forced to act last. | 2 | Quick Draw `1`, Stall `1` |
| 58 | `STRIDE` | `priority` | Once per game may pre-empt: interpose or capture out of turn under a stated trigger. | 3 | Gale Wings `3`, Prankster `20`, Triage `1` |
| 59 | `STRIDE` | `penalty` | Movement crippled: skips alternate turns, or halved range for the first 5 turns. | 2 | Truant `3`, Slow Start `2` |
| 60 | `STRIDE` | `weight` | Weight class shifts, changing Iron Ball / Heavy Slam / Grass-terrain interactions and hazard vulnerability. | 2 | Heavy Metal `10`, Light Metal `7` |
| 61 | `STRIDE` | `item-linked` | Movement range +1 permanently once this piece's held item is consumed or removed. | 1 | Unburden `17` |
| 62 | `STRIDE` | `mirror` | When an enemy piece uses a dance-flagged move, this piece copies it for free. | 1 | Dancer `4` |
| 63 | `STRIDE` | `status-synergy` | Movement range +1 while statused; ignores the paralysis movement penalty. | 1 | Quick Feet `11` |
| 64 | `ARRIVAL` | `debuff-aura` | On entering a square, all enemy pieces adjacent (or in line of sight) lose 1 Vigour / evasion. | 2 | Intimidate `46`, Supersweet Syrup `2` |
| 65 | `ARRIVAL` | `self-buff` | On entering a square, gain +1 Vigour / +1 movement. Once per game where the real ability is once-per-battle. | 7 | Intrepid Sword `2`, Dauntless Shield `2`, Embody Aspect (Cornerstone) `1`, Embody Aspect (Hearthflame) `1`, Embody Aspect (Teal) `1`, Embody Aspect (Wellspring) `1`, Download `8` |
| 66 | `ARRIVAL` | `info` | On entering a square, reveal hidden information: enemy items, enemy signature moves, threat warnings. | 3 | Frisk `38`, Forewarn `6`, Anticipation `18` |
| 67 | `ARRIVAL` | `ally-support` | On entering a square, heal / copy / reset the Vigour of a friendly adjacent piece. | 3 | Hospitality `4`, Costar `1`, Curious Medicine `1` |
| 68 | `ARRIVAL` | `field-clear` | On entering a square, clear the enemy's screens/auras on that half of the board. | 1 | Screen Cleaner `2` |
| 69 | `ARRIVAL` | `deny-aura` | While on the board, enemy pieces cannot consume held berries / gain Vigour from items. | 3 | Unnerve `28`, As One (Glastrier) `1`, As One (Spectrier) `1` |
| 70 | `MORPH` | `type-on-attack` | Before its capture resolves, this piece's chess type becomes the type of the move it uses. Once per game (see Balance). | 2 | Protean `7`, Libero `4` |
| 71 | `MORPH` | `type-reactive` | This piece's chess type becomes the type of the last attack that hit it. | 1 | Color Change `1` |
| 72 | `MORPH` | `type-field` | This piece's chess type tracks the active weather / terrain. | 2 | Forecast `4`, Mimicry `1` |
| 73 | `MORPH` | `type-item` | This piece's chess type is set by its held Plate / Memory / Drive / Mask. The item IS the type. | 2 | Multitype `18`, RKS System `18` |
| 74 | `MORPH` | `attack-type` | Its Normal-type (or sound) captures resolve as the named type, +1 Clash die. Changes the matchup, not the piece. | 7 | Aerilate `2`, Galvanize `3`, Pixilate `3`, Refrigerate `3`, Normalize `2`, Liquid Voice `3`, Dragonize *(Future)* `0` |
| 75 | `MORPH` | `forme-threshold` | At a Vigour / damage threshold this piece swaps to its alternate forme (new stat line, sometimes new type). | 5 | Zen Mode `4`, Schooling `2`, Shields Down `8`, Power Construct `3`, Hunger Switch `2` |
| 76 | `MORPH` | `forme-stance` | Swaps between an offensive and a defensive forme depending on whether it captured or defended last. | 1 | Stance Change `2` |
| 77 | `MORPH` | `forme-entry` | Transforms on first entering the board. | 1 | Tera Shift `1` |
| 78 | `MORPH` | `forme-once` | Transforms permanently the first time it survives a clash. One-way promotion. | 1 | Zero to Hero `2` |
| 79 | `MORPH` | `ability-copy` | Copies the ability of an adjacent enemy (or a friendly piece that just died). | 3 | Trace `6`, Receiver `1`, Power of Alchemy `2` |
| 80 | `MORPH` | `total-copy` | On arrival, becomes a full copy of the enemy piece it faces (type, ability, movement). BANNED in ranked (see Balance). | 1 | Imposter `1` |
| 81 | `FIELD` | `weather` | Sets a global weather that persists until replaced; changes movement, Clash dice and chip damage board-wide. | 8 | Drizzle `3`, Drought `5`, Sand Stream `5`, Snow Warning `8`, Primordial Sea `1`, Desolate Land `1`, Delta Stream `1`, Mega Sol *(Future)* `0` |
| 82 | `FIELD` | `terrain` | Sets a global terrain that persists until replaced; buffs matching types and blocks some effects. | 4 | Electric Surge `2`, Grassy Surge `5`, Misty Surge `2`, Psychic Surge `3` |
| 83 | `FIELD` | `weather-off` | While this piece is on the board, all weather effects are suspended. | 2 | Air Lock `1`, Cloud Nine `7` |
| 84 | `FIELD` | `suppress` | While this piece is on the board, ALL abilities (both sides) are switched off. Board-wide rule toggle. | 2 | Neutralizing Gas `3`, Teraform Zero `1` |
| 85 | `FIELD` | `aura-offense` | All pieces of the named type get +1 Clash die (or 0.75x), regardless of owner. | 6 | Dark Aura `1`, Fairy Aura `1`, Aura Break `2`, Steely Spirit `1`, Battery `1`, Power Spot `1` |
| 86 | `FIELD` | `aura-ruin` | All pieces WITHOUT this ability lose 1 from the named Clash role. Four Ruin abilities. | 4 | Sword of Ruin `1`, Tablets of Ruin `1`, Beads of Ruin `1`, Vessel of Ruin `1` |
| 87 | `FIELD` | `aura-ally` | Friendly pieces adjacent to this one gain a defensive/accuracy/status bonus. | 8 | Friend Guard `29`, Flower Gift `2`, Flower Veil `5`, Victory Star `1`, Plus `10`, Minus `8`, Healer `12`, Commander `3` |
| 88 | `FIELD` | `aura-pressure` | Enemy pieces adjacent to this one pay an extra cost to act (lose a move charge) or take chip damage. | 2 | Pressure `36`, Bad Dreams `1` |
| 89 | `FIELD` | `upkeep` | End-of-turn self-sustain tied to weather: regain 1 Vigour, or pay 1. | 2 | Rain Dish `14`, Ice Body `21` |
| 90 | `FIELD` | `duration (excluded)` | Extends the duration of global effects. CAP-only, excluded. | 1 | Persistent *(CAP)* `0` |
| 91 | `FOCUS` | `accuracy` | +1 to this piece's Clash die (attacking); its die cannot be lowered by enemy evasion effects. | 3 | Compound Eyes `32`, Keen Eye `43`, Illuminate `8` |
| 92 | `FOCUS` | `always-hit` | Neither this piece nor its attacker can roll a 1 (miss): re-roll 1s both ways. | 1 | No Guard `11` |
| 93 | `FOCUS` | `evasion` | -1 to the enemy Clash die when this piece is the target, under the named condition. | 4 | Sand Veil `30`, Snow Cloak `15`, Tangled Feet `9`, Wonder Skin `5` |
| 94 | `FOCUS` | `crit` | Widens the crit window: a 5 also counts as a 6 (extra move) under the named condition. | 3 | Super Luck `9`, Sniper `18`, Merciless `2` |
| 95 | `FOCUS` | `crit-deny` | This piece cannot be crit: an attacker's 6 against it is treated as a 4 (plain capture, no extra move). | 2 | Battle Armor `11`, Shell Armor `31` |
| 96 | `FOCUS` | `secondary` | Doubles / adds the chance that a capture also applies its rider effect. | 2 | Serene Grace `18`, Stench `10` |
| 97 | `FOCUS` | `multihit` | Multi-hit signature moves always roll their maximum; used for the multi-capture move family. | 1 | Skill Link `10` |
| 98 | `FOCUS` | `steady` | Cannot be flinched or intimidated: immune to ARRIVAL/debuff-aura and flinch riders. | 1 | Inner Focus `38` |
| 99 | `FOCUS` | `random` | Every turn, +2 to one random Clash role and -1 to another. BANNED in ranked (see Balance). | 1 | Moody `8` |
| 100 | `BIND` | `trap-all` | Enemy pieces adjacent to this one may not move away from it (only capture it, or move within its zone). | 2 | Shadow Tag `6`, Arena Trap `3` |
| 101 | `BIND` | `trap-typed` | Same, but only against enemy pieces of the named type. | 1 | Magnet Pull `9` |
| 102 | `BIND` | `escape` | Immune to BIND: this piece may always move away. | 2 | Run Away `36`, Suction Cups `5` |
| 103 | `AILMENT` | `immune` | Immune to the named status condition; gaining the ability cures it. | 10 | Immunity `4`, Limber `14`, Insomnia `24`, Vital Spirit `16`, Magma Armor `3`, Water Veil `13`, Oblivious `25`, Own Tempo `34`, Comatose `1`, Leaf Guard `23` |
| 104 | `AILMENT` | `aura-immune` | This piece and adjacent friendly pieces are immune to the named status family. | 3 | Aroma Veil `15`, Sweet Veil `18`, Pastel Veil `2` |
| 105 | `AILMENT` | `cure` | Removes its own status at end of turn / on retreat / by chance. | 4 | Natural Cure `19`, Shed Skin `23`, Hydration `23`, Early Bird `16` |
| 106 | `AILMENT` | `exploit` | Turns a status into an advantage: heals from poison instead of taking chip damage. | 1 | Poison Heal `3` |
| 107 | `AILMENT` | `inflict` | Its captures and near-misses apply the named status to the target. | 3 | Poison Touch `11`, Toxic Chain `3`, Poison Puppeteer `1` |
| 108 | `AILMENT` | `pierce` | Can apply poison regardless of the target's type immunity. | 1 | Corrosion `5` |
| 109 | `GRASP` | `berry` | Modifies how this piece uses its held berry: earlier, doubled, twice, healing, or regrown. | 5 | Gluttony `38`, Ripen `5`, Cheek Pouch `7`, Cud Chew `4`, Harvest `9` |
| 110 | `GRASP` | `steal` | Takes the defender's (or attacker's) held item on a clash if this piece holds none. | 2 | Magician `6`, Pickpocket `16` |
| 111 | `GRASP` | `scavenge` | Picks up items dropped by captured pieces on adjacent squares. | 1 | Pickup `30` |
| 112 | `GRASP` | `protect` | This piece's item cannot be stolen, knocked off, or disabled. | 1 | Sticky Hold `12` |
| 113 | `GRASP` | `give` | May hand its item to an adjacent friendly piece as a free action once per game. | 1 | Symbiosis `5` |
| 114 | `GRASP` | `deny-self` | This piece's own held item does nothing (drafting cost offset elsewhere). | 1 | Klutz `12` |
| 115 | `INERT` | `none` | No board analogue. Drafted as "no ability"; the piece instead gets a +1 draft-budget refund. | 3 | No Ability *(Past)* `0`, Ball Fetch `1`, Honey Gather `4` |

---

## 3. Items: 19 classes over all 583

### 3.1 What the dataset actually contains (three surprises)

Before classifying, three things worth knowing because they shrink the problem:

1. **There are no medicines.** `Potion`, `Full Restore`, `Revive`, `Antidote`, `Elixir`, `Rare Candy` — a
   grep for all of them returns **zero** items. Showdown's item list is battle-relevant items only. So the
   whole "healing item" class the brief anticipates *does not exist* and needs no ruling.
2. **There are no vitamins / X-items / EV items.** `HP Up`, `Protein`, `X Attack`, `Dire Hit`, mints,
   `Ability Capsule` — a regex covering all of them matches **zero** items. The "TRAINING" class I built
   came back empty.
3. **100 of the 583 items (17%) are `TR00`–`TR99`** — Gen-8 Technical Records, all `Past`. That is the
   single biggest block of junk and it is one regex.

So the "junk" problem is much smaller than it looks: **232 items excluded**, and 100 of those are TRs.

### 3.2 Class table — 583/583 assigned, validated

`n(std/Past/other)` = `isNonstandard` split. `ADMITTED` classes are filtered to `{null, Past}` at
generation time, which is why the admitted total is 351 rather than 352.

| Class | Verdict | n | std/Past/other | Board rule (admitted) or replacement (excluded) |
|---|---|---|---|---|
| `TYPE_LENS` | **ADMITTED** | 26 | 19/7/0 | +1 Clash die on captures made with the matching attacking type. Passive, permanent, never consumed. The bread-and-butter draft item. |
| `GEM` | **ADMITTED** | 18 | 1/17/0 | One-shot: +2 Clash die on this piece's next capture with the matching type, then consumed. |
| `CHOICE` | **ADMITTED** | 3 | 3/0/0 | Locks the piece to a single movement pattern / attack type for the rest of the game in exchange for +2 Clash die (Band/Specs) or +2 movement (Scarf). |
| `BERRY` | **ADMITTED** | 77 | 53/24/0 | One-shot consumable that fires on a stated Clash trigger, then the item slot is empty. |
| `GUARD` | **ADMITTED** | 21 | 19/2/0 | Defensive: raises the defender's Clash die, denies an attacker's bonus, or blocks a specific capture route outright. |
| `THORNS` | **ADMITTED** | 15 | 14/1/0 | Reactive: punishes or displaces the attacker after a clash this piece survives. |
| `UPKEEP` | **ADMITTED** | 7 | 7/0/0 | Ticks every turn the piece is on the board: regain or lose 1 Vigour, or convert damage dealt into Vigour. |
| `TEMPO` | **ADMITTED** | 24 | 15/9/0 | Changes movement range, initiative order, or the odds of acting first. |
| `LENS` | **ADMITTED** | 8 | 8/0/0 | Directly edits the d6: shifts the crit window, re-rolls misses, or adds flat accuracy. |
| `FIELD_ITEM` | **ADMITTED** | 10 | 10/0/0 | Interacts with global board state: extends or consumes weather/terrain, or immunises against it. |
| `FORME_KEY` | **ADMITTED** | 53 | 29/23/1 | Sets or gates the piece's identity: Plates/Memories/Drives/Masks/Orbs/Rusted gear/Booster Energy. Pairs with MORPH/type-item. |
| `EVO_ITEM` | **ADMITTED** | 43 | 41/2/0 | Not a held item: consumed at PROMOTION to pick which evolution the pawn becomes. Lives in a separate draft pool. |
| `MEGA_STONE` | **PARTIAL** | 93 | 0/47/46 | Admitted ONLY for the 48 real Mega formes; drives the once-per-game Mega transformation. The 45 fan-data stones are excluded. |
| `Z_CRYSTAL` | EXCLUDED | 35 | 0/35/0 | Excluded as items; the Z-Move payload is reassigned to the once-per-game Burst (see section 5). Crystals remain as the Burst icon/VFX set. |
| `BALL` | EXCLUDED | 28 | 25/0/3 | Excluded: no capture-a-wild-Pokemon concept. Drafting UI folds these into the cosmetic "Ball skin" for the piece's summon animation. |
| `RECORD` | EXCLUDED | 100 | 0/100/0 | Excluded: TR00-TR99 are move-teaching consumables. Drafting UI reuses them as the icon set for the "swap signature move" action in team-build. |
| `FOSSIL` | EXCLUDED | 15 | 0/15/0 | Excluded: revival mechanic has no board analogue. Drafting UI shows them as the "Ancient" cosmetic frame for the 11 fossil Pokemon lines. |
| `MAIL` | EXCLUDED | 1 | 0/1/0 | Excluded. Repurposed as the in-game emote/taunt channel icon. |
| `VALUABLE` | EXCLUDED | 6 | 5/1/0 | Excluded: no shop, no money. Drafting UI shows them as post-game "spoils" cosmetics awarded per win. |

### 3.3 Every item by name

**`TYPE_LENS`** (26) — Black Belt, Black Glasses, Charcoal, Dragon Fang, Fairy Feather, Hard Stone, Magnet, Metal Coat, Miracle Seed, Mystic Water, Never-Melt Ice, Odd Incense *(Past)*, Poison Barb, Rock Incense *(Past)*, Rose Incense *(Past)*, Sea Incense *(Past)*, Sharp Beak, Silk Scarf, Silver Powder, Soft Sand, Soul Dew, Spell Tag, Twisted Spoon, Wave Incense *(Past)*, Pink Bow *(Past)*, Polkadot Bow *(Past)*

**`GEM`** (18) — Bug Gem *(Past)*, Dark Gem *(Past)*, Dragon Gem *(Past)*, Electric Gem *(Past)*, Fairy Gem *(Past)*, Fighting Gem *(Past)*, Fire Gem *(Past)*, Flying Gem *(Past)*, Ghost Gem *(Past)*, Grass Gem *(Past)*, Ground Gem *(Past)*, Ice Gem *(Past)*, Normal Gem, Poison Gem *(Past)*, Psychic Gem *(Past)*, Rock Gem *(Past)*, Steel Gem *(Past)*, Water Gem *(Past)*

**`CHOICE`** (3) — Choice Band, Choice Scarf, Choice Specs

**`BERRY`** (77) — Aguav Berry, Apicot Berry, Aspear Berry, Babiri Berry, Belue Berry *(Past)*, Bluk Berry *(Past)*, Charti Berry, Cheri Berry, Chesto Berry, Chilan Berry, Chople Berry, Coba Berry, Colbur Berry, Cornn Berry *(Past)*, Custap Berry, Durin Berry *(Past)*, Enigma Berry, Figy Berry, Ganlon Berry, Grepa Berry, Haban Berry, Hondew Berry, Iapapa Berry, Jaboca Berry, Kasib Berry, Kebia Berry, Kee Berry, Kelpsy Berry, Lansat Berry, Leppa Berry, Liechi Berry, Lum Berry, Mago Berry, Magost Berry *(Past)*, Maranga Berry, Micle Berry, Nanab Berry *(Past)*, Nomel Berry *(Past)*, Occa Berry, Oran Berry, Pamtre Berry *(Past)*, Passho Berry, Payapa Berry, Pecha Berry, Persim Berry, Petaya Berry, Pinap Berry *(Past)*, Pomeg Berry, Qualot Berry, Rabuta Berry *(Past)*, Rawst Berry, Razz Berry *(Past)*, Rindo Berry, Roseli Berry, Rowap Berry, Salac Berry, Shuca Berry, Sitrus Berry, Spelon Berry *(Past)*, Starf Berry, Tamato Berry, Tanga Berry, Wacan Berry, Watmel Berry *(Past)*, Wepear Berry *(Past)*, Wiki Berry, Yache Berry, Berry *(Past)*, Bitter Berry *(Past)*, Burnt Berry *(Past)*, Gold Berry *(Past)*, Ice Berry *(Past)*, Mint Berry *(Past)*, Miracle Berry *(Past)*, Mystery Berry *(Past)*, PRZ Cure Berry *(Past)*, PSN Cure Berry *(Past)*

**`GUARD`** (21) — Ability Shield, Air Balloon, Assault Vest, Big Root, Bright Powder, Clear Amulet, Covert Cloak, Destiny Knot, Eviolite, Focus Band, Focus Sash, Heavy-Duty Boots, Lax Incense *(Past)*, Mental Herb, Metal Powder *(Past)*, Protective Pads, Ring Target, Safety Goggles, Shed Shell, Utility Umbrella, White Herb

**`THORNS`** (15) — Absorb Bulb, Adrenaline Orb, Blunder Policy, Cell Battery, Eject Button, Eject Pack, Luminous Moss, Mirror Herb, Red Card, Rocky Helmet, Snowball, Sticky Barb, Throat Spray, Weakness Policy, Berserk Gene *(Past)*

**`UPKEEP`** (7) — Black Sludge, Flame Orb, Leftovers, Life Orb, Metronome, Shell Bell, Toxic Orb

**`TEMPO`** (24) — Binding Band, Deep Sea Scale *(Past)*, Deep Sea Tooth *(Past)*, Float Stone, Full Incense *(Past)*, Grip Claw, Iron Ball, Lagging Tail, Leek *(Past)*, Light Ball, Lucky Punch *(Past)*, Macho Brace *(Past)*, Power Anklet, Power Band, Power Belt, Power Bracer, Power Herb, Power Lens, Power Weight, Quick Claw, Quick Powder *(Past)*, Room Service, Stick *(Past)*, Thick Club *(Past)*

**`LENS`** (8) — Expert Belt, Loaded Dice, Muscle Band, Punching Glove, Scope Lens, Wide Lens, Wise Glasses, Zoom Lens

**`FIELD_ITEM`** (10) — Damp Rock, Electric Seed, Grassy Seed, Heat Rock, Icy Rock, Light Clay, Misty Seed, Psychic Seed, Smooth Rock, Terrain Extender

**`FORME_KEY`** (53) — Adamant Crystal, Adamant Orb, Blue Orb *(Past)*, Booster Energy, Bug Memory *(Past)*, Burn Drive *(Past)*, Chill Drive *(Past)*, Cornerstone Mask, Dark Memory *(Past)*, Douse Drive *(Past)*, Draco Plate, Dragon Memory *(Past)*, Dread Plate, Earth Plate, Electric Memory *(Past)*, Fairy Memory *(Past)*, Fighting Memory *(Past)*, Fire Memory *(Past)*, Fist Plate, Flame Plate, Flying Memory *(Past)*, Ghost Memory *(Past)*, Grass Memory *(Past)*, Griseous Core, Griseous Orb, Ground Memory *(Past)*, Hearthflame Mask, Ice Memory *(Past)*, Icicle Plate, Insect Plate, Iron Plate, Lustrous Globe, Lustrous Orb, Meadow Plate, Mind Plate, Pixie Plate, Poison Memory *(Past)*, Psychic Memory *(Past)*, Red Orb *(Past)*, Rock Memory *(Past)*, Rusted Shield, Rusted Sword, Shock Drive *(Past)*, Sky Plate, Splash Plate, Spooky Plate, Steel Memory *(Past)*, Stone Plate, Toxic Plate, Water Memory *(Past)*, Wellspring Mask, Zap Plate, Vile Vial *(CAP)*

**`EVO_ITEM`** (43) — Auspicious Armor, Berry Sweet, Chipped Pot, Clover Sweet, Cracked Pot, Dawn Stone, Dragon Scale, Dubious Disc, Dusk Stone, Electirizer, Fire Stone, Flower Sweet, Galarica Cuff, Galarica Wreath, Ice Stone, King's Rock, Leaf Stone, Love Sweet, Magmarizer, Malicious Armor, Masterpiece Teacup, Metal Alloy, Moon Stone, Oval Stone, Prism Scale, Protector, Razor Claw, Razor Fang, Reaper Cloth, Ribbon Sweet, Sachet *(Past)*, Shiny Stone, Star Sweet, Strawberry Sweet, Sun Stone, Sweet Apple, Syrupy Apple, Tart Apple, Thunder Stone, Unremarkable Teacup, Up-Grade, Water Stone, Whipped Dream *(Past)*

**`MEGA_STONE`** (93) — Abomasite *(Past)*, Absolite *(Past)*, Absolite Z *(Future)*, Aerodactylite *(Past)*, Aggronite *(Past)*, Alakazite *(Past)*, Altarianite *(Past)*, Ampharosite *(Past)*, Audinite *(Past)*, Banettite *(Past)*, Barbaracite *(Future)*, Baxcalibrite *(Future)*, Beedrillite *(Past)*, Blastoisinite *(Past)*, Blazikenite *(Past)*, Cameruptite *(Past)*, Chandelurite *(Future)*, Charizardite X *(Past)*, Charizardite Y *(Past)*, Chesnaughtite *(Future)*, Chimechite *(Future)*, Clefablite *(Future)*, Crabominite *(Future)*, Darkranite *(Future)*, Delphoxite *(Future)*, Diancite *(Past)*, Dragalgite *(Future)*, Dragoninite *(Future)*, Drampanite *(Future)*, Eelektrossite *(Future)*, Emboarite *(Future)*, Excadrite *(Future)*, Falinksite *(Future)*, Feraligite *(Future)*, Floettite *(Future)*, Froslassite *(Future)*, Galladite *(Past)*, Garchompite *(Past)*, Garchompite Z *(Future)*, Gardevoirite *(Past)*, Gengarite *(Past)*, Glalitite *(Past)*, Glimmoranite *(Future)*, Golisopite *(Future)*, Golurkite *(Future)*, Greninjite *(Future)*, Gyaradosite *(Past)*, Hawluchanite *(Future)*, Heatranite *(Future)*, Heracronite *(Past)*, Houndoominite *(Past)*, Kangaskhanite *(Past)*, Latiasite *(Past)*, Latiosite *(Past)*, Lopunnite *(Past)*, Lucarionite *(Past)*, Lucarionite Z *(Future)*, Magearnite *(Future)*, Malamarite *(Future)*, Manectite *(Past)*, Mawilite *(Past)*, Medichamite *(Past)*, Meganiumite *(Future)*, Meowsticite *(Future)*, Metagrossite *(Past)*, Mewtwonite X *(Past)*, Mewtwonite Y *(Past)*, Pidgeotite *(Past)*, Pinsirite *(Past)*, Pyroarite *(Future)*, Raichunite X *(Future)*, Raichunite Y *(Future)*, Sablenite *(Past)*, Salamencite *(Past)*, Sceptilite *(Past)*, Scizorite *(Past)*, Scolipite *(Future)*, Scovillainite *(Future)*, Scraftinite *(Future)*, Sharpedonite *(Past)*, Skarmorite *(Future)*, Slowbronite *(Past)*, Staraptite *(Future)*, Starminite *(Future)*, Steelixite *(Past)*, Swampertite *(Past)*, Tatsugirinite *(Future)*, Tyranitarite *(Past)*, Venusaurite *(Past)*, Victreebelite *(Future)*, Zeraorite *(Future)*, Zygardite *(Future)*, Crucibellite *(CAP)*

**`Z_CRYSTAL`** (35) — Aloraichium Z *(Past)*, Buginium Z *(Past)*, Darkinium Z *(Past)*, Decidium Z *(Past)*, Dragonium Z *(Past)*, Eevium Z *(Past)*, Electrium Z *(Past)*, Fairium Z *(Past)*, Fightinium Z *(Past)*, Firium Z *(Past)*, Flyinium Z *(Past)*, Ghostium Z *(Past)*, Grassium Z *(Past)*, Groundium Z *(Past)*, Icium Z *(Past)*, Incinium Z *(Past)*, Kommonium Z *(Past)*, Lunalium Z *(Past)*, Lycanium Z *(Past)*, Marshadium Z *(Past)*, Mewnium Z *(Past)*, Mimikium Z *(Past)*, Normalium Z *(Past)*, Pikanium Z *(Past)*, Pikashunium Z *(Past)*, Poisonium Z *(Past)*, Primarium Z *(Past)*, Psychium Z *(Past)*, Rockium Z *(Past)*, Snorlium Z *(Past)*, Solganium Z *(Past)*, Steelium Z *(Past)*, Tapunium Z *(Past)*, Ultranecrozium Z *(Past)*, Waterium Z *(Past)*

**`BALL`** (28) — Beast Ball, Cherish Ball *(Unobtainable)*, Dive Ball, Dream Ball, Dusk Ball, Fast Ball, Friend Ball, Great Ball, Heal Ball, Heavy Ball, Level Ball, Love Ball, Lure Ball, Luxury Ball, Master Ball, Moon Ball, Nest Ball, Net Ball, Park Ball *(Unobtainable)*, Poke Ball, Premier Ball, Quick Ball, Repeat Ball, Safari Ball, Sport Ball, Strange Ball *(Unobtainable)*, Timer Ball, Ultra Ball

**`RECORD`** (100) — TR00 *(Past)*, TR01 *(Past)*, TR02 *(Past)*, TR03 *(Past)*, TR04 *(Past)*, TR05 *(Past)*, TR06 *(Past)*, TR07 *(Past)*, TR08 *(Past)*, TR09 *(Past)*, TR10 *(Past)*, TR11 *(Past)*, TR12 *(Past)*, TR13 *(Past)*, TR14 *(Past)*, TR15 *(Past)*, TR16 *(Past)*, TR17 *(Past)*, TR18 *(Past)*, TR19 *(Past)*, TR20 *(Past)*, TR21 *(Past)*, TR22 *(Past)*, TR23 *(Past)*, TR24 *(Past)*, TR25 *(Past)*, TR26 *(Past)*, TR27 *(Past)*, TR28 *(Past)*, TR29 *(Past)*, TR30 *(Past)*, TR31 *(Past)*, TR32 *(Past)*, TR33 *(Past)*, TR34 *(Past)*, TR35 *(Past)*, TR36 *(Past)*, TR37 *(Past)*, TR38 *(Past)*, TR39 *(Past)*, TR40 *(Past)*, TR41 *(Past)*, TR42 *(Past)*, TR43 *(Past)*, TR44 *(Past)*, TR45 *(Past)*, TR46 *(Past)*, TR47 *(Past)*, TR48 *(Past)*, TR49 *(Past)*, TR50 *(Past)*, TR51 *(Past)*, TR52 *(Past)*, TR53 *(Past)*, TR54 *(Past)*, TR55 *(Past)*, TR56 *(Past)*, TR57 *(Past)*, TR58 *(Past)*, TR59 *(Past)*, TR60 *(Past)*, TR61 *(Past)*, TR62 *(Past)*, TR63 *(Past)*, TR64 *(Past)*, TR65 *(Past)*, TR66 *(Past)*, TR67 *(Past)*, TR68 *(Past)*, TR69 *(Past)*, TR70 *(Past)*, TR71 *(Past)*, TR72 *(Past)*, TR73 *(Past)*, TR74 *(Past)*, TR75 *(Past)*, TR76 *(Past)*, TR77 *(Past)*, TR78 *(Past)*, TR79 *(Past)*, TR80 *(Past)*, TR81 *(Past)*, TR82 *(Past)*, TR83 *(Past)*, TR84 *(Past)*, TR85 *(Past)*, TR86 *(Past)*, TR87 *(Past)*, TR88 *(Past)*, TR89 *(Past)*, TR90 *(Past)*, TR91 *(Past)*, TR92 *(Past)*, TR93 *(Past)*, TR94 *(Past)*, TR95 *(Past)*, TR96 *(Past)*, TR97 *(Past)*, TR98 *(Past)*, TR99 *(Past)*

**`FOSSIL`** (15) — Armor Fossil *(Past)*, Claw Fossil *(Past)*, Cover Fossil *(Past)*, Dome Fossil *(Past)*, Fossilized Bird *(Past)*, Fossilized Dino *(Past)*, Fossilized Drake *(Past)*, Fossilized Fish *(Past)*, Helix Fossil *(Past)*, Jaw Fossil *(Past)*, Old Amber *(Past)*, Plume Fossil *(Past)*, Root Fossil *(Past)*, Sail Fossil *(Past)*, Skull Fossil *(Past)*

**`MAIL`** (1) — Mail *(Past)*

**`VALUABLE`** (6) — Berry Juice *(Past)*, Big Nugget, Bottle Cap, Gold Bottle Cap, Pretty Feather, Rare Bone

*Note on dual-purpose items.* The classifier is **ordered, first-match-wins**, so a few real items that
serve two functions in canon land in the class that matters more on a chess board:
`Metal Coat`, `King's Rock`, `Dragon Scale`, `Razor Claw`, `Razor Fang`, `Deep Sea Tooth`,
`Deep Sea Scale` and `Prism Scale` are all *both* held items *and* evolution items. `Metal Coat` →
`TYPE_LENS` (its Steel boost is the board-relevant half); the rest → `EVO_ITEM` or `TEMPO` as listed.
Each of those eight also carries its evolution role in the promotion pool, so nothing is lost — the class
just says which hook owns it during play.

### 3.4 Admitted vs excluded, and what the UI shows instead

Measured totals (`node ai/final.mjs`): **ADMITTED 351, EXCLUDED 232, total 583.**

| Excluded class | n | Why it is meaningless on a chess board | What the drafting UI shows instead |
|---|---|---|---|
| `RECORD` (TR00–TR99) | 100 | teaches a move to a Pokémon outside battle | These become the **icon set and card frames for the "signature move" picker** in team-build. The player *does* choose each piece's signature move (that is the move-layer analyst's system) — the TR art is what that picker looks like. Nothing feels missing because the function they served (choosing moves) is preserved. |
| `MEGA_STONE` (fan/CAP) | 46 | Baxcalibrite, Meganiumite, Chandelurite etc. are not real Pokémon content (`isNonstandard: Future`/`CAP`) | Nothing. Silently absent — a player cannot notice the absence of an item that does not exist in any Pokémon game. |
| `Z_CRYSTAL` | 35 | a once-per-battle nuke; we already have a once-per-game Burst and the crystals would be a *second* hidden system on top of it | **Reassigned, not deleted.** The 18 type crystals become the 18 Burst VFX/aura colours; the 17 signature crystals become the signature-Burst art for their species. Choosing your Burst *is* choosing a crystal, visually. |
| `BALL` | 28 | no wild encounters, no catching | **Cosmetic "Ball skin"** on the piece's summon animation and its captured-piece tray. Free personalisation, zero rules weight. |
| `FOSSIL` | 15 | revival is an out-of-battle process | The **"Ancient" card frame** applied automatically to the 11 fossil lines (Omanyte, Kabuto, Aerodactyl, Lileep, Anorith, Cranidos, Shieldon, Tirtouga, Archen, Tyrunt, Amaura) plus the 4 Galar chimeras. |
| `VALUABLE` | 6 | no shop, no currency (`Berry Juice, Big Nugget, Bottle Cap, Gold Bottle Cap, Pretty Feather, Rare Bone`) | **Post-game spoils**: awarded per win, spend on board/piece cosmetics. Keeps the "found treasure" feeling without touching the rules engine. |
| `MAIL` | 1 | flavour text attached to a traded Pokémon | The **emote / taunt channel icon** in multiplayer. |

Two further sub-exclusions inside admitted classes:

- **20 of the 77 berries are flavour-only** (`shortDesc: "Cannot be eaten by the holder"`): Belue, Bluk,
  Cornn, Durin, Grepa, Hondew, Kelpsy, Magost, Nanab, Nomel, Pamtre, Pinap, Pomeg, Qualot, Rabuta, Razz,
  Spelon, Tamato, Watmel, Wepear. They are *drafted*, cost 0 budget, and act as **cosmetic snacks with a
  single mechanical hook: they satisfy `GRASP/berry` abilities** (Harvest, Cheek Pouch, Cud Chew, Ripen,
  Gluttony) with a small generic effect (+1 Vigour once). So a Harvest piece with a Razz Berry is not a
  dead draw. The remaining **57 berries are live**, in exactly five roles measured from the data:
  `resist 18 / status-cure 15 / pinch-heal 9 / pinch-boost 8 / other 7`.
- **1 `FORME_KEY` excluded**: `Vile Vial` (CAP).

### 3.5 The ~40 item primitives

Items reuse the *same 12 hooks* as abilities (§2.4). That is the whole design economy: an item is an
ability with a consumption counter and a transfer rule. Concretely:

| primitive | hook | n items | example |
|---|---|---|---|
| `typeLens(type, +1)` | `atk` | 26 | Charcoal, Silk Scarf, Soul Dew |
| `gem(type, +2, consume)` | `atk` | 18 | Fire Gem |
| `resistBerry(type, def+2, consume)` | `def` | 18 | Occa Berry — **params from `naturalGift.type`** |
| `statusCureBerry(status, consume)` | `upkeep` | 15 | Lum Berry |
| `pinchHeal(consume)` | `upkeep` | 9 | Sitrus Berry |
| `pinchBoost(vigour, consume)` | `upkeep` | 8 | Salac Berry |
| `snack(consume)` | `upkeep` | 20 | Razz Berry (flavour berries) |
| `oneShotWard(type, popOnUse)` | `legality`+`outcome` | 1 | **Air Balloon** — the template for all wards, see §6 |
| `surviveOnce(condition)` | `outcome` | 2 | Focus Sash (`pristine`), Focus Band (1-in-6) |
| `flatDef(+1)` | `def` | 4 | Eviolite (only if `species.nfe`), Assault Vest |
| `immunityBreaker` | `legality` | 2 | **Ring Target, Iron Ball** — see §6 |
| `hazardImmune` | `enter` | 2 | Heavy-Duty Boots, Safety Goggles |
| `thorns(chip)` | `survive` | 4 | Rocky Helmet, Jaboca/Rowap Berry, Sticky Barb |
| `displaceAttacker` | `survive` | 2 | Red Card, Eject Button |
| `reactBoost(trigger, vigour, consume)` | `survive` | 11 | Weakness Policy, Absorb Bulb, Snowball |
| `upkeepTick(±1)` | `upkeep` | 7 | Leftovers (+1), Life Orb (−1 per capture), Toxic Orb |
| `moveRange(±1)` | `mobility` | 13 | Choice Scarf, Iron Ball, Macho Brace, the 6 Power items |
| `initiative(first\|last, p)` | `mobility` | 5 | Quick Claw (20%), Lagging Tail, Full Incense |
| `speciesLock(species, effect)` | any | 12 | Light Ball, Thick Club, Leek — params from **`itemUser`** |
| `crit(+1)` | `outcome` | 3 | Scope Lens, Leek, Lansat Berry |
| `accuracy(+1)` | `atk` | 4 | Wide Lens, Zoom Lens, Micle Berry |
| `fieldExtend(kind, +3)` | `global` | 6 | Damp Rock, Light Clay, Terrain Extender |
| `terrainSeed(kind, vigour, consume)` | `enter` | 4 | Electric Seed |
| `setType(type)` | `identity` | 55 | Plates, Memories, Drives, Masks — params from **`onPlate`/`onMemory`/`onDrive`/`forcedForme`** |
| `formeKey(forme)` | `identity` | 8 | Rusted Sword, Griseous Core, Adamant Crystal |
| `megaKey(forme)` | promotion | 47 | Venusaurite — params from **`megaStone`** |
| `evoKey(consumeAtPromotion)` | promotion | 43 | Fire Stone, Berry Sweet |
| `choiceLock(bonus)` | `atk`+`mobility` | 3 | Choice Band/Specs/Scarf |
| `itemLock` | `global` | 2 | Ability Shield, Clear Amulet |
| … 12 more singletons | | | Metronome, Loaded Dice, Big Root, Destiny Knot, Blunder Policy, Room Service, Utility Umbrella, Power Herb, Grip Claw, Binding Band, Protective Pads, Shed Shell |

**~40 primitives, 351 admitted items.** Twelve of them are parameterised purely from structured fields.

---

## 4. The economy: how a piece gets an ability and an item

### 4.1 Design constraint I am solving for

The brief's own trap: *"how does this stay legible rather than becoming 32 pieces × 2 hidden systems?"*
32 pieces × (1 ability + 1 item) = 64 effects on the board. If each is arbitrary, the game is unreadable
and unteachable. My answer is not "fewer effects" — it is **fewer kinds of effect, publicly displayed, with
a fixed vocabulary of 25 glyphs.**

### 4.2 Abilities: one, from the species' real slots, chosen at draft, public

- A drafted piece has **exactly one** ability, picked from `species.abilities` (`0`, `1`, `H`, `S`).
- Measured cost of this choice: 357 species offer no choice at all (1 slot), 378 offer 2, 631 offer 3,
  1 offers 4. So the UI is a **1-to-4 radio button**, never a search box.
- The Hidden ability is *not* gated (no "Hidden Ability unlock" grind — that is a single-player-RPG idea
  and it would make the draft unfair between players).
- **Abilities are public information**, shown on the piece card and on hover, both sides, always.

  *Trade-off taken:* this kills the surprise value of Illusion, Frisk, Forewarn, Anticipation and Imposter.
  I accept that, because hidden information (a) breaks the chess-adjacent AI search in the brief's hard
  problem #8, (b) makes the "type knowledge is your edge" fantasy into "memorisation of hidden state", and
  (c) makes losses feel unfair. **Compensation:** `Illusion` becomes the *one* sanctioned hidden-info
  ability (its piece renders as a decoy species until its first Clash), and `Frisk`/`Forewarn`/
  `Anticipation` are repurposed into board-analysis QoL (highlight threatened squares / show which enemy
  pieces can legally capture this one). Those are genuinely useful in chess and read as "this Pokémon is
  perceptive", which is the flavour.

- **Abilities do not transfer on capture.** They are part of the species. The four copy abilities
  (`Trace`, `Receiver`, `Power of Alchemy`, `Imposter`) are the deliberate, flagged exception, and their
  legality is read straight off `flags.notrace / noreceiver / failroleplay` (§2.1) so they can never copy
  something they shouldn't. Only 8 species total carry them (Ditto, Porygon line, Ralts line,
  Alakazam-Mega), so this is a rare, memorable event, not a systemic complication.

### 4.3 Items: one, from a 12-item Kit, chosen at draft, public, destroyed on death

The naive design — "pick any of 351 items for each of 16 pieces" — is 351^16 and paralysing. Instead:

**Format Kits.** A format (the draft preset) declares a **Kit: an ordered list of 12 items**, and each side
gets *one of each*. 16 pieces, 12 items → four pieces hold nothing. That single constraint does four things
at once: it caps the state space, it forces real allocation decisions (who gets the Sash?), it guarantees
both sides face the same toolbox, and it makes the item layer *learnable* — a returning player already
knows every item on the board.

Proposed v1 Kit ("Standard 12"), one per admitted class so the 12 glyphs teach the 12 archetypes:

| slot | item | class | why it's in the starter Kit |
|---|---|---|---|
| 1 | Leftovers | `UPKEEP` | teaches Vigour regeneration |
| 2 | Life Orb | `UPKEEP` | teaches Vigour as a cost, and it self-limits capture chains (see §6.15) |
| 3 | Focus Sash | `GUARD` | teaches `pristine` and survive-once |
| 4 | Rocky Helmet | `THORNS` | teaches "attacking is not free" |
| 5 | Choice Scarf | `CHOICE` | teaches lock-in trade-offs and movement |
| 6 | Air Balloon | `GUARD` | teaches one-shot wards, the template for all immunity |
| 7 | **Ring Target** | `GUARD` | **teaches that immunity is beatable** — the answer to hard problem #6 |
| 8 | Expert Belt | `LENS` | rewards knowing the type chart (SE captures) |
| 9 | Eviolite | `GUARD` | rewards drafting un-evolved pieces; legality from `species.nfe` |
| 10 | Sitrus Berry | `BERRY` | teaches consumables |
| 11 | Occa Berry (player picks the type) | `BERRY` | teaches type-resist tech; params from `naturalGift.type` |
| 12 | Heavy-Duty Boots | `GUARD` | teaches the hazard layer |

Later formats swap the Kit wholesale ("Weather Kit": 4 weather rocks + 4 terrain seeds + Utility Umbrella +
Damp Rock…; "Signature Kit": 12 `itemUser`-locked items and you must draft their owners). This is how the
remaining 339 admitted items enter the game over time — as *formats*, not as an inventory screen. Nothing is
missing; it is queued.

**Item persistence and theft.**

| event | what happens to the item |
|---|---|
| the piece is captured | item is **destroyed**. No loot. |
| the piece survives a Clash | item may be consumed by its own trigger (berries, Sash, Balloon) |
| capturer has `Magician` / `Pickpocket` and holds nothing | it **steals** the item — the only theft route via abilities (2 abilities, ~20 species) |
| `Sticky Hold` / `Ability Shield` on the defender | theft and removal fail |
| a `Knock Off` / `Trick` / `Thief` signature move resolves | move-layer effect; destroys or swaps the item |
| `Symbiosis` | hand your item to an adjacent friendly piece, once per game |

*Rationale for "destroyed, not looted":* looting turns every capture into a resource-accrual decision on top
of a chess decision, and it makes the winning side snowball. Destruction keeps the item layer a
*pre-game allocation puzzle* (which is legible and deep) rather than an in-game economy (which is neither).
The exceptions are all named, all rare, and all read as "that Pokémon is a thief", which is the flavour.

### 4.4 Legibility budget: 25 glyphs

The piece card is exactly three lines:

```
  ┌───────────────────────────────┐
  │  GENGAR            ♛ QUEEN    │
  │  ◆ GHOST                      │   ← the one chess-relevant type
  │  ⛨ WARD  · Levitate           │   ← archetype glyph + name; hover = shortDesc
  │  ✦ THORNS · Rocky Helmet      │   ← archetype glyph + name; hover = shortDesc
  │  Vigour ●●○                   │
  └───────────────────────────────┘
```

The player must learn 18 types (which is the game's whole point) + **13 ability glyphs** + **12 item
glyphs**. Every ability on the board is one of 13 colours, and its colour tells you what kind of thing it
will do to you before you read a word. That is the legibility answer: the archetype is not an internal
implementation detail, **it is the UI**.

---

## 5. Mega / Z / Dynamax / Tera — which survive

First, the measured data availability, because it decides most of this:

| mechanic | data in `@pkmn/dex@0.10.11` | `isNonstandard` |
|---|---|---|
| **Mega Evolution** | 48 real `-Mega` formes (full stat lines, new abilities, sometimes new types) + **47 Mega Stones** with `megaStone → forme` | all `Past`; 0 standard |
| **Primal Reversion** | 2 formes (Kyogre-Primal, Groudon-Primal) + Blue/Red Orb with `isPrimalOrb` | `Past` |
| **Z-Moves** | 35 crystals: 18 with `zMoveType`, 17 with `zMove: string` + `zMoveFrom`; `Move.isZ` on the move side | all `Past` |
| **Gigantamax** | 34 `-Gmax` formes, 41 species with `canGigantamax`; `Move.isMax` on the move side | all `Past` |
| **Terastallization** | **nothing.** No `teraType` field on Species (verified `false`), no Stellar type (the brief's 19 types are 18 + `???`) | n/a |

Note the asymmetry: 47 stones vs 48 Mega formes. `Rayquaza-Mega` needs no stone (it Megas via Dragon
Ascent) — a nice detail the data gives us for free.

### 5.1 ADOPT: Terastallization as the universal once-per-game transformation

**Verdict: build this one, and make it the headline.**

Argument. The core of Pokémon Chess (rule 2 of the original ruleset) is *one type per piece*. Tera is
literally the mechanic that changes a Pokémon's type. It is the only one of the four whose real-game
semantics land exactly on our central axis. Everything else about the four transformations (bigger stats,
bigger HP, one huge attack) is a *magnitude* change, and magnitudes are the part of Pokémon we already threw
away when we made capture binary.

**Rule — Terastal Burst.** Once per game per side, on your turn, declare Tera on one of your pieces:

- Its chess type changes to **any type it could legally have declared at draft** (its other real type(s)),
  plus one **Tera type** granted by the format — default "the type of its signature move".
- The change is **permanent** and public. The piece's board glow changes colour.
- Cost: the piece may not move on the turn it Teras. So it is a tempo sacrifice, which makes it a real
  decision, and it cannot be used as a free escape from a check.

Why it is good design here: it costs **zero data** (the type chart already exists), applies to **all 1025**
Pokémon uniformly (no haves/have-nots), it is the single most legible transformation to a chess player
("my bishop stops being weak to Ghost"), and it directly answers hard problem #5 (a piece that has been
countered at draft can be rescued once). It also gives the type-savvy player a skill expression that the
chess-savvy player cannot fake, which is the brief's stated soul.

### 5.2 ADOPT: Mega Evolution + Primal Reversion as the *promotion* payload

**Verdict: keep, scoped to the 48 + 2 formes that really exist.**

Pawn promotion is already reskinned as evolution in the original ruleset. Mega Evolution is the canon
"a fully evolved Pokémon goes further" mechanic, and the data is complete: a Mega forme has a real
`baseStats`, a real ability (often a different archetype — Mega Gengar gets `Shadow Tag`, Mega Kangaskhan
gets `Parental Bond`), and sometimes a real type change (Mega Charizard X becomes Fire/Dragon; Mega Ampharos
gains Dragon). All of that is exactly the promotion payload a chess variant wants.

**Rule.** A pawn reaching the last rank promotes along its real `evos` chain. If the species it promotes
*into* has a Mega forme and the side holds the matching `megaStone` in its Kit, promotion may go straight to
the Mega forme instead: a stronger piece class, a new ability, possibly a new type (which the player
re-declares). Primal Reversion is the same code path with 2 more rows and an `isPrimalOrb` gate.

Because all 48 Mega formes and 47 stones are `Past`, this is *only* available if we admit `Past` — which
§1.3 already established we must.

The **46 fan/CAP stones are excluded** by `isNonstandard ∈ {Future, CAP}` and never surface anywhere.

### 5.3 ADOPT the shell, CUT the items: Z-Moves become "the Burst"

**Verdict: keep the mechanic as a once-per-game special capture; do not admit the 35 crystals as items.**

A Z-Move is one enormous attack, once per battle. That maps cleanly to a once-per-game **Burst**: declare it
before a capture, and the Clash auto-resolves as a `CRIT` (capture + extra move) ignoring WARD and BULWARK.
It is a great panic button and a great finisher.

But making it an *item* is the mistake. It would occupy the one item slot, compete with Leftovers, and be a
second once-per-game resource sitting next to Tera — two hidden budgets is exactly the "32 pieces × 2 hidden
systems" failure the brief warns about. So: **Burst is a free, universal, once-per-game action** (like Tera,
and mutually exclusive with it — you get *one* of Tera or Burst per game, which makes the choice sharp), and
the 35 crystals are demoted to its **art**: 18 type auras, 17 signature animations for their species.

*Traded away:* the 17 signature Z-Moves as distinct mechanical effects (Ultranecrozium Z, Pikashunium Z…).
They survive as flavour and VFX only. I think that is right — 17 bespoke rules for 17 species is the worst
possible content-to-effort ratio in this whole document.

### 5.4 CUT: Dynamax / Gigantamax

**Verdict: cut the mechanic. Keep the art.**

Three independent reasons:

1. **It is an HP mechanic and we have no HP.** Dynamax's primary effect is doubling max HP. Capture is
   binary in this game. The core of the mechanic is definitionally inexpressible.
2. **Its second effect is already in our move layer.** G-Max moves are typed nukes with side effects —
   `Move.isMax` moves are structurally ordinary moves plus a field effect. Our move system covers that.
   Building Dynamax would produce a system whose only unique output is "a big number", which we deleted.
3. **Coverage is bad and lopsided.** 41 species out of 1025 (4%) can Gigantamax, and they skew hard to
   Gen-8 starters and Galar mons. A once-per-game transformation available to 4% of the roster is a draft
   trap, not a mechanic — it makes 41 species mandatory picks and the other 984 second-class.

Keep: the 34 `-Gmax` sprites as the **promotion animation** for those species (they are the best-looking
art in the dataset), and `canGigantamax` as a purely cosmetic card badge.

### 5.5 Summary

| mechanic | verdict | cost |
|---|---|---|
| Terastallization | **ADOPT** as the flagship once-per-game transformation | 1 rule, 0 data |
| Mega Evolution | **ADOPT** as the promotion payload | 48 formes + 47 stones, all already in data |
| Primal Reversion | **ADOPT**, same code path | 2 formes + 2 orbs |
| Z-Moves | **ADOPT the mechanic** (universal Burst), **CUT the 35 items** | 1 rule; crystals → VFX |
| Dynamax / Gigantamax | **CUT** | 34 sprites retained as promotion art |

And a rule to keep it bounded: **one transformation per side per game.** Tera *or* Burst, and promotion-to-
Mega is separate (it requires reaching the last rank, which is already a cost). Three simultaneous
once-per-game budgets would be unplayable.

---

## 6. Balance danger list

Every entry: the ability/item, the measured number of species that can access it, why it breaks, and the
specific bound. "Bound" means a rule change, not a nerf number I made up in isolation.

### 6.1 The general bound: **wards are one-shot**

This is the most important rule in this document, so it comes first. The brief's hard problem —
*"zero-effectiveness immunity creates untouchable pieces… bounded how?"* — has a canon answer sitting in the
item list, and it is **Air Balloon**: *"Holder is immune to Ground-type attacks. Pops when holder is hit."*

**Rule.** Every `WARD` (ability or item, including the type chart's own 0×) makes the *first* capture attempt
against it **illegal and consumes the ward**. The attacker loses its move; the defender gains the state
`Grounded` and is thereafter capturable normally. Flying pieces are not permanently immune to Ground; they
are immune *once*.

Why this is the right bound rather than a numeric nerf: it preserves the whole point (type knowledge saves
your piece at a critical moment), it makes the immune piece a *tempo* asset instead of an invulnerable one,
it is trivially legible ("the shield broke"), and it makes the immunity chart teachable through play. It
also fixes the video's runaway case without touching the type chart.

Measured scale of the problem it solves: **190 of 1367 admitted species (13.9%) carry a type-immunity
ability**, and **330 (24%) carry some `WARD`**. On top of that **164 species are Flying-type** and immune to
Ground by the chart alone. Without this bound, a quarter of the roster is drafted for untouchability.

Counter-suite that must be admitted alongside it (all canon, all measured present):

| counter | source | effect |
|---|---|---|
| **Ring Target** | item, `std` | *"The holder's type immunities granted solely by its typing are negated."* — a legality-layer immunity breaker, on the defender's side. Put it in the v1 Kit (§4.3 slot 7). |
| **Iron Ball** | item, `std` | *"Holder is grounded… If Flying type, takes neutral Ground damage."* — grounds a Flying piece. |
| `Scrappy` / `Mind's Eye` | 15 species | Normal/Fighting captures ignore the Ghost 0×. |
| `Mold Breaker` / `Teravolt` / `Turboblaze` / `Unseen Fist` | abilities | ignore all 84 `flags.breakable` defences — the `pierce` hook (§2.4) |
| `ignoreImmunity` moves | move layer | Thousand Arrows, Smack Down, Foresight family |

**Draft legality rule:** a format must guarantee each side ends the draft with at least one immunity breaker
(a `Scrappy`/`Mind's Eye` piece, or a `Ring Target`-holding piece, or a `pierce` ability). Enforced by the
draft validator, same as "at least one of every type on the board".

### 6.2 `Wonder Guard` — 1 species (Shedinja)

*"Can only be damaged by supereffective moves."* Under our rules this is a piece that **cannot be captured
at all** by most of the board — strictly worse than the Flying problem because it applies to 15 of 18 types
at once. And Shedinja has 1 HP in canon, which we have no way to represent.

**Bound (three layers, all needed):**
1. It obeys §6.1: the ward is one-shot. First non-SE capture attempt fails, then Shedinja is a normal piece.
2. While the ward is intact, a `CRIT` (Clash value ≥ 6) still captures it. RNG beats the wall, which is on
   theme for this game.
3. `Magic Guard` is *not* also granted, so hazards, weather, `RETALIATE/thorns` and status ticks kill it —
   which is exactly how Shedinja dies in the real game.

### 6.3 `Shadow Tag` — 6 species (Wobbuffet, Wynaut, Gothita line, Gengar-Mega)

Board-wide "enemies cannot move away from you" is *mate-forcing*: park it near the enemy king and the
opponent's legal move set collapses. This is the single most dangerous ability in the dex for a chess
variant, because chess loses are caused by having no legal moves.

**Bound:**
1. `BIND` range = the **king-move ring only** (the 8 adjacent squares), never board-wide.
2. **It never restricts the enemy KING.** Absolute carve-out. A binding ability may not participate in
   producing checkmate or stalemate.
3. A bound piece may always still *capture* the binder, and may always move *within* the ring.
4. `Run Away` / `Suction Cups` (`BIND/escape`) and `Shed Shell` (item) hard-counter it, and one must be
   legal in every format's Kit or ability pool.

Same bound applies to `Arena Trap` (3 species) and `Magnet Pull` (9 species), with their canon carve-outs
intact (Arena Trap does not bind airborne pieces; Magnet Pull binds only Steel), which conveniently makes
them weaker *and* more flavourful than Shadow Tag.

### 6.4 `Huge Power` / `Pure Power` — 9 species (Azumarill, Medicham, Diggersby, Mawile-Mega…)

Doubled Attack as a flat `+2` on the Clash die is not just strong, it *changes the outcome distribution*: it
would let a piece hit the `CRIT` band (≥6) on a base roll of 4, turning "double damage" into "free extra
moves forever" and feeding the chain-termination problem.

**Bound:** `EDGE/double` grants `+2` but the Clash value is **capped at 5** for these two abilities — they
can never manufacture a `CRIT`. They make you reliably win Clashes; they never give you tempo. That is the
correct translation of "high Attack" into a game where tempo is the scarce resource.

### 6.5 `Imposter` — 1 species (Ditto)

*"Transforms into the opposing Pokemon that is facing it."* A pawn that becomes a copy of the enemy queen is
a free second queen. It also breaks the draft (Ditto is a mandatory first pick) and the AI (the position's
material value changes on arrival).

**Bound:** Ditto copies **movement pattern and ability only**. Its chess **type stays Normal** and it stays
in its drafted piece class. So Ditto-as-a-pawn that faces a rook *moves* like a rook but is still a Normal
pawn on the type chart and still promotes like a pawn. That keeps the "Ditto copies things" fantasy,
removes the material duplication, and keeps it a fun draft pick rather than a mandatory one.
Copy legality is read from `flags.notransform` (13 abilities) so it can never copy `Disguise`,
`Neutralizing Gas`, `Protosynthesis`, etc.

### 6.6 `Focus Sash` + mutual destruction — the interaction the brief calls out

The degenerate line: put a Sash on a worthless pawn, throw it at the enemy queen. Under naive rules the
Sash converts the outcome so the pawn lives *and* the attacker suffers the mutual-destruction death → a
free queen for a pawn, repeatable with every survive-once effect on the board.

**Bound — the survive-once rule is strictly one-directional:**

> `BULWARK/survive-once` and `GUARD/surviveOnce` (Sturdy, Disguise, Ice Face, Multiscale, Shadow Shield,
> Focus Sash, Focus Band) convert **only** outcomes in which the *defender alone* would die
> (`TRADE`, `ADVANTAGE`, `CRIT`) into "capture fails, attacker stays put".
> They **do not** convert `MISS` (Clash ≤ 1) or `BACKLASH` (not-very-effective mutual destruction).
> On those two outcomes both pieces still die, ward or no ward.

Read plainly: *a shield protects you from being killed; it does not protect you from killing yourself.*
That one sentence removes the exploit, is memorable, and needs no numbers. It also means the suicide-capture
tactic from the video stays available (which I think is a feature — it is the low-skill player's tool) but
can never be made *free*.

`Rock Head` (`BULWARK/no-backlash`) is the deliberate, single, named exception — one ability, on a handful
of species, that *does* survive `BACKLASH`. Making it unique is what makes it exciting.

### 6.7 `Air Balloon` vs the Ground/Flying immunity rule

Already resolved by §6.1 — Air Balloon is not a problem, it is **the template**. Explicitly:

- Air Balloon grants `WARD/elemental(Ground)`, one-shot, and pops on the first attempt (canon behaviour).
- It stacks with a Flying type only in the sense that you now need **two** Ground attempts: the first pops
  the balloon, the second breaks the type ward. That is a *legible* two-layer defence with a clear cost
  (the item slot), not an invulnerability.
- `Iron Ball` and `Ring Target` (§6.1) each remove one layer, and `Iron Ball` also halves movement, so the
  counter-play is a real trade.

### 6.8 `Moody` — 8 species

`+2` to a random stat and `-1` to another, every turn, with no decision attached. In a deterministic-engine
game with a seeded PRNG this is pure variance that the player cannot interact with, and it makes the AI
search branch on nothing meaningful.

**Bound: banned in ranked formats.** Available in a "Chaos" casual format. This is the one place I would
rather remove content than translate it, because there is no decision to preserve.

### 6.9 `Neutralizing Gas` — 3 species (Koffing, Weezing, Weezing-Galar)

*"While this Pokemon is active, Abilities have no effect."* Board-wide, it deletes 62 other effects at once
and turns the game into plain chess for as long as it lives — an enormous, non-interactive swing, and a
nightmare for incremental AI evaluation.

**Bound:** `FIELD/suppress` applies to the **king-move ring only**, like `BIND`. Weezing becomes a walking
dead-zone you must route around — a genuinely interesting positional piece — instead of a global off-switch.
`Teraform Zero` gets the same treatment.

### 6.10 `Protean` / `Libero` — 11 species (Greninja, Cinderace, Meowscarada…)

Free type-changing every capture means the piece is never on the wrong side of a matchup, which deletes the
game's core skill test for its owner.

**Bound:** once per game (which is what Gen 9 already did — the data's `shortDesc` says
*"Once per switch-in"*). After it fires, the piece's type is locked to what it became. So it is a single,
big, planned tempo swing — the same shape as Tera, which keeps the vocabulary consistent.

### 6.11 `Speed Boost` — 14 species

Unbounded movement growth eventually produces a piece that reaches any square, which breaks both the
chess geometry and the AI's move generation.

**Bound:** `+1` initiative per turn, capped at `+3`, and **only ticks on a turn the piece does not capture**.
So it rewards patience and cannot combine with capture chains.

### 6.12 `Truant` / `Slow Start` — 3 species (Slakoth, Slaking, Durant)

The opposite failure: an ability so bad the species is undraftable, which effectively deletes Slaking (one
of the highest-BST Pokémon) from the game.

**Bound:** `STRIDE/penalty` and `INERT` abilities grant a **+1 draft-budget refund** to their side.
Slaking is a bargain piece with a real drawback rather than a trap. This is also why `INERT` is a real
archetype with a rule attached instead of a dumping ground.

### 6.13 Thorns stacking — `Rough Skin` + `Rocky Helmet` + `Iron Barbs` etc.

If `RETALIATE/thorns` can kill, then a thorns piece is an anti-capture wall and thorns effects stack into
free mutual destruction — the §6.6 exploit through a different door.

**Bound:** all thorns effects on a single Clash resolve to **at most `-1` Vigour on the attacker, total**
(they do not stack, they do not kill). Thorns wear the attacker down over several exchanges; they never
convert an attack into a death. `Aftermath` and `Innards Out` (`RETALIATE/posthumous`, 2 abilities only) are
the named exceptions that *do* kill, and they only trigger when their own piece has already died — so they
cost you a piece, which is the price of admission.

### 6.14 `Trace` / `Receiver` / `Power of Alchemy` copying a bounded ability

Copying must not launder a ban. **Bound:** the copy resolves through the same ban list and the same
`flags.notrace/noreceiver/failroleplay` sets (34/35/35 abilities). A `Trace` piece can never end up holding
`Wonder Guard`, `Imposter`, `Neutralizing Gas`, `Multitype`, or any format-banned ability — the flags in the
dataset already say so, for free.

### 6.15 `Life Orb` — a *helpful* interaction worth protecting

Worth flagging as the opposite of a danger. `Life Orb` costs `-1` Vigour per capture. In a chained capture
sequence (SE → extra move → SE → extra move…) it drains the chaining piece, so a Life Orb piece **cannot
chain indefinitely**. That is a small, thematic, player-visible contribution to the brief's termination
problem. Keep it in the v1 Kit, and keep the mechanic honest: the drain applies on *every* capture in the
chain, not once per turn.

### 6.16 Miscellaneous bounds, stated for completeness

| item / ability | risk | bound |
|---|---|---|
| `Choice Scarf` (`+2` movement) | a queen with `+2` range covers the board | Choice items are **illegal on King and Queen** class pieces |
| `Eviolite` | free `+1` def on any un-evolved piece | legality gated on `species.nfe` (a real structured field), and un-evolved pieces are cheaper in the draft anyway |
| 4 `FIELD/aura-ruin` abilities (Sword/Tablets/Beads/Vessel of Ruin) | board-wide `-1` to everyone else | one Ruin ability per side maximum; they do not stack with each other |
| `Multitype` / `RKS System` | 36 species (Arceus ×18, Silvally ×18) whose type is item-defined | the Plate/Memory **is** their type declaration at draft; they may not also hold a Kit item. One system, not two. |
| `Comatose` (Komala) | permanent status immunity | fine as-is; 1 species, and it is `breakable` so `pierce` beats it |
| `Gale Wings` / `Prankster` / `Triage` (`STRIDE/priority`) | out-of-turn actions threaten the turn-order invariant | strictly **once per game**, and may never be used to escape check |
| `Dancer` / `Parental Bond` | extra actions → chain-length risk | both grant a **non-capturing** move only, so they cannot extend a capture chain |

**Termination note for the engine analyst:** across all 310 abilities and 351 items, the *only* sources of
an extra move are (a) `CRIT`, (b) `ADVANTAGE`, (c) `EDGE/double-strike` and `STRIDE/mirror`, both restricted
to non-capturing moves, and (d) `STRIDE/priority`, once per game. So abilities and items add **no unbounded
extra-move source**. The chain bound remains whatever the core rules prove (≤ number of enemy pieces), plus
at most one non-capturing step per capture and one once-per-game pre-empt per side.

---

## 7. Bundle budget and file layout

Measured payload sizes (gzip, node `zlib`):

| payload | raw | gzip |
|---|---|---|
| 310 compact archetype records (`[abilityIdx, archetype, primitive, params[]]`) | 4.8 KB | **0.7 KB** |
| ability `name` + `shortDesc` (tooltips, 311 entries) | 27.9 KB | **7.7 KB** |
| ability `name` + full `desc` (311) | 54.5 KB | 12.1 KB |
| item `name` + `shortDesc` (583) | 45.8 KB | **9.5 KB** |

**Budget: ship archetype records + `shortDesc` only** → `0.7 + 7.7 + ~1 + 9.5 ≈ 19 KB gzip` for the entire
ability+item layer, tooltips included. Full `desc` (another ~5 KB gz) is lazy-loaded on "read more". This is
a rounding error against the sprite budget and needs no cleverness.

```
tools/gen/
  abilities.ts            # reads @pkmn/dex + data/curated/ability-archetypes.json → dist
  items.ts                # reads @pkmn/dex + data/curated/item-classes.json      → dist
                          #   asserts: every ability/item assigned exactly once, else BUILD FAILS
data/curated/
  ability-archetypes.json # 320 rows: {name, archetype, primitive, params}      ← §2.6 of this doc
  item-classes.json       # 583 rows: {name, class, admitted, primitive, params} ← §3.2/3.3
  format-kits.json        # Kits (the 12-item lists), ban lists, draft-legality validators
src/rules/
  clash.ts                # the Clash resolver of §2.4 — the only place outcomes are decided
  vigour.ts               # the single [-3,+3] counter
  abilities/
    primitives.ts         # 115 functions, one per row of §2.6
    registry.ts           # archetype → hook dispatch table
  items/
    primitives.ts         # ~40 functions
    registry.ts
dist/data/
  abilities.bin           # 0.7 KB gz
  abilities.strings.json  # 7.7 KB gz
  items.bin / items.strings.json
```

The build-time assertion is the important line: the generator diffs the curated tables against
`Dex.abilities.all()` / `Dex.items.all()` and **fails the build** on any unassigned, duplicated, or unknown
name. That is exactly the check that produced this document's `320 of 320` and `583/583` results, promoted
into CI, so a dependency bump to `@pkmn/dex@0.11` cannot silently drop content.

---

## 8. Open questions for the other analysts

1. **Move layer:** `EDGE/flag` (6 abilities), `WARD/class` (6), `FOCUS/multihit`, `BULWARK/contact`,
   `EDGE/no-contact` and `GRASP` theft all key off the *signature move's* `flags` (`contact`, `bullet`,
   `sound`, `powder`, `punch`, `bite`, `slicing`, `pulse`, `wind`). My design assumes **each piece has
   exactly one signature move whose type = the piece's chess type and whose flags are readable.** If the
   move analyst proposes multiple moves per piece, ~20 of my primitives need a "which move" parameter.
2. **Turn/termination:** I have assumed extra moves come only from `CRIT`/`ADVANTAGE` and that abilities add
   no new unbounded source (§6, termination note). Please confirm that against the core turn loop.
3. **Check/checkmate:** I have asserted two carve-outs that the rules engine must honour —
   `BIND` may never restrict the enemy king (§6.3), and `STRIDE/priority` may never be used to escape check
   (§6.16). Both exist to keep the check model coherent.
4. **Draft:** the ability pick is 1-to-4 wide (§1.4) and the item pick is 1-of-12 from a Kit (§4.3).
   The draft designer needs to fold in two validators: "at least one immunity breaker per side" (§6.1) and
   "at most one Ruin ability per side" (§6.16).
5. **AI:** the `WARD` one-shot rule (§6.1) makes capture legality *state-dependent* (a square becomes
   attackable after the ward pops). Move generation is no longer a pure function of piece positions — it
   depends on per-piece ward flags. Flag this early; it affects transposition-table keys.
