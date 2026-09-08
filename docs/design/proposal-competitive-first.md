# Pokémon Chess — Competitive-First Design Specification

**Author role:** competitive / depth-first designer.
**Status:** proposal. Subordinate to [`DIRECTION.md`](./DIRECTION.md); builds on the four recon documents and
on eight new probes measured on this machine (`/tmp/pkmn-probe/compfirst-{1..9}.mjs`, `@pkmn/dex@0.10.11`).
Every number tagged **[CF]** is new to this document and reproducible from those scripts.

---

## 0. Thesis

> **Move the type-knowledge edge out of the draft and onto the board.**

The video's soul is "Pokémon knowledge beats chess strength". Every design that keeps *one type per piece
and one capture rule* puts that knowledge in the **draft** — you pick Steel, you win. That game is solved in
a month: a tier list appears, the draft becomes rote, and what is left is chess with a lottery attached.

This design keeps one *declared* type per piece as its **defensive identity**, and gives each piece its real
**four-move kit** whose types decide what a capture *means*. Then the type chart is consulted **once per
capture, twenty times a game, by the player**, and the question "which of my four moves do I hit this piece
with?" is the whole game. That is a recurring skill test, not a pre-game lookup.

The measurement that makes this a design and not a preference **[CF]**:

| Regime | mean distinct attacking types/piece | pairs with **no legal capture** | pairs where the best option is **0.5×** (forced self-destruct) | mean super-effective coverage | **E[Δ] edge of a type-literate over a type-blind player** |
|---|---|---|---|---|---|
| Video rules (one type, one attack) | 1.00 | **2.47%** (8/324) | **18.8%** | 2.83 / 18 | ≈0.56 pawns/capture *(recon-variants §6.1)* |
| recon-moves' shape-quota picker | 1.57 | 1.30% | 12.02% | 4.09 / 18 | — |
| **This design (shape + type-coverage quota)** | **2.42** | **0.37%** | **3.60%** | **5.72 / 18** | **0.572 pawns/capture** |

