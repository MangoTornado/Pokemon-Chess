# Recon: the Pokémon TCG as a rules source

**Role:** Pokémon TCG mechanics analyst.
**Why this document exists:** `DIRECTION.md` names **both** canons — *"make sure that all of the interactions
are proper and make sense to how it works in pokemon (games/tcg)"* — and no prior recon covered the TCG at
all. That gap matters more than it sounds. The TCG is a **board game with a small action budget per turn**:
one attack, one Energy attachment, one retreat, one Supporter, one Stadium. Structurally that is far closer
to chess than a real-time battle sim is, and it has already shipped answers to four problems this project is
stuck on — how to express the type chart as a modifier, how to make randomness feel Pokémon rather than
bolted-on, how to make status conditions turn-scoped and board-visible, and how to price movement.

**Method.** Two independent sources, and I say which is which everywhere:

1. **Rules text**, from Bulbapedia's TCG rules articles and glossary and from the official Play! Pokémon
   resources index (URLs in §14). The official rulebook PDF itself is served behind Imperva bot protection
   and exceeds the fetch size limit — I could not read it directly and I say so rather than pretending I did.
2. **A measured card corpus.** I downloaded **every Pokémon card and every Trainer/Energy card printed in the
   Scarlet & Violet series** (the current era) from `api.pokemontcg.io` — **2 915 Pokémon cards** and
   **499 Trainer/Energy cards** across 16 sets, sv1 through Black Bolt / White Flare — plus one representative
   set from each earlier era, and I computed the rules-relevant statistics directly. Every number below with a
   count in it was measured, not recalled. Scripts and the raw JSON are in
   `/tmp/pkmn-probe/tcg-recon/` (`tcg-recon-1-eras.py`, `tcg-recon-2-fetch-sv.py`,
   `tcg-recon-3-analyse.py`, `tcg-recon-3-output.txt`).

The corpus is the interesting half. Several claims that "everyone knows" about the TCG turn out to be
measurably wrong, and one measurement (§2.2) is the strongest single piece of evidence in this whole
design phase for how our randomness should work.

**Relationship to the other recon docs.** Where I contradict `recon-variants.md`,
`recon-moves.md` or `recon-abilities-items.md` I say so explicitly in §11 and rule on it.
`recon-data-substrate.md` remains authoritative for what the *video-game* dataset exposes; nothing here
touches that.

---

## 0. Executive summary

### 0.1 The ten mechanisms, mapped

| # | TCG mechanic | → Pokémon Chess mechanic | Faithful because | On the board |
|---|---|---|---|---|
| 1 | **Weakness ×2** on the defender's card | **Super-effective capture ⇒ one free extra move.** Keep the games' full 18×18 chart; borrow the TCG's *words* and its *magnitude discipline* | measured: a ×2 Weakness most often buys exactly **one turn** of tempo (mode 1306/3683 attacks, §1.4). "Super effective = one extra move" *is* the TCG's Weakness, translated into a game with binary capture | the word **WEAKNESS** on the capture banner, in the defender's type colour |
| 2 | **Resistance −30** | **Not-very-effective ⇒ the capture *fizzles* (power-scaled), with mutual destruction kept as the default ruleset but re-labelled as chess canon** | measured: −30 reduces **41.5 %** of all printed attacks to zero damage but merely shaves the strong ones. Resistance in the TCG is *total immunity against weak attackers and a shave against strong ones* — the exact shape we want for 0.5× | the word **RESISTANCE**, and a visible "bounced off" recoil for a fizzle |
| 3 | **Coin flips** | **Every probability in the game is a coin count.** Randomness gates *riders*, essentially never the capture itself | measured: of 433 coin-flip attacks in the current era, **397 gate only a rider**; only **36 of 4 435 attacks (0.8 %)** let a flip decide whether the attack does anything | a coin, not a die; "flip 3 coins" for a crit |
| 4 | **Special Conditions** | **Two classes of status, marked two different ways** — three turn-scoped rotations (Asleep / Paralyzed / Confused, mutually exclusive) and two persistent counters (Poisoned / Burned, stackable) | the TCG's *physical marking system* (rotate the card vs put a marker on it) encodes exactly the games' volatile / non-volatile split. Same distinction, better interface | rotate the piece sprite for the three; stack counter pips for the two |
| 5 | **Retreat Cost** | **A charge cost to *withdraw* a committed piece**, scaling with piece class | measured: mean Retreat Cost rises Basic 1.53 → Stage 1 1.92 → Stage 2 2.34 as median HP rises 70 → 120 → 180. Bigger pieces are canonically harder to move | a Colorless-pip cost badge on the piece card |
| 6 | **Energy** | **No energy economy. Adopt TCG *Pocket*'s automatic Energy Zone shape instead:** a per-piece Charge that accrues on turns the piece does not capture and gates its top-tier move | TCG Pocket (2024) deleted Energy cards precisely because a digital board game wants the ramp without the bookkeeping. Chess already charges a full tempo per action, so an energy tax would double-charge | one filling pip on the piece, no card management |
| 7 | **Evolution** | **Pawn promotion = playing an Evolution card.** New type (re-declared), new moveset, statuses cleared, item and Vigour kept, no bonus move on the promoting move | the TCG's evolution rules are precisely "a deliberate action played onto a piece in play", and its Mega rule prices exactly this: *"When 1 of your Pokémon becomes a Mega Evolution Pokémon, your turn ends."* | the evolution flash, then the piece re-badges with its new type colour |
| 8 | **Pokémon Tool / Stadium** | **Held item = Tool** (one per piece, public, stays attached, destroyed with the piece). **Weather/terrain = Stadium** (exactly one global field, playing a new one replaces it, affects both sides, cannot be refreshed by its own owner) | quoted rule text: *"You may attach only 1 Pokémon Tool to each Pokémon, and it stays attached"*; a Stadium *"may only be removed when another Stadium card is played"* | item glyph on the card; the board itself re-skins for the field |
| 9 | **Prize cards / win conditions** | **No change to king-capture.** Adopt the **Prize track as HUD and as the timed-game tiebreak only** | honest answer: the TCG's win conditions are worse for chess. But its *progress meter* is the best legibility idea in the game | a 6-slot prize row that fills as you capture; premium pieces are worth 2 slots |
| 10 | **Ability** (post-2011) | **One keyword, one glyph slot.** Activated vs passive lives in the text and in the affordance, not in a second card type | Black & White merged Poké-POWER and Poké-BODY into one keyword because two keywords confused players. Measured current split: **413 passive / 229 activated** of 642 | one ability line per card; activated abilities get a tappable button |

### 0.2 The five findings that should change the design

1. **The TCG has abolished type immunity entirely.** Across **2 915** current-era Pokémon cards the *only*
   printed modifier values are **`×2` (2 833 cards)** and **`−30` (621 cards)**. There is no `×0`, no `×4`,
   and **zero dual weaknesses**. Ghost-species cards, which are immune to Fighting and Normal in the video
   games, are printed with **Fighting −30**. Flying-species cards, immune to Ground in the games, are printed
   with **Fighting −30** (Fighting is the TCG's Ground). The board-game canon looked at 0× and *deleted it*.
   That is the single most relevant precedent for hard problem 6 (§1.6).
2. **Randomness in the Pokémon board game is rider randomness, not outcome randomness.** 0.8 % of attacks
   let a coin decide whether the attack happens. The video's d6 — where a 1 kills both pieces and a 6 grants
   a free move — is *not* how the Pokémon board game works, and the TCG is now the second independent line of
   evidence (after `recon-variants.md` §2.4) that it has to go. What survives, and is fully authentic, is
   **"flip a coin: if heads, the target is now Paralyzed."**
3. **The TCG's randomizer alphabet is powers of ½, never sixths.** Measured: 310 attacks flip one coin, 57
   flip two, 45 flip three, 10 flip four, 29 flip "until you get tails". Nothing in the game uses 1/6 of
   anything. So a crit rate should be **1/16, presented as "four heads"** — which happens to land inside the
   variance budget `recon-variants.md` §6.2 derived independently (it wants 1/18 with headroom to 1/12).
4. **The same Pokémon is routinely printed as different types, and its Weakness follows the type it was
   printed as.** Measured: **96 of 1 164 distinct card names (8.2 %)** appear as more than one Energy type in
   the current era alone — Gengar as Psychic *and* Darkness, Excadrill as Metal *and* Fighting, Flamigo as
   Colorless *and* Fighting. **This is the video's "one type only, chosen at draft" rule, already shipped as
   canon.** Rule 2 of the original ruleset needs no defence: the TCG has done it for 25 years.
5. **Terastallization in the TCG is exactly the mechanic `recon-abilities-items.md` §5.1 proposed.** Tera
   cards are printed **off-type with a matching new Weakness**: Tera Charizard ex is a **Darkness** card weak
   to **Grass** (not a Fire card weak to Water); Tera Tyranitar ex is **Lightning**; Tera Skeledirge ex is
   **Metal**; Tera Greninja ex is **Fighting**. That proposal is not an invention — it is a direct read of the
   current card set. Build it.

---

## 1. Weakness and Resistance

### 1.1 The current rules

Weakness and Resistance are printed on the card: a small type symbol with a modifier next to it. From
Bulbapedia's TCG glossary:

> **Weakness** (弱点) — more damage from the attacking type. Originally a fixed "×2 damage".
> **Resistance** (抵抗力) — reduces damage from that type. Initially "−30 damage".

Three procedural rules matter to us, all from Bulbapedia's `Type (TCG)` article:

> "the damage is first modified by the Weakness, then the Resistance"

> "**Weakness and Resistance only modify damage dealt to Active Pokémon**"

and, on the Bench entry in the glossary: on Bench damage, *"Weakness and Resistance are not applied."*
Card text says the same thing in parentheses, e.g. Miraidon's *Lightning Laser*: **"This attack also does 30
damage to 1 of your opponent's Benched Pokémon. (Don't apply Weakness and Resistance for Benched Pokémon.)"**

The damage pipeline is also explicit on the cards themselves, and it is a strict order of operations:
attacker bonuses are applied **"before applying Weakness and Resistance"** (Vitality Band: *"The attacks of
the Pokémon this card is attached to do 10 more damage to your opponent's Active Pokémon (before applying
Weakness and Resistance)"*), and defender reductions **"after applying Weakness and Resistance"** (Rock
Chestplate: *"The Fighting Pokémon this card is attached to takes 30 less damage from attacks from your
opponent's Pokémon (after applying Weakness and Resistance)"*).

### 1.2 The era history, measured

I sampled the first main set of each era and counted the printed values on every Pokémon card
(`tcg-recon-1-eras.py`):

| Era (set sampled) | Year | Pokémon cards | Weakness values | no Weakness | Resistance values | no Resistance |
|---|---|---|---|---|---|---|
| Original (`base1`) | 1999 | 69 | `×2` ×64 | 5 | `−30` ×20 | 49 |
| Diamond & Pearl (`dp1`) | 2007 | 107 | **`+10` ×47, `+20` ×45, `+30` ×15** | 0 | `−20` ×49 | 58 |
| Black & White (`bw1`) | 2011 | 94 | `×2` ×94 | 0 | `−20` ×35 | 59 |
| XY (`xy1`) | 2014 | 120 | `×2` ×119 | 1 | `−20` ×47 | 73 |
| Sword & Shield (`swsh1`) | 2020 | 173 | `×2` ×173 | 0 | **`−30` ×36** | 137 |
| Scarlet & Violet (`sv1`) | 2023 | 207 | `×2` ×207 | 0 | `−30` ×41 | 166 |

So the arc is: **×2 → additive +10/+20/+30 (DP/Platinum only) → back to ×2 forever**, and
**−30 → −20 → back to −30**. The additive experiment lasted one generation of sets and was abandoned.

This measurement also **corrects a live error on Bulbapedia**: its `Type (TCG)` article says Resistance was
"−20 from Diamond & Pearl through Sword & Shield". Measured, `swsh1` (Sword & Shield base, Feb 2020) prints
**−30**. The glossary's phrasing — *"with Sword & Shield resistances are now −30 again"* — is the correct one.
Flagged in §11.

Across the whole current-era corpus the printed alphabet is exactly two symbols:

```
all printed modifier values, 2915 SV-era Pokémon cards:
  W×2   : 2833      R−30  : 621
  no Weakness: 82   dual Weakness: 0
  no Resistance: 2294 (78.7%)   dual Resistance: 0
```

The 82 cards with **no Weakness at all** are exactly the **82 Dragon-type cards**. In the current era,
choosing Dragon means you have no Weakness — and Dragon is rationed to 2.8 % of the set. That is the same
shape as our Steel problem (`recon-variants.md` §8.5: strongest defensive type is also one of the two
scarcest); the TCG solves it by supply control, not by a rules carve-out.

### 1.3 The empirical TCG type chart

There is no clean published TCG type chart, because the chart is per-card editorial rather than a matrix. So
I built one from the corpus. Read this as: *cards of this type are printed weak to / resistant to …*

| Card type | n | Weak to | Resists |
|---|---|---|---|
| Grass | 410 | Fire 405, Lightning 5 | Fighting 5 |
| Psychic | 392 | Darkness 264, Metal 118, Lightning 10 | **Fighting 274** |
| Water | 377 | Lightning 286, Metal 91 | Fighting 10 |
| Fighting | 347 | Grass 221, Psychic 125, Lightning 1 | Fighting 1 |
| Colorless | 341 | Fighting 236, **Lightning 105** | **Fighting 105** |
| Darkness | 281 | Grass 144, Fighting 107, Lightning 30 | Fighting 30 |
| Fire | 271 | Water 263, Lightning 8 | Fighting 8 |
| Lightning | 249 | Fighting 226, **Lightning 23** | Fighting 23 |
| Metal | 165 | Fire 157, Lightning 8 | **Grass 157**, Fighting 8 |
| Dragon | 82 | *(none)* | *(none)* |

The type collapse itself (Bulbapedia `Type (TCG)`): *"Because the TCG has fewer types than the video games,
some Energy types represent multiple types from the video games."* Grass = Grass + Bug; Water = Water + Ice;
Lightning = Electric; **Fighting = Fighting + Rock + Ground**; **Psychic = Psychic + Ghost + Fairy** (Fairy
folded in from Sword & Shield); Colorless = Normal + Flying; **Darkness = Dark + Poison**; Metal = Steel.
Fairy as a separate Energy type was *"retired in February 2020"*.

Reading the chart back against the games shows it is **derived from the games' chart, then flattened**:

- Metal resists Grass ← Steel resists Grass and Bug.
- Darkness weak to Grass 144 ← Dark is weak to **Bug**, and Bug collapsed into Grass.
- Psychic resists Fighting 274 ← **Ghost is immune to Fighting**, downgraded to −30.
- Colorless weak to Lightning 105 + resists Fighting 105 ← these are the **Flying** Pokémon: Flying is weak
  to Electric and resists Fighting, and its **Ground immunity is gone**.