Read the last column against the first. **The type-knowledge edge is preserved exactly** (0.572 vs ≈0.56
pawns per capture ⇒ ≈10 pawns per game ⇒ ≈700 Elo of chess strength by recon-variants' conversion), while the
untouchable-piece problem shrinks **6.7×** and the "my Ice type is so worthless the suicide is worth it" tax
shrinks **5.2×**. Measured breakdown of the same 18,381 samples **[CF]**:

```
type-literate (picks the best of its 4 moves) : E[Δ] = +2.569   bonus-move rate 31.8%   forced 0.5× 3.6%
STAB-only player                              : E[Δ] = +2.004
type-blind (picks the highest base power)      : E[Δ] = +1.997   illegal attempts 2.8%   self-destructs 19.5%   bonus 13.7%
```

A type-blind player throws pieces away on one attack in five and earns less than half the free moves. That is
visible, teachable, and it is *skill*, not luck.

The second commitment: **no randomness after a decision that the player did not buy.** All variance is either
(a) revealed publicly three turns in advance (the Forecast), (b) attached to a move the player chose to draft
and chose to use (accuracy < 100, secondary-effect chances), or (c) attached to an item the player chose to
draft (Quick Claw, Focus Band). Variance is a *drafted resource*, never a tax. This is simultaneously the
fairness decision and, per recon-tech §B.3, the decision that makes the AI ~100× cheaper.

Everything else in this document — the shared-pool draft, usage-based tiering, the initiative auction, the
sub-move clock, the deterministic Clash — exists to make the game *rateable*: same seed and action list ⇒
same game, no post-commitment dice, no hidden information, server-authoritative, replayable, ladder-ready.

---

## 1. Deviations from the recon documents (read this before the rules)

| # | Recon recommendation | What I do instead | Why |
|---|---|---|---|
| D1 | recon-moves: a piece's capture uses its single declared type | **The capture uses the *move's* type; the declared type is the piece's defensive identity and its STAB type** | The measured table in §0. Same skill edge, 6.7× fewer lockouts, and the skill is exercised every capture instead of once at draft. |
| D2 | recon-abilities §2.4: Clash = `d6 + Vigour ± hooks`, with MISS on ≤1 and CRIT on ≥6 | **No die in the Clash.** A deterministic integer **FORCE** with two thresholds (REPELLED ≤ −3, OVERWHELM ≥ +3) replaces the die. All 115 ability primitives keep their signatures; "+1 to the die" becomes "+1 FORCE"; the MISS/CRIT bands become REPELLED/OVERWHELM. | A die inside the capture is post-commitment randomness on the single most important decision in the game. FORCE is the canon damage formula collapsed to an integer, which is exactly the question a binary-capture game asks ("did you do enough to KO?"). |
| D3 | recon-variants §6.3: per-turn public CRIT type + FLINCH type, revealed at turn start | **The Forecast:** one public **Charged type** per turn, generated from the seed at game start and revealed **three turns ahead**. No FLINCH track. | Revealing at turn start still *gifts* tempo at random. Revealing three turns ahead converts randomness into a **known future constraint** both sides can manoeuvre around — Chess960's trick (random but fully knowable and symmetric). Dropping FLINCH removes the one element that can delete a player's winning tactic without warning. |
| D4 | recon-abilities §6.1: **all** wards are one-shot, including the type chart's 0× | **Canon decides per entity.** Type immunity and ability wards (Levitate, Flash Fire, Volt Absorb) are **permanent**; item wards that canonically pop (Air Balloon) are one-shot. Balance comes from key supply, not from a blanket rule. | `DIRECTION.md` names permanent Levitate as the *example of a good mechanic*, and it outranks the recon docs. Competitively, permanent-but-narrow immunity is **plannable**; one-shot wards add hidden state that costs the AI ~1 ply (recon-tech §B.5) and that players must track. With D1 the problem it solved is already 6.7× smaller (0.37% of pairs). |
| D5 | recon-variants T2: a piece may not earn a second bonus move in a turn, and the baton must pass to a different piece | **The bonus sub-move may be played by any piece, including the one that earned it; but a piece may earn at most one bonus per turn.** | Preserves the "my Garchomp rampages" fantasy (2 captures max by one piece) while keeping the same hard cap of 3 sub-moves. One rule instead of two, and it is easier to say out loud. |
| D6 | recon-abilities: one **Vigour** counter in [−3,+3] absorbing all stats and stages | **Two integers, one displayed number:** `boost ∈ [0,3]` (from moves/abilities, decays 1 per own turn) and `wound ∈ [0,3]` (from chip damage, permanent, **KO at 4**). `Vigour = boost − wound`. | A single counter cannot be both a decaying buff and a permanent wound; with one counter, poison heals itself. Two fields give status a real kill clock and give abilities a real `pristine` predicate, at the cost of one extra byte. |
| D7 | recon-moves: sleep lasts `d6 mod 3 + 1` turns; paralysis fizzles 25% of the time | **Sleep is exactly 2 turns and paralysis never fizzles.** Plus **Sleep Clause** (at most one enemy piece asleep per side) and **Freeze Clause** (freeze lasts at most 2 turns). | Sleep and full-paralysis RNG are the two mechanics that competitive Pokémon itself legislated against. Adopting Smogon's clauses is *more* faithful to how Pokémon is actually played at a high level, and it removes post-commitment variance. |
| D8 | recon-variants: point-buy as the draft's spine, gated by Chess18-style pairing screens | **Ranked drafts from a shared, seeded, screened 46-card pool with fixed class counts, so material is symmetric by construction.** Point-buy exists only in the collection format, where it buys *quality within a fixed class structure*, never extra material. | Betza's four "balanced" armies scored +62%/−71% over 400 engine games. The only reliable fix is not to let armies differ in material at all. A shared pool is also exactly what the video did (2 kings, 2 queens, 4 bishops… alternate picks). |
| D9 | recon-tech: 5 verdict visuals | **6**: add `REPELLED`, and add a persistent Forecast strip to the HUD. | New outcomes need new art or the game is illegible. |
| D10 | recon-moves: ship 867 moves (gen-9 + non-Z/non-Max delta) | **Ship all 950 admitted move effect records** (recon-data-substrate's inclusion policy), exclude Z/Max from *selectable* kits. | 950 × ~24 B = 23 KB; the CI coverage audit is over the admitted set, and a moveset picker that can never reach 109 of them is a smaller claim than "every admitted move has an effect". |

Everything else in the recon documents is adopted, and where I adopt it I say so.

---

# PART I — THE MATCH

## 2. Board, setup, notation

- **8×8**, standard chess board, standard initial array: back rank `R N B Q K B N R`, pawns on the second
  rank, mirrored. Squares carry state (hazard layers, last-move marks); the board itself is ordinary.
- **Castling** exists with standard rights, and — because there is no check-legality (§7) — a king **may
  castle out of, through and into attack** (Duck Chess precedent).
- **En passant** exists and, per Marseillais/Progressive precedent, **may only be taken on the first
  sub-move of a turn**.
- **Pawn double-step** exists.
- **Notation.** Standard algebraic plus a bracketed move name and an outcome tag, so a game log is readable
  and greppable: `Nxe5[Drill Run] ADV`, `Rg3[Brave Bird]* TRADE` (`*` = ranged strike, attacker did not
  move), `Bd4[Earthquake]~ AREA:2` (`~` = area action), `e8=Gyarados`, `Qd1[Tera→Steel]`.
- **Coordinates are always shown**; a piece's chess role glyph (♟♞♝♜♛♚) is drawn on every piece, because a
  Skarmory does not look like a rook (recon-tech §A.7.1).

## 3. Classes: how 1025 Pokémon become chess pieces, from data

The video assigned classes by flavour. Flavour does not scale to 1025 and it does not survive a ladder,
because players will argue about it. This design derives class from the dataset, and the derivation is
published so the argument is about the formula, not about individual mons.

**Rule 1 — role family is decided by evolution, not by stats.**

```
canEvolve(s) = s.evos.length > 0     ⇒  s is a PAWN candidate
otherwise                            ⇒  s is an OFFICER candidate
```

Measured over the 1025 admitted base formes **[CF]**: **450 pawn candidates, 575 officer candidates**, with
no overlap and no gaps. This is the single most faithful rule in the document: **a pawn is a Pokémon that has
not finished growing, and promotion is its evolution** — exactly the video's on-camera reading ("Pikachu is
evolving…"), and exactly the TCG's model of evolution as a deliberate play onto a Pokémon already in play.

**Rule 2 — an officer's class is a pure function of its base stats.**

```ts
function classOf(s: Species): 'K'|'Q'|'B'|'N'|'R' {
  const b = s.baseStats, bulk = b.hp + b.def + b.spd, off = Math.max(b.atk, b.spa);
  if (isRoyal(s) && s.bst >= 580)          return 'K';   // tags: Legendary / Mythical / Sub-Legendary / Paradox / UB
  if (s.bst >= 540 && off >= 100)          return 'Q';
  if (b.spa > b.atk + 10 && b.spa >= 90)   return 'B';   // "magical" — the video's own bishop flavour
  if (b.spe >= 95)                          return 'N';   // fast leapers — the video's "rideable"
  if (bulk >= 280 || b.def >= 100)          return 'R';   // walls — the video's bulky rooks
  if (s.bst >= 480)                         return 'Q';
  return 'N';
}
```

Measured distribution over the 575 officers **[CF]**: **K 76, Q 143, B 103, N 162, R 91**. Every class has
three-figure supply; the flavour the video used falls out of the stat lines (special attackers become
bishops, walls become rooks, fast Pokémon become knights, legendaries become kings).

**Rule 3 — a species may be *eligible* for more than one class, and the draft pool uses eligibility, not the
single best class.** A strict single mapping leaves holes: with a one-class-per-species function, **Fighting
has zero bishops** **[CF]** — so a Fighting bishop could never appear and the "every type on the board" goal
becomes unreachable. The eligibility predicate (which admits a species to a class if it is *plausible* there)
gives a mean of **1.88 classes per species** and leaves **no empty (type × class) cell**; the scarcest cells
are Bug/King 4, Ground/Bishop 6 and Fighting/Bishop 7 **[CF]**.

```ts
function eligible(s: Species): Set<Klass> {           // officers use K/Q/B/N/R; pawn candidates use P
  const b = s.baseStats, bulk = b.hp + b.def + b.spd, off = Math.max(b.atk, b.spa), e = new Set<Klass>();
  if (b.spe >= 85 || (b.spe >= 70 && b.atk >= 90))  e.add('N');
  if (b.spa >= b.atk && b.spa >= 80)                e.add('B');
  if (bulk >= 270 || b.def >= 100 || b.spd >= 100)  e.add('R');
  if (s.bst >= 500 && off >= 95)                    e.add('Q');
  if (isRoyal(s) || s.bst >= 580)                   e.add('K');
  if (e.size === 0) e.add(s.bst >= 470 ? 'R' : 'N');            // total fallback: never empty
  return e;
}
```

**Rule 4 — base stats never touch capture resolution.** They decide class eligibility, they steer the
moveset picker (§5.2), and they set the draft price (§11.2). They do **not** make a Blissey harder to
capture. This is a deliberate trade, stated plainly: chess's grammar is that any piece may take any piece,
and a stat-gated defence would recreate Betza's Iron Ghost by the back door and delete tactics. Raw power
enters the game through **Vigour**, which is *earned in play*, not bought at draft.

## 4. Types

- Each piece **declares exactly one type at draft** from its species' real `types[]` (Lapras → Water *or*
  Ice, the video's own example). That type is:
  1. its **defensive identity** — what the enemy's move types are compared against;
  2. its **STAB type** — moves of that type get **+1 FORCE**;
  3. its board colour, aura and tooltip identity.
- **Stellar is excluded** from declaration (0 species, 1× both ways ⇒ strictly dominant defensively) —
  adopted verbatim from recon-variants §8.1. The working chart is **18 × 18 = 324 ordered pairs**.
- A piece's type can change in play, and only in these ways, all canon: **Tera** (§9), **Soak / Magic Powder
  / Forest's Curse / Trick-or-Treat / Conversion / Reflect Type** (recon-moves B6), **Multitype / RKS System**
  (the held Plate/Memory *is* the type), **Forecast/Mimicry** (tracks weather/terrain), **Color Change**,
  **Protean/Libero** (once per game).

## 5. The piece

### 5.1 What a piece IS

```ts
type PieceId = number;                     // stable for the whole game: animation, replay, logs
type Klass = 'K'|'Q'|'R'|'B'|'N'|'P';

interface Piece {
  id: PieceId;
  side: 0 | 1;
  klass: Klass;
  species: SpeciesId;        // 1..1025 base forme, or a forme id after promotion / Mega / battle forme
  declaredType: TypeId;      // 0..17
  teraType: TypeId | null;   // set once, permanently, when Tera fires
  ability: AbilityId;        // exactly one, from species.abilities {0,1,H,S}
  item: ItemId | null;       // destroyed on capture; never looted
  slots: [MoveSlot, MoveSlot, MoveSlot, MoveSlot];
  boost: 0|1|2|3;            // decaying buff  (from moves, abilities, items)
  wound: 0|1|2|3;            // permanent damage; a 4th wound is a KO
  status: Status;            // NONE|SLP|PAR|PSN|TOX|BRN|FRZ
  statusTurns: number;       // deterministic countdowns only
  volatiles: number;         // bitset over 24 board-relevant marks (trapped, ingrain, substitute, …)
  itemWardIntact: boolean;   // Air Balloon-class one-shots ONLY
  hasMoved: boolean;         // castling / pawn double step
  earnedBonusThisTurn: boolean;
  alive: boolean;
}
interface MoveSlot { move: MoveId; charges: 0|1|2|3|4|5; disabledFor: number; }

const vigour = (p: Piece) => p.boost - p.wound;      // −3 … +3, the one number the UI shows
const pristine = (p: Piece) => p.wound === 0;        // the "at full HP" ability family
const wounded  = (p: Piece) => p.wound >= 2;         // the "in a pinch" ability family
```

There is **no HP**. Capture is binary. `wound` is a four-state kill clock for *indirect* damage (status,
hazards, recoil, thorns, weather) and it is what makes poison, Stealth Rock and Perish Song mean something
without an HP bar. Both counters are drawn as pips: green for `boost`, red for `wound`.

### 5.2 The four moves, and the coverage quota

Movesets are auto-generated at draft time from the **all-gens prevo-chain learnset union** (recon-moves §6.1:
median 79 candidates, p10 48, max 375 — re-measured identical **[CF]**), scored, and filled against **two**
quotas. recon-moves specified a *shape* quota; I add a **type-coverage** quota, and that single change is what
produces the numbers in §0.

```
score(species, move) =
  +30 if move.type ∈ species.types                        # STAB
  +20 if (Physical and atk >= spa) or (Special and spa > atk) else −10
  +min(30, (basePower || 60)/4)
  +rarity(move)          # +45 for 1 learner … −10 for >150 learners; learner counts come free from learnsets
  + 8 if priority > 0
  + 6 if shape ∈ {RAY_LOS, RAY_ANY}                       # ranged
  + 6 if shape ∈ {RING_FOES, RING_ALL}                    # area
  − 8 if accuracy < 80
  −15 if flags.recharge || flags.pledgecombo              # recon-moves' measured fix (no more Blast Burn Charizard)
  −60 if isJunkStatus(move)                               # NEW [CF]: a Status move with no structured payload at all

slot 1: best MELEE damaging move — SKIPPED if its score is negative (recon-moves' Blissey fix)
slot 2: best ranged/area damaging move
slot 3: NEW — best damaging move of a type NOT already present   ← the coverage quota
slot 4: best Status move with a real payload
(fill any unfilled slot with the best remaining candidate; then the type-kit floor, below)

isJunkStatus(m) = category==='Status' && !status && !volatileStatus && !boosts && !self.boosts
                  && !sideCondition && !weather && !terrain && !pseudoWeather && !slotCondition
                  && !heal && !flags.heal && !forceSwitch && !selfSwitch && !callsMove
```

Measured outcome over all 1025 admitted base formes **[CF]**:

- **525 distinct moves** appear in auto-kits (recon-moves measured 488 with the shape-only picker over 876
  gen-9 species; the coverage quota raises both the count and the variety).
- Shape mix of the 4,091 picked slots: **MELEE 1,919 (47%)**, RAY_LOS 444, RING_FOES 433, SELF 397,
  RING_ALL 352, OTHER 298, RAY_ANY 248. **53% of what is on the board is not a plain step-in capture.**
- Only **4 species** fail to fill 4 slots, so the **type-kit floor** (18 types × 6 curated move ids = 108
  entries, recon-moves §6.1) is needed for exactly those 4 plus the forme stubs — it stays in the spec
  because Ditto (1 move) and Unown (1 move) must be playable.
- `isJunkStatus` is what removes the picker's embarrassments: Charizard no longer takes *Hold Hands* and
  Magikarp no longer takes *Happy Hour* **[CF]**.

Real generated kits, verbatim from the probe **[CF]** (these are the kits used in the worked example, §17):

| Species | Declared type options | Auto-kit |
|---|---|---|
| Skarmory | Steel / Flying | Steel Wing·Steel │ Brave Bird·Flying │ **Drill Run·Ground** │ Autotomize·Steel |
| Ferrothorn | Grass / Steel | Power Whip·Grass │ Gyro Ball·Steel │ **Explosion·Normal** │ Ingrain·Grass |
| Garchomp | Dragon / Ground | Dragon Rush·Dragon │ Breaking Swipe·Dragon │ **Earthquake·Ground** │ Dragon Cheer·Dragon |
| Charizard | Fire / Flying | Overheat·Fire │ Hurricane·Flying │ **Dragon Pulse·Dragon** │ Roost·Flying |
| Gengar | Ghost / Poison | Clear Smog·Poison │ Sludge Wave·Poison │ **Hex·Ghost** │ Poison Gas·Poison |
| Lapras | Water / Ice | Ice Shard·Ice │ Sparkling Aria·Water │ **Megahorn·Bug** │ Life Dew·Water |
| Blissey | Normal | Tri Attack·Normal │ Hyper Voice·Normal │ **Mud Bomb·Ground** │ Soft-Boiled·Normal |
| Pikachu | Electric | Volt Tackle·Electric │ Fly·Flying │ **Heart Stamp·Psychic** │ Charge·Electric |
| Magikarp | Water | Hydro Pump·Water │ Bounce·Flying │ **Flail·Normal** │ Tackle·Normal |

The bolded slot is the coverage pick. Note what it buys competitively: **Skarmory, a Steel/Flying wall,
carries the answer to Steel's own worst matchup**; Blissey, which cannot hit anything super-effectively with
Normal moves, gets Mud Bomb; Lapras gets Megahorn for Psychic and Dark walls.

**Player control** (recon-moves §6.4, adopted): the draft shows the auto-kit; **one slot is swappable** from a
shortlist of the 8 best alternatives *by the same score*, filtered to a different shape than the slot it
replaces. An "Advanced" toggle exposes the full union (median 79). Legality is **baked** — the bundle ships
`species → uint16[]`, so there is no runtime validation surface and no way to smuggle an illegal move into a
rated game.

### 5.3 Charges, and Struggle

`charges = clamp(round(pp / 5), 1, 5)` (recon-moves §2.5). Distribution over gen-9: 131 moves at 1 charge,
237 at 2, 124 at 3, 120 at 4, 73 at 5. A piece therefore has roughly **12 move-uses for the whole game**, and
that is a hard, data-derived scarcity that no rule needs to invent.

Charges do **not** regenerate (Leppa Berry is the one exception, and it is in the item pool).

**A piece with zero charges may still capture, using Struggle.** Struggle is typeless (in canon it ignores
the type chart entirely — Showdown implements the typelessness in the engine, not the data; `Dex` reports it
as Normal/50 BP with `pp: 1` **[CF]**), so on the board:

> **Struggle.** Always available. Resolves as **NEUTRAL** against every defender, ignores type immunity, has
> FORCE = −1 (no STAB, tier 2), grants no bonus move, and the attacker takes **+1 wound**.

This is why no piece can ever become unable to act, which matters because "no legal action ⇒ you lose"
(§7.4). It is also a real punishment for burning charges, which is what makes the 12-use budget a resource.

## 6. The turn loop

```
TURN (side S, turn number T):
  ── 6.1 TURN START ─────────────────────────────────────────────────────────
  reveal Forecast[T+2]                        # the window is always exactly 3 turns wide, public
  charged := Forecast[T]                      # one TypeId; moves of this type resolve one step higher
  decrement all durations (screens, weather, terrain, pseudo, status counters, disabled slots)
  fire scheduled effects due at T             # Future Sight, Doom Desire, Wish, Perish Song
  S.boost -= 1 on every piece of S with boost > 0        # buffs decay on your own turn
  chainLeft := 2 ;  bonusPieces := {} ;  subMove := 0

  ── 6.2 SUB-MOVE LOOP ──────────────────────────────────────────────────────
  loop:
    A := generate(state)                      # THE one legality predicate; §6.3
    if A is empty                     -> S LOSES (shogi convention)
    a := (S chooses one action from A)
    (state, events) := apply(state, a)
    subMove += 1
    if a was a capture that resolved ADVANTAGE or ROUT
       and chainLeft > 0
       and the acting piece has not already earned a bonus this turn
       and the enemy King is NOT capturable after this sub-move        # T3, §7
       then grant a bonus sub-move: chainLeft -= 1 ; actingPiece.earnedBonusThisTurn := true
            the player may play it or play DeclineBonus (the bonus is OPTIONAL)
       else break
    if subMove == 3 -> break                                          # T1: hard cap
    if the enemy King is capturable -> break                           # T3: exposure ends the turn

  ── 6.3 TURN END ───────────────────────────────────────────────────────────
  end-of-turn ticks, in this fixed order:
    1. weather chip        (sand/hail on non-immune pieces of S)
    2. status chip         (BRN −1, PSN −1, TOX −1 and −2 on alternate turns)
    3. item upkeep         (Leftovers +heal, Black Sludge, Life Orb already paid per capture)
    4. ability upkeep      (Rain Dish, Ice Body, Poison Heal, Bad Dreams)
    5. leech / ingrain / aqua ring
    6. KO resolution       # any piece whose wound would exceed 3 is removed here, in piece-id order
    7. promotion check     # a pawn standing on the last rank promotes now (§9.1)
  clear earnedBonusThisTurn ; T += 1 ; side flips
```

**Where do Pokémon moves fit relative to chess moves?** A move *is* a sub-move. Every sub-move is exactly one
of: a free positional move, a capture (which spends a move and a charge), a ranged strike, an area attack, a
tactic (status/support), a castle, or a transformation. **Using a Pokémon move costs your chess action** —
which is what keeps the turn budget honest and the action space small.

### 6.4 The action space

```ts
type Action =
  | { k:'MOVE',    from: Sq, to: Sq }                          // ordinary chess move, no charge, no move used
  | { k:'CAPTURE', from: Sq, to: Sq, slot: 0|1|2|3 }           // step-in capture with a declared move
  | { k:'STRIKE',  from: Sq, to: Sq, slot: 0|1|2|3 }           // ranged capture; attacker does NOT move
  | { k:'AREA',    from: Sq,          slot: 0|1|2|3 }          // RING_FOES / RING_ALL; attacker does NOT move
  | { k:'TACTIC',  from: Sq, slot: 0|1|2|3, target?: Sq }      // Status move; attacker does NOT move
  | { k:'CASTLE',  side: 'K'|'Q' }
  | { k:'TERA',    at: Sq, type: TypeId }                      // once per side per game
  | { k:'PROMOTE', at: Sq, branch: SpeciesId, type: TypeId, ability: AbilityId }   // only at promotion
  | { k:'DECLINE_BONUS' }
```

Branching factor, from recon-tech §B.2 (30.9 legal moves, 3.27 captures available per position) plus the slot
dimension: mean actions ≈ **30.9 + 3.27 × ~2.4 ≈ 41**, still chess-like, still alpha-beta's home territory.
§14 gives the dominated-slot pruning that removes most of the added width.

### 6.5 Geometry: where a move can reach

Shapes are derived from `target` + ranged flags exactly as recon-moves §2.2 specifies. The one thing recon-moves
left open is how a ranged shape interacts with chess geometry, and the answer has to be tight or Rifle Chess's
warning bites ("it is of no use to guard pieces"):

> **A ranged action may only target squares along directions in which the piece can already capture.**

| Shape | n (gen-9) | Board rule |
|---|---|---|
| `MELEE` | 432 | Ordinary step-in capture. The default; 47% of picked slots. |
| `RAY_LOS` | 37 | STRIKE the **first occupied square** at Chebyshev distance ≤ 2 along one of the piece's own capture directions. Blockers matter. Attacker does not move. |
| `RAY_ANY` | 21 | Same, distance ≤ 3, **blockers ignored** ("it flies or beams over them" — 15 of 21 are Flying-type). |
| `RING_FOES` | 48 | AREA against every **enemy** piece on the 8 adjacent squares. |
| `RING_ALL` | 15 | AREA against every piece on the 8 adjacent squares **including your own**. Earthquake, Surf, Explosion. Do not water this down. |
| `ENEMY_ZONE` | 4 | Paint hazard layers on 3 squares of the enemy's third rank (own file ± 1, mirrored). |
| `SELF`/`OWN_ARMY`/`BOARD`/`ALLY` | 80/11/18/9 | Self-buff, screens, weather/terrain/global, ally support. |
| `RANDOM_FOE` | 6 | Lock-in: 2–3 turns of forced auto-captures on a PRNG-chosen adjacent enemy, then self-confusion. |
| `REACTIVE` | 4 | Sets a 1-turn reaction flag (Counter/Mirror Coat/Metal Burst/Comeuppance). |

**Knights and kings have no rays.** For them, `RAY_LOS`/`RAY_ANY` become **strike-and-stay**: the piece may
resolve the capture on any square it could normally leap to, without moving there. A knight with Air Slash
strikes a square and keeps its outpost. This is the cleanest reading and it is a genuinely good chess idea.

Bounds that keep ranged capture from destroying protection:
1. Ranged actions exist only if the drafted kit contains a ranged move — measured **17% of picked slots**
   (RAY_LOS 444 + RAY_ANY 248 of 4,091) **[CF]**, i.e. roughly 1 piece in 3 has one.
2. A ranged capture **cannot promote a pawn** (the pawn does not advance) and cannot castle.
3. An `AREA` action grants **at most one** bonus sub-move no matter how many pieces it removes.

## 7. Capture resolution — the Clash

This is the centre of the game, and it is **fully deterministic given public information**, except for
accuracy on moves the player chose to draft and use.

### 7.1 The pipeline

```
CLASH(attacker A, defender D, move m, charged: TypeId | null) :
 1. LEGALITY   (evaluated during move generation, never at resolution time)
      chartStep = STEP[m.type][D.declaredType]           // −2 | −1 | 0 | +1
      if chartStep === −2 (i.e. 0x)  and no piercer applies  -> ILLEGAL, not generated
      ability WARDs on D (Levitate vs Ground, Flash Fire vs Fire, …) -> ILLEGAL unless A pierces
      item wards on D (Air Balloon)  -> ILLEGAL, and the FIRST attempt pops the balloon (see §7.5)
      BIND / Damp / Dazzling-class legality hooks
      SUICIDE GUARD (R3): illegal if the deterministic part of resolution necessarily removes A's own King
      D is a KING: chartStep of −2 is raised to −1  (R6: kings are never immune)
 2. ACCURACY   if m.accuracy is a number < 100 (or D has evasion):
                  roll d100 from the seeded PRNG.  On failure -> MISS (§7.3). 531 of 685 gen-9 moves
                  (accuracy true or 100) can NEVER miss [CF: census 169 true + 362 at 100].
 3. FORCE      an integer, all terms public and shown before the click:
      FORCE = (powerTier(m) − 3)                         // tier 1..5 from basePower; 3 for the 28 variable-BP moves
            + (m.type === A.declaredType ? +1 : 0)       // STAB
            + vigour(A) − vigour(D)                      // boost − wound, each side
            + fieldTerm(m, weather, terrain)             // ±1 (Rain/Water, Sun/Fire, terrains)
            + Σ abilityAtk(A) − Σ abilityDef(D)          // EDGE / BULWARK hooks, ±1 or ±2 each
            + Σ itemAtk(A)    − Σ itemDef(D)
            − (D's side has a matching screen ? 1 : 0)   // Reflect / Light Screen / Aurora Veil
 4. STEP       step = chartStep
            + (m.type === charged ? +1 : 0)              // the Forecast
            + (FORCE >= +3 ? +1 : 0)                     // OVERWHELM
            + Σ abilityStep hooks                        // Filter −1 on incoming SE; Tinted Lens resist→neutral; …
            clamp(step, −2, +2)
      if FORCE <= −3  -> REPELLED  (overrides step)
 5. OUTCOME    the table in §7.2
 6. RIDERS     on any outcome where D was removed: secondary effects roll their `chance` from the PRNG
               (status 39 kinds, stat drops 34, flinch 12 …). Riders never change who dies.
 7. AFTERMATH  drain / recoil / withdrawal / thorns / on-faint abilities / item consumption / Life Orb wound
               / hazard triggers if a piece ended a sub-move on a hazard square
```

### 7.2 Every effectiveness case, exhaustively

| step | Name | What happens |
|---|---|---|
| **−2** | **NO EFFECT** | The action is **never generated**. On piece pickup the square shows a dashed grey ring and a `NO EFFECT` tooltip naming the reason (type / Levitate / Air Balloon). Clicking it plays a 60 ms shake and changes nothing. **Immunity is never a surprise** — pre-emptive feedback, per recon-tech §A.7.4. |
| **−1** | **BACKLASH** | **Both pieces are removed.** Deterministic mutual destruction, from the type chart only, never from a die. This is Kamikaze Chess (Laws, 1928) and Stratego's equal-rank rule. A charge is spent. No bonus move. |
| **0** | **TRADE** | Defender removed. Attacker occupies the square (`CAPTURE`) or stays (`STRIKE`/`AREA`). A charge is spent. No bonus move. |
| **+1** | **ADVANTAGE** | Defender removed, attacker occupies/stays, and the side gains **one bonus sub-move** (optional, subject to T1/T2/T3). |
| **+2** | **ROUT** | As ADVANTAGE, plus the attacker gains **+1 boost** (momentum). Only reachable by upgrading a super-effective hit (Charged, or OVERWHELM, or Neuroforce). |
| — | **REPELLED** (FORCE ≤ −3) | Nothing dies. Attacker stays. Charge spent, sub-move spent, turn ends. "Your attack was not strong enough." |
| — | **MISS** (accuracy) | Identical to REPELLED. Only possible with a sub-100-accuracy move or against an evasion effect (capped at +2 stages, recon-moves §5). |

Three properties of this table that a competitive player will care about:

1. **Nothing in it is decided by a die.** The only randomness is step 2, and 531 of 685 moves cannot fail it.
2. **`REPELLED` and `OVERWHELM` are the whole ability/item/boost layer's teeth.** A piece behind Reflect with
   Iron Defense up (+2 boost) repels a tier-1 attack (FORCE = −2 +0 −2 −1 = −5). A Swords Dance Garchomp
   (boost +2) hitting with a tier-4 STAB move overwhelms (FORCE = +1 +1 +2 = +4) and turns a neutral capture
   into a free move. Both are legible integers on screen before you commit.
3. **BACKLASH is a chosen tactic, not a tax.** With coverage kits it is only forced on **3.6%** of matchups
   **[CF]**; the rest of the time you self-destruct because you *decided* to trade a pawn for a queen. That is
   recon-variants' verdict (§5.2f: "keep it, and make it deterministic") with a measured 5.2× reduction in how
   often it is involuntary.

### 7.3 Worked FORCE examples

| Situation | FORCE arithmetic | step | Outcome |
|---|---|---|---|
| Skarmory (Steel) hits an Electric pawn with Steel Wing (tier 2, STAB) | (2−3)+1+0 = **0** | Steel→Electric = 0 | TRADE |
| Same, but Steel is Charged this turn | **0** | 0 +1 | **ADVANTAGE**, bonus move |
| Garchomp (Dragon) hits a Steel rook with Earthquake (tier 4, no STAB) | (4−3)+0+0 = **+1** | Ground→Steel = +1 | ADVANTAGE |
| Same, Garchomp at boost +2 | **+3** ⇒ OVERWHELM | +1 +1 = +2 | **ROUT** |
| Magikarp (Water) hits a Grass bishop with Tackle (tier 1, no STAB) | (1−3)+0+0 = **−2** | Normal→Grass = 0 | TRADE (a real capture — Magikarp matters) |
| Same, into a bishop with Iron Defense (+2) behind Light Screen | −2 −2 −1 = **−5** | — | **REPELLED** |
| Gengar (Ghost) hits a Normal rook with Hex (tier 3, STAB) | (3−3)+1 = **+1** | Ghost→Normal = **−2** | **NO EFFECT** — not generated. Gengar must use Sludge Wave (Poison→Normal = 0, TRADE) |

That last row is the game in one line: the type-literate player knows Gengar's Ghost move is dead against a
Normal piece and its Poison move is not, and the type-blind player clicks the biggest number.

### 7.4 Area, hazards, field, status, and the indirect kill channel

- **AREA** resolves an independent Clash against each occupant of the 8 adjacent squares, in a fixed
  (rank, file) order, with per-target immunity honoured. Earthquake genuinely does not hit a Flying or
  Levitating piece. Grants ≤ 1 bonus sub-move total. `RING_ALL` hits your own pieces, and a `RING_ALL` action
  that would necessarily remove your own King is illegal (R3).
- **Hazards** (Spikes, Toxic Spikes, Stealth Rock, Sticky Web) sit on squares with real layer counts from the
  data (3/2/1/1) and fire when an enemy piece **ends a sub-move** on the square: Spikes **+1 wound** (Flying
  and Levitate immune — faithful), Toxic Spikes **poison** (Steel/Poison immune), Stealth Rock **+1 wound, +2
  if Rock is super-effective against that piece's declared type**, Sticky Web **halves that piece's range on
  its next turn**. Cleared by Defog / Rapid Spin / Court Change; Heavy-Duty Boots ignores them.
- **Weather / terrain / pseudo-weather** are global, `condition.duration` turns long (max in the whole
  dataset = **5**, verified **[CF]**), and modify FORCE ±1 for matching types, `STRIDE` movement, and chip.
- **Status** (deterministic per D7): SLP 2 turns, cannot act, wakes early if hit, **Sleep Clause**; FRZ ≤ 2
  turns, cannot act, thawed by any Fire-type capture or a `thawsTarget` move, **Freeze Clause**; PAR halves
  range (sliders capped at 2), never fizzles; BRN −1 FORCE on contact captures and +1 wound per own turn;
  PSN +1 wound per own turn; TOX +1 wound, +2 on alternate turns. Read **both** `move.status` and
  `move.secondary/secondaries[].status` — recon-moves' warning: 119 of 132 status applications are secondaries,
  and every one of gen-9's 13 freeze applications is a secondary.
- **The indirect kill channel.** A 4th wound is a KO, resolved at turn end in piece-id order. From full health
  a poisoned piece dies in 4 of its own turns; a toxic piece in 3. This is what stops a "wall behind a wall"
  from being a win condition and what makes hazard/status play a real archetype rather than flavour.

### 7.5 Wards: which are permanent and which pop (D4)

| Ward source | n species / items | Permanent? | Counter |
|---|---|---|---|
| Type chart 0× | 8 ordered pairs (2.5%) | **Permanent** | a coverage move, Ring Target, Smack Down/Thousand Arrows (grounds), Gravity, Soak, Tera, Scrappy/Mind's Eye |
| `WARD/elemental` abilities (Levitate 42, Lightning Rod 35, Water Absorb 29, Flash Fire 29 …) | 190 species (13.9%) carry one | **Permanent** — `DIRECTION.md` names this as the model of a good mechanic | Mold Breaker / Teravolt / Turboblaze / Unseen Fist (the 84-member `flags.breakable` set), Ring Target, coverage, status (which ignores immunity) |
| `WARD/absolute` — Wonder Guard (Shedinja, 1 species) | 1 | **Permanent**, but every hazard, status tick, weather, thorn and Struggle kills it (Shedinja has no Magic Guard) | it dies to the indirect channel, which is exactly how Shedinja dies in the real game |
| Air Balloon, Focus Sash, Sturdy, Disguise, Ice Face, Multiscale, Shadow Shield, Focus Band | 8 primitives | **One-shot**, because that is their canon text | attack it twice |

**The bound is key supply, not a blanket nerf.** Three things make it hold, and two of them are measured:

1. **Coverage.** Only **0.37%** of (species, defender-type) pairs leave an attacker with no legal capture at
   all **[CF]** — down from 2.47%. The average piece can hit **5.72 of 18** defensive types super-effectively.
2. **Status ignores immunity, from the data.** **213 of 214** gen-9 Status moves set `ignoreImmunity`
   **[CF]**. The single exception is **Thunder Wave**, which canonically cannot paralyse a Ground type — the
   dataset encodes the exception for us. So an "untouchable" Flying rook can still be Taunted, Disabled,
   trapped, Leech Seeded, Sticky Webbed, **Smacked Down** (Ground immunity removed) or **Soaked** (turned into
   a Water piece). Immunity means *you cannot capture it*, never *you cannot beat it*.
3. **Draft validators** (§12.5): every side must finish the draft holding at least one immunity breaker.
   Stratego's rule — always supply the key, and over-supply it.

Instrumentation instead of a guess: the batch simulator (§19.7) reports **`P(a piece is uncapturable by every
enemy piece for ≥ 20 consecutive turns)`**. If that exceeds **5%** of games, we enable recon-variants' graceful
degradation (0× becomes "graze": the capture fails, nobody dies, the attacker does not move) as a format flag.
That is a measured trigger, not an opinion.

## 8. The Forecast — the entire randomness budget

```ts
// Generated once at game start from the match seed. Server-authoritative. Revealed 3 turns wide.
forecast: TypeId[]              // forecast[T] = the Charged type on turn T
visible(T) = [forecast[T], forecast[T+1], forecast[T+2]]
```

On turn `T`, **moves of type `forecast[T]` resolve one ladder step higher** (§7.1 step 4). Nothing else.

- It is **public**, **symmetric** (both players see the same three-turn window, including the entries that
  fall on the opponent's turns) and **three turns early**, so it is a *plannable constraint*, not a gift.
- It is **the only source of variance that is not attached to a choice the player made.** σ contribution is
  small by construction: one type of eighteen, one step, known in advance by both sides.
- Flavour and canon: this is weather/terrain energy — Electric Terrain boosting Electric moves is exactly
  "+1 step for one type", and the TCG's public, countable information (prize count, deck order revealed by
  effects) is the precedent for "randomness you can see coming". Framed in-game as **"the field is charged
  with ⚡ Electric on turn 12"**, with the charged pieces' auras changing colour on the board.

**The complete RNG inventory of this game**, with nothing hidden:

| Source | When rolled | Can it change who dies? | Opt-in? |
|---|---|---|---|
| **Forecast** | at game start, revealed 3 turns early | yes (one step) | no — but it is public and symmetric |
| Accuracy (154 of 685 moves) | at resolution | yes (MISS) | **yes** — you drafted the move and chose to use it; 531 moves cannot miss |
| Secondary riders (170 moves) | at resolution | **no** — riders apply after the outcome | yes |
| `RANDOM_FOE` lock-in (6 moves) | at resolution | yes | yes, and it is 6 moves |
| `callsMove` (Metronome class, 11) | at resolution, depth-capped, from a restricted pool | yes | yes |
| Quick Claw (20%), Focus Band (1/6), Loaded Dice | at resolution | yes | **yes** — one item slot |
| Pool generation, promotion branch offers, Gym-Leader armies | pre-game | n/a | n/a |
| **Anything else** | — | — | **there is nothing else. There is no capture die.** |

Variance budget, against recon-variants §6.2's targets:

| Component | σ (pawns/game) | Share of Var(M) | Note |
|---|---|---|---|
| Chess strength (300 Elo spread) | ≈4.3 | ≈47% | it must still be chess |
| Type knowledge | ≈4.5 population sd (max edge ≈10) | ≈45% | measured 0.572 pawns/capture **[CF]** |
| RNG (Forecast + opt-in) | **≈1.0–1.5** | **≈8%** | vs **≈5.5** under the video's rules |

I am **deliberately below** recon-variants' 20% RNG target, and I hand the dial to the players instead of
setting it globally: a player who wants swing drafts Quick Claw, Focus Band, Zap Cannon (50% accuracy, huge
tier), Fissure and Sheer Cold. **Variance is a drafted resource.** If ladder telemetry shows upsets are too
rare (measured as the Glicko-2 win-probability calibration curve being too steep), the knob to turn first is
recon-variants' real master dial — **game length** — not the dice.

## 9. Transformations, promotion and once-per-game budgets

### 9.1 Promotion is evolution

A pawn that ends a sub-move on the last rank **must promote, immediately, at turn end**:

1. It evolves to the **terminal forme of its chosen branch**. **44 of the 450 pawn candidates have branching
   lines** **[CF]** (Eevee's nine, Wurmple, Tyrogue, Applin…) — those present a choice; the rest are forced.
2. Its class becomes `classOf(evolvedForme)`, with a **floor of Knight** (chess requires a real piece).
   Measured promotion payoff over the 450 pawn candidates **[CF]**: **144 → Queen-class, 118 → Knight,
   104 → Bishop, 82 → Rook, 2 → King-class (demoted to Queen: there is only one king)**.
3. It **re-declares its type** from the evolved forme's `types[]`, picks an ability from the evolved forme's
   slots, keeps its item, keeps its `wound`, and its **kit is re-derived for the new species with charges
   refreshed** (the moveset is genuinely different, so the charges are genuinely new).
4. If the evolved forme has a Mega forme and the side drafted the matching `megaStone`, promotion **may** go
   straight to the Mega forme instead (48 real Mega formes + 2 Primal, 47 stones, all `Past`, all in the
   data — `Rayquaza-Mega` correctly needs no stone). Once per side per game.

This is the deepest draft axis in the game and it costs nothing to build: **a pawn's promotion is drafted**.
Per-type Queen-class promotion supply **[CF]**: Dragon 21 of 24, Grass 21 of 63, Normal 19 of 61, Water 16 of
69, Fighting 13, Flying 13 … Bug and Rock only 5 each. A Magikarp pawn is a Gyarados threat; a Caterpie pawn
is a Butterfree (Bishop). **The eighth rank is a different prize for different pawns**, and pricing it is §11.2.

### 9.2 Terastallization — the flagship

Adopted from recon-abilities §5.1, which is right that this is the mechanic that lands on our central axis.

> **Tera.** Once per side per game, on your turn, as a whole sub-move (the piece does not move): a piece
> permanently changes its declared type to **any type it could have declared at draft** (its species' other
> real types) **or** to the type of one of its four moves. Public. The board aura changes colour.

Cost: a sub-move. It cannot be used to escape a capture threat for free, and because the enemy sees your kit
it is a *read*, not a surprise. Competitively it is the answer to "I got countered at draft": one piece can be
rescued, once, and the opponent gets to watch you spend a tempo doing it.

### 9.3 Burst, and the transformation budget

recon-abilities' Burst (a Z-Move reskin: once per game, auto-resolve a capture as ROUT ignoring wards) is
adopted **as the alternative to Tera, not in addition**:

> **One transformation per side per game: Tera *or* Burst.** Mega promotion is separate and is paid for by
> reaching the eighth rank.

Two once-per-game budgets are a legibility disaster and a bookkeeping tax; one sharp choice is a good
decision. **Dynamax/Gigantamax is cut** for recon-abilities' three reasons (it is an HP mechanic, we have no
HP; G-Max moves are already covered by the move layer; 41 of 1025 species is a draft trap). The 34 Gmax
sprites are kept as promotion art.

## 10. King, win conditions, draws, termination

### 10.1 The king model (R1–R7, adopted from recon-variants §5)

> **R1 — Win condition.** A player wins the instant the opposing King leaves the board, by any means.
> There is no checkmate terminal state.
> **R2 — No check-legality.** A move that leaves your own King capturable is legal. A King may move to an
> attacked square and may castle out of, through and into attack.
> **R3 — Suicide guard.** A move is **illegal** iff the *deterministic* part of resolution necessarily
> removes your own King. A move that only *risks* it is legal, and the UI must show the exact probability
> before the click. (Atomic rule 5, extended for our accuracy rolls.)
> **R4 — Simultaneous royal death.** If one resolution removes both Kings, **the mover wins.** Deaths apply
> defender-first and the game ends the moment a King leaves the board.
> **R5 — Exposure ends the turn (T3).** If after any sub-move the enemy King is capturable by any of your
> pieces, your turn ends immediately and remaining bonus sub-moves are forfeit.
> **R6 — Kings are never immune.** A King's declared type is used for its own attacks and for the multiplier
> when it is captured, but 0× against a King degrades to BACKLASH (−1).
> **R7 — Check is advice, not law.** A persistent banner names every piece that can capture your King, with
> which move, at what FORCE, and with what probability.

Why not keep checkmate: because under any randomness the post-move position is a random variable, so "must not
leave your King in check" is not a well-formed predicate. Every variant where check is hard to compute — Fog
of War, Duck Chess, Losing Chess, single-die Dice Chess, ICC Atomic — made the same switch. **R5 is what makes
it safe**: the King can only ever be taken by the *first* sub-move of a turn, from an exposure that was
already on the board when the turn began, so the opponent always gets a reply.

Cost, stated honestly: stalemate disappears as a drawing resource and basic endgame theory shifts (on ICC's
no-check Atomic, K+R vs K becomes a forced win where it is a book draw). Mitigations: R7's banner, and
**Guarded mode** — a *filter over `generate()`'s output* (never a second generator) that hides moves leaving
your King capturable with probability ≥ p. Default **on** in casual and tutorial, **off** in every rated game.

### 10.2 Draws and adjudication

| Rule | Detail |
|---|---|
| **Threefold repetition** | On the full state hash: placement, side, castling, ep, per-piece (type, boost, wound, status, charges, volatiles), hazards, field, side conditions, `chainLeft`, **and the currently Charged type** — but **NOT the PRNG counter and NOT the turn index**. Including the PRNG counter makes repetition unreachable by construction (recon-variants §4.3). |
| **Progress rule** | **100 consecutive sub-moves with no progress ⇒ draw.** Progress = a capture, a KO by any means, a pawn advance, a promotion, a hazard layer added, a **new lifetime-minimum `wound` for any piece**, or a Tera/Burst. The lifetime-minimum clause is the important one: it is monotone, so heal/status loops cannot farm it. |
| **Perpetual exposure** | Repeatedly exposing the enemy King in a cycle ⇒ **the exposing player loses** (shogi). Closes the "chase forever with bonus-move tempo" degeneracy. |
| **No legal action** | That player **loses** (shogi/xiangqi; Really Bad Chess). Reachable only through total immobility, since Struggle guarantees an action whenever any capture geometry exists. |
| **Both Kings removed at once** | Mover wins (R4). |
| **Both sides reduced to lone Kings** | Draw (Archon's precedent). |
| **Tournament adjudication (format flag, default OFF)** | At the progress-clock expiry, compare **Army Score** = Σ V(piece) (§11.1); if the difference ≥ 3.0 pawns the leader wins, else draw. Shogi's *jishōgi* count, adapted. Turn it on only if the measured ladder draw rate exceeds **12%**. |

### 10.3 Termination — the proof

**Claim 1 (a turn is bounded).** A bonus sub-move is granted only by a capture that resolved ADVANTAGE or
ROUT, and every such capture strictly decreases the enemy piece count. Therefore a chain of length `L`
requires `L − 1` captures, so `L ≤ 1 + N ≤ 17`. We additionally cap `L ≤ 3` (T1) and grant at most one bonus
per piece per turn (D5). ∎

**Claim 2 (no rule adds a bonus without a capture).** Audited against every content layer: the only sources of
an extra sub-move in the entire design are ADVANTAGE, ROUT, `EDGE/double-strike` (Parental Bond — a
**non-capturing** move only), `STRIDE/mirror` (Dancer — non-capturing only) and `STRIDE/priority` (Gale
Wings/Prankster/Triage — **once per game per side**). recon-abilities §6's termination note reaches the same
conclusion independently. ∎

**Claim 3 (no rule adds pieces).** Promotion transforms; Substitute creates a *mark*, not a piece; Revival
Blessing is **once per side per game** and only to the piece's original starting square if empty. `N` is
non-increasing except for that single bounded event. ∎

**Claim 4 (the game is bounded).** Progress events are finite: captures ≤ 30, pawn advances ≤ 96 (16 pawns ×
6 steps), promotions ≤ 16, hazard layers ≤ 14, lifetime-minimum wound events ≤ 32 × 3 = 96, Tera/Burst ≤ 2,
Revival ≤ 2 — total **P ≤ 256**. Between any two progress events at most 100 sub-moves may pass. Therefore
**a game lasts at most (256 + 1) × 100 = 25,700 sub-moves**, and threefold repetition will end almost every
game long before that. ∎

**Claim 5 (the scheduler is bounded).** Delayed effects come only from `condition.duration`, whose **maximum
value in the entire dataset is 5** (verified **[CF]**), with at most one pending entry per (side, kind).
Horizon ≤ 5 turns, queue size O(1). ∎

**Claim 6 (recursion is bounded).** `RESOLUTION_DEPTH = 1`. The 11 `callsMove` moves sample from the caller's
own derived kits minus all `callsMove` and all `selfdestruct` moves, using the seeded PRNG. Metronome is
therefore deterministic and replayable. ∎

---

# PART II — CONTENT AT SCALE

## 10A. Content coverage: 950 moves, 310 abilities, 583 items

### 10A.1 The inclusion policy

Adopted verbatim from `recon-data-substrate.md` §1, which supersedes the brief's raw counts. Filtering by
`!isNonstandard` silently deletes 454 real Pokémon including Ferrothorn, Shedinja, Aegislash and Kangaskhan,
and orphans 37 abilities.

| Entity | Admitted | Predicate | Verified |
|---|---|---|---|
| Species formes | **1367** | `num > 0 && isNonstandard ∈ {null, Past, LGPE}` | 1367 formes / **1025 distinct dex numbers** / 1025 base formes **[CF]** |
| Moves | **950** | `isNonstandard ∈ {null, Past, LGPE, Unobtainable, Gigantamax}` | — |
| Abilities | **310** | `isNonstandard ∈ {null}` (drop the `No Ability` sentinel) | zero orphans under the species policy |
| Items | **536 classified / 351 admitted as mechanics** | `isNonstandard ∈ {null, Past, Unobtainable}` | 583/583 classified |

### 10A.2 Moves: where the derived/curated line falls

Adopted from recon-moves, with recon-data-substrate's correction applied to the *effort estimate*.

| Layer | Size | What it is |
|---|---|---|
| **Derived** | **~787 of 950 (83%)** | Pure functions of dex fields → a `MoveEffect` record (shape, payload, selfAfter, power, reach, reliability, initiative, charges, duration). recon-moves' 37-entry ordered decision list classifies **685/685 gen-9 and 954/954 all-gens with zero unclassified**, and the shape × payload cross-tab has only **37 non-empty cells** — you implement 37 combinations, not 950 moves. |
| **Curated tags (data, not code)** | **88 rows** | A `Record<MoveId, Tag>` in 7 families (TRAP 18, VARPOWER 20, VARTYPE 10, STATSWAP 7, ABILITYMOD 7, PHAZE 5, LOCKOUT 7) redirecting a move to a rule that already exists. |
| **Bespoke** | **79 moves in 16 rules (8.3%)** | recon-moves §3's enumerated list: CallsMove, SelfKO, Retaliate, OHKO, TypelessDamage, TypeMutation, PassState, BoardSwap, Delayed, Guard, Hazard, SelfLock, Decoy, ItemDependent, FieldType, Cleanse. |
| **Generic fallback** | total | Damaging → a MELEE capture at tier `basePower \|\| 60` (the `\|\| 60` matters: **28 gen-9 moves have basePower 0** and would silently become unusable). Unrecognised Status → +1 boost on the caster for 2 turns. Legal-and-boring by construction; Splash and Celebrate land here and that is correct. |

**Where I am more honest than recon-moves:** recon-data-substrate §3 measures that **315 of 950 moves (33%)
have behaviour that lives in `@pkmn/sim` handler code**, not in declarative fields, and that `@pkmn/dex`
strips those handlers **without leaving a marker** (Rest appears to inflict nothing; Belly Drum appears
inert). So:

1. The generator reads **`@pkmn/sim`** (build-time devDependency, never shipped) and extracts the **handler
   fingerprint** — the *set* of `on*` names an entry defines — alongside the declarative fields.
2. Every emitted record carries a **`coverage` tag**: `derived-fields | derived-fingerprint | curated-tag |
   bespoke | fallback`.
3. A CI test walks **all 950 / 310 / 583** entries and fails the build if any entry is `fallback` and is not
   on an explicit allow-list. That is the difference between "all content makes sense" as a claim and as a
   test.

Bespoke effort is therefore budgeted at **16 rules + ~90 fingerprint-informed curations**, not 16 rules flat.
I am telling you the curated layer is a few hundred rows because the measurement says so.

### 10A.3 Abilities: 13 archetypes, 115 primitives, 12 hooks

recon-abilities' table is adopted wholesale and is machine-validated (`assigned: 320 of 320, MISSING (0)`),
with **two edits**:

1. **Every "+1 to the Clash die" primitive becomes "+1 FORCE"** (D2). Their MISS band becomes REPELLED, their
   CRIT band becomes OVERWHELM. The 12 hook signatures are unchanged, so the 115 functions are unchanged in
   shape:
   `legality, enter, atk, def, outcome, survive, faint, upkeep, mobility, identity, global, pierce`.
2. **Wards follow canon on permanence** (D4).

Free machine-readable seams, used as specified: `flags.breakable` is **exactly** the 84-ability set that Mold
Breaker ignores (so `pierce` needs no curation), and `cantsuppress`/`notransform`/`notrace`/`noentrain`/
`noreceiver`/`failroleplay`/`failskillswap` give the whole ability-copy legality matrix for free — which is
what stops Trace from laundering a ban (§12.4).

The ability *choice* is cheap: over 1367 admitted formes the slot distribution is **{1: 357, 2: 378, 3: 631,
4: 1}** — a 1-to-4 radio button, never a search box. Abilities are **public**, both sides, always. Hidden
information would force an information-set search on the AI and turn "type knowledge is your edge" into
"memorising hidden state"; `Illusion` is the single sanctioned exception (its piece renders as a decoy until
its first Clash), and `Frisk`/`Forewarn`/`Anticipation` become genuinely useful board-analysis QoL, which is
exactly their flavour.

The balance bounds in recon-abilities §6 are adopted with their numbers: BIND is king-ring-only and may
**never** restrict the enemy King; `FIELD/suppress` (Neutralizing Gas) is king-ring-only; Huge/Pure Power
grant +2 FORCE but can never manufacture an OVERWHELM upgrade; Protean/Libero fire once per game; Speed Boost
caps at +3 and only ticks on non-capturing turns; thorns cap at **−1 total wound per Clash** and never kill
(Aftermath and Innards Out are the two named exceptions, and they only fire when their own piece is already
dead); `survive-once` is strictly one-directional — **"a shield protects you from being killed; it does not
protect you from killing yourself"** — so Focus Sash never converts BACKLASH; Rock Head is the single named
exception; INERT and penalty abilities grant a **draft-budget refund** so Slaking is a bargain rather than a
trap.

### 10A.4 Items: 19 classes, format-scoped admission

583/583 classified (recon-abilities §3); **351 admitted** as mechanics, 232 excluded and **repurposed rather
than deleted** (100 TRs become the signature-move picker's art, 28 Poké Balls become cosmetic ball skins, 35
Z-Crystals become the Burst's 18 type auras + 17 signature animations, 15 fossils become the "Ancient" card
frame, 6 valuables become post-game spoils, 1 Mail becomes the emote channel icon).

**How all 351 reach the board without an inventory screen:** a format declares a **Kit** — an ordered list of
items, one of each per side. The ladder's Standard Kit is recon-abilities' "Standard 12" (Leftovers, Life Orb,
Focus Sash, Rocky Helmet, Choice Scarf, Air Balloon, **Ring Target**, Expert Belt, Eviolite, Sitrus Berry, a
player-chosen resist Berry, Heavy-Duty Boots) — one item per admitted class, so the 12 glyphs teach the 12
classes. **Constructed** (§12.2) opens the full 351 under tiering. New formats swap the Kit wholesale
("Weather Kit", "Signature Kit" — 12 `itemUser`-locked items and you must draft their owners). Nothing is
missing; it is **queued as content**, which is also how a live game keeps a metagame moving.

Items are **public**, **destroyed on capture** (no looting — looting turns every capture into a resource
decision and lets the winner snowball), and theft is confined to Magician/Pickpocket, countered by Sticky
Hold/Ability Shield, with Knock Off/Trick/Thief in the move layer.

54% of items classify from structured fields with zero prose reading (`isPokeball` 28, `megaStone` 93,
`zMove` 35, `isBerry` 77, `isGem` 18, `forcedForme` 62, `isChoice` 3), 71% once you add the `/^TR\d\d$/`
regex, and all 18 resist berries are 100% derived because `naturalGift.type` **is** the resisted type.

### 10A.5 Bundle budget

| Chunk | gz | When |
|---|---|---|
| `dex-index` — columnar 1025 base formes (num, name, types, bst, icon, abilities, evo, class-eligibility) | **17.4 KB** | eager |
| `move-effects` — packed `MoveEffect` × 950 | **~23 KB** | eager |
| `ability-item-effects` — 310 archetype records + shortDescs | **~19 KB** | eager |
| `typechart` | 0.33 KB | eager (statically imported; the AI depends on it being sync) |
| **Critical path** | **≈ 60 KB** | ✅ |
| `species-detail`, prose, `learnsets` (841-id union) | 76.9 + 121 + 75.6 KB | idle / first inspect / behind the Custom-moveset toggle |

Plus vendored art: 32 gen-5 stills per game = **26 KB**, painted in a measured **105 ms**; the 383 KB icon
sheet for grids. Entry chunk gate **110 KB gz** (measured 65.2, of which 59.3 is React).

---

# PART III — THE COMPETITIVE LAYER

## 11. Piece value, and what a piece is worth

### 11.1 The formula

Base class values from Berliner/AlphaZero rather than the folk 1/3/3/5/9: **P 1.0, N 3.2, B 3.3, R 5.0,
Q 9.5, K ∞**.

```
V(piece) = m(class) · ( 1 + β·ARM(declaredType) − α·LIAB(kit) − ε·BLOCK(kit) )
         + τ·BONUS(kit)
         + κ·COVER(kit)
         + ability/item/promotion adders (§11.2)

α = 0.9   β = 0.5   ε = 0.3   τ = 0.5 pawns   κ = 0.25 pawns per super-effective type above the mean
```

The shape is recon-variants §3.2's, and the crucial change is **which terms are properties of the type and
which are properties of the kit**. Under D1, offence belongs to the four moves:

- `ARM(t)` — P(a random enemy piece cannot attack you, or dies doing it) — is a property of your **declared
  type**.
- `LIAB(kit)`, `BLOCK(kit)`, `BONUS(kit)`, `COVER(kit)` are properties of your **moveset**.

**`ARM` measured against all 1,025 real kits** (each kit using its best option), not against single types
**[CF]** — this is a materially different table from recon-variants' and it is the honest one for this ruleset:

| Declared type | BLOCKED | must self-destruct | neutral | grants bonus | **ARM** |
|---|---|---|---|---|---|
| **Steel** | 0.3% | **31.7%** | 34.0% | 34.0% | **32.0%** |
| Poison | 0.3 | 5.6 | 66.3 | 27.8 | 5.9 |
| Fire | 0.3 | 5.2 | 58.2 | 36.3 | 5.5 |
| Rock | 0.3 | 5.1 | 32.7 | **62.0** | 5.4 |
| Ghost | **1.8** | 3.3 | 76.2 | 18.7 | 5.1 |
| Flying | 0.3 | 3.1 | 70.4 | 26.1 | 3.4 |
| Grass | 0.3 | 2.0 | 46.3 | 51.4 | 2.2 |
| Fairy / Water / Dark / Dragon / Bug | 0.3 | 1.2–1.7 | 64–78 | 21–35 | 1.5–2.0 |
| Ground / Fighting / Psychic / Electric | 0.3 | 0.4–0.7 | 61–86 | 14–38 | 0.7–1.0 |
| **Ice / Normal** | 0.3 | **0.0** | 60 / 85 | 39.8 / 14.6 | **0.3** |

Resulting value table (α/β/τ as above, mean kit LIAB 3.6%, mean kit BONUS 31.7%, all measured) **[CF]**:

| Declared type | V(P) | V(N) | V(B) | V(R) | V(Q) |
|---|---|---|---|---|---|
| **Steel** | 1.29 | 3.77 | 3.88 | **5.80** | **10.87** |
| Poison / Fire / Rock / Ghost | 1.15–1.16 | 3.34 | 3.44 | 5.12–5.14 | 9.59–9.63 |
| Flying / Grass / Fairy / Water / Dark / Dragon / Bug | 1.13–1.14 | 3.28–3.31 | 3.38–3.41 | 5.03–5.08 | 9.42–9.51 |
| Ground / Fighting / Psychic / Electric | 1.13 | 3.27 | 3.36–3.37 | 5.01–5.02 | 9.38–9.40 |
| **Ice / Normal** | 1.13 | 3.26 | 3.36 | **5.00** | **9.36** |

### 11.2 The most important consequence: the value spread collapses, on purpose

**recon-variants measured a 1.46× spread between the best and worst type of the same class** (Steel rook 5.61
vs Bug rook 3.85) under single-type offence. Under this design the measured spread is **1.16×** (Steel rook
5.80 vs Normal rook 5.00), and **17 of 18 types sit inside a 1.03× band** **[CF]**.

That is the design working, not the design failing:

- **Type identity no longer prices a piece; type *play* prices a decision.** The 0.572 pawns/capture edge
  (§0) is unchanged. The edge simply moved from an asset you buy to a skill you exercise.
- **Draft-time tier lists lose their teeth.** If Steel-vs-Normal is worth 0.8 pawns on a rook, the draft is a
  price list. If it is worth 0.8 pawns and *every capture in the game is a four-way type decision worth 0.57
  pawns*, the draft is a preface.
- **Steel is the one remaining rationed resource** (32% ARM against real kits, and it is the second-scarcest
  type in the dex at 43 of 733 standard base formes / 65 of 1025 admitted). Explicitly rationed by the pool
  generator: **at most 2 Steel-declarable candidates per pool block, at most 3 Steel declarations per side**.
- **Bug and Grass are no longer traps.** recon-variants found them the worst types overall because each
  self-destructs on 7 of 18 *attacking* matchups. With a coverage kit that liability is 2.0% and 1.2%
  respectively **[CF]**. A Bug piece is now a normal piece that happens to hit Psychic hard.

### 11.3 Point-buy (Constructed only), in quarter-pawns

```
cost(piece) = m(class)                                       # P 1.0 N 3.2 B 3.3 R 5.0 Q 9.5, King free
            + 0.5 · m · ARM(declaredType)                    # the measured table above
            + 0.25 · (COVER(kit) − 5.72) / 1.0               # super-effective types above/below the mean
            + abilityCost(archetype)   ∈ {0, 0.25, 0.5, 0.75, 1.0}
            + itemCost(item, class)    ∈ {0 … 1.0}
            + promoCost(pawn)          = 0.75 if the terminal forme is Queen-class,
                                         0.375 if Bishop/Rook/Knight-class, 0 otherwise
            − 0.25 if the ability is INERT or a STRIDE/penalty (Truant, Slow Start)
  rounded to the nearest 0.25
Budget: 42.00 pawns.  Slot structure is FIXED: 1K, 1Q, 2R, 2B, 2N, 8P.
```

The fixed slot structure is the load-bearing part. **The budget can never buy extra material** — a standard
chess army already costs 40.5 — so it buys typing, ability, item and promotion quality *within* symmetric
material. That is what makes Constructed rateable at all, given Betza's CwDA result (+62% / +19% / −11% /
−71% over 400 engine games after human masters pronounced the armies balanced).

Knightmare Chess's shipped precedent is adopted for skill gaps: **a voluntary handicap** (declare a smaller
budget) is a first-class, displayed option in friendly games.

And the standing warning, restated because it is the single most-ignored lesson in the prior art:
**never trust the sum.** Army value is sub-additive (Muller). The price list is a *usability tool* and a
first-order filter; the real balance mechanism is §12.6's measured tiering plus §19.7's batch simulator.

## 12. The draft

Three formats ship. All three read from a **pool source** — `full-dex` or `collection` — and **the match rules
never learn which**, per `DIRECTION.md`'s hard architectural seam.

### 12.1 Format A — **Ladder Draft** (the ranked default)

The video's own draft, made rigorous. Both players draft from **one shared pool**, so material is symmetric
by construction and there is no army-pairing problem to screen for.

**Pool generation** (deterministic from the public match seed; the seed is shown to both players so any pool
can be reproduced and shared):

```
POOL = 4 King candidates      (from the 76 K-eligible terminals)
     + 4 Queen candidates     (143 Q-eligible)
     + 6 Bishop candidates    (103 B-eligible)
     + 6 Knight candidates    (162 N-eligible)
     + 6 Rook candidates      (91 R-eligible)
     + 5 Pawn Squads          (each = 4 pawn candidates from the 450 evolvers, sharing a type theme)
     = 46 cards

CONSTRAINTS enforced by the generator (retry until satisfied; measured feasible — no (type,class) cell is empty [CF]):
  C1  all 18 types are declarable somewhere in the pool                       # the video's "one of every type"
  C2  no type appears as the only option in more than one class block
  C3  Steel-declarable candidates <= 2 per block                              # rationing the one real ARM type
  C4  >= 2 candidates in the pool carry an immunity breaker (Scrappy / Mind's Eye / a pierce ability)
  C5  >= 2 Pawn Squads contain at least one Queen-class promotion             # 144 of 450 qualify [CF]
  C6  no candidate is on the format's Restricted list (§12.6)
  C7  tier balance: the pool's mean V is within ±0.4 pawns of the format's published target
```

**Ban and pick order** (10 picks + 1 ban each; the classic snake with a first-pick correction):

```
BAN     A1  B1                                    # 1 ban each, any card, 15 s
PICK    B   A A   B B   A A   B B   A A   B B   A   # snake; B has the FIRST pick (see §12.7)
        each player ends with exactly 1K 1Q 2B 2N 2R + 2 Pawn Squads (= 8 pawns) = 16 pieces
PER PICK you also declare, immediately and publicly:
        the type (from that species' real types)
        the ability (1-to-4 radio)
        one Kit item, or none (12 items, one of each, per side)
        optionally swap ONE move slot from its 8-alternative shortlist
CLOCK   20 s per pick + a 60 s reserve for the whole draft.  Total draft ≈ 2.5–3 min.
VALIDATORS run at draft close (§12.5); a side that violates one is auto-corrected by the least-cost change,
        and the correction is shown.
```

Why this is the right ranked format:

- **Material is identical.** 1K/1Q/2B/2N/2R/8P both sides, always. The CwDA catastrophe cannot happen.
- **The pool is shared**, so any "broken" card is available to whoever picks it — the classic MOBA/TCG draft
  fairness property. Advantage comes from *drafting skill*, which is skill.
- **It is the video's draft.** 2 kings, 2 queens, 4 bishops… alternate picks. We are not replacing the
  concept; we are giving it a seed, a ban, a clock and validators.
- **It refreshes forever.** 46 cards out of 1025 species × 18 types × 3010 (species, ability) pairs means the
  pool is effectively never the same twice, so there is no opening book to memorise — Chess960's stated
  rationale, applying to us for free.

### 12.2 Format B — **Constructed** (the collection ladder)

Bring 16 from your own collection under the §11.3 point-buy, fixed slot structure, full 351-item pool subject
to tiering. This is the format the meta-game (accounts, collection, evolution, trading) plugs into, via the
`collection` pool source. **Matchmaking pairs on budget tier and on collection depth**, and the budget caps
what a deep collection can convert into advantage: a 20-Pokémon account and an 800-Pokémon account both field
exactly 42.00 pawns of exactly 16 pieces. Depth buys *options*, not *power*.

### 12.3 Format C — **Mirror**

Both sides receive **identical** armies (same species, types, abilities, items, kits) from a seeded generator.
Zero draft variance, pure play. Used for: tournament tiebreaks, the top-100 Champion bracket, the AI
difficulty round-robin, and every balance A/B in the batch simulator (it is the only format where a measured
win-rate difference is unambiguously about play).

### 12.4 Gym-Leader challenges (single-player, and the badge gate)

Mono-type AI armies, per `DIRECTION.md`. recon-tech measured a mono-type army at **36%** against a mixed army
at equal search — a ~14-point, ≈100–150 Elo composition handicap — and that number is probably an
*under*-estimate because neither side in the probe had a `typeCoverage` term. So Gym Leaders are compensated
on **army quality and search depth, never on type knowledge** (a Gym Leader must be a type *expert*):
Brock–Erika get +1 draft-budget tier; Koga–Giovanni get +1 tier and +1 search ply. Recalibrated against real
Glicko-2 numbers before the labels ship.

### 12.5 Draft validators

Run at draft close, in this order, on both sides:

| # | Validator | Source |
|---|---|---|
| V1 | **≥ 1 immunity breaker** per side (Scrappy/Mind's Eye, a `pierce` ability, or a Ring Target holder) | Stratego's over-supplied key; recon-abilities §6.1 |
| V2 | **≤ 1 Ruin ability** per side, and Ruin abilities do not stack | recon-abilities §6.16 |
| V3 | **≤ 3 Steel declarations** per side | §11.2 |
| V4 | **≤ 1 OHKO move** and **≤ 1 `willCrit` move** per side | recon-moves §5 |
| V5 | Choice items **illegal on King and Queen** | recon-abilities §6.16 |
| V6 | Eviolite legal only on `species.nfe` pieces | structured field |
| V7 | **≥ 10 distinct declared types** across the 16 pieces (a 16-piece army cannot cover 18; the *pool* covers 18 via C1) | the video's goal, made satisfiable |
| V8 | Every piece has ≥ 1 damaging move with charges > 0 | Struggle covers the rest |

V7 deserves a note because it is the one place the video's stated goal is arithmetically impossible: **16
pieces cannot carry 18 types.** The goal is satisfied at the level of the *pool* (C1: all 18 types are
declarable) and the *board* (32 pieces across both armies routinely show 14–18), and V7 stops a player from
mono-typing their way out of the type game.

### 12.6 Legality and the banlist philosophy: usage-based tiering

The philosophy is not "ban what looks strong". It is **Smogon's**, which is the authentic competitive-Pokémon
answer and also the statistically defensible one: content moves between tiers on **measured ladder usage and
win rate**, published, on a schedule.

**Three tiers, three ladders. Everything is legal somewhere.**

| Tier | Content | Ladder |
|---|---|---|
| **PC Standard** | Everything not Restricted. The ranked default. | primary Glicko-2 ladder, badges |
| **Restricted** | Content that failed the test below, plus the enumerated hard-bans | its own ladder ("Restricted Draft") — Ubers' role: a real format, not a graveyard |
| **Unbound** | Literally everything admitted, no clauses | casual/sandbox ladder |

**The test, run at the end of every 8-week season on the primary ladder:**

```
An entity (species, declared type, ability, item, or move) becomes RESTRICTED if
   usage >= 8% of drafted pieces in games above the Marsh Badge
   AND n >= 2000 games
   AND Wilson 95% lower bound on its side's win rate >= 53%
It returns to Standard if, after a season in Restricted, a simulated-pool A/B in the batch simulator
   shows its Standard win-rate contribution below 52%.
```

**Hard-banned in every rated format, with the reason** (these are not usage decisions, they are
"there is no decision to preserve" decisions):

| Banned | Why | n species affected |
|---|---|---|
| `Moody` | +2/−1 random stat per turn with no player decision attached; pure variance the player cannot interact with | 8 |
| `Imposter` unbounded | a pawn becoming a copy of the enemy queen is free material and a mandatory first pick | 1 (permitted in the bounded form: Ditto copies movement pattern and ability only, stays a Normal pawn) |
| OHKO moves beyond 1 per side | they bypass the type chart, i.e. the game's thesis | 4 moves |
| `willCrit` moves stacking | Flower Trick / Frost Breath / Surging Strikes / Wicked Blow guarantee the upgraded step; a stack is a chain engine | 4 moves, ≤1 per side |
| evasion beyond +2 stages | a second route to the untouchable-piece bug | 3 moves |
| `Wonder Guard` in Restricted only | it is 1 species and the indirect channel kills it, but it needs a season of data before it is trusted in Standard | 1 |

**This is how total content coverage and competitive balance coexist.** Every one of the 950 moves, 310
abilities and 583 items resolves to something coherent in the engine (§10) and is *legal in at least one
rated format*. Balance is a **per-format legality predicate over baked tags**, evaluated at draft time, never
a fork in the rules engine. One engine, many formats — which is also the only way a live game keeps a
metagame alive.

### 12.7 First-player advantage

Extra-move chains make this a real problem, and the prior art is loud about it: in Marseillais Chess the
unbalanced double-move version is believed to be a **theoretical win for White**, and the fix that gained
"wide acceptance" was Bruce's 1963 balancing (White moves once on the first turn). Three measures, in
increasing strength:

1. **Balanced first turn (always on).** On turn 1 only, **White may not play a bonus sub-move** (`chainLeft`
   starts at 0). Bruce's rule, transplanted.
2. **The draft compensates (always on).** In Format A, **the player who moves second picks first**. Move
   order is decided before the draft by coin flip; the loser of the flip gets first pick.
3. **The Initiative Auction (rated Format B, and optional in A).** Before the draft, both players secretly
   bid **draft budget in quarter-pawns** for the right to move first; high bid pays its bid and moves first,
   ties re-flip. The market prices first-move advantage; we do not have to. This is the cleanest
   self-balancing device available to a game with an asymmetric first move, it produces a published time
   series of what the ladder thinks tempo is worth, and that series is a direct, ongoing measurement of FPA.

And the measurement that decides whether 1–3 suffice: the batch simulator reports **White's score over
10,000 Mirror-format games** (Format C removes draft noise). Target **50% ± 2%**. If White exceeds 53%, the
next lever is a **second bonus-move restriction on turn 3**, then reducing `chainLeft` to 1 globally — both
tuned in the simulator, never in a patch note without a number.

### 12.8 Time controls under variable turn length

A turn is 1–3 sub-moves plus optional promotion/Tera choices, so a per-*turn* increment is wrong: it either
underpays a 3-decision turn or overpays a 1-decision turn. The rule is therefore:

> **The clock charges decisions, and the increment is granted per decision.**

| Format | Base | Increment | Notes |
|---|---|---|---|
| **Blitz (ladder default)** | 4:00 | **+3 s per sub-move** (≤ 3 per turn ⇒ ≤ 9 s) | mean measured 1.05–1.25 sub-moves/turn, so it behaves like 4+3 |
| Rapid | 10:00 | +5 s per sub-move | badge promotion matches |
| Classical (tournament) | 20:00 | +10 s per sub-move | |
| Draft clock (separate) | 60 s reserve | 20 s per pick, 15 s per ban | never shared with the game clock |

Engineering rules that make this fair, all server-side:

1. **The clock starts when the position becomes actionable**, which is when the server has applied the
   previous action — *not* when the client finishes animating. Animation is never charged. This is why
   `DIRECTION.md`'s "animation must never gate play" is a *competitive integrity* requirement, not just a
   feel one.
2. **A promotion branch choice and a Tera type choice are part of their sub-move** and get no extra
   increment, but they carry a **10 s minimum** so a player is never flag-falled by a modal.
3. **The Forecast reveal is instant** and happens before the clock starts.
4. On timeout: loss, unless the opponent has no mating material (both sides lone Kings ⇒ draw).
5. **Reconnect grace 60 s, drawn from your own clock**, then forfeit. A whole game is a seed plus an action
   list, so reconnect is replay and costs nothing.

### 12.9 "Is this decided at draft time?" — the analysis

The honest answer requires separating three claims.

**(a) Can the draft produce a material advantage?** **No, structurally.** Format A fixes class counts and
draws from a shared pool; Format B fixes class counts and caps quality at 42.00 pawns; Format C is a mirror.
There is no legal path to 17 pieces or to a second queen.

**(b) Can the draft produce a quality advantage?** **Yes, bounded, and measurable.** The total quality spread
available is the sum of the terms in §11.3. Taking the extremes of each term for a full 16-piece army:
type ARM (Steel ×3 at +0.5·m·0.32, everything else ≈+0.02·m) ≈ **+1.6 pawns**; coverage (COVER 8 vs the mean
5.72 across 16 pieces at κ=0.25) ≈ **+1.5**; abilities (16 × up to 1.0, realistically ≈+0.4 each) ≈ **+2.5**;
items (12 slots) ≈ **+1.5**; promotion payoff (8 pawns, up to +0.75 each) ≈ **+2.5**. **Ceiling ≈ 9.6 pawns
of quality**, i.e. about one queen, spread over 16 pieces and 60 turns — and in Format A *both players are
drafting from the same 46 cards*, so the realistic differential is the difference between two competent
drafters, not between the ceiling and the floor.

**(c) Does the winner of the draft win the game?** This is an empirical question and it gets an empirical
answer, published, every season. The instrumentation:

```
For each rated game we log: the two draft states, the pre-game V-differential ΔV, and the result.
We fit  P(win) = logistic(a + b·ΔV + c·ΔGlicko)  over the season.
PUBLISHED METRIC: "draft share" = b·sd(ΔV) / (b·sd(ΔV) + c·sd(ΔGlicko))
TARGET: draft share <= 0.25.
If it exceeds 0.30, the levers in priority order are:
  1. tighten pool constraint C7 (mean-V band ±0.4 -> ±0.25)
  2. add a second ban per player  (bans are the cheapest way to cut the tail of a draft)
  3. lower kappa and the promotion adders (the two terms with the widest measured spread)
  4. move the offending content to Restricted via §12.6
```

The reason I expect draft share to come in low is the measurement in §11.2: **the value spread between the
best and worst declared type of the same class is 1.16×, and 17 of 18 types sit inside 1.03×.** There is no
tier list to memorise because there is almost no tier. The 0.572 pawns/capture that *does* decide games is
paid out twenty times per game, on the board, by the player.

## 13. Counterplay: every dominant strategy and its answer

Sirlin's definition is the bar: a strategy is degenerate if an expert reliably wins with it for lack of viable
options. Each row's answer is a *mechanic already in this design*, not a future patch.

| Strategy | Why it is strong | Counterplay | Bounded by |
|---|---|---|---|
| **Steel wall** | 32% ARM, the only type with real armour | Fire/Fighting/Ground coverage moves are on 38/39/21 of the pool's typical bishops and knights **[CF]**; Steel has 0.3% BLOCK so it can always be attacked; hazards and status ignore ARM entirely | V3 (≤3 Steel/side), C3 (≤2 per pool block) |
| **Immunity fortress** (Levitate/Flying/Ghost) | permanent wards (D4) | coverage (0.37% true lockouts), Ring Target, Smack Down, Gravity, Soak, 213/214 status moves ignore immunity, Mold Breaker family | V1 (≥1 breaker/side), the ≥20-turn telemetry trigger (§7.5) |
| **Chain rush** (stack super-effective coverage, chain 3 sub-moves) | 3 sub-moves can shatter a king ring | T1 (≤3), D5 (≤1 bonus earned per piece/turn), **R5 — exposing the King ends the turn**, Life Orb self-drain, Filter/Solid Rock/Prism Armor deny the bonus outright, `WARD/chain` (Armor Tail, Dazzling, Queenly Majesty) forbids being captured by a bonus move | proof §10.3 |
| **Kamikaze trading** (cheap resist-typed pieces trading up via BACKLASH) | it is the underdog's tool and it should exist | it is now **chosen**, not forced (3.6%); Rock Head and Tinted Lens are the named counters; OVERWHELM (FORCE ≥ +3) upgrades a resisted hit out of BACKLASH; `survive-once` never saves a BACKLASH so it cannot be made free | recon-abilities §6.6, adopted verbatim |
| **Hazard attrition** (Spikes + status + walls, win on the indirect channel) | the `wound` clock is a real win condition | Defog, Rapid Spin, Court Change, Heavy-Duty Boots, Magic Guard, and hazards **are progress** so they cannot be used to stall the clock; hazard squares are visibly painted from the moment they are set | the 100-sub-move progress rule counts hazards as progress, which shortens rather than lengthens these games |
| **Ranged sniping** (RAY kits capturing without exposure — Rifle Chess's warning) | protection stops deterring | ranged moves are 17% of picked slots **[CF]**, cost a charge, are directionally restricted to the piece's own capture lines, cannot promote a pawn, and RAY_LOS respects blockers | §6.5's three bounds |
| **Promotion race** (draft 8 Queen-class promotions) | 144 of 450 pawn candidates promote to Queen-class | it is **priced** (+0.75 each, so 8 of them costs 6 pawns of the 42 budget); pawn squads are drafted as sets so you cannot cherry-pick 8; hazards and status kill pawns on the way; a promoting pawn spends 5–6 turns walking | C5 guarantees the *option* exists for both sides, the price stops one side monopolising it |
| **Forecast timing** (park pieces to exploit the Charged turn) | +1 step is a real swing | it is public **three turns early**, so the defender has two turns to evacuate, screen, or set a Ward; and a Charged type helps *whoever* uses that move type, including the defender's counter-attack | symmetry + the 3-turn window |
| **Stall to the clock** | ladder-standard degeneracy | the progress rule counts hazards, wounds and pawn moves as progress; the perpetual-exposure loss; the optional Army-Score adjudication | §10.2 |

## 14. The metagame after 1000 games

A prediction is only worth making if it is falsifiable by an instrument we are shipping. Each row names the
metric that checks it, all produced by the batch simulator and the ladder telemetry (§19.7, §15).

| # | Prediction | Falsifying metric |
|---|---|---|
| 1 | **Five stable archetypes**: Coverage Control (3-type officer kits + ranged), Hazard Attrition, Chain Rush, Steel-and-Promote, Kamikaze Tempo. None above 30% or below 12% of drafts above Marsh Badge. | archetype share, clustered on the draft log by kit-shape/type/item vector |
| 2 | **Draft share ≤ 0.25** (§12.9): games are decided on the board. | the published logistic fit |
| 3 | **The bonus move is the most contested resource, not material.** Expect >60% of turns with a super-effective capture available to take it, and expect the "decline bonus" action to be played in 5–12% of grants (it exists because a mandatory extra move is undesigned zugzwang). | decline rate; bonus-taken rate |
| 4 | **Steel's usage is 2–3× the average type and its win-rate contribution is +1 to +2 points**, i.e. contested but not broken, because V3/C3 ration it. If it clears the §12.6 test, it is Steel *declarations* that get restricted (max 2), not the species. | usage × Wilson win rate per declared type |
| 5 | **Ice and Normal are viable, not free wins for the opponent.** They have ARM 0.3% but 39.8% and 14.6% bonus rates and full coverage kits. Expect them 0.5–1.5 points below average, not 5. | per-declared-type win rate |
| 6 | **Draw rate 6–12%.** Mutual destruction removes ~2 pieces per BACKLASH, which shortens games, but king-capture removes stalemate as a resource, which lengthens the tail. Above 12% we enable Army-Score adjudication. | ladder draw rate |
| 7 | **Mean game 55–130 plies** (recon-tech measured 55 at 10k nodes/move, 127 at 2k). Games get *longer* as the ladder gets stronger, because strong players stop making 0.5× attacks. | mean plies by badge tier |
| 8 | **The first solved thing will be pool evaluation, not play.** Within ~200 games of a season, strong players will know which of the 46 cards is the first pick. That is fine and intended: the pool changes every game, so the skill is *evaluating a novel pool fast*, which is a real skill (this is Chess960's argument and Hearthstone Arena's). | first-pick concentration per pool archetype |
| 9 | **Two content items will need restricting in season 1.** My priors: `Regenerator` (27 species, resets Vigour after surviving — it interacts with the `wound` clock more strongly than intended) and **Explosion on a Ferrothorn-class rook** (a RING_ALL tier-5 area attack from a piece nobody wants to trade with). Both are §12.6 test candidates, not pre-emptive bans, because a pre-emptive ban with no data is exactly the mistake the tiering system exists to avoid. | the seasonal usage/win-rate report |
| 10 | **The type quiz score of a player will predict their badge better than their chess Elo.** This is the design's central claim and it is directly testable once both are logged. | the `(ΔElo_chess, Δtype-quiz)` fit recon-variants §6.1 specifies |

## 15. Rating, ladder and integrity

- **Glicko-2** internally (τ = 0.5, initial 1500/RD 350, 10 provisional games at doubled RD), never displayed
  as the primary identity. Separate ratings per format; the **Ladder Draft** rating is the one badges track.
- **Badges are the identity**: Boulder → Cascade → Thunder → Rainbow → Soul → Marsh → Volcano → Earth, each
  subdivided I/II/III, then Elite Four I–IV, then **Champion = top 100 of the season** (a rank, not a
  threshold, so it stays scarce). **Highest badge earned** is permanent and separate from **current tier**, so
  the ladder can be brutal without the profile being punitive.
- **Promotion gates** are Gym-Leader matches (§12.4) — you must beat the mono-type army to leave a tier. It
  teaches the chart by making you exploit it, which is the whole game's premise, and it is the shared spine of
  single-player, collection and ranked.
- **Seasons**: 8 weeks, soft reset `r ← 1500 + 0.7·(r − 1500)`, RD raised to 150.
- **Integrity**, because a rateable game needs all of this: the server owns the seed and resolves every
  action with the same pure engine module the client runs; a game is `{formatId, poolSeed, draftLog, rngSeed,
  actions[]}` so replay, spectate and reconnect are the same code path; a state hash is exchanged every
  sub-move for desync detection; win-trading is detected by pair-frequency and rating-flow anomaly
  (the same statistics the tiering report already computes); the Forecast is never sent beyond its 3-turn
  window, so a modified client cannot see further than an honest one.

---

# PART IV — BUILD

## 16. Answers to the ten hard problems

**1. Content coverage at scale.** §10A. A three-layer scheme with a measured line: **~83% derived** from
structured fields via 37 (shape × payload) combinations, **88 curated data tags**, **79 bespoke moves in 16
rules**, plus ~90 fingerprint-informed curations that recon-data-substrate proves are unavoidable (33% of
moves have handler-only behaviour and `@pkmn/dex` strips handlers silently). Abilities: 13 archetypes / 115
primitives / 12 hooks, machine-validated 320/320. Items: 19 classes, 583/583, 351 admitted, entering play as
format **Kits** rather than an inventory. Fallbacks: a damaging move becomes a MELEE capture at tier
`basePower || 60`, a Status move becomes a +1 boost for 2 turns, an unknown ability becomes `INERT` with its
real `shortDesc` as a tooltip, an unknown item becomes cosmetic. Every record carries a `coverage` tag and CI
**fails the build** on an unaccounted entry — the claim is a test, not prose. 900 unbalanced special cases are
avoided by making balance a *format legality predicate* (§12.6) rather than a per-entity nerf.

**2. Turn structure.** §6, with the loop written out. No HP; capture is binary; `wound ∈ [0,3]` is a
four-state indirect kill clock and `boost ∈ [0,3]` a decaying buff, displayed as one number
`Vigour = boost − wound`. A Pokémon move **is** a sub-move: using one costs your chess action, and a capture
spends both a sub-move and a charge (`charges = clamp(round(pp/5),1,5)` ⇒ ~12 uses per piece per game, with
**Struggle** as the typeless, wounding fallback so no piece is ever stuck). A turn is 1–3 sub-moves; extra
sub-moves come only from ADVANTAGE/ROUT captures and are optional.

**3. Termination.** §10.3, six claims. Chain ≤ 3 by rule and ≤ 1+N by monovariant; no rule grants a bonus
without a capture (audited across all 310 abilities and 351 items); no rule adds pieces except a
once-per-game Revival Blessing; progress events ≤ 256 and ≤ 100 sub-moves between them ⇒ **game ≤ 25,700
sub-moves**; the delayed-effect horizon is ≤ 5 because the dataset's max `condition.duration` is 5;
`RESOLUTION_DEPTH = 1` bounds Metronome. Threefold repetition on the full state hash **excluding the PRNG
counter** ends nearly every game far sooner.

**4. Check, checkmate, mutual destruction, king capture.** §10.1, R1–R7. **King capture, no check-legality**,
because under any randomness "must not leave your King in check" is not a well-formed predicate — which is
precisely why Fog of War, Duck Chess, Losing Chess, single-die Dice Chess and ICC Atomic all made this switch.
Deterministic self-kill is illegal (Atomic rule 5); probabilistic self-risk is legal with the probability
shown. Both Kings dying at once: **the mover wins**. **Exposing the enemy King ends your turn (R5)** — the
Marseillais patch that makes king-capture safe by guaranteeing a reply. Kings are never immune (R6).
Checkmate becomes a *label* ("your King cannot escape") and a persistent banner (R7), plus **Guarded mode** as
a filter over `generate()` in casual play.

**5. Balance.** §11 (value), §12 (draft/formats/tiering), §13 (counterplay), §14 (metagame). Piece value `V = m(1 + β·ARM − α·LIAB − ε·BLOCK) + τ·BONUS + κ·COVER` with
ARM measured against **all 1,025 real kits** rather than against single types **[CF]**; the resulting spread
is **1.16×**, deliberately collapsed, because the type edge lives in play (0.572 pawns/capture **[CF]**), not
in the price list. Immunity, mutual destruction and crit chains are each bounded by a named rule with a
counterplay row in §13. A type-knowing player wins by making twenty correct four-way move choices a game, and
the game is not decided at draft time because material is symmetric by construction, quality is capped at
≈9.6 pawns of ceiling spread over 16 pieces, and **draft share is published every season with a ≤0.25
target** (§12.9).

**6. Draft.** §12. Three formats. Ranked is a **shared, seeded, constraint-screened 46-card pool** with 1 ban
and 10 picks each and fixed class counts — the video's own draft with a seed, a clock and validators — which
makes 1025 Pokémon non-paralysing (you read 46 cards, and each pick is 1 species + a 1-to-4 ability radio + 1
type + 1 Kit item + an optional 1-of-8 move swap). Pool constraints C1–C7 guarantee all 18 types are
declarable (the video's goal, satisfiable at pool level since 16 pieces cannot carry 18 types), ration Steel,
and guarantee immunity breakers and Queen-class promotion options. Constructed uses the point-buy for the
collection ladder; Mirror exists for tiebreaks and for every balance measurement.

**7. Rendering & performance.** §18. recon-tech's hybrid adopted: DOM board of 64 `<button>`s + one
transform-positioned piece layer + **two** Canvas2D FX layers, React for chrome only, no PixiJS (165–231 KB
gz to fix a 0.09 ms problem, and it *cannot* consume Showdown sprites because there is no
`Access-Control-Allow-Origin`). Vendored gen-5 96 px stills on the board (26 KB/game, painted in 105 ms),
Showdown's 383 KB icon sheet in grids, CSS type pills, a zero-asset Type Glyph mode. Budgets: entry ≤ 110 KB
gz, critical-path data ≤ 60 KB, ≤ 1,200 canvas particles, ≤ 250 DOM nodes in the board, ≤ 200 concurrent
composited animations, frame p95 ≤ 10 ms at 60 Hz on a 6×-slower device, 0 dropped frames per capture — all
CI gates. Six verdict visuals (adding REPELLED) plus the Forecast strip; capture resolution ≤ 700 ms at
Normal, ≤ 1,540 ms for a 3-sub-move chain, and **animation is never on the clock**.

**8. AI opponent.** §19. Alpha-beta negamax + PVS + iterative deepening + quiescence in a Web Worker, at a
measured 7.1 M nodes/s and EBF ≈ 4 (depth 9 in 601 ms). **My ruleset removes the chance nodes**: with the
Forecast public and no capture die, a whole turn is deterministic, so the only stochastic elements are
opt-in accuracy (EV-collapse with recon-tech's bias correction), riders (never change material), and the
Forecast beyond the 3-turn window (root sampling with common random numbers, linear in R). No star1/star2
(measured a net negative), no full expectiminimax (121–159×), no MCTS (branching 41, sharp tactics, and we
have a good static eval), no WASM (2× buys 0.5 plies). Eval is tiered by measured cost with the relational
type terms — `superEffectiveVulnerability` above all — in the lazy tier. Difficulty is a **corrupted type
chart** (measured monotonic: 5% → 47%, 50% → 30%, 100% → 25%), not a shallower search. Plus one new
requirement from D1: **dominated-slot pruning** (§19.3).

**9. Legibility.** §17. The **Clash Panel** is the whole answer: hover an enemy and you get one row per move
showing the outcome word, the FORCE arithmetic, the charge cost and the riders, with the best row
preselected — so a chess player plays chess with a recommended attack and *learns the chart by reading the
words*, and an expert deviates on purpose. Immunity is shown pre-emptively as a dashed ring the moment you
pick a piece up, never discovered mid-attempt. Everything is public: types, abilities, items, kits, charges,
Vigour, hazards, the Forecast. Four-tier progressive disclosure, a **Type Trainer** that quizzes you on the
matchups you got wrong in your last game, Guarded mode for chess players, a 5×5 six-piece tutorial for
Pokémon players, and every verdict carried redundantly in motion, sound, text and an `aria-live` region.

**10. Scope order.** §21. v0 = the pure engine and its test suite (the one thing everything else depends on).
**v1 = a rateable game**: Ladder Draft, full Clash, the derived move layer with the 16 bespoke rules, all 310
abilities and the Standard 12 Kit, promotion-as-evolution, Tera, one AI difficulty, six verdict animations,
hot-seat and offline. v1.1 = the ladder, badges, Gym Leaders, five difficulties, batch simulator, Constructed.
v2 = network multiplayer, seasons, tiering automation, the collection layer. Honest total ≈ **95–115
agent-days**, of which the engine is 30 and the content layer is 25.

## 16A. The six bugs from BRIEF §2, resolved

| Bug | Resolution |
|---|---|
| **Capture-in-check is broken** | There is no check-legality (R2), so the situation is well-defined rather than illegal: your piece and the checker both die (BACKLASH), and if that leaves your King capturable, your opponent takes it on their turn. That is a *consequence of a losing move*, not a rules failure — and R7's banner told you the number before you clicked. The root cause is named: under randomness the post-move position is a random variable, so the orthodox legality predicate is ill-posed. |
| **Infinite / runaway turns** | Bounded three ways (§10.3): the monovariant (≤1+N), the hard cap T1 (≤3 sub-moves), and D5 (one bonus earned per piece per turn). The two ways to break it are flagged loudly: never grant a bonus without a capture, never add pieces. |
| **King capture vs checkmate** | King capture, chosen explicitly (R1), with the cost stated (stalemate disappears; K+R vs K changes). R5 makes it safe by guaranteeing the opponent a reply. |
| **Suicide-capture as a tactic** | **A feature, made deterministic and no longer compulsory.** BACKLASH comes only from the type chart, never a die; it is *forced* on only 3.6% of matchups **[CF]** (down from 18.8%); OVERWHELM lets a boosted piece punch out of it; Rock Head and Tinted Lens are the named counters; and `survive-once` effects can never make it free. It is the underdog's tool and it is priced into `α·LIAB`. |
| **Draw / stalemate undefined** | Fully defined (§10.2): threefold on the full hash excluding the PRNG counter, a 100-sub-move progress rule with a monotone progress list, perpetual-exposure loses, no-legal-action loses, both-Kings-at-once ⇒ mover wins, lone Kings ⇒ draw, and an optional Army-Score adjudication for tournaments. |
| **Zero-effectiveness immunity creates untouchable pieces** | Reduced 6.7× by coverage kits (**0.37%** of pairs, measured **[CF]**), guaranteed answerable by V1's key-supply validator, and *always* answerable indirectly because **213 of 214 status moves ignore immunity** — the one exception being Thunder Wave, which canonically cannot paralyse a Ground type **[CF]**. Kings are never immune (R6). And a measured trigger, not an opinion, decides whether we need more: if ≥5% of simulated games contain a piece uncapturable for ≥20 turns, 0× degrades to "graze". |

---

## 17. UX and onboarding

### 17.1 The Clash Panel — the single most important screen in the game

Pick up a piece; every enemy in reach shows a badge with the best outcome. Hover one and the panel opens:

```
 ┌─ GENGAR ♝ ◆GHOST  →  BLISSEY ♜ ◆NORMAL ──────────────────────────┐
 │  ▸ Hex          ·Ghost   T3  ⚡4     NO EFFECT   Ghost → Normal 0× │  greyed, dashed ring on the board
 │  ● Sludge Wave  ·Poison  T3  ⚡2     TRADE       FORCE +0          │  ← preselected (best)
 │    Clear Smog   ·Poison  T2  ⚡3     TRADE       FORCE −1   · resets enemy boosts
 │    Poison Gas   ·Poison  —   ⚡2     TACTIC      poisons (does not capture)
 │  FORCE +0 = tier 3 (0) + STAB (0, Poison ≠ Ghost) + vigour (0) …   │
 │  ⚡ = charges remaining.   Turn 14 is ⚡CHARGED: POISON  → TRADE becomes ADVANTAGE │
 └───────────────────────────────────────────────────────────────────┘
```

This one component does the entire legibility job:

- **A chess-only player** never has to learn the chart to play: the best row is preselected, so they play
  chess and press enter. They learn the chart by *reading the words that keep appearing* — "NO EFFECT" next to
  Ghost→Normal, "BOTH FALL" next to Grass→Fire. Recognition, then recall.
- **A Pokémon-only player** reads it instantly: it is a move list with type matchups, which is the interface
  they already know.
- **An expert** deviates: takes Clear Smog over Sludge Wave to strip boosts, takes a ranged move to avoid the
  recapture, takes a lower tier to keep a charge, or declines a capture because the Forecast says Poison is
  charged in two turns.
- Every element is DOM with an `aria-live` mirror, so the accessibility path and the legibility path are the
  same path.

### 17.2 Progressive disclosure

| Stage | Unlocked | Format |
|---|---|---|
| 1 (games 1–3) | Board, types, the four capture outcomes, the Clash Panel, the bonus move. **Guarded mode on.** | *Basic*: no items, no hazards, no field, kits filtered to MELEE + one Status |
| 2 (games 4–8) | Vigour pips, status, charges and Struggle | *Basic+* |
| 3 (games 9–15) | Items (the Standard 12), hazards, weather/terrain, abilities as 13 coloured glyphs | *Standard*, Guarded still on |
| 4 (rated) | FORCE arithmetic, the Forecast as a planning tool, Tera/Burst, the draft's ban phase. **Guarded off.** | *Ladder Draft* |

This is disclosure, not trimming: every mechanic is present in the engine from game 1 and the formats are
legality predicates, exactly as §12.6 requires.

### 17.3 Two tutorials, because there are two players

- **For the chess player:** a 6-move puzzle set. "You are a Ground rook. The enemy bishop is Flying. Find a
  capture." (Answer: your coverage move, or Smack Down, or don't.) Then: "You are up a queen. Your queen is
  Grass; every enemy pawn is Fire. Why are you losing?" The type chart is taught as *chess tactics*.
- **For the Pokémon player:** a 5×5 board, six pieces, no types. Move the knight. Take the rook. Promote the
  pawn. Then the same board with types switched on. Chess is taught as *a Pokémon team with movement rules*.
- **After every game, win or lose:** the **Type Trainer** shows the three matchups you actually got wrong
  that game, as three cards. It is the single highest-leverage teaching surface in the design because it is
  personalised by the game you just played, and it produces the type-quiz score that §14 prediction 10 tests.

### 17.4 Legibility under load

Adopted from recon-tech §A.7.4 and extended: colour is never the primary channel (each of the six outcomes
has distinct motion, sound and text); the verdict banner is a real `aria-live="assertive"` element; a
persistent right-rail log names every state change; hazard squares, trapped pieces, screens and weather are
drawn on the board rather than listed; and the **"your King can be taken" banner** names the attacker, the
move and the probability. Four speed modes (Cinematic / Normal / Fast / Instant), `prefers-reduced-motion`
handled as a *distinct* path rather than as Instant, and Shift-commit plays one move instantly.

## 18. Rendering and performance

recon-tech Part A is adopted essentially unchanged — its measurements are decisive and I have no reason to
disagree. The stack: 64 `<button>` squares (DOM, focusable, `aria-label`led) + one `.pieces` layer with one
transform-positioned element per **piece id** + `fx-under` and `fx-over` Canvas2D layers + React for chrome.
One `requestAnimationFrame` ticker with fixed `read → simulate → write → draw` phases, running only while the
FX queue is non-empty. Six `--z-*` custom properties and a lint rule banning every other `z-index`. A
pre-allocated struct-of-arrays particle pool capped at 1,200 that degrades density rather than dropping
frames. Vendored sprites same-origin (Showdown sends no `Access-Control-Allow-Origin`, so hotlinking
permanently taints the canvas and forecloses sprite-derived dissolve particles — which is exactly the effect
`DIRECTION.md` asks for when it says mutual destruction must visibly destroy both pieces). No Pokémon art in
git; Type Glyph mode as a first-class zero-asset look.

**Three competitive-specific additions:**

1. **FX must be deterministic.** `FxQueue.enqueue` is a pure function of `(EffectEvent, seed)`, asserted by a
   Vitest test ("a ROUT with seed 7 emits exactly 240 particles with these velocities"). A replay must
   reproduce the *animation*, or spectating and reconnect-by-replay diverge visibly and the ladder gets bug
   reports it cannot triage.
2. **Fast and Instant are rated-legal**, and the clock never charges animation (§12.8). A player who plays at
   Instant must not gain time over a player who watches the show.
3. **The Forecast strip** is a persistent three-cell HUD element (this turn / next / next+1) with each cell
   showing a type pill; pieces whose kit contains a move of the charged type get a matching aura *on the turn
   before*, so the plan is visible on the board and not only in the HUD.

The full budget table (§A.6 of recon-tech) is adopted as CI gates, with one added row: **draft screen build
≤ 16 ms** for 46 cards (trivially inside the measured 10.5 ms for a 200-cell virtualised grid).

## 19. AI opponent

recon-tech Part B is adopted, and this ruleset makes it *cheaper and stronger*:

```ts
interface Rules {                                     // the ONLY interface the searcher may depend on
  generate(s: GameState): Action[];                   // one legality predicate, shared with the UI and Guarded mode
  apply(s: GameState, a: Action): { state: GameState; events: EffectEvent[] };
  terminal(s: GameState): Result | null;
  staticClash(s: GameState, a: Action): number;       // ordering + quiescence key
}
```

**19.1 Chance nodes: almost gone.** With the Forecast public and no capture die, the current turn is fully
deterministic. The remaining stochastic elements are (a) opt-in accuracy → recon-tech's EV-collapse with the
`bias = Σ P(o)·Δmaterial(o) − Δmaterial(modal)` correction, which is the important half; (b) riders, which
never change material and are collapsed to their expectation; (c) the Forecast beyond turn `T+2` → **root
sampling with common random numbers**, linear in R. No interior chance nodes at all. No star1/star2.

**19.2 Sub-moves, not plies.** Carry `(side, chainLeft, bonusPieces)` and recurse **without negating** on a
bonus sub-move; mate scores are `29000 − subMoveCount`; progress and repetition counters count sub-moves; and
R5 is tested after every sub-move with `isAttacked(enemyKing, bySide)` filtered by type legality (~30 table
lookups, ≈15 ns) rather than a full opponent `genMoves`. Generate an explicit `DeclineBonus` action.

**19.3 New from D1 — dominated-slot pruning.** Captures now branch on the move slot. Order slots by
`staticClash` and prune slot `j` if some slot `i` has `step_i ≥ step_j` **and** `FORCE_i ≥ FORCE_j` **and**
slot `i`'s riders are a superset of `j`'s and `charges_i > 0`. Typically 1–2 of a piece's 2.42 attacking types
survive, so the measured +33% action width collapses to roughly +10% at the node level. Never prune a slot
that grants a bonus move, and **never prune a "losing" capture** — under BACKLASH, a pawn taking a queen is a
good trade, and prune-by-`staticClash > −50 cp` instead of by SEE. That single change is what makes the AI
play *this* game rather than play chess badly.

**19.4 Eval.** recon-tech's three tiers verbatim, with §11.1's value model in Tier 0 (incremental accumulator,
4 ns) and the relational terms in the lazy tier: `typeCoverage`, `superEffectiveThreats`,
`superEffectiveVulnerability` (weighted higher — fear beats greed), `kingRing × (1 − immunityFraction)`,
`hazardPressure`, `boundPieces`, plus two of mine: **`chargeEconomy`** (Σ remaining charges, ~8 cp each —
charges are a real resource in this design and an engine that ignores them will Struggle in the endgame) and
**`forecastFit`** (over the visible 3-turn window, the value of captures that the charged type will upgrade —
this is how the AI *plans around the Forecast*, and it is the term that makes it feel like it is thinking).
Weights are **fitted by self-play (SPSA/Texel) via the batch simulator**, never chosen.

**19.5 Zobrist and the TT.** Factorised, ~6,500 keys / 52 KB, including `Z_type[square][type]` (the table a
chess engine does not have), `Z_boost`, `Z_wound`, `Z_status`, `Z_charges`, `Z_chargedType`, `Z_chainLeft`.
**Never** the PRNG counter. Epoch-split the slow-moving state (types, wards, items, field) so value cutoffs
survive; always validate a TT move against the freshly generated list, because legality is state-dependent.
2²⁰ × 16 B = 16 MB, two `Int32Array`s, no objects. Disable null-move pruning (being forced to act is often
bad here, so zugzwang is common rather than rare).

**19.6 Difficulty.** The measured type-belief dial, with structured corruption at the low tiers (keep the
starter triangle, be wrong about the 8 immunities and Steel's resistances — the two things intermediate
players demonstrably get wrong):

| Level | Hard budget | Depth | `typeErrorRate` | Blunder | Eval | Feel |
|---|---|---|---|---|---|---|
| Rookie | 150 ms | 5–6 | 100% (structured) | 12% top-5 | T0 | plays chess, ignores types |
| Trainer | 300 ms | 6–7 | 50% | 6% top-3 | T0 | confidently wrong about immunities |
| **Gym Leader** (default) | 700 ms | 8–9 | 15% | 2% | T0+1 | punishes real mistakes |
| Elite Four | 1500 ms | 9 + R=4 | 0% | 0 | T0+1+2 | perfect chart, full eval |
| Champion | 3000 ms | 9–10 + R=8 | 0% | 0 | all, tuned | labelled "may take 3 s" |

Latency contract p50 = 0.55 × budget, **p95 ≤ 1.3 × budget** with a hard abort returning the last completed
depth, and a **350 ms floor** so the AI never reads as a script. The Elo labels ship only after a 200-game
round robin against a flat-Monte-Carlo baseline, with the score matrix published.

**19.7 The batch simulator is a first-class product surface**, because every claim in §12–14 depends on it.
Measured: **25.9 games/s** single-threaded at 2,000 nodes/move ⇒ 10,000 games in ~6.4 min, ~1 min on 8
workers. Budget in **node counts, not milliseconds**, or results are not reproducible across machines and CI.
Required outputs: outcome distribution, game length by badge tier, capture-outcome frequencies, per-declared-
type win rate, **White's score in Mirror format** (§12.7), **draft share** (§12.9), archetype shares, and
`P(uncapturable ≥ 20 turns)` (§7.5).

## 20. Architecture

```
src/
  engine/                        # PURE. no DOM, no React, no I/O, no Math.random. This is the product.
    types.ts                     # Piece, GameState, Action, Outcome, Result — the vocabulary
    board.ts                     # 0x88 mailbox + precomputed RAYS / BETWEEN / KNIGHT / KING / PAWN_ATTACKS
    rng.ts                       # xoshiro128**, 4-word serialisable state; rngFork(state, i)
    zobrist.ts                   # factorised tables, epoch split
    typechart.ts                 # STEP[18][18] as a Uint8Array(324), statically imported
    generate.ts                  # THE legality predicate. every rule lands here or in apply.
    apply.ts                     # THE transition. returns { state, events }
    clash.ts                     # §7: FORCE, step, the outcome table. the only place outcomes are decided
    force.ts                     # the FORCE terms, one pure function each
    vigour.ts                    # boost / wound / KO-at-4 / pristine / wounded
    status.ts                    # deterministic status, Sleep + Freeze clauses
    hazards.ts  field.ts  screens.ts
    scheduler.ts                 # delayed effects, horizon <= 5, one entry per (side, kind)
    forecast.ts                  # the charged-type timeline, 3-turn visibility
    promotion.ts                 # evolution, branch choice, classOf, Mega
    terminal.ts                  # R1-R7, draws, progress, repetition, the Army-Score adjudicator
    moves/
      derive.ts                  # dex fields -> MoveEffect (the 37 combinations)
      shapes.ts                  # MELEE / RAY_LOS / RAY_ANY / RING_* / ENEMY_ZONE geometry
      bespoke/                   # exactly 16 files, one per rule (B1_callsMove.ts … B16_cleanse.ts)
      tags.ts                    # the 88 curated data tags
      fallback.ts                # the two-branch total fallback
    abilities/
      primitives.ts              # 115 functions
      registry.ts                # archetype -> hook dispatch
    items/
      primitives.ts              # ~40 functions
      registry.ts
    formats/
      legality.ts                # per-format predicate over baked tags. NO rule forks.
      pool.ts                    # Format A pool generator + C1..C7
      pointbuy.ts                # Format B pricing
      validators.ts              # V1..V8
      kits.ts                    # the item Kits
  ai/
    search.ts                    # alpha-beta + PVS + ID + quiescence, sub-move aware
    order.ts                     # TT, staticClash, extra-move-first, dominated-slot pruning, killers, history
    eval.ts                      # three tiers, incremental accumulators
    tt.ts  worker.ts  difficulty.ts  batch.ts
  data/
    generated/                   # baked at build time; NEVER @pkmn/* at runtime
      dex-index.json  move-effects.bin  ability-item-effects.bin  typechart.json  kits.json  tiers.json
  ui/
    board/     Board.tsx  Pieces.tsx  Piece.tsx  squares.ts  layers.css
    fx/        Ticker.ts  FxQueue.ts  Renderer.ts  Canvas2DRenderer.ts  StaticRenderer.ts  particles.ts
    present/   Presenter.ts  beats.ts          # authoritative vs displayed; settle(); the beat grid
    clash/     ClashPanel.tsx  ForceBreakdown.tsx  ForecastStrip.tsx
    draft/     PoolBoard.tsx  Card.tsx  BanPhase.tsx  DraftClock.tsx
    dex/       DexGrid.tsx                     # virtualised 200-cell window
    learn/     TypeTrainer.tsx  Tutorial.tsx
  net/         protocol.ts  client.ts          # seed + action list; state-hash desync detection
scripts/
  gen-data.ts                    # @pkmn/sim + @pkmn/dex -> bundles; FAILS on unassigned content
  vendor-sprites.ts              # 829 KB + 383 KB + 87 KB -> public/sprites (gitignored)
  sim.ts                         # headless batch simulator (node budgets, aggregate counters)
  tier-report.ts                 # the seasonal usage x Wilson win-rate report
tests/
  perft.test.ts                  # perft(1..5), differential vs chess.js on type-neutral positions
  coverage.test.ts               # walks ALL 950 / 310 / 583. fails on an unaccounted entry.
  termination.test.ts            # the six claims of §10.3, as properties
  determinism.test.ts            # seed + actions -> identical state hash, 10k random games
  clash.test.ts                  # the §7.2 table, every cell, plus the §7.3 worked rows
```

Key signatures, so there is nothing to ask about:

```ts
function generate(s: GameState): Action[];
function apply(s: GameState, a: Action): { state: GameState; events: EffectEvent[] };
function terminal(s: GameState): Result | null;

function clash(s: GameState, atk: Piece, def: Piece, m: MoveEffect, charged: TypeId | null): ClashResult;
interface ClashResult {
  step: -2|-1|0|1|2; force: number; outcome: Outcome;   // 'NO_EFFECT'|'BACKLASH'|'TRADE'|'ADVANTAGE'|'ROUT'|'REPELLED'|'MISS'
  breakdown: ForceTerm[];                               // for the Clash Panel AND for the AI's explanation
  deaths: PieceId[]; grantsBonus: boolean; riders: Rider[];
}
function staticClash(s: GameState, a: Action): number;   // centipawns, pure table lookups
function legal(format: FormatId, entity: EntityRef): boolean;   // the ONLY balance fork
function priceOf(p: DraftedPiece): number;               // quarter-pawns
function generatePool(seed: number, format: FormatId): Pool;    // C1..C7, retry until satisfied
```

The `breakdown` field is load-bearing in two directions: it is what the Clash Panel renders, and it is what
the AI's hint mode shows — so the AI's displayed reasoning is *the same data* as the player's, which is what
makes "Rookie is honestly wrong about types" implementable without a second code path.

## 21. Milestones

"Agent-day" = one focused day with review. Nothing is listed as v1 unless it is complete and playable.

| Stage | Contents | Days |
|---|---|---|
| **v0 — the engine** | types, board, 0x88 movegen + `perft(5)`, rng, zobrist, typechart, generate/apply, Clash + FORCE + the full §7.2 table, vigour/status/charges/Struggle, R1–R7, draws + the six termination properties, determinism test, `chess.js` differential | **30** |
| **v0.5 — content** | the derived move layer (37 combinations), 16 bespoke rules, 88 tags, the total fallback, 115 ability primitives, ~40 item primitives, `gen-data.ts` on `@pkmn/sim` with the coverage audit in CI, the auto-kit picker with both quotas | **25** |
| **v1 — a rateable game** | Ladder Draft (pool generator + C1–C7 + ban/pick + V1–V8 + clock), board refactor, Presenter + beat grid, six verdict animations, Clash Panel, Forecast strip, promotion-as-evolution, Tera/Burst, Standard 12 Kit, hazards/field/screens, Gym-Leader-level AI in a Worker, hot-seat, offline, vendored sprites, Type Glyph mode, the CI perf gates | **35** |
| **v1.1 — the ladder** | Glicko-2 + badges + promotion matches, five AI difficulties + the round robin, batch simulator + `tier-report.ts`, Constructed + point-buy, Mirror, Type Trainer, tutorials, four speed modes + reduced motion | **20** |
| **v2 — live** | authoritative server, netcode (seed + actions + state hashes), friends/queue/friendly, reconnect, spectate, seasons + automated tiering, the collection layer and its `collection` pool source, trading | **35+** |

**Total to v1 ≈ 90 agent-days; to v1.1 ≈ 110.** The riskiest line is v0.5's ability layer, because
recon-data-substrate's measurement (33% of moves and ~95% of abilities have handler-implemented behaviour)
means the honest curation cost is a few hundred small decisions, not forty. The mitigation is the coverage
audit: it makes partial completion *visible* rather than silently wrong, so v0.5 can ship at 80% curated with
the remainder marked `INERT` in the UI and the build failing loudly if anyone forgets.

## 22. Worked example

### 22.1 The draft (Format A, pool seed `PC-7F31`)

46 cards. Both players see all of them. Two players: **Blue takes White and moves first**, so — per §12.7
measure 2 — **Red (Black) gets the first draft pick.**

| Slot | Black picks (moves second, picks first) | White picks (moves first) |
|---|---|---|
| BAN | *Iron Valiant* (K-block) | *Ferrothorn* (R-block) |
| King | **Cobalion** → declares **Steel** | **Zapdos** → declares **Electric** |
| Queen | **Garchomp** → **Dragon** *(Dragon Rush / Breaking Swipe / Earthquake / Dragon Cheer)* | **Charizard** → **Fire** *(Overheat / Hurricane / Dragon Pulse / Roost)* |
| Bishops | **Gengar** → **Ghost**, **Alakazam** → **Psychic** | **Lapras** → **Ice**, **Clefable** → **Fairy** |
| Knights | **Aerodactyl** → **Rock**, **Jolteon** → **Electric** | **Weavile** → **Dark**, **Talonflame** → **Flying** |
| Rooks | **Skarmory** → **Steel** *(Steel Wing / Brave Bird / Drill Run / Autotomize)*, **Tangrowth** → **Grass** | **Blissey** → **Normal** *(Tri Attack / Hyper Voice / Mud Bomb / Soft-Boiled)*, **Gyarados** → **Water** |
| Pawn squads | *Kanto Waters* (Magikarp, Poliwag, Krabby, Horsea), *Rock Cradle* (Larvitar, Geodude, Roggenrola, Nosepass) | *Shock Squad* (Pikachu, Magnemite, Elekid, Voltorb), *Bug Brigade* (Caterpie, Weedle, Scyther, Nincada) |
| Items (of the Standard 12) | Focus Sash→Gengar, Rocky Helmet→Skarmory, Ring Target→Aerodactyl, Leftovers→Cobalion, … | Life Orb→Charizard, Heavy-Duty Boots→Talonflame, Expert Belt→Weavile, Eviolite→Pikachu, … |

Validators: Black has Ring Target (V1 ✓), 3 Steel declarations exactly (V3 ✓), 11 distinct types (V7 ✓).
White has Weavile's *Pursuit* coverage and Scrappy on nothing — the validator flags V1 and auto-assigns
White's Ring Target to Blissey, shown as a correction. Black notes it: **White's immunity key is on a rook
that will not want to leave the back rank.**

**Forecast at kickoff (public):** `T1 ⚡GROUND · T2 ⚡WATER · T3 ⚡FLYING`.

### 22.2 The first six turns

Notation: `*` = ranged strike (attacker did not move), `~` = area, `[Move]` = the declared move,
`→` = the bonus sub-move.

**T1 — White. ⚡GROUND.**
`1. e4` — Elekid (Electric pawn) to e4. White has no Ground moves in reach on turn 1, so the charge is dead
for them; but White reads the queue: **T3 is Flying, and White has Talonflame and Charizard**. The move is
played to open the f1–a6 diagonal for Charizard's Hurricane line. *No bonus move is available on turn 1
anyway (§12.7 measure 1).*

**T2 — Black. ⚡WATER.**
`1… d5` — Horsea (Water pawn) to d5, offering the exchange. Black is deliberately putting a Water piece on a
Charged turn: if White takes with Elekid, `Electric → Water` is `+1` (super-effective) and White gets a bonus
move — so Black is *not* offering a real trade, it is a probe. Black's real plan is `⚡FLYING on T3`: Skarmory
is going to matter, and Black wants the d-file open for it.

**T3 — White. ⚡FLYING.**
`2. exd5[Volt Switch] ADV` — Elekid's kit is *Thunder Punch / Volt Switch / Brick Break / Charge*. White
captures with **Volt Switch**: Electric, tier 3, and a `WITHDRAW` move (`selfSwitch`), so the piece
**captures and returns to e4 instead of occupying d5**. `Electric → Water = +1` ⇒ **ADVANTAGE**, FORCE = 0.
A bonus sub-move is granted, and White's King is not exposed, so it stands.
`→ 2. Nf4` — White spends the bonus on a **developing move**, bringing Talonflame to f4. Flying is charged
*this* turn but Talonflame has no target yet, and White would rather have it on f4 for the next Flying charge
than trade it now. **White has spent a Charged Flying turn on tempo rather than on a capture — a real
decision, made visible by the queue, and the kind of decision a chess player will recognise immediately.**
Black is a pawn down for nothing, and the pawn that took it is still on e4 behind its own structure.
**New Forecast:** `T4 ⚡PSYCHIC · T5 ⚡ICE · T6 ⚡GROUND`.

**T4 — Black. ⚡PSYCHIC.**
`2… Nc6` — Aerodactyl (Rock knight) develops to c6. Alakazam is Black's Psychic bishop and it is charged
*this* turn, but it has no target in reach: Black checks the Clash Panel on every White piece and every row
says NO TARGET. **Black plays the developing move and banks the information that its own T6 is ⚡GROUND, when
Aerodactyl's *Rock Slide* is not charged but Larvitar's *Bulldoze* is.**

**T5 — White. ⚡ICE.**
Lapras (Ice bishop) has a shot at Aerodactyl on c6, and this is the first genuinely sharp decision of the
game — because **three** of its four moves can take the knight and they are not equivalent. The Clash Panel:

```
LAPRAS ♝ ◆ICE  →  AERODACTYL ♞ ◆ROCK          (this turn is ⚡CHARGED: ICE)
 ● Ice Shard      ·Ice   T1 ⚡3  MELEE     ADVANTAGE  step 0 (Ice→Rock) +1 charged   FORCE −1  · priority +1
   Sparkling Aria ·Water T3 ⚡2  RING_ALL  ADVANTAGE  step +1 (Water→Rock)           FORCE  0  · hits ALL neighbours
   Megahorn       ·Bug   T4 ⚡2  MELEE     TRADE      step 0 (Bug→Rock)              FORCE +1  · 85% — CAN MISS
```

Three real options, and the type-blind player takes the worst of them. **Megahorn** has the biggest base power
and the highest FORCE, and it delivers a plain TRADE, requires Lapras to step onto c6 where it can be
recaptured, and is the **only row in the panel that can miss** (85%). **Ice Shard** works because the Ice charge
upgrades a neutral matchup, but it spends the charge and steps in. The type-literate move is
`3. B~c6[Sparkling Aria]~ ADV`: Water is super-effective on Rock **without** spending the Ice charge, and
because Sparkling Aria is `allAdjacent` (**RING_ALL**) Lapras resolves it **from its own square and never steps
onto c6** — so it cannot be recaptured. The cost, which the panel spells out, is friendly fire: Lapras checks
that none of its own pieces are adjacent first. Same capture, one bonus sub-move, one saved charge, no
exposure, no miss chance. That is the 0.572 pawns per capture, in one click.
`→ 3. Ng5` — the bonus sub-move develops Talonflame to g5, hitting f7.

**T6 — Black. ⚡GROUND.**
Black is down a pawn and a knight and has one charged Ground turn. Larvitar (Rock pawn, kit *Rock
Slide / Bulldoze / Stealth Rock / Sand Tomb*) is on e7. White's Elekid (Electric) sits on e4, its **Charizard
(declared Fire)** has come out to f4, and Talonflame is on g5.
Black's move is `3… e6` — Larvitar steps to e6, adjacent to nothing yet — and then, next turn, the bomb. But
the Forecast says Ground is charged **now**, so Black plays the sharper line instead:

`3… e5` then `3… ~[Bulldoze]~ AREA:2`. Larvitar double-steps to e5 — adjacent to e4, f4, d4, f5, d5, d6, e6,
f6 — and Bulldoze (Ground, tier 2, `allAdjacent` ⇒ **RING_ALL**) resolves from e5 without the pawn moving
again. FORCE = (2−3) + 0 STAB (Larvitar declared **Rock**, Bulldoze is Ground) = **−1**, comfortably clear of
the −3 REPELLED threshold. Because it is RING_ALL it would hit Black's own neighbours too, and Black checks
first: d6, e6 and f6 are empty. Then one action, two independent Clashes:

- **Elekid (Electric) on e4** — `Ground → Electric = +1`, charged ⇒ step `+2` ⇒ **ROUT**.
- **Charizard (Fire) on f4** — Charizard declared **Fire**, not Flying, so it is **not** Ground-immune ⇒
  `Ground → Fire = +1`, charged ⇒ **ROUT**. *(Had White declared Charizard as Flying at draft, this row would
  read `NO EFFECT` and the whole combination would not exist.)*
- Talonflame on g5 is out of the ring, and it is **Flying**, so it would have read `NO EFFECT` anyway.

Two pieces, including White's queen, removed by an un-promoted Rock pawn.

That is the moment the design exists for. It is not luck: the Ground charge was on the board three turns
early, Charizard's declared type was public from the draft, and White chose to leave its queen adjacent to an
un-promoted Rock pawn on a Ground-charged turn. Black earned **one** bonus sub-move (an AREA action grants at
most one no matter how many pieces it removes, §7.4), and R5 checks whether White's King is now capturable —
it is not, so the bonus stands: `→ 3… Rd8` centralising Skarmory.

Position after six turns: White has lost queen and pawn for a pawn and a knight; the material count is close
but White's *coverage* is wrecked (Charizard carried the Dragon Pulse answer to Black's Garchomp), and
Black's Skarmory now looks at a d-file with no Fire piece on it. **New Forecast: `T7 ⚡STEEL · T8 ⚡FAIRY ·
T9 ⚡DARK`** — and Black has three Steel declarations.

### 22.3 The dramatic mid-game exchange (move 24)

Position. Black: **Skarmory** (Steel rook, Rocky Helmet, `boost 0 / wound 1` from Stealth Rock) on **g5**;
**Gengar** (Ghost bishop, Focus Sash) on **b3**; **Tyranitar** on **d1** — Black's Larvitar, promoted on move
19, now a **Queen-class Rock piece**. White: King on **g8**, **Blissey** (Normal rook, Ring Target) shielding
it on **g7**, **Weavile** (Dark knight, Expert Belt) on **e6**, **Gyarados** (Water rook) on **a5**,
**Talonflame** (Flying knight) on **e2**, **Clefable** (Fairy bishop) on **c2**. It is Black's turn.
**Forecast window: `this turn (Black) ⚡FLYING · next (White) ⚡STEEL · then (Black) ⚡GHOST`.**

Black sees a three-sub-move line, and the Clash Panel prices every step of it before a single click:

1. **`24… R~g7[Brave Bird]* ADV`.** Skarmory strikes Blissey with **Brave Bird**: Flying, tier 5, and
   `target: 'any'` ⇒ **RAY_ANY**, so it reaches g7 from g5 at distance 2 **and Skarmory does not move**.
   `Flying → Normal` is `0`; **Flying is charged this turn** ⇒ step `+1` ⇒ **ADVANTAGE**. FORCE = (5−3) + 0
   (Skarmory declared **Steel**, so no STAB on a Flying move) + 0 = **+2** — one short of OVERWHELM. Cost:
   Brave Bird carries `recoil [33,100]`, so Skarmory takes **+1 wound** (now `wound 2` ⇒ `wounded`, one hit
   from a KO). Blissey dies. A bonus sub-move is granted — and then **R5 fires its check**: with g7 empty,
   Skarmory on g5 attacks up the g-file to **g8**, so **White's King is capturable**.
   **R5 ends Black's turn immediately and the bonus sub-move is forfeit.**

   That is the rule doing its job: Black cannot expose the King and then take it in the same turn. White gets a
   reply, exactly as Marseillais Chess legislated a century ago — and Black *knew* it would, because the panel
   showed the forfeit before the click. Black played it anyway, because the alternative was worse.

2. **White must answer the exposure, and its natural answer is to take the rook.** `25. Nxg5` with Weavile
   (Dark knight on e6 — a legal leap to g5 — kit *Triple Axel / Ice Shard / Night Slash / Swords Dance*).
   The Clash Panel is brutal reading:

```
 WEAVILE ♞ ◆DARK  →  SKARMORY ♜ ◆STEEL     (White's turn is ⚡CHARGED: STEEL — helps Skarmory, not Weavile)
   Triple Axel  ·Ice     T2  ⚡2   BACKLASH   step −1 (Ice→Steel)     FORCE −1   · both fall
   Ice Shard    ·Ice     T1  ⚡3   BACKLASH   step −1                  FORCE −2   · both fall
   Night Slash  ·Dark    T3  ⚡2   BACKLASH   step −1 (Dark→Steel)     FORCE  0   · both fall
   ⚠ every option is BACKLASH. Skarmory's Rocky Helmet adds +1 wound to the attacker on any Clash it survives.
```

   **Steel's 32% ARM, measured, is the whole reason this position is hard.** Weavile *can* remove the rook,
   but it dies doing it — and Weavile is White's only piece with an Ice answer to Black's Tyranitar.

3. **White's other recapture is no better.** Gyarados (Water rook on a5) can slide the fifth rank to g5, and
   every one of its rows is BACKLASH too: `Water → Steel` **0.5×**, its coverage slot **Crunch** (Dark → Steel)
   **0.5×**, **Bounce** (Flying → Steel) **0.5×**. FORCE cannot rescue any of them — Gyarados would need
   FORCE ≥ +3 to overwhelm a resisted hit up into a TRADE, and Waterfall at tier 3 with no STAB is FORCE 0.
   And interposing does not work either: nothing White owns can reach g6 or g7 this turn.
   **Every White piece that can take the Steel rook dies doing it.**

   So White plays `25. Kh7` — legal, because a King may move to an attacked square (R2), and a rook on g5 does
   not see h7 — accepting that Skarmory lives. The Steel rook has just eaten a rook, from range, and survived
   two would-be recaptures **because of its declared type**. This is the moment **Steel's measured 32% ARM**
   stops being a table in a design document.

4. **Black's next turn, ⚡GHOST — a three-sub-move turn, all of it deterministic.**
   `25… Bxc2[Hex] ADV` — Gengar (Ghost bishop on b3) steps onto c2 and takes **Clefable** (Fairy bishop) with
   **Hex** (`target: normal` ⇒ MELEE): Ghost, tier 3, STAB +1, and `Ghost → Fairy = 0` upgraded by the Ghost
   charge to **+1** ⇒ **ADVANTAGE**, FORCE = (3−3) + 1 = **+1**. *(Note what Gengar could not do: White's pawn
   on b2 is Normal, and `Ghost → Normal` is 0× — that row is greyed out with a dashed ring, and Gengar would
   have had to switch to Sludge Wave.)* R5 checks White's King on h7: a bishop on c2 does not see it, so the
   bonus **stands**.
   `→ 25… Q~[Rock Slide]~ ADV` — Black spends the bonus on **Tyranitar** on d1, whose Rock Slide
   (`allAdjacentFoes` ⇒ **RING_FOES**, so it spares the Gengar that just landed on c2) catches **Talonflame**
   (Flying knight) on **e2**: `Rock → Flying = +1` ⇒ **ADVANTAGE**, FORCE = (3−3) + 1 STAB = **+1**. Legal under
   **D5** because *Tyranitar* has not yet earned a bonus this turn (Gengar has), and an AREA grants **one**
   bonus however many pieces it removes (§7.4). Rock Slide is 90% accurate, so this is the one row in the whole
   sequence that can miss — Black takes it because a miss costs only a sub-move it was going to spend anyway.
   R5 checks again: nothing now attacks h7.
   `→ 25… Rg7` — the third sub-move walks Skarmory into g7, beside the King. **That sub-move exposes the King
   again, which is precisely why it is safe as the third one**: the turn was ending at the T1 cap regardless, so
   R5 costs Black nothing. White must now answer a wounded Steel rook on g7 that nothing in its army can
   profitably take. Over two turns Black has won a rook, a bishop and a knight for one wound and one forfeited
   bonus move.

What that exchange demonstrates, and why I think it is the design's best moment: **not one die was rolled.**
Every branch was visible in the Clash Panel before it was chosen. Black won it by knowing that **32% of real
enemy kits cannot attack a Steel piece without dying** (§11.1, measured), by reading a Ghost charge three turns
before it landed, and by understanding R5 well enough to *spend* a forfeited bonus on move 24 and to place the
exposing sub-move last on move 25, where the forfeit costs nothing. White lost it by
declaring Charizard as **Fire** instead of **Flying** on turn 0 of the draft — a single click, twenty-four
moves earlier, that made its queen vulnerable to a pawn's Bulldoze. That is a game with a skill ceiling.

## 23. What I traded away, and what to measure first

**Traded away, deliberately:**

1. **The d6.** The video's dice are gone from capture resolution. I keep coin-flip randomness exactly where
   the TCG puts it — on the attack you chose (accuracy) and on riders — and I keep a public, plannable
   Forecast. If the project owner's reading of "RNG is a feature" requires a visible die on every capture,
   the smallest faithful concession is to raise the Forecast to two charged types per turn; that costs σ, not
   architecture. What I will not do is roll after the click.
2. **Type identity as a piece-value driver.** The spread is 1.16× and that is on purpose (§11.2). A player who
   wants "Steel pieces are just better" will not find it here.
3. **Per-move fidelity on ~34 moves.** VARPOWER, STATSWAP and ABILITYMOD are approximated (Gyro Ball is a
   tier-3 hit with a speed-based ±1, not a true inverse-speed scale). A Pokémon expert will notice.
4. **Iron Defense vs Swords Dance.** Collapsing all six stats and all stages into `boost` means offensive and
   defensive buffs are mechanically the same +1. This is the least faithful decision in the document and I
   take it for one displayed number instead of six.
5. **Hidden information.** Everything is public. Illusion is the one sanctioned exception. This kills the
   surprise value of Frisk/Forewarn/Anticipation (repurposed as board-analysis QoL) and makes the AI
   tractable.
6. **Dynamax, the 17 signature Z-Moves as distinct effects, and the 46 fan Mega Stones.** Cut with reasons.
7. **Free-form drafting.** You cannot bring any 16 Pokémon to a rated game. Format A hands you 46 cards;
   Format B caps you at 42.00 pawns in fixed slots. Sandbox and Unbound exist for the players who want the
   toy box, and they are not rated.

**The five measurements that must run before v1 ships**, in priority order:

1. **White's score over 10,000 Mirror games** (§12.7). Target 50% ± 2%. This is the one number that decides
   whether the extra-move mechanic is fair at all.
2. **Draft share** over the first 2,000 rated games (§12.9). Target ≤ 0.25.
3. **`P(uncapturable ≥ 20 turns)`** (§7.5). Target < 5%, else 0× degrades to "graze".
4. **The bonus-decline rate and the sub-moves-per-turn distribution.** If sub-moves/turn exceeds 1.4, T1
   drops from 3 to 2 and the animation budget with it.
5. **The type-quiz-vs-badge fit** (§14 prediction 10). If type literacy does not predict rating better than
   chess Elo does, the central claim of this design is wrong and I would want to know in month one, not year
   two.