- Lightning weak to Lightning 23 ← Electric/**Flying** Pokémon (Kilowattrel, Squawkabilly-adjacent birds):
  the card takes its Weakness from the *secondary* type's defensive profile, even when that makes a Pokémon
  weak to its own type.

And the chart is genuinely inconsistent, quantifiably: **96 of 1 164 distinct card names (8.2 %) are printed
as more than one Energy type**, and **71 (6.2 %) are printed with more than one Weakness type**. Gengar is
Psychic-weak-to-Darkness on some cards and Darkness-weak-to-Fighting on others. Excadrill is Metal (weak
Fire, resists Grass) and also Fighting (weak Grass). Bulbapedia notes some cards *"actively contradict the
video games"*.

### 1.4 What a ×2 is actually worth — measured

Median printed HP in the current era is **110**; median printed attack damage is **50** (mean 69.4). So for
every numeric-damage attack I computed hits-to-KO against a 110 HP target with and without Weakness:

| Turns saved by a ×2 Weakness | 0 | 1 | 2 | 3 | 5 |
|---|---|---|---|---|---|
| attacks (of 3 683) | 849 | **1 306** | 584 | 507 | 437 |

**The modal effect of Weakness in the TCG is exactly one turn of tempo** (35 % of attacks), and it saves at
least one turn in 77 % of cases. That is the load-bearing fact for our capture rule:

> **"Super effective ⇒ your piece immediately moves again" is not a chess-variant invention. It is the TCG's
> Weakness modifier, expressed in the only currency a binary-capture game has: tempo.**

That legitimises rule 3 of the original ruleset from a canon direction nobody had checked, and it tells us
the *magnitude* is right — one extra move, not two, not a chained cascade.

The reverse calculation for Resistance is even more useful. **1 528 of 3 683 numeric-damage attacks (41.5 %)
do 30 damage or less**, so a −30 Resistance reduces them to **zero**:

> **In the TCG, Resistance is total immunity against weak attackers and a mere shave against strong ones.**

### 1.5 Recommendation: keep the games' full 18×18 chart

**Use the games' chart. Do not adopt the TCG's coarser one.** Reasons, strongest first:

1. **`DIRECTION.md` settles it.** *"The mainline games are the primary reference for typing, moves, abilities
   and items."* The TCG is named as the better precedent for coin flips, status, retreat, evolution, tools and
   stadiums — and, for Weakness/Resistance, explicitly for its **vocabulary**: *"its vocabulary ('Weakness',
   'Resistance') is worth reusing in the interface"*. Not its chart.
2. **The TCG's chart exists to solve a printing constraint we do not have.** A card has room for one Weakness
   symbol and one Resistance symbol. That is why there are 10 types instead of 18, why there are no dual
   weaknesses (0 in 2 915 cards), and why the same Pokémon gets re-typed set to set. We compute the chart at
   runtime in `src/engine/typechart.ts` from a ~1 KB matrix. The constraint does not bind.
3. **Collapsing to 10 types would delete the game's content.** Fighting/Rock/Ground would become one type and
   Psychic/Ghost/Fairy another. `recon-variants.md` §2.2 measures Ground as the best attacker and Ghost as one
   of only two types with 2 immunities — those distinctions are the *skill surface*. It would also orphan 8 of
   the 18 type colours already fixed in `src/ui/typeColors.ts`, which `DIRECTION.md` calls "the palette's
   spine".
4. **"The TCG chart" is not a chart.** 8.2 % of names carry contradictory typings. There is nothing coherent
   to port.

**Do adopt these four things from the TCG side, though:**

| Adopt | Rule | Source |
|---|---|---|
| **The words** | The capture banner says **WEAKNESS** (super effective) and **RESISTANCE** (not very effective), not "2× effective". Players already read those as numbers that change an outcome | `DIRECTION.md`; TCG card faces |
| **One modifier per piece, ever** | A piece has one type, so the multiplier is only ever `0`, `½`, `1`, `2` — never `4` or `¼`. Already true (`recon-variants.md` §2.1) and now canon-backed: 0 dual weaknesses in 2 915 cards | measured |
| **The modifier applies only at the point of contact** | The type modifier applies **only to the primary target of a move**. Area and splash targets (`AREA_ALL` 15 moves, `AREA_FOES` 45 moves, and the secondary targets of `RAY_*`) resolve at **neutral**, with no bonus move and no mutual destruction | *"Don't apply Weakness and Resistance for Benched Pokémon"* — quoted on hundreds of cards |
| **The modifier pipeline order** | `attacker modifiers → type modifier → defender modifiers`, in that order, and nothing may re-order it | *"before applying Weakness and Resistance"* / *"after applying Weakness and Resistance"* |

That third row is a real balance fix that costs nothing. Earthquake hitting eight neighbours, each rolling
its own type matchup with its own chance of granting a bonus move or destroying your own piece, is a
combinatorial nightmare for both the player and the AI. The TCG's answer — *the chart only applies to the
Pokémon you are actually fighting* — makes area moves legible in one sentence and is quotable off the cards.

The fourth row is a **correction to `recon-abilities-items.md` §2.4**, whose Clash spec sums attacker and
defender hooks into one roll and resolves legality first. Under the TCG order, a defender's reduction is
applied *after* the type modifier, which means a `BULWARK` effect can never prevent the type modifier from
being read — it can only reduce the result. That matters for Filter/Solid Rock (`se-reduce`) and for the
`no Weakness` family in §1.6. See §11.4.

### 1.6 The TCG's answer to hard problem 6 (untouchable pieces)

`BRIEF.md` §2: *"Zero-effectiveness immunity creates untouchable pieces — a Flying piece that no Ground piece
can ever capture distorts the board. Bounded how?"*

**The board-game canon's answer is: don't have immunity.** Not "bound it" — remove it. Ghost keeps a −30
against Fighting; Flying keeps a −30 against Fighting/Ground; nothing is ever untouchable. Combined with
§1.4's measurement, the TCG's −30 behaves like this:

- against an attacker doing ≤30 (41.5 % of attacks): **fully absorbed, zero damage**
- against a strong attacker: **a shave that costs the attacker some tempo**

That is a *power-scaled* immunity, and it is exactly the mechanic our 0× problem wants. Concrete proposal,
offered as the **graceful-degradation lever** `recon-variants.md` §6.3 knob 4 already asked for, now with a
canon source:

> **Rule (TCG-derived) — the Graze.** A capture at 0× is **legal but fails**: the attacker does not move, no
> piece is removed, and the attempt costs the attacker's move (and one charge of the move used). The attacker
> is left standing where it was, exposed.
>
> **Rule (TCG-derived) — power-scaled Resistance.** A capture at 0.5× fails outright (a Graze) if the move
> used is power tier ≤ T2 (`basePower ≤ 75`, 201 of 685 gen-9 moves per `recon-moves.md` §2.5); at T3 and
> above the capture resolves. The flavour is exact: a weak resisted hit does nothing, a Hydro Pump gets
> through.

I am **not** recommending shipping the Graze as the default for 0× in v1 — the video's "the capture is
illegal" is louder, more legible, and `recon-variants.md` §1.4 measures immunity at only 2.5 % of matchups,
so it is not actually dangerous. I am recommending it as the **format switch** to reach for if playtesting
shows lockouts feel unfair, and I am recommending the **power-scaled Resistance** rule seriously, because it
is the only proposal on the table that keeps mutual destruction's flavour while stopping cheap pieces from
being universal solvents (see §11.2).

The TCG also supplies the counter-card layer, which we should copy verbatim in spirit:

| Card | Exact text | Our analogue |
|---|---|---|
| **Protective Goggles** (Tool) | *"The Basic Pokémon this card is attached to has no Weakness."* | An item that denies the attacker the bonus move on a super-effective capture. This is the TCG-canon form of `BULWARK/se-reduce` (Filter, Solid Rock, Prism Armor) |
| **Archaludon ex**, *Metal Defender* | *"During your opponent's next turn, this Pokémon has no Weakness."* | A one-turn defensive move that suppresses the type modifier — the missing "Protect against typing" primitive |
| **Florges**, *Blooming Garden* | *"Your Pokémon in play have no Weakness."* | A board-wide aura; matches `FIELD/aura-*` and should be bounded to the king-move ring per `recon-abilities-items.md` §6.9 |
| **Kabutops**, *Ancient Way* | *"Apply Weakness for your opponent's Active Pokémon as ×4 instead."* | An escalator — the canon precedent for `EDGE/se` (Neuroforce) and for a "double bonus" effect |
| **Porygon**, *Conversion 4* | *"Choose Grass, Fire, Water, Lightning, Psychic, Fighting, Darkness, Metal, or Dragon type. Until the Defending Pokémon leaves the Active Spot, its Weakness is now that type. (The amount of Weakness doesn't change.)"* | Direct canon for `B6_TypeMutation` (Soak, Conversion, Forest's Curse) — and note it changes the **defensive** matchup, which is the interesting half |
| **Oranguru**, *Now You're in My Power* | *"Until the end of your next turn, the Defending Pokémon's Weakness is now Colorless."* | A debuff that *creates* a weakness. We have no move like this; it is a good candidate for the Ring Target item's active form |
| **Umbreon**, *Feint Attack* / **Staryu**, *Swift* | *"This attack's damage isn't affected by Weakness or Resistance, or by any effects on that Pokémon."* | Direct canon for `B5_TypelessDamage` (Night Shade, Seismic Toss, Super Fang). **In the TCG, "typeless" is a common, printed, well-understood keyword** — 20+ distinct cards in the current era alone. Our 5-move bespoke rule is under-scoped, not over-scoped |

That last row deserves emphasis. `recon-moves.md` treats typeless damage as a 5-move oddity (`B5`). The TCG
treats "this attack ignores Weakness and Resistance" as a *standard design lever*, printed on Swift, Feint
Attack, Sonic Peridot, Twin Shotels, Yoga Kick, Severe Squall, Telekinesis, Rising Chop and more. Ours should
be a first-class flag on the move record (`ignoresTypeChart: boolean`), not a special case — and it should be
the thing that makes an immune piece capturable without needing an item.

---

## 2. Coin flips

### 2.1 Where the TCG uses them

From the glossary: coins are *"one of two types of randomizers"*, dice being the other, and on a die *"the
even number sides represent Heads and the odd number sides represent Tails"* — i.e. **the TCG already tells
you how to run a coin off a d6**. Our seeded PRNG is the randomizer; the coin is the presentation layer.
Uses, with measured counts from the current era:

| Use | Rule | Measured |
|---|---|---|
| **Who goes first** | coin flip or six-sided die at setup | — |
| **Asleep recovery** | at each Pokémon Checkup, flip: heads wakes up | Bulbapedia `Special Condition (TCG)` |
| **Burned recovery** | at Checkup, place 2 damage counters, then flip: heads cures | ditto |
| **Confusion** | when attacking, flip: tails = 3 damage counters on itself, attack does not happen, turn ends | ditto |
| **Paralysis application** | *"Flip a coin. If heads, your opponent's Active Pokémon is now Paralyzed."* | **59 of the 67** flip-gated condition attacks are Paralysis |
| **Attack riders** | *"Flip a coin. If heads, …"* | **224** attacks |
| **All-or-nothing attacks** | *"Flip a coin. If tails, this attack does nothing."* | **36** attacks |
| **Flip until tails** | *"Flip a coin until you get tails. This attack does 30 damage for each heads."* | **29** attacks |
| **Multi-coin** | *"Flip N coins"* | 1 coin ×310, 2 ×57, 3 ×45, 4 ×10 |
| *(retired)* | up to *Skyridge*, attacking a Baby Pokémon required a flip — *"if tails, the Attack would fail"* | glossary |

Nothing in the TCG uses a 1/6, a 1/3, or any probability that is not a coin count.

### 2.2 The measurement that matters

Of **4 435** attacks printed in the Scarlet & Violet era:

```
attacks with any coin flip                     433   ( 9.8% )
  ├─ the flip gates only a RIDER or a bonus    397   ( 91.7% of flips )
  └─ the flip gates whether the attack does
     anything at all ("this attack does nothing") 36 (  0.8% of ALL attacks )
```

**In the Pokémon board game, 99.2 % of attacks connect deterministically.** The coin decides whether
something *extra* happens.

This is decisive for us, and it converges with `recon-variants.md` §2.4 from a completely different
direction. That document measured the video's dice at **≈5.5 pawns of pure noise per game**, ~25× the entire
White advantage in chess, and concluded "cut the dice hard". The TCG independently says the same thing:
Pokémon's own board game does not gamble the outcome of an attack, it gambles the *garnish*.

But note the honest complication, because it contradicts `recon-variants.md` §6.3 knob 1:
**the TCG flips *after* you commit.** You declare the attack, then flip. That is output randomness, which
`recon-variants.md` calls "the single biggest lever (≈5× on σ_dice)" and says never to do. Both are right,
and the synthesis is the actual rule:

> **Output randomness is fine when the stake is a rider. It is catastrophic when the stake is a piece.**
> The TCG can flip after commitment because losing the flip costs you a status application, not a Pokémon.
> The video's d6 flips after commitment for a stake of *your entire attacking piece*. Same timing, 50× the
> variance.

So: **flip after commitment for riders (authentic, and it is where the drama is). Reveal before commitment
for anything that can lose you a piece.** That preserves the video's texture — you attack, the coin spins,
the crowd holds its breath — while keeping the variance budget intact.

### 2.3 Granularity: what probability for what

The TCG's probability alphabet is `{1, ½, ¼, ⅛, 1/16, geometric}`. Recommendation:

| Effect class | Probability | Presented as | Why |
|---|---|---|---|
| Capture outcome (super / neutral / resisted / immune) | **1** — fully deterministic | no flip at all | 99.2 % of TCG attacks; `recon-variants.md`'s whole variance argument |
| **Status / rider application** | **½** | *"flip a coin"* | the TCG's default. 59 of 67 flip-gated conditions are exactly this |
| A strong rider (stat drop, flinch on a heavy move) | **¼** | *"flip 2 coins — both heads"* | 57 two-coin attacks |
| **Crit (a bonus move independent of typing)** | **1/16** | *"flip 4 coins — all heads"* | 10 four-coin attacks exist; 1/16 = 0.0625 sits inside `recon-variants.md` §6.2's target band [1/18, 1/12] |
| Move accuracy below ~90 | **½ or ¼**, snapped | *"if tails, this attack does nothing"* | the 36-attack all-or-nothing pattern — reserve it for the moves that really are unreliable (Focus Blast, Hydro Pump, Zap Cannon), not for every capture |
| Never-miss moves | **1** | nothing shown | 169 gen-9 moves have `accuracy: true` (`recon-moves.md` §2.5); the TCG's default is also "no flip printed" |

Concretely, the snap function for `secondary.chance` from the dex (measured buckets in `recon-moves.md`
§2.6: 100 % → 34 moves, 30 % → 24, 10 % → 30, 50 % → 11, 20 % → 11, 40 % → 3, 70 % → 1):

```
coins(chance):  chance >= 90 -> ALWAYS        (0 coins)
                chance >= 60 -> 3/4           (2 coins, at least one head)
                chance >= 35 -> 1/2           (1 coin)
                chance >= 15 -> 1/4           (2 coins, both heads)
                else         -> 1/8           (3 coins, all heads)
```

Every probability in Pokémon Chess then expressible as a coin count, which is a real legibility win: the
player never sees a percentage they have to trust, they see coins land.

**The flinch rider deserves special mention.** `recon-moves.md` §2.8 measures `flinch` as the largest single
volatile rider — **46 gen-9 applications** — and maps it to "the target loses its next turn". That is
**literally TCG Paralysis** (§3.3). Iron Head's 30 % flinch and *"Flip a coin. If heads, your opponent's
Active Pokémon is now Paralyzed"* are the same mechanic in two canons. Unify them: flinch and paralysis
should produce the same board state and the same visual, differing only in duration.

### 2.4 "Flip until you get tails" and our bonus-move chain

Five current cards, e.g. **Growlithe, *Relentless Flames*: "Flip a coin until you get tails. This attack does
30 damage for each heads."** The TCG ships an *unbounded-in-principle* geometric chain with no cap. Expected
heads = 1, `P(≥3 heads) = 12.5 %`.

Compare `recon-variants.md` §4.2, which measures our bonus-move chain under the original rules at
`P(L≥3) = 7.5 %`, `P(L≥5) = 0.57 %`, and recommends a hard cap of `L ≤ 3` "for feel, not for termination".

So our chain is **shorter-tailed than a mechanic the TCG prints without a cap**, and the cap of 3 costs us
nothing in authenticity. Present the chain in exactly the TCG's language — a run of coins that keeps going
while you keep winning — and it will read as Pokémon rather than as a chess-variant bolt-on. It also gives
the animation team the right beat: a chain of captures is a run of heads.

---

## 3. Status conditions

### 3.1 Why the TCG model wins for a chess turn

The games tick HP each turn and store a duration counter you cannot see. The TCG:

- applies conditions **only to the Active Pokémon** — *"They can only happen to an Active Pokémon — when a
  Pokémon goes to the Bench, it recovers from all Special Conditions"*
- **marks every one physically on the play surface**
- resolves all of them in a **single, fixed-order upkeep step** (the Pokémon Checkup)
- clears the turn-scoped ones by a **defined event**, not a hidden counter

For a game whose two hard constraints are *termination* and *legibility under load* (`DIRECTION.md`), that is
strictly better. `DIRECTION.md` already says so: *"The TCG's Asleep / Paralyzed / Confused are turn-scoped,
board-visible, and cleared by a defined event — a far better fit for a chess turn than the games' HP-tick
model."* This section makes it concrete.

### 3.2 The marking system is the design

This is the finding I did not expect. The TCG marks conditions two different ways, and the split is not
arbitrary:

| Condition | TCG marking | Consequence |
|---|---|---|
| Asleep | card turned sideways, *"usually counterclockwise"* | rotation-based, so… |
| Paralyzed | card turned sideways, *"usually clockwise"* | …only **one** of the three can apply at a time, and |
| Confused | card *"turned upside-down"* | *"the newest condition overriding the previous one"* |
| Poisoned | a **poison marker** placed on the Pokémon | marker-based, so it **stacks** with anything |
| Burned | a **burn marker** placed on the Pokémon | ditto — *"Since Poisoned and Burned use markers, those don't affect other Special Conditions"* |

So a Pokémon can be Poisoned + Burned + one rotation condition, and never two rotation conditions.

**That is exactly the games' volatile / non-volatile split, encoded in cardboard.** In the games,
`confusion` is a volatile status (cleared on switch, replaced freely) while `slp/par/psn/tox/brn` are
non-volatile (one at a time, persist through switching). The TCG regroups them as *"turn-scoped and mutually
exclusive"* (slp/par/confusion) vs *"persistent and stackable counters"* (psn/brn) — which is the more useful
grouping for a board game, because it maps onto two different physical affordances.

**Adopt it wholesale, including the visuals.** This directly discharges `DIRECTION.md`'s requirement that
"status visibly afflicting a piece" be readable without text:

- **Rotation class** (Asleep / Paralyzed / Confused): **rotate the piece sprite** — CSS `transform: rotate()`
  on the `PokemonIcon`, counter-clockwise for Asleep, clockwise for Paralyzed, 180° for Confused. Only one at
  a time, newest wins, so there is never ambiguity. A tilted piece reads instantly from across the board and
  costs nothing to render.
- **Counter class** (Poisoned / Burned): **small pips on the piece**, purple for poison, orange for burn,
  stacking. These are the TCG's damage counters and they are the only place in our game where a piece has a
  quantity attached.

### 3.3 Exact mechanics, and the mapping

Current rules (Bulbapedia `Special Condition (TCG)`), then the board effect. Where the two canons differ I
name the winner.

#### Asleep

> Cannot attack or retreat. At Checkup, flip a coin: heads means the Pokémon *"wakes up"*; tails means it
> stays Asleep.

Games: `slp` lasts 1–3 turns (a hidden counter). TCG: geometric, `E[turns] = 2`, unbounded tail.

**Ruling: TCG mechanism, games' cap.** A sleeping piece **cannot move at all**. At the start of its owner's
turn, flip a coin; heads and it wakes (and may move this turn). **Hard cap at 3 turns asleep**, then it wakes
automatically — the games' maximum, which removes the tail without removing the flip. `P(3 turns) = 25 %`,
so the cap binds a quarter of the time and is a visible mercy rather than a hidden rule.

This is the one status where the TCG's version, taken raw, is a termination hazard for the *defender*: an
opponent-hostile unbounded lockout. Capping it is not a compromise, it is required.

Board effect: piece rotated counter-clockwise, dimmed, cannot be selected. It **can still be captured**
(both canons agree — sleeping does not protect you). 5 gen-9 moves inflict `slp` as a primary effect
(Spore, Sleep Powder, Hypnosis, Sing, Dark Void).

#### Paralyzed

> Cannot attack or retreat for one turn; clears automatically at the affected player's next Checkup. **No
> coin flip.**

Games: `par` is permanent until cured, halves Speed, and gives a 25 % chance the Pokémon cannot move.

**Ruling: the TCG wins outright, and this is the clearest case in the document.** A permanent 25 % chance
that your move silently fails is the worst possible mechanic for a chess variant — it is output randomness on
a full move, it cannot be planned around, and it never ends. The TCG's version is a clean, complete,
self-clearing tempo tax:

> **Paralyzed: the piece loses exactly its next turn. Then the condition clears itself.**

That is one skipped activation, fully visible, provably terminating, and it is *the same effect as flinch*
(§2.3), which unifies 35 secondary `par` applications with 46 flinch applications into a single mechanic and
a single visual. Board effect: rotated clockwise, a small chain/spark overlay, cleared with a visible pop at
the start of the owner's turn.

Keep one thing from the games as a distinct, weaker effect: Sticky Web / Icy Wind style **speed reduction**
should map to movement range, not to paralysis. `recon-moves.md` §2.8 currently overloads `par` with both
("half range" *and* "25 % fizzle") — split them.

#### Confused

> Attacking requires a coin flip. Heads: the attack proceeds normally. Tails: **3 damage counters** go on the
> Pokémon and **the turn ends**; the attack does not occur.

History, measured against the article: originally tails dealt 20 self-damage; the current wording arrived
with EX Ruby & Sapphire (2003) and the amount is now 30. And notably **TCG Pocket (2024) removed the
self-damage entirely**: *"Confused Pokémon do not take damage when flipping tails for the Special
Condition."*

Games: 33 % chance to hit yourself with a 40-power typeless physical attack, for 1–4 turns.

**Ruling: TCG, in its Pocket form, and it is a gift.** We have no HP, so the self-damage has nowhere to
land — and Pokémon's own newest board game already deleted it. What is left maps perfectly:

> **Confused: when this piece attempts a capture, flip a coin. On tails the capture does not happen, the
> piece does not move, and *your turn ends immediately* — forfeiting any remaining bonus moves.**

Look at what that gives us for free:

1. It is the only status that punishes **the acting player**, which is the flavour ("it hurt itself in its
   confusion") without needing HP.
2. **"The turn ends" is a bonus-move-chain terminator.** A Confused piece cannot chain. That is an
   independent, thematic, player-visible contribution to the termination bound, exactly like Life Orb in
   `recon-abilities-items.md` §6.15.
3. It is the correct home for the risk the video wanted from the d6 — a coin that can cost you your action —
   but scoped to a piece that has been *deliberately confused by an opponent's move*, rather than applied to
   every capture in the game.

Board effect: piece rendered upside-down, wobbling. Cleared by the piece using a `WITHDRAW` move
(§3.5), by promotion, or by a cleanse. 17 gen-9 moves apply `confusion`-family volatiles
(`recon-moves.md` A28).

#### Poisoned

> **1 damage counter** at each Checkup (effects can raise this). No coin flip and no self-cure — removal
> requires a card effect or retreating.

Escalation precedent, measured off a real card — **Toxicroak ex, *Toxic Ripper*: "Your opponent's Active
Pokémon is now Poisoned. During Pokémon Checkup, put 6 damage counters on that Pokémon instead of 1."**

Games: chip damage per turn; `tox` escalates 1/16, 2/16, 3/16 … and kills in ~5 turns.

**Ruling: TCG's counter model, and use it to give us a bounded HP-lite that only status touches.**

> **Poisoned: the piece gains 1 **poison counter** at the end of each of its owner's turns. At **3
> counters** the piece is removed from the board.**
> **Badly Poisoned (`tox`): 2 counters per turn — so it kills in 2 turns.** (The TCG's own escalation is
> ×6; ×2 is the right magnitude on a 3-counter clock.)

Why this is right and not scope creep:

- It is **deterministic, visible, and bounded** — a 3-turn death clock you can see and can answer, not a
  hidden HP number.
- It gives status real teeth without giving pieces HP. `recon-abilities-items.md` §2.4 already establishes
  that HP does not exist and capture is binary; poison counters do not violate that — they are a *separate,
  status-only* resource, exactly as damage counters are separate from a card's printed HP.
- It is already precedented inside our own design: Perish Song has `condition.duration: 4` in the dataset and
  `recon-moves.md` §5/D2 already proposes exactly this "marked pieces die in N turns" shape. Poison is the
  same primitive with a smaller N. One mechanic, two moves.
- `recon-moves.md` measures **24 secondary `psn` applications + 3 primary + 4 `tox`** — 31 moves get real
  behaviour out of one 12-line rule.
- The counter is the natural home for **`AILMENT/exploit`** (Poison Heal: counters heal instead of
  accumulating), **`AILMENT/immune`** (Immunity), **`AILMENT/pierce`** (Corrosion: poisons Steel and Poison
  types anyway), and **`GRASP`** berries (Pecha Berry removes a counter). Thirteen abilities and ~15 items
  become implementable rather than approximated.

Board effect: up to 3 purple pips under the piece, filling. At 2 of 3, the piece pulses a warning — that is
the "legibility under load" answer for a piece that is about to die to something other than a capture.

#### Burned

> Sun & Moon onward: **2 damage counters** at Checkup, **then flip — heads cures it**, tails keeps it.
> (Pre-Sun & Moon the order was reversed: flip first, tails placed the counters, and it stayed Burned either
> way.)

Games: chip damage per turn **and it halves the Pokémon's physical Attack** — the halving is the important
half competitively.

**Ruling: split the difference, because each canon has half of it.**

> **Burned: (a) the piece rolls at **−1** on the Clash when it attacks with a **contact / Physical** move
> [games]; and (b) at the end of each of its owner's turns, flip a coin — **heads and the burn is cured**
> [TCG]. No counters.**

The Attack-halving is what makes Will-O-Wisp a real move and it is the thing a Pokémon player expects; the
coin is what makes it turn-scoped and self-clearing rather than permanent. Burn deliberately does **not**
place poison counters — one death-clock status is enough, and keeping burn non-lethal preserves the
distinction players already have ("burn cripples, poison kills"). `recon-moves.md` measures **41 secondary
`brn` applications**, the single largest secondary status, so this rule is high-leverage.

Board effect: orange flame pip, and the piece's attack indicator shows −1. Cleared with a visible flare.

#### Frozen — a note

`recon-moves.md` §2.8 flags that `frz` never appears as a primary status in gen 9. The TCG **has no Frozen
condition at all**: Bulbapedia notes Asleep is *"analogous to both Sleep and Freeze"* and Paralyzed likewise.
**Ruling: do not build a separate Frozen status.** Map the 13 secondary `frz` applications onto **Asleep**,
with the games' thaw condition preserved as a bonus clear (an incoming Fire-type capture or a `thawsTarget`
move wakes it immediately). One fewer status to teach, both canons satisfied.

### 3.4 The Pokémon Checkup: adopt the order verbatim

Between turns, the TCG resolves conditions in a fixed sequence:

> **Poisoned → Burned → Asleep → Paralyzed.** Confusion has no Checkup effect. Damage from Poison/Burn does
> not immediately KO — *"any Pokémon that has no HP remaining is Knocked Out"* only after both players
> finish their checks.

Adopt this exactly, as the **Upkeep phase** of our turn loop:

```
UPKEEP(player P):                     // runs at the end of P's turn, before the opponent's
  1. poison counters      (+1, or +2 if tox)      -> queue removals, do not apply yet
  2. burn                 (flip: heads -> cure)
  3. sleep                (flip: heads -> wake;  3rd turn -> auto-wake)
  4. paralysis            (clear)
  5. field / hazard / ability `upkeep` hooks      (recon-abilities-items §2.4)
  6. APPLY all queued removals simultaneously, then check win condition
```

Two reasons this exact shape is worth copying rather than inventing. First, a **fixed, published order** is
what makes a pure deterministic engine reproducible — `BRIEF.md` §4.2 requires "same seed + same move list ⇒
identical game", and a status system with ambiguous ordering is the classic way to lose that. Second, the
TCG's deferred-removal rule ("nobody is Knocked Out until both checks finish") is precisely the
**simultaneous-death** discipline `recon-variants.md` §5 R4 needs for the both-kings-die case. The board game
already solved simultaneity, in the same shape, for the same reason.

### 3.5 When conditions clear

TCG: *"moving to the Bench, evolving, devolving, Leveling Up … or card effects such as Double Full Heal"*.
Games: switching clears volatile statuses only; non-volatile persist.

**Ruling: use the TCG's *events*, with the games' *split*.** This reconciles both canons at zero cost,
because the TCG's own marking system already draws the line in the same place (§3.2):

| Event | Rotation class (slp / par / confusion) | Counter class (psn / brn) |
|---|---|---|
| The piece uses a `WITHDRAW` move (U-turn, Volt Switch, Flip Turn, Baton Pass, Teleport — `selfSwitch`, 9 moves) | **cleared** — this is "going to the Bench" | **kept** |
| The piece promotes / evolves | **cleared** | **kept** |
| A cleanse resolves (Heal Bell, Aromatherapy, Rest, `AILMENT/cure` abilities, Lum/Pecha/Rawst/Cheri berries) | cleared | cleared |
| End of the condition's own timer / flip | cleared | *poison never self-cures; burn does* |

That gives `WITHDRAW` moves — which `recon-moves.md` A10 already identifies as "exactly the mechanic asked
for" — a *second* reason to exist: U-turn is now both a repositioning tool and a status cure, which is
exactly what switching does in the real games.

### 3.6 Two more TCG status facts worth having

- **Abilities are not shut off by status any more.** *"Pokémon Powers and Poké-Powers cease functioning while
  a Special Condition is present; Poké-Bodies are unaffected. Abilities (Black & White onward) are never shut
  off by Special Conditions."* **Ruling: modern canon — status does not disable abilities.** Our only
  ability-off switch stays `FIELD/suppress` (Neutralizing Gas), ring-scoped per
  `recon-abilities-items.md` §6.9.
- **Status immunity is a printed, ordinary card ability.** Base-era Snorlax, *Thick Skinned*: *"Snorlax can't
  become Asleep, Confused, Paralyzed, or Poisoned."* Current-era **Therapeutic Energy**: *"The Pokémon this
  card is attached to recovers from being Asleep, Confused, or Paralyzed and can't be affected by those
  Special Conditions."* So `AILMENT/immune` (10 abilities) and `AILMENT/aura-immune` (3) are canon-shaped in
  both games and TCG. Note the TCG's phrasing pattern — *recovers from, and can't be affected by* — which is
  the right semantics for our hooks: a cure plus a lock, not just a lock.

---

## 4. Retreat cost

### 4.1 The rule

Bulbapedia `Retreat`:

> Retreat Cost is *"the amount of Energy attached to a Pokémon that must be discarded in order to retreat to
> the Bench,"* which also brings up a replacement Active Pokémon from the Bench.

- Printed on the card, bottom right, as Colorless Energy symbols. Range 0 (*"often called a 'free retreat'"*)
  to 5. *"there was no card with a Retreat Cost of 5 since"* Stormfront Mamoswine.
- **Once per turn.** Before EX Ruby & Sapphire *"a player could retreat Pokémon as often as they liked during
  the same turn."* That change is instructive: unlimited free repositioning was a problem, and the fix was a
  once-per-turn cap.
- Blocked entirely while **Asleep** or **Paralyzed**, and blocked by *"can't retreat"* effects (measured: 4+
  current attacks print *"During your opponent's next turn, the Defending Pokémon can't retreat"*).
- Cost modification order: *"Increases are calculated first, then reductions,"* and a *"no Retreat Cost"*
  effect *"overrides all effects that increase its Retreat Cost."*
- Stadiums modify it globally: **Beach Court** — *"The Retreat Cost of each Basic Pokémon in play (both yours
  and your opponent's) is Colorless less."* **Calamitous Wasteland** — *"…each Basic non-Fighting Pokémon in
  play … is Colorless more."*

### 4.2 Measured: cost scales with piece size

| Stage | n | median printed HP | **mean Retreat Cost** |
|---|---|---|---|
| Basic | 1 643 | 70 | **1.53** |
| Stage 1 | 974 | 120 | **1.92** |
| Stage 2 | 298 | 180 | **2.34** |

| HP band | 0–49 | 50–99 | 100–149 | 150–199 | 200–249 | 250–299 | 300–349 |
|---|---|---|---|---|---|---|---|
| mean Retreat Cost | 1.00 | 1.33 | 1.86 | 2.64 | 2.00 | 2.28 | 2.46 |

Distribution across the era: cost 1 ×1 385, 2 ×889, 3 ×421, 4 ×114, and **106 cards with no printed cost at
all (3.6 %) — free retreat**. No 0-cost is printed as "0"; it is printed as *nothing*, which is itself a UI
lesson: the absence of a badge means free.

**So the canon is: the bigger and more evolved the Pokémon, the more it costs to move it out of trouble.**

### 4.3 What this gives us

`DIRECTION.md` calls this out specifically: *"A concrete precedent for making movement itself cost something,
which is a lever a chess variant can use where the mainline games have no equivalent."* Here is the concrete
form, and I want to be careful about what it should and should not touch.

**Do not tax ordinary chess movement.** Every square of a chess move already costs a full tempo, which is the
scarcest resource in the game; adding a second cost to plain movement would slow the game and break the
chess geometry that `BRIEF.md` §1 insists on keeping.

**Do tax *disengagement*** — the specific act the TCG is pricing. Retreat in the TCG is not "moving", it is
"pulling a committed piece out of a fight it is losing". That has a precise chess analogue: moving a piece
**out of a square where it is currently capturable** (i.e. breaking off from a threatened engagement).

> **Rule (TCG-derived) — Retreat.** A piece that is currently capturable by an enemy piece may move away
> ("retreat") only by paying **one charge** from any of its moves. Retreat Cost is derived from the piece
> class: **Pawn 0 (free retreat), Knight/Bishop 1, Rook 1, Queen 2, King 0.**
> A piece with no charges left may not retreat — it must fight, be captured, or be defended.
> **A piece that is Asleep or Paralyzed may not retreat at all** (TCG rule, verbatim in effect).
> At most **one retreat per turn**, per the TCG's own post-2003 fix.

Notes on the calibration:
- Class costs mirror the measured HP↔cost correlation: bigger piece, costlier to extract. That also lands on
  the right side of `recon-variants.md` §2.4B's queen problem — a queen that is *hard to disengage* is a
  queen you must place carefully, which restores some of the value the mutual-destruction rule strips out.
- **King retreat is free**, and Pawn retreat is free, for the same reason the TCG prints free retreat on its
  cheapest and its most critical Pokémon: never let a cost mechanic manufacture a checkmate. This is the same
  carve-out `recon-abilities-items.md` §6.3 already demands for `BIND`.
- The counters exist and are canon: **Choice Scarf / `TEMPO` items** reduce it, **Iron Ball / Lagging Tail**
  raise it, `BIND` abilities (Shadow Tag, Arena Trap) forbid it outright — and the TCG's *"Increases first,
  then reductions, and 'no Retreat Cost' overrides all increases"* is the exact resolution order to use.
- It creates a genuinely new, thematic decision the video's game does not have: *do I spend Garchomp's last
  Earthquake charge to save it?*

**Honest risk.** This is the one recommendation in this document that adds a rule to the core turn loop
rather than reskinning one, and it interacts with check (a king-adjacent piece that cannot retreat is
effectively pinned). Ship it behind a format flag, and measure whether it lengthens games — per
`recon-variants.md` §6.2, game length is the master dial for how much chess skill gets expressed, and a
retreat tax lengthens games, which is *pro-favourite*, the opposite direction from the rest of our design.

---

## 5. Energy

### 5.1 What Energy is

The TCG's core resource. Nine Basic Energy types plus Colorless (which *"accepts any Energy"*); eleven Energy
types counting Dragon. Attacks print a cost in Energy symbols and can only be used if that Energy is
attached. You may **attach exactly one Energy card from your hand per turn**. Special Energy cards *"give
more than one … Energy card of a specific type and/or have an additional effect"*.

Measured cost distribution across 4 435 current-era attacks:

| Energy symbols | 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| attacks | 10 | **1 755** | 1 380 | 1 117 | 149 | 24 |

Median cost **2**. So at one attachment per turn, a Pokémon's mid-tier attack is online on turn 2 and its
best attack on turn 3 or 4. **Energy is a ramp, and the ramp is short.**

Special Energy shows the second thing Energy does — it is also an attachment layer that carries effects,
i.e. a second Tool slot: **Jet Energy** (*"When you attach this card from your hand to 1 of your Benched
Pokémon, switch that Pokémon with your Active Pokémon"* — a free retreat), **Spiky Energy** (thorns),
**Therapeutic Energy** (status immunity), **Mist Energy** (*"Prevent all effects of attacks used by your
opponent's Pokémon done to the Pokémon this card is attached to"*), **Medical Energy** (heal 30 on attach).

### 5.2 Recommendation: **no**, and here is the exact substitute

**Do not add an energy resource to Pokémon Chess.** Clear recommendation, three reasons:

1. **Chess already charges a full tempo for every action.** Energy exists in the TCG because a TCG turn is
   otherwise nearly free — you can play as many Basics, evolve as many Pokémon, and play as many Items as you
   like; the *only* hard budget is one attachment, one Supporter, one retreat, one attack. Chess's budget is
   already brutal: one move, full stop. Layering an energy tax on top double-charges the player for the same
   scarcity and makes the early game a do-nothing ramp — the exact opposite of the short, violent, upset-prone
   game `recon-variants.md` §6.2 identifies as structurally on-premise.
2. **We already have the resource, and it is called PP.** `recon-moves.md` §2.5 derives
   `charges = clamp(round(pp/5), 1, 5)` per move, ≈12 move-uses per piece per game, and §5/D4 makes that a
   load-bearing part of the termination bound. Two consumable resources per piece is one too many for the
   legibility budget.
3. **Pokémon's own newest board game deleted Energy cards.** TCG Pocket (2024): *"Energy cards are replaced
   by an Energy Zone, which generates one Energy each turn to attach to a Pokémon."* When the franchise built
   a digital board game with a small action budget — our situation, exactly — the first thing it cut was
   Energy-as-cards, while **keeping the ramp**. That is the strongest possible signal about which half of
   Energy is the good half.

**Take the ramp, not the economy.** The Energy Zone's shape, translated:

> **Rule (TCG Pocket–derived) — Charge.** Every piece has a **Charge** counter, 0–2, shown as up to two pips.
> It **gains 1 at the end of any turn in which the piece did not capture**, and **resets to 0 when the piece
> captures**. A move of power tier **T4 or T5** (`basePower ≥ 96`; 124 of 685 gen-9 moves) may only be used at
> **Charge ≥ 2**; a **T5** move (`basePower ≥ 121`, 36 moves) additionally resets Charge to 0 on use.

What this buys, for one integer per piece and zero player bookkeeping:

- **The wind-up texture is authentic** in both canons at once. It is the Energy Zone's ramp; it is also
  exactly how `flags.charge` (Fly, Dig, Solar Beam — 13 moves), `flags.recharge` (Hyper Beam, Giga Impact —
  8 moves), Focus Energy, Stockpile and Speed Boost already behave in the games. `recon-moves.md` A17/A18 and
  `recon-abilities-items.md` `STRIDE/ramp` currently need bespoke handling for these; Charge is the shared
  primitive they were all reaching for.
- **It is a chain brake.** A piece that captures resets to 0, so no piece can nuke twice in a chain. That
  is another independent contribution to termination, in the same family as Life Orb
  (`recon-abilities-items.md` §6.15).
- **It prices patience** — the thing chess players are good at — which is a deliberate counterweight to the
  rest of the design being tilted toward the underdog.
- **It gives the top of the move list a reason to exist.** Right now Eruption (BP 150) and Tackle (BP 40) both
  just "capture". Under Charge, the big moves are events you set up and the player can see coming, which is
  both a balance lever and an animation cue.

Keep the **Special Energy** idea only as vocabulary: it confirms that "an attachment that both pays a cost
and carries an effect" is canon, which is what our `FORME_KEY` plates and `TYPE_LENS` items already are.
Do not build a second attachment slot; `recon-abilities-items.md` §4.3's one-Tool-per-piece rule is the TCG's
own rule and should stay.

---

## 6. Evolution

### 6.1 The rules

- **Three tiers.** Basic → Stage 1 → Stage 2. Measured current-era supply: **Basic 1 643, Stage 1 974,
  Stage 2 298** (56 % / 33 % / 10 %), with median HP **70 / 120 / 180**.
- **Evolving is an action you play onto a piece in play.** *"Stage 1 goes onto Basic, Stage 2 Pokémon are
  placed onto Stage 1 Pokémon."* You may *"Evolve as many of their Pokémon as they like"* in a turn.
- **Two timing restrictions:** you may not evolve *"on your first turn or the turn a Pokémon entered play."*
  (An ability exists to break it — measured: **Scatterbug/Spewpa, *Adaptive Evolution*: "This Pokémon can
  evolve during your first turn or the turn you play it."**)
- **The evolved Pokémon is the same card-stack.** *"an evolved Pokémon counts as one card while in play"* —
  damage counters, attached Energy and attached Tools all stay.
- **But Special Conditions clear.** Evolving is one of the listed removals.
- **Rare Candy skips a stage:** *"Choose 1 of your Basic Pokémon in play. If you have a Stage 2 card in your
  hand that evolves from that Pokémon, put that card on the Basic Pokémon. (This counts as evolving that
  Pokémon.) You can't use this card during your first turn or on a Basic Pokémon that was put into play this
  turn."*
- **Mega Evolution has a price, printed as a rule:** **"Mega Evolution rule: When 1 of your Pokémon becomes a
  Mega Evolution Pokémon, your turn ends."** And an item removes it: **Charizard Spirit Link: "Your turn does
  not end if the Pokémon this card is attached to becomes M Charizard-EX."**
- **The 2025–2026 Mega Evolution era** reintroduced them as *Mega Evolution Pokémon ex*, *"each of which is
  worth 3 Prize cards on defeat"*, evolving from the normal prior stage rather than from a Basic EX.

### 6.2 Mapping onto pawn promotion

The video already reskins promotion as evolution. The TCG makes it precise, and answers the three questions
the prompt asks — what happens to type, moves, and chess role.

| TCG rule | → Pokémon Chess promotion rule | Why faithful |
|---|---|---|
| Evolution is played onto a Pokémon in play; the stack is one card | The pawn **becomes** the evolved species on its own square; it is the same piece with a new identity, not a new piece | keeps `N` non-increasing, which `recon-variants.md` §4.1 requires for the termination proof |
| Basic → Stage 1 → Stage 2 | Promotion follows the species' real `evos` chain (`recon-data-substrate.md` §5: `prevo`, `evos[]`, `evoType`, `evoLevel`, `evoItem`, `evoCondition` are all present) | data exists; no invention |
| The evolved card can be a **different Energy type** (measured: 96 names printed as >1 type) | **The player re-declares the piece's single type** from the evolved species' real typing. Charmeleon (Fire) → Charizard may declare **Fire or Flying** | this is TCG canon *and* it is rule 2 of the video's ruleset. Promotion is the one moment the game lets you fix a bad type declaration, which answers `BRIEF.md` hard problem 5 |
| The evolved card has **different attacks** | The moveset is **regenerated** by the auto-picker (`recon-moves.md` §6.3) for the new species; charges reset to full | Zapdos does not know Pikachu's moves |
| Damage counters, Energy and Tools **stay** | **Poison counters, Charge, Vigour and the held item persist** through promotion | quoted rule; also stops promotion being a free cleanse of the counter class |
| **Special Conditions clear** | **Asleep / Paralyzed / Confused clear** on promotion | quoted rule; and it is the right feel — evolving is a transformation |
| Cannot evolve *"the turn a Pokémon entered play"* | **A promoted piece may not earn a bonus move on the promoting move**, even if the promoting move was a super-effective capture | the TCG's own "no acting on arrival" restriction, and it is a free tightening of the chain bound |
| **Rare Candy** skips Stage 1 | A pawn reaching the last rank promotes **all the way to the final stage** of its chain (Caterpie → Butterfree, not → Metapod) — but only if the side holds the **Rare Candy** item, otherwise it promotes one stage | keeps the promotion payoff meaningful for 3-stage lines without needing two promotions, and the gate is a real card |
| **Mega Evolution rule: "your turn ends"** | **Promoting to a Mega forme ends your turn immediately**, forfeiting all remaining bonus moves | this is the correct cost model for *every* once-per-game transformation we ship, and it is printed canon |
| **Spirit Link** removes that cost | The matching **Mega Stone** in the side's Kit removes the turn-ending cost | the item is literally named for this job |
| **Mega ex = 3 Prize cards** | A Mega piece **fills 2 prize slots** when captured (§8) | *"extra power brings extra risks"* — the TCG's own framing |

### 6.3 The chess-role question

The video's version promotes a pawn to a queen *and* evolves it. The TCG has no piece-class concept, so this
is where the two systems have to be welded rather than mapped. Recommendation:

> **Class and species advance together, and the species' real evolution stage picks the class.**
> A pawn whose chain has **one** remaining stage promotes to **Knight or Bishop** (player's choice);
> **two** remaining stages promotes to **Rook**; a pawn that is **already fully evolved** at draft time
> (Farfetch'd, Lapras, the legendaries — `species.nfe === false`) promotes to **Queen** directly.

That is a genuinely nice piece of design falling out of real data. It means a Caterpie pawn is a long-term
investment that becomes a rook, a Magikarp becomes a rook (Gyarados earns it), and drafting a fully-evolved
pawn is a *deliberate trade*: no evolution fantasy, but the best promotion. It also uses `species.nfe`, a real
structured field the abilities recon already relies on for Eviolite, so the legality is baked, not judged.

**Cross-check against Terastallization.** `recon-abilities-items.md` §5.1 proposes Tera as the flagship
once-per-game type change and worried that it "costs zero data". §0.2 finding 5 above removes the worry
entirely: Tera in the TCG **is** a re-typed card with a re-derived Weakness. Measured examples, all current:

| Tera card | Printed as | Weak to | Its games typing |
|---|---|---|---|
| Charizard ex | **Darkness** | Grass | Fire/Flying |
| Tyranitar ex | **Lightning** | Fighting | Rock/Dark |
| Skeledirge ex | **Metal** | Fire | Fire/Ghost |
| Greninja ex | **Fighting** | Psychic | Water/Dark |
| Froslass ex | **Grass** | Fire | Ice/Ghost |
| Mewtwo ex | **Lightning** | Fighting | Psychic |
| Dragapult ex | **Dragon** | *(none)* | Dragon/Ghost |

Note the last row: a Tera piece that declares the TCG's no-Weakness type has **no defensive liability at
all**. That is the `Stellar` trap `recon-variants.md` §8.1 already caught, arriving from a second direction —
whatever Tera type we grant, it must have a real defensive profile. And note the TCG's cost for Tera is the
same as its cost for Mega: *"Tera: As long as this Pokémon is on your Bench, prevent all damage…"* is the
*benefit*, and the piece is a 2-prize liability. Charge Tera the Mega price: **it ends your turn.** One cost
model for all three transformations is one fewer thing to teach.

---

## 7. Tool cards and Stadium cards

### 7.1 Pokémon Tool = the held item, and the rules are already ours

Current rule text, printed on every Tool:

> *"You may attach any number of Pokémon Tools to your Pokémon during your turn. **You may attach only 1
> Pokémon Tool to each Pokémon, and it stays attached.**"*

and the older, tighter phrasing: *"Attach a Pokémon Tool to 1 of your Pokémon that doesn't already have a
Pokémon Tool attached to it."* Glossary: Active and Benched Pokémon *"may only have one Pokémon Tool
attached"*; before Scarlet & Violet, Tools were a **subtype of Item card** — i.e. the TCG eventually promoted
"held item" to its own card type because it is structurally different from a one-shot.

Measured: **60 distinct Pokémon Tools** in the current era (of 473 Trainer cards), plus **33 ACE SPEC** cards
of which several are Tools.

The behaviours read like a list of our items, because they are:

| TCG Tool | Text | Our item |
|---|---|---|
| **Rocky Helmet** | *"…is damaged by an attack from your opponent's Pokémon (even if it is Knocked Out), put **2 damage counters** on the Attacking Pokémon."* | `THORNS`. Note **2 counters, not lethal** — canon support for `recon-abilities-items.md` §6.13's "thorns never kill" bound |
| **Leftovers** | *"At the end of your turn, if the Pokémon this card is attached to is in the Active Spot, heal 20 damage from it."* | `UPKEEP`, +1 Vigour — same name, same shape |
| **Vitality Band** | *"…do 10 more damage … (before applying Weakness and Resistance)"* | `LENS` / `TYPE_LENS`, and it fixes our pipeline order |
| **Rock Chestplate** | *"The **Fighting** Pokémon this card is attached to takes 30 less damage … (after applying Weakness and Resistance)"* | a **type-gated** `GUARD`. The TCG routinely gates Tools on the holder's type/stage — direct precedent for Eviolite-on-`nfe` |
| **Bravery Charm / Rigid Band** | gated on **Basic** / **Stage 1** | stage-gated items → **class-gated items**. This is the canon answer to `recon-abilities-items.md` §6.16's "Choice items illegal on King and Queen": gate by class, as the TCG gates by stage |
| **Protective Goggles** | *"The Basic Pokémon this card is attached to has no Weakness."* | the defensive type-modifier suppressor (§1.6) |
| **Exp. Share** | *"When your Active Pokémon is Knocked Out … you may move a Basic Energy from that Pokémon to the Pokémon this card is attached to."* | an item that **transfers state off a dying piece** — canon for `GRASP/give` (Symbiosis) and a gentler alternative to Baton Pass |
| **Vengeful Punch** | *"If the Pokémon this card is attached to is Knocked Out … put 4 damage counters on the Attacking Pokémon."* | `RETALIATE/posthumous` (Aftermath, Innards Out) |
| **Hero's Cape** (ACE SPEC) | *"+100 HP"*, and *"You can't have more than 1 ACE SPEC card in your deck."* | see §7.3 |

### 7.2 Stadium = the global field, and it fixes weather for us

Glossary:

> A Stadium *"alters play for both players long-term and **may only be removed when another Stadium card is
> played**."* One per turn, and **not one sharing a name with a Stadium already in play**.

Measured: **37 Stadium cards** in the current era. Examples I pulled: **Beach Court** (retreat costs down for
all Basics, both sides), **Calamitous Wasteland** (retreat costs up for all non-Fighting Basics),
**Pokémon League Headquarters** (*"Attacks used by each Basic Pokémon in play (both yours and your
opponent's) cost Colorless more"*), **Practice Studio** (*"The attacks of Stage 1 Pokémon (both yours and your
opponent's) do 10 more damage"*), **Calamitous Snowy Mountain** (punishes attaching Energy to non-Water
Basics), **Artazon** / **Mesagoza** / **Town Store** (*"Once during **each player's** turn, that player may…"*).

Three rules to lift verbatim into our weather/terrain layer:

> **W1 — Exactly one field at a time.** A new field replaces the current one. There is no weather-plus-terrain
> stack.
> **W2 — Fields affect both sides.** Every Stadium says *"both yours and your opponent's"*. Rain helps *every*
> Water piece on the board, including the enemy's.
> **W3 — You may not re-play a field that is already active.** *"not one sharing a name with a Stadium already
> in play."*

W1 is a straight simplification of a system that is otherwise a nightmare: the dataset has 5 weathers,
4 terrains and 5 pseudo-weathers (`recon-moves.md` §1), and `recon-abilities-items.md` gives 8 abilities that
set weather and 4 that set terrain. Under W1 the board has **one** field slot and the HUD has **one** field
badge. That is the difference between a legible board and an unreadable one, and it costs nothing in
faithfulness — the games also allow only one weather and only one terrain, and W1 merely merges those two
slots into one.

W2 is already true in the games and is worth stating because it is the thing that makes field control a real
decision rather than a free buff.

W3 is the anti-stall rule we did not have. Without it, Drizzle + Rain Dance every fifth turn is a free
permanent buff and a repetition-draw engine; `recon-moves.md` §5/D4 flags status/heal loops as not resetting
the progress clock, and W3 closes the same hole for fields.

### 7.3 Both are public — and the TCG's whole design depends on it

Tools and Stadiums are face-up, permanently, for both players. So are abilities, HP, damage counters, Energy,
and Weakness/Resistance. **The only hidden information in the TCG is hands and Prize cards** — i.e. what you
*could* do next, never what is on the board.

This is a strong, independent endorsement of `recon-abilities-items.md` §4.2's decision to make abilities and
items public, and it improves the argument. That document justifies public information on AI-tractability
grounds and accepts "this kills the surprise value of Illusion, Frisk, Forewarn, Anticipation and Imposter"
as a cost. The TCG shows it is not a cost at all — it is the design:

> **The TCG puts every persistent effect on the table face-up, and puts randomness and information asymmetry
> entirely in the *deck and hand*. The board is a perfect-information object; the future is not.**

Our analogue of the hand is the **draft** (both players see the pools, neither knows the other's picks until
they are placed) and the **charge budget** (you can see how many uses a piece has left, but not which move
your opponent intends). Keep those. Keep the board perfectly legible. That is not a compromise on depth; it
is how the most successful Pokémon board game does it.

One concrete UI consequence, direct from the TCG's layout: the card face puts Weakness and Resistance in a
fixed spot at the bottom, Retreat Cost bottom-right, HP top-right, and the Ability above the attacks. Fixed
positions, learned once. `recon-abilities-items.md` §4.4's three-line piece card should be laid out the same
way, and the type modifier should be *on the piece card*, not only in a hover tooltip — because the TCG's
core discovery is that a printed type modifier is something players read as fluently as a number.

---

## 8. Prize cards and win conditions

### 8.1 How the TCG decides a winner

Three ways, all quoted:

1. **Prizes** — six Prize cards set aside face-down at setup; you take one each time you Knock Out an
   opponent's Pokémon; *"The first player to take all of their Prize cards Wins the game."*
2. **No Pokémon in play** — *"The player that runs out of Pokémon in play loses the game."*
3. **Deck-out** — *"if a player must draw a card from an empty deck, that player loses the game."*

Plus: certain cards win or lose the game outright by their own text.

Prize weighting is a real system. Measured on the current era: **555 of 2 915 Pokémon cards (19 %)** carry
*"Pokémon ex rule: When your Pokémon ex is Knocked Out, your opponent takes 2 Prize cards."* Historically
GX/V = 2, VMAX/V-UNION = 3, VSTAR = 2, and the 2025–26 Mega Evolution ex = **3**. Format variants scale the
count: *"three are put down if using 30-card Half Decks, and four … using 40-card prerelease decks,"* one each
in Sudden Death. And TCG Pocket replaced the whole thing: *"Prize cards are replaced by points; players win
battles by obtaining three points."*

### 8.2 Honest answer: none of this beats king-capture for us

**Recommendation: do not change the win condition. Keep king-capture per `recon-variants.md` §5 R1.**

The reasoning, and I want to be blunt because the prompt asks me to be:

- **A prize race is a material race, and chess already has one.** Replacing checkmate with "capture N pieces"
  deletes the entire point of chess: that the objective is *positional*, not attritional. It would make every
  sacrifice strictly bad and every trade strictly good, which is the degenerate direction
  `recon-variants.md` §2.4B already warns our rules push toward.
- **Deck-out has no analogue.** We have no deck. The nearest thing is the charge budget (≈12 move-uses per
  piece), and "you lose when your pieces run out of moves" would be a bizarre, un-telegraphed way to end a
  chess game.
- **"No Pokémon in play = loss" is already adopted**, in a better form: `recon-variants.md` §4.3 takes the
  shogi/xiangqi convention that **no legal move ⇒ that player loses**. That is the same idea (you have nothing
  left to do, you lose) generalised correctly for a board game with movement.

### 8.3 Three things to take anyway

1. **The Prize track as the progress HUD.** This is the best piece of interface design in the TCG and it costs
   us nothing. Six face-down cards that flip over one at a time is the reason a TCG game *feels* like it has a
   score, and it is instantly readable from across a table. Ship a **6-slot prize row per player** that fills
   as you capture, where a **premium piece fills 2 slots** (queens, Mega-promoted pieces, and anything above a
   draft-cost threshold — the TCG's "Rule Box" idea, §10.6). It is not a win condition; it is a *material
   meter that a chess novice can read without knowing piece values.* That directly answers `BRIEF.md` hard
   problem 9 for the player who knows Pokémon but not chess: they have never learned that a rook is worth 5,
   but they can see that taking the enemy Charizard filled two slots.
2. **Prize-count as the timed-game and anti-draw tiebreak.** `recon-variants.md` §4.3 wants a material
   adjudication for ranked ladders and offers shogi's jishōgi 24/27-point count. The prize track is the same
   device with a Pokémon skin and a UI already built: on time-out or on the 100-sub-move progress rule, **the
   player with more prizes taken wins**; equal prizes is a draw. Use the prize weighting (premium pieces = 2)
   as the point values so the meter the player has been watching all game is the one that decides it.
3. **Format scaling by prize count.** *Half Deck = 3 prizes; Sudden Death = 1.* That is the TCG's short-format
   knob, and it maps onto our "Blitz" mode cleanly: a shorter game is one where fewer prizes are needed for
   the tiebreak, not one with a shorter clock. Worth having for the roguelike/casual modes.

And one TCG idea to **reject explicitly**: `Shedinja` (EX Deoxys), *Empty Shell*: *"When Shedinja is Knocked
Out, your opponent doesn't take any Prize cards."* A piece that is free to lose is a piece you throw at
everything, which is `recon-variants.md` §5(f)'s suicide-capture problem with the brakes cut. Do not
implement zero-value pieces.

---

## 9. Abilities: Poké-Power vs Poké-Body vs Ability

### 9.1 The history is the lesson

| Era | Keyword | Semantics |
|---|---|---|
| Base Set → *Neo* | **Pokémon Power** (特殊能力) | one undifferentiated keyword |
| *Expedition Base Set* (2002) → *HeartGold & SoulSilver* | **Poké-POWER** / **Poké-BODY** | split into **activated** (*"often be used once during the player's turn, before their Attack"*) and **passive** (*"active for as long as the Pokémon that has it is in play"*) |
| *Black & White* (2011) → today | **Ability** | *"With Black & White, Poké-BODY and Poké-POWER **were combined into this single mechanic**"* |

So the TCG ran the experiment for us: it split passive from activated into two card keywords for nine years,
then **merged them back**. Measured on the current era: **642 abilities across 2 915 cards**; every single one
carries `type: "Ability"` — one keyword, no exceptions — and the activated/passive distinction now lives
purely in the text:

```
abilities 642   activated ("Once during your turn …") 229 (36%)   passive 413 (64%)
```

There was also a real mechanical consequence of the old split, and it is why the merge happened: *"Pokémon
Powers and Poké-Powers cease functioning while a Special Condition is present; Poké-Bodies are unaffected.
Abilities (Black & White onward) are never shut off by Special Conditions."* Two keywords meant two
interaction rules, and players got them wrong.

### 9.2 Recommendation

> **One keyword — "Ability" — one glyph slot on the piece card, one interaction rule.** The
> activated/passive distinction is expressed in the **affordance**, not in the taxonomy: an activated
> ability renders as a tappable button on the selected piece (and, per the TCG, is usable **once during your
> turn, before you move**); a passive ability renders as a static badge. Status conditions never disable
> either.

This validates `recon-abilities-items.md`'s 13-archetype scheme and sharpens one thing about it. That
document's 13 archetypes are a *classification of effect kind* (WARD, EDGE, RETALIATE…), which is the right
axis for the glyph colour. But the player's first question about an ability is not "what kind of effect is
it", it is **"is this something I do, or something that just happens?"** — and the TCG spent nine years
learning that this question needs its own visual channel. So:

- **Glyph colour** = the 13 archetypes (what kind of thing it does) — as designed.
- **Glyph shape** = activated (a filled, button-like shape) vs passive (an outlined badge) — new, and it is
  the cheapest legibility win in the document.

Measured mapping of the 13 archetypes onto the TCG's own two-way split, using the archetype's hook set from
`recon-abilities-items.md` §2.4:

| Presents as | Archetypes | n abilities |
|---|---|---|
| **Passive** (Poké-BODY–shaped) | WARD, BULWARK, EDGE, RETALIATE, FOCUS, BIND, AILMENT, FIELD, MORPH | 259 |
| **Activated** (Poké-POWER–shaped) | ARRIVAL (fires on your action), STRIDE/priority, GRASP/give, MORPH/type-on-attack | ~48 |
| **Inert** | INERT | 3 |

Which is ~85 % passive against the TCG's 64 % — a difference worth noting rather than fixing. Our ability
layer is more passive than the TCG's because our pieces do not have a "before your attack" phase; the fix, if
we want the activated feel, is to give `ARRIVAL` and `GRASP` abilities an explicit tap.

One more precedent worth naming: **Shedinja (EX Dragon), *Wonder Guard* (a Poké-BODY): "Prevent all effects
of attacks, including damage, done to Shedinja by your opponent's **Evolved Pokémon and Pokémon-ex**."**
The TCG's Wonder Guard is **class-scoped immunity with a guaranteed counter-class** — it is untouchable by the
big things and fully vulnerable to Basics. That is a better bound than
`recon-abilities-items.md` §6.2's one-shot ward, because it is *permanent and legible* rather than a hidden
consumed flag, and it is Stratego's "always supply the key" (`recon-variants.md` §1.4) in Pokémon's own
words. See §11.5 for the ruling.

---

## 10. Everything else the TCG solves

### 10.1 Active vs Bench — the bound, not the mechanic

One Active Pokémon, up to five on the Bench. Almost every rule in the TCG applies **only to the Active
Pokémon**: Special Conditions can only happen to it, Weakness and Resistance only modify damage to it, only
it may attack or retreat. Benched Pokémon may still use Abilities.

Our board has no Active/Bench distinction and should not acquire one — 16 simultaneously-active pieces is what
makes it chess. But the *reason* the TCG restricts everything to the Active slot transfers exactly: **a board
game stays legible when effects are local.** That is an independent justification for the scoping bounds
`recon-abilities-items.md` §6.3 and §6.9 already impose (Shadow Tag and Neutralizing Gas restricted to the
king-move ring rather than board-wide). Generalise it into a rule:

> **Locality rule.** Any per-piece effect applies to the piece and, at most, its 8 neighbours. Only **fields**
> (the Stadium slot, §7.2) are board-wide, and there is exactly one field.

That single rule, plus §1.5's "the type modifier applies only to the primary target", makes the whole content
layer bounded in space, which is what keeps a 32-piece board readable.

### 10.2 Switching and forced switching

- **Retreat** = voluntary, costs Energy, once per turn (§4).
- **Jet Energy** = a free switch on attach.
- **Prime Catcher** (ACE SPEC): *"Switch in 1 of your opponent's Benched Pokémon to the Active Spot. If you
  do, switch your Active Pokémon with 1 of your Benched Pokémon."*
- Attacks that forbid it: *"During your opponent's next turn, the Defending Pokémon can't retreat."*

Maps cleanly onto our existing shapes: `WITHDRAW` (`selfSwitch`, 9 moves — U-turn, Volt Switch, Flip Turn) is
retreat-after-attacking; `PHAZE` (`forceSwitch`, 4 moves — Roar, Whirlwind, Dragon Tail, Circle Throw) is
Prime Catcher; `TRAP`/`BIND` (18 moves, 5 abilities) is *"can't retreat"*. Nothing new to invent — but note
that the TCG's forced-switch cards move the *defender to a square the attacker chooses*, whereas
`recon-moves.md` A11 pushes it "1 square directly away". The TCG's version is stronger and more interesting;
worth prototyping "the attacker chooses which adjacent empty square the pushed piece lands on."

### 10.3 Attack costs → the wind-up (§5), and the ACE SPEC singleton

**ACE SPEC: *"You can't have more than 1 ACE SPEC card in your deck."*** Measured: **33 ACE SPEC cards** in
the current era, spanning Items, Tools and Energy, all strictly more powerful than the ordinary versions
(Master Ball, Hero's Cape +100 HP, Prime Catcher, Maximum Belt +50 damage).

This is a **shipped, current, first-party precedent for exactly the draft restriction we need**, and it lands
on the same answer as two other sources: Knightmare Chess's asterisked one-per-deck cards
(`recon-variants.md` §1.1) and `recon-moves.md` §5's proposal that OHKO moves be "draft-restricted (max 1 per
team)". Three independent canons converge, so make it a formal draft rule:

> **Rule (ACE SPEC) — a side may field at most **one** Ace piece.** The Ace list is the format's named set of
> outliers: an OHKO move (Fissure, Guillotine, Horn Drill, Sheer Cold), `Wonder Guard`, `Imposter`,
> `Shadow Tag`, `Huge Power`/`Pure Power`, and the 4 Ruin abilities. Marked with the same badge the TCG uses,
> visible in the draft and on the board.

That replaces four separate bespoke bans in `recon-abilities-items.md` §6 with one uniform rule the player
learns once. It also gives the draft an interesting texture — your one Ace pick is a statement — rather than a
ban list that reads as an apology.

### 10.4 Special Conditions stacking → already in §3.2

The rotation/counter split is the whole rule and it is the single most portable thing in this document.

### 10.5 Damage counters → poison counters and Vigour pips

Every damage value in the TCG is a multiple of 10, and I checked: **3 683 of 3 683 numeric-damage attacks are
divisible by 10**, min 10, median 50, max 330. *"Each damage counter counts as 10 damage."* Damage is a
**countable physical token**, not a number.

Two consequences:

1. **Our poison clock should be counters, not a number** (§3.3) — three pips, filling.
2. **`Vigour` should render as counters too.** `recon-abilities-items.md` §2.4 defines a single `[-3, +3]`
   integer replacing all six base stats and all stat stages, and §4.4 already sketches `Vigour ●●○`. The TCG
   confirms the presentation: a small, countable, physically-legible token row, with a clear neutral point.
   Also worth copying: the TCG lets a **die** substitute for counters (*"a die showing 5 = 50 damage"*) — i.e.
   when the count gets large, switch from pips to a numeral. Do the same at 3.

### 10.6 The Rule Box — how the TCG makes powerful cards legible

Pokémon ex, V, VMAX and so on carry a printed **Rule Box**: a boxed line of text stating the drawback
(*"When your Pokémon ex is Knocked Out, your opponent takes 2 Prize cards"*). Many other cards then reference
it — Artazon searches for *"a Basic Pokémon that **doesn't have a Rule Box**"*, and Reversal Energy only works
on *"an Evolution Pokémon that doesn't have a Rule Box"*. So "is this a premium card" is a **first-class,
machine-checkable property that other cards can key off**, and the marketing framing is explicit for the new
Mega era: *"extra power brings extra risks!"*

Adopt it as the draft's legibility device and as a real rules hook:

> **Rule Box.** A drafted piece whose cost exceeds the format's premium threshold displays a **Rule Box** on
> its card listing its drawback: it fills **2 prize slots** when captured. Format rules, abilities and items
> may reference "a piece without a Rule Box" (the TCG's own idiom), which gives the draft validator and the
> underdog-support items something clean to key off.

That is how the TCG makes a 300-HP Charizard fair without nerfing it, and it is the same lever
`recon-variants.md` §3.3 wants for point-buy — but expressed as a *visible property of the piece* rather than
a number in a spreadsheet.

### 10.7 Turn structure — the one-of-each budget

Worth writing down because it is the shape of a good board-game turn:

> Draw a card. Then, in any order: attach **up to one** Energy; play **as many** Basics as you like; evolve
> **as many** Pokémon as you like; retreat **up to one** time; play **as many** Trainers as you like *(but
> only **one** Supporter and **one** Stadium)*; use any Abilities. *"Attacking will end a player's turn
> regardless of how many other actions they have taken."*

Two design principles fall out, both of which we should honour:

1. **The turn is unlimited in the cheap things and strictly rationed in the consequential ones.** Free:
   information, positioning of new pieces, reading. Rationed: the resource, the disengagement, the global
   effect, the attack. Our turn should follow the same grammar — free to inspect, look ahead, and read type
   matchups; exactly one move; at most one retreat; at most one field change per side per turn.
2. **The attack ends the turn.** That is precisely our "a capture ends your turn unless it earned a bonus
   move", and the TCG's version is the stricter one. It is also the reason the TCG can flip coins after
   commitment without the game spiralling: the turn is over either way.

---

## 11. Where the TCG and the games conflict — rulings

| # | Conflict | Games say | TCG says | **Ruling** |
|---|---|---|---|---|
| 1 | **Type immunity** | 8 ordered pairs are `0×`: the attack has no effect at all | **no immunity exists.** Ghost gets Fighting −30; Flying gets Fighting −30. Zero `×0` in 2 915 cards | **Games win on the headline rule** — "Ground cannot capture Flying" is the video's rule, it is 2.5 % of matchups (`recon-variants.md` §1.4), and it is the most memorable Pokémon fact a chess player can learn. **TCG wins on the bounding philosophy**: ship the Graze and the power-scaled Resistance (§1.6) as the balance valve, and make `ignoresTypeChart` a first-class move flag rather than a 5-move special case |
| 2 | **Mutual destruction** | resisted attacks just do less damage; the attacker is never harmed | **nothing** — a resisted attack never hurts the attacker. There is no TCG support whatsoever for a capture killing the capturer | **Neither canon supports it — it is chess canon (Kamikaze 1928, Stratego), and the design must say so.** Keep it, because `DIRECTION.md` demands richness and the video demands it and `recon-variants.md` §5(f) makes the case. But **label it in the UI as a chess rule, not a Pokémon rule**, and ship the TCG-faithful alternative (power-scaled Resistance: a resisted capture by a ≤T2 move simply fails) as the primary balance lever if the value scale collapses. Do not pretend it is Pokémon-authentic; it is the one core rule that is not |
| 3 | **Paralysis** | permanent until cured; halves Speed; 25 % chance the move silently fails | loses exactly one turn, then self-clears; no flip | **TCG, unambiguously.** Adopted in §3.3. The games' silent 25 % failure is the worst mechanic in either canon for a chess variant. Route the Speed halving to a separate movement-range debuff |
| 4 | **Damage-modifier order** | one big multiplicative damage formula; ability modifiers and the type multiplier interleave | strict order, printed on the cards: attacker bonuses **before** Weakness/Resistance, defender reductions **after** | **TCG.** This is a **correction to `recon-abilities-items.md` §2.4**, whose Clash step 2 sums attacker and defender hooks together. Re-spec as: `roll = d + Σatk`; then apply the type modifier to classify; then `Σdef` may only *downgrade* the classification. Otherwise a `BULWARK` bonus can silently erase a `WEAKNESS` reading, which is both unfaithful and illegible |
| 5 | **Wonder Guard** | immune to everything that is not super effective (15 of 18 types) | immune only to **Evolved Pokémon and Pokémon-ex** — a named class, with Basics as the guaranteed key | **TCG.** It is a better bound than `recon-abilities-items.md` §6.2's one-shot ward: permanent, legible, and it never produces an untouchable piece. Re-spec `WARD/absolute` as *"cannot be captured by Queen, Rook, Bishop or Knight; can be captured by any Pawn or King"*. That is class-scoped immunity with an over-supplied key — Stratego's rule, Pokémon's words, and it makes Shedinja a fascinating piece instead of a banned one |
| 6 | **Sleep duration** | 1–3 turns, hidden counter | coin flip each Checkup, unbounded tail | **Split: TCG's flip, games' 3-turn cap** (§3.3). The flip is the authentic board-game feel; the cap is required by our termination culture, and it comes from the other canon rather than being invented |
| 7 | **Confusion self-damage** | 33 % chance to hit yourself for 40 power | 30 self-damage — **and TCG Pocket removed it entirely** | **TCG Pocket.** We have no HP; the newest first-party board game already dropped it. What we keep is the good part: the capture fails and **your turn ends** |
| 8 | **Status clearing on switch** | volatile clears, non-volatile persists | **all** conditions clear when the Pokémon leaves the Active spot | **Split, and the TCG's own marking system draws the line for us** (§3.5): the rotation class clears on withdraw/promotion, the counter class persists. Both canons satisfied by one rule |
| 9 | **What "Tera" means** | change the Pokémon's type, gain a boost; the Pokémon keeps its original type's moves | the card is **printed as a different type with a matching new Weakness**; the "Tera" keyword itself grants a Bench-damage immunity | **Games for the semantics, TCG for the cost.** Type change is the mechanic (`recon-abilities-items.md` §5.1, now corroborated). The cost should be the printed Mega cost: **it ends your turn** |
| 10 | **Resistance value across eras** | n/a | Bulbapedia's `Type (TCG)` says −20 "from Diamond & Pearl through Sword & Shield" | **Measured: wrong.** `swsh1` (Feb 2020) prints **−30** on all 36 of its resisted cards. The glossary's *"with Sword & Shield resistances are now −30 again"* is correct. Noted so nobody re-derives the wrong number from the wrong article |
| 11 | **Frozen** | a real non-volatile status (13 secondary applications, 0 primary in gen 9) | **does not exist**; Asleep covers it | **TCG.** Fold `frz` into Asleep, keeping the games' Fire/`thawsTarget` early-clear as a bonus. One fewer status to teach |
| 12 | **Coin timing** | n/a | flips happen **after** you commit to the attack | **Neither, alone.** `recon-variants.md` §6.3 is right that output randomness is the biggest variance lever; the TCG is right that flipping after commitment is authentic and dramatic. **Rule: output randomness for riders, pre-revealed randomness for anything that can cost you a piece** (§2.2) |

---

## 12. What *not* to take from the TCG

Being explicit, because "the TCG did it" is going to become an argument-ender and it should not be.

1. **Do not take the 10-type chart** (§1.5). It is a printing constraint and it is internally inconsistent
   (8.2 % of names contradict themselves).
2. **Do not take Energy as a resource** (§5.2). Chess already charges a tempo per action.
3. **Do not take prizes as the win condition** (§8.2). It converts chess into an attrition race.
4. **Do not take HP.** The TCG's HP (median 110, max 340) and damage counters exist because a TCG attack is
   repeatable each turn against the same target. Our captures are one-shot; binary capture plus the
   status-only poison counter is the right amount of "hit points".
5. **Do not take deck-building, hands, Supporters, or search.** 267 of 473 current Trainer cards are
   Supporters and most of them are draw/search effects — a deck-manipulation layer with no board analogue.
   Draft is our deck-building, and it happens once.
6. **Do not take "the first player cannot attack".** The TCG's first-turn restriction solves a
   card-advantage problem we do not have. If we ever find a first-player skew, `recon-variants.md` §1.3 has
   the right tool (Bruce's balanced Marseillais opening: White gets one move on turn 1).
7. **Do not take zero-value pieces** (§8.3, *Empty Shell*).
8. **Do not take the pre-2003 rules** for anything. Unlimited retreats per turn, coin-flip retreats, and the
   1998 Japanese confusion rule (where a tails flip made your attack resolve against *your own* board, with
   Weakness and Resistance applied) are all documented mistakes that the TCG itself fixed.

---

## 13. Deliverables for the engine

Concrete, ordered by how much they touch existing code.

### 13.1 Vocabulary (UI strings, no engine change)

| Concept | Say this | Not this |
|---|---|---|
| `super` outcome | **WEAKNESS** — *"Charizard's Fire hits Ferrothorn's Weakness"* | "2× effective" |
| `resisted` outcome | **RESISTANCE** | "0.5× effective" |
| `immune` outcome | **NO EFFECT** | "0× / illegal" |
| the randomizer | **the flip** / *"flip 3 coins"* | "the d6" |
| the status upkeep step | **Pokémon Checkup** | "end of turn phase" |
| a status | **Special Condition** | "status effect" |
| a held item | **Tool** | "equipment" |
| weather / terrain | **Stadium** (or keep the real names, but *one slot*) | "field effects", plural |
| the material meter | **Prizes** | "captured pieces" |
| an outlier draft pick | **Ace** (ACE SPEC) | "banned-ish" |
| a premium piece's drawback | **Rule Box** | "penalty" |

### 13.2 Small, self-contained additions

| Change | Where | Effort |
|---|---|---|
| The type modifier applies only to a move's **primary target**; area/splash targets resolve neutral | move resolution | small, and it removes a large class of balance and AI problems |
| Fix the modifier order: `atk → type → def`, `def` may only downgrade | the Clash resolver | small, prevents a faithfulness bug |
| Two status classes with two markings (rotation / counter) | status model + `PokemonIcon` render | medium; highest legibility return in the document |
| Fixed Checkup order `psn → brn → slp → par → hooks → simultaneous removal` | turn loop | small; needed for engine determinism anyway |
| Poison counters, 3 to kill (`tox` = 2/turn) | status model | small; unlocks ~31 moves and ~15 items |
| Paralysis = lose exactly one activation, self-clearing; unify with `flinch` | status model | small; unlocks 35 + 46 applications with one rule |
| Confusion = flip on capture; tails ⇒ no capture and **turn ends** | turn loop | small; also a chain brake |
| Charge counter (0–2), gates T4/T5 moves | piece state | medium; replaces bespoke handling for `flags.charge`, `flags.recharge`, Speed Boost |
| One field slot; new field replaces; cannot re-cast the active field | field state | small; large legibility win |
| Coin-count probability snapping for all `secondary.chance` values | move derivation (build time) | small |
| Crit rate `γ = 1/16`, presented as "four heads" | RNG config | trivial |
| ACE SPEC: one Ace piece per side | draft validator | small; replaces 4 ad-hoc bans |
| Rule Box on premium pieces; prize slots weighted 1 or 2 | draft + HUD | small |
| Prize track HUD; prize count as the timed/no-progress tiebreak | HUD + adjudication | medium |
| Retreat cost on disengagement (class-scaled, 1 charge) | move legality | **medium-large, ship behind a format flag** — the one rule here that changes the core loop |

### 13.3 Tests this document implies

- Every probability the engine can produce is in `{1, 3/4, 1/2, 1/4, 1/8, 1/16}` — assert over all 950 moves.
- No piece is ever afflicted by two rotation-class conditions simultaneously.
- A Confused piece's failed capture always terminates the turn (property test: no bonus move follows).
- Sleep never exceeds 3 turns, for any seed.
- Poison always kills in ≤3 of the owner's turns unless cured, and never in fewer than 2 (`tox`).
- Exactly one field is active at any time; re-casting the active field is rejected as illegal.
- The type modifier is read exactly once per capture, against exactly one target square.
- `atk` modifiers can never turn a `resisted` into a `neutral`; `def` modifiers can never turn a `neutral`
  into a `super`.
- Draft validator rejects a second Ace.

---

## 14. Sources

**Official (Pokémon / Play! Pokémon)**
- Rules & resources index (rulebook, tournament handbook, alternative play handbook, errata, banned list) —
  <https://www.pokemon.com/us/play-pokemon/about/tournaments-rules-and-resources>
- Pokémon TCG rulebook (current) —
  `https://www.pokemon.com/static-assets/content-assets/cms2/pdf/trading-card-game/rulebook/pbl_rulebook_en.pdf`
  — **not readable by this agent**: served behind Imperva bot protection to `curl`, and exceeds the 10 MB
  fetch limit via the web tool. A text extraction attempt via `r.jina.ai` returned no extractable text. Every
  rule I attribute to "the rulebook" below is therefore attributed to Bulbapedia's rendering of it, and marked
  as such. **A human should verify §3.3's exact condition wording against this PDF.**
- *Mega Evolution—Pitch Black* rule-change announcement (2 July 2026; confirms **no** rules changes) —
  <https://www.pokemon.com/us/play-pokemon/about/mega-evolution/mega-evolution-pitch-black-rule-changes-announcement>

**Bulbapedia (rules text and history)**
- `Appendix:Glossary (TCG)` — Weakness, Resistance, Retreat cost, Prize card, Special Condition, Pokémon
  Checkup, Ability, Poké-POWER, Poké-BODY, Pokémon Tool, Stadium, Bench, Active Pokémon, Energy, Evolution,
  Damage counter, Coin flip —
  <https://bulbapedia.bulbagarden.net/wiki/Appendix:Glossary_(TCG)>
- `Special Condition (TCG)` — per-condition mechanics, marking, Checkup order, era changes —
  <https://bulbapedia.bulbagarden.net/wiki/Special_Condition_(TCG)>
- `Type (TCG)` — the 11 Energy types, the games→TCG type collapse, Weakness/Resistance values and ordering —
  <https://bulbapedia.bulbagarden.net/wiki/Type_(TCG)> *(contains the −20/Sword & Shield error corrected in
  §11.10)*
- `Retreat` — retreat cost, once-per-turn history, modification order —
  <https://bulbapedia.bulbagarden.net/wiki/Retreat>
- `Pokémon Trading Card Game` — turn sequence, the three win conditions, setup, Bench, prizes —
  <https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_Trading_Card_Game>
- `Mega Evolution (TCG)` — the 2025–26 Mega Evolution era, Mega ex = 3 prizes —
  <https://bulbapedia.bulbagarden.net/wiki/Mega_Evolution_(TCG)>
- `Pokémon Trading Card Game Pocket` — 20-card decks, Energy Zone, 3-point win, **Weakness +20 and no
  Resistance**, 3-Bench, no Confusion self-damage —
  <https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9mon_Trading_Card_Game_Pocket>

**Card text quoted verbatim** (all retrieved from `https://api.pokemontcg.io/v2`, the community Pokémon TCG
API; card text is printed on the physical cards)
- M Charizard-EX (*Flashfire*, 2014) — *"Mega Evolution rule: When 1 of your Pokémon becomes a Mega Evolution
  Pokémon, your turn ends."*
- Charizard Spirit Link (*Evolutions*, 2016) — *"Your turn does not end if the Pokémon this card is attached
  to becomes M Charizard-EX."*
- Rare Candy (*Plasma Blast*, 2013) — the stage-skip text
- Shedinja (*EX Dragon*, 2003) — *Wonder Guard*, class-scoped
- Shedinja (*EX Deoxys*, 2005) — *Empty Shell*, the zero-prize piece
- Snorlax (*Jungle*, 1999) — *Thick Skinned*
- Snorlax-GX (2017) — *"You can't use more than 1 GX attack in a game."*
- Current era (SV): Protective Goggles, Rocky Helmet, Leftovers, Vitality Band, Rock Chestplate, Bravery
  Charm, Rigid Band, Choice Belt, Exp. Share, Vengeful Punch, Hero's Cape, Maximum Belt, Prime Catcher,
  Master Ball, Beach Court, Calamitous Wasteland, Calamitous Snowy Mountain, Pokémon League Headquarters,
  Practice Studio, Artazon, Town Store, Mesagoza, Jet Energy, Spiky Energy, Therapeutic Energy, Mist Energy,
  Medical Energy, Kabutops *Ancient Way*, Porygon *Conversion 4*, Oranguru *Now You're in My Power*, Florges
  *Blooming Garden*, Archaludon ex *Metal Defender*, Umbreon *Feint Attack*, Staryu *Swift*, Pachirisu
  *Everyone Discharge*, Toxicroak ex *Toxic Ripper*, Growlithe *Relentless Flames*, Scatterbug *Adaptive
  Evolution*, Spidops ex *Trap Territory*

**Measured on this machine** (`/tmp/pkmn-probe/tcg-recon/`)

| Script | What it produced |
|---|---|
| `tcg-recon-1-eras.py` | the era table in §1.2 — printed Weakness/Resistance values and retreat costs for `base1`, `dp1`, `bw1`, `xy1`, `swsh1`, `sv1` |
| `tcg-recon-2-fetch-sv.py` | the corpus: 2 915 Pokémon cards + 499 Trainer/Energy cards across all 16 Scarlet & Violet sets → `sv_cards.json`, `sv_trainers.json` |
| `tcg-recon-3-analyse.py` | every other number in this document: the empirical type chart (§1.3), the modifier alphabet, multi-typed names, coin-flip taxonomy (§2.2), Special Condition counts (§2.1), attack energy costs (§5.1), retreat-cost-by-stage (§4.2), turns-saved-by-Weakness (§1.4), activated-vs-passive abilities (§9.1), Trainer subtype counts (§7) |
| `tcg-recon-3-output.txt` | its captured output |

**Caveats on the measured corpus.** (a) `api.pokemontcg.io`'s set list ends at *White Flare* (July 2025), so
the 2025–26 *Mega Evolution* era cards are **not** in the corpus; §6.1's Mega-era facts come from Bulbapedia,
not from measurement. (b) Set totals include alternate-art reprints, so a popular card is counted more than
once — that inflates absolute counts but not the ratios I draw conclusions from, and the per-name analysis in
§1.3 deduplicates. (c) The API is community-maintained; every card-text quote above is one I read directly in
its response, but it is not a first-party source.

**Not verified / do not rely on**
- The exact current rulebook wording for the five Special Conditions. Bulbapedia's article is detailed and
  internally consistent and I have quoted it as such, but I could not diff it against the official PDF.
- Whether the 2025–26 Mega Evolution era changed any general rule. The one announcement page I could reach
  says *"No changes have been made"* to the banned lists and is silent on mechanics; Bulbapedia describes the
  Mega ex cards but quotes no drawback text beyond the 3-prize rule.
