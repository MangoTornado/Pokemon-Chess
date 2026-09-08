# Pokémon Chess — Design Specification: **MAINLINE BATTLE-SIM**

**Author role:** game designer (mainline battle-sim philosophy).
**Status:** complete, implementable proposal. Every number marked *(measured)* was computed on this machine
against `@pkmn/dex@0.10.11` / `@pkmn/data@0.10.11`; probe scripts are
`/tmp/pkmn-probe/battlesim-{1-damage,2-skirmish,3-clash,4-worked,5-choice}.mjs`.
**Reads as binding:** `DIRECTION.md` (authoritative), then `BRIEF.md`, then `recon-data-substrate.md`
(authoritative on data), then `recon-moves.md`, `recon-abilities-items.md`, `recon-variants.md`,
`recon-tcg.md`, `recon-tech.md`, `recon-visual.md`. Deviations from a recon doc's *recommendation* are
listed with reasons in §26.

---

## 0. Thesis, and the one bet

> **A capture is a battle, and it is resolved the way Pokémon resolves one.**

Pieces have real HP. Damage is computed with the real gen-9 damage formula from real base stats, real move
base power, STAB, stat stages, weather, terrain, screens, abilities, items and the type chart. Nothing about
a Pokémon's power is collapsed into an abstraction.

**The bet, and it is the whole proposal:** the video's four capture outcomes are not rules we impose — they
are what the damage formula *already does*, and we can prove it. Measured over 6 000 random one-blow
exchanges between real Pokémon at level 50 (`battlesim-3-clash.mjs`):

| Move effectiveness | capture | capture **+ free move** | both die | attacker dies alone | attack bounces off |
|---|---|---|---|---|---|
| **2× super effective** | — | **86 %** | 9 % | 2 % | 2 % |
| **1× neutral** | **53 %** | — | 10 % | 20 % | 16 % |
| **0.5× resisted** | 11 % | — | 1 % | **52 %** | 36 % |
| **0× immune** | *the move is not generated* | | | | |

Read that table against `BRIEF.md` §2 rule 3. "Super effective → capture and move again" (86 %). "Neutral →
ordinary capture" (53 %, the modal outcome). "Not very effective → you lose your piece" (53 % of the time,
plus 36 % nothing happens). "Immune → illegal". **The source ruleset is the emergent behaviour of the real
damage formula.** No other proposal can say that, because no other proposal computes damage.

What we buy with real HP, beyond faithfulness:

1. **Hard problem 6 dissolves.** A Flying piece that no Ground move can capture still dies to Stealth Rock,
   to sandstorm, to Toxic, and to a Fire Blast fired from three squares away. *Immunity blocks a capture, it
   does not block death* — which is exactly what it does in the games. We need no one-shot-ward fudge
   (`recon-abilities-items.md` §6.1), so capture legality stays a pure function of position and the AI keeps
   the ply that `recon-tech.md` §B.5 measured the ward costing.
2. **Shedinja needs no special case.** Wonder Guard means "only super-effective moves can capture it";
   Shedinja's real HP stat at level 50 is **1** *(measured)*, so it dies to any hazard, any weather tick, any
   chip. That is precisely how Shedinja dies in the real game. Zero bespoke bounds.
3. **A third of the dex stops being decorative.** `drain`, `recoil`, `heal`, `multihit`, `damage: 'level'`,
   Leftovers, Life Orb, Rocky Helmet, Rough Skin, Sturdy, Multiscale, Filter, resist berries, poison, burn,
   Regenerator, Substitute, Perish Song — every one of these is *about HP*. With real HP they are
   implemented literally rather than approximated by a single abstract counter.
4. **Attrition gives chess something it lacks and Pokémon has: the wounded piece.** A rook at 30 % HP is a
   liability you must protect or trade. Guarding matters again, which is the failure mode `recon-variants.md`
   §1.2 warns about via Rifle Chess.

And what stops it collapsing into a slow mess, which is the only real objection:

5. **One blow each, never a loop.** A clash is exactly two blows: the attacker's, which always lands, and
   the defender's counterblow, which lands unless it was knocked out by a *faster* attacker. Bounded,
   instant, one animation.
6. **All randomness is revealed before you decide.** The turn's damage roll, crit and accuracy check are
   public at turn start. Therefore **every clash outcome is exactly known before you click** — the board
   shows a verdict glyph on every target square. The player reads verdicts, not stat bars. There are no
   chance nodes inside a turn, for the human or for the search.

---

## 1. The player's mental model, in six lines

1. Your piece moves like a chess piece. That never changes.
2. Moving onto an enemy starts a **Clash**. You pick which of your four moves to swing with; the default is
   already right 68 % of the time *(measured, `battlesim-5-choice.mjs`)*.
3. Your blow always lands. Then it hits you back — unless you knocked it out **and you were faster**.
4. HP does not come back. Everything that chips HP in Pokémon chips it here.
5. Knock something out with a super-effective move and you **move again**.
6. Every one of those results is printed on the square before you commit.

---

## 2. Board, army, setup

| Item | Value |
|---|---|
| Board | 8×8, standard chess geometry, `src/engine/board.ts` unchanged |
| Army | **16 pieces**: 1 King, 1 Queen, 2 Rooks, 2 Bishops, 2 Knights, 8 Pawns |
| Starting squares | standard (`STARTING_SQUARES`), so opening intuition transfers |
| Chess rules retained | castling, en passant, two-square pawn advance, promotion geometry |
| Declared type | **exactly one**, chosen at draft from the species' real `types` |
| Types in play | **18**. `Stellar` is excluded (0 species, 1× both ways ⇒ strictly dominant) |
| Level | every piece is **level 50** |
| Spread | the canonical all-out attacker: **252 EV in the higher offensive stat (+10 % nature), 252 Spe, 4 HP, 31 IVs** |

The spread is a real competitive build, not an invention, and it is uniform so no hidden per-piece knob
exists. Consequence *(measured, `battlesim-4-worked.mjs`)*: HP at level 50 spans **1 (Shedinja) / 101
(Magnemite) / median 143 / 330 (Blissey)**; Speed spans 57–252. Both spreads are wide enough to matter and
narrow enough to hold in your head.

### 2.1 Declared type does what it does in Pokémon

This is the single most important faithfulness decision in the document, and it is where the mainline
philosophy departs from a literal reading of the video.

- **The declared type is the piece's *defensive* identity** and its STAB type. It is the enamel colour on
  the pin, and it is what the enemy computes effectiveness *against*.
- **Effectiveness is computed from the type of the move being used**, because that is how Pokémon works.

The video's "one type only" rule is preserved where it matters and made deeper where it doesn't:

- **Slot 0, the Assault, must be a damaging move of the declared type.** It is the move used by default
  whenever you charge into a square, so "Ground cannot capture Flying" is still the headline rule on the
  default line of play.
- Coverage moves in slots 1–3 are a deliberate, visible, charge-limited investment. Measured: a coverage
  move is strictly better than the Assault in **32 %** of clashes, and rescues an outright-illegal Assault
  in only **2 %** *(measured)*. So immunity keeps its teeth (98 % of the time it is not simply bypassed)
  while type mastery is worth roughly one outcome rung, a third of the time.
- Knowing your moveset triples your free-move rate: super-effective knockouts rise from **12 % to 32 %** of
  clashes when the player picks the best of four rather than always swinging with the Assault *(measured)*.

That last row is the quantified answer to "how does the Pokémon player beat the better chess player".

---

## 3. Data model

Real TypeScript, compatible with the existing modules. `Position` (`src/engine/position.ts`) already gives
us persistent piece ids that survive promotion, packed move generation, and a Zobrist seam (`xorHash`);
the Pokémon layer keys off `Piece.id` and never forks move generation.

```ts
// src/rules/state.ts
import type { PieceClass, Side, Square } from '../engine/board.ts';
import { Position } from '../engine/position.ts';
import type { BattleType } from '../data/schema.ts';
import type { RngState } from '../engine/rng.ts';

/** Six stats in canonical order. Baked at draft from base stats + level + the fixed spread. */
export interface StatBlock {
  readonly hp: number; readonly atk: number; readonly def: number;
  readonly spa: number; readonly spd: number; readonly spe: number;
}

/** Stat stages, −6..+6, exactly as in the games. Two extra channels for accuracy/evasion. */
export interface Stages {
  atk: number; def: number; spa: number; spd: number; spe: number;
  accuracy: number; evasion: number;
}

export type Status = 'brn' | 'psn' | 'tox' | 'par' | 'slp' | 'frz';

/** Volatiles as a bitmask; `VOLATILE_TURNS` carries the countdown for the ones with duration. */
export const enum Volatile {
  Confusion = 1 << 0, Flinch = 1 << 1, LeechSeed = 1 << 2, Substitute = 1 << 3,
  Trapped = 1 << 4, Taunt = 1 << 5, Encore = 1 << 6, Disable = 1 << 7,
  Charging = 1 << 8, Recharging = 1 << 9, Rooted = 1 << 10, MagnetRise = 1 << 11,
  Perish = 1 << 12, DestinyBond = 1 << 13, Protected = 1 << 14, Grounded = 1 << 15,
  Yawn = 1 << 16, AquaRing = 1 << 17, FocusEnergy = 1 << 18, Minimize = 1 << 19,
  Torment = 1 << 20, Curse = 1 << 21, SaltCure = 1 << 22, Illusion = 1 << 23,
}

export interface MoveSlot {
  readonly moveId: string;
  /** `clamp(round(pp / 5), 1, 5)` at draft. Slot 0 always gets 5. */
  charges: number;
  readonly maxCharges: number;
}

/** Everything the Pokémon layer knows about one piece. 12 words plus four slots. */
export interface PokemonPiece {
  readonly id: number;              // === Position piece id; survives promotion
  readonly side: Side;
  cls: PieceClass;                  // mutated by promotion only
  speciesId: string;                // mutated by promotion / Mega / forme change
  chessType: BattleType;            // the declared single type
  stabTypes: readonly BattleType[]; // declared type, plus the pre-Tera type after Terastallizing
  stats: StatBlock;                 // recomputed on species change, HP fraction preserved
  hp: number;
  maxHp: number;
  stages: Stages;
  status: Status | null;
  statusTurns: number;              // sleep counter, toxic counter
  volatiles: number;                // Volatile bitmask
  volatileTurns: Int8Array;         // 24 counters, parallel to the bitmask
  abilityId: string;
  abilitySuppressed: boolean;       // Neutralizing Gas ring, Gastro Acid
  itemId: string | null;
  itemUsed: boolean;                // consumed berries/Sash leave a visible empty slot
  moves: readonly [MoveSlot, MoveSlot, MoveSlot, MoveSlot];
  /** Set once the piece has taken any damage. Drives `Sturdy` / `Multiscale` / `Focus Sash`. */
  pristine: boolean;
  choiceLock: string | null;        // Choice item: the move id it is locked to
  teraUsed: boolean;
  earnedBonusThisTurn: boolean;     // T2: one bonus per piece per turn
  usedBonusThisTurn: boolean;
}

export type Weather = 'none' | 'sun' | 'rain' | 'sand' | 'snow' | 'harsh-sun' | 'heavy-rain' | 'delta';
export type Terrain = 'none' | 'electric' | 'grassy' | 'misty' | 'psychic';

export interface FieldState {
  weather: Weather; weatherTurns: number;
  terrain: Terrain; terrainTurns: number;
  trickRoom: number; gravity: number; magicRoom: number; wonderRoom: number;
  /** Per-side screens and wards, duration in turns. */
  screens: Record<Side, { reflect: number; lightScreen: number; auroraVeil: number; safeguard: number; mist: number; tailwind: number }>;
}

/** Hazards live on individual squares, painted as a 3-square segment (see §9.4). */
export interface HazardCell {
  spikes: 0 | 1 | 2 | 3;
  toxicSpikes: 0 | 1 | 2;
  stealthRock: 0 | 1;
  stickyWeb: 0 | 1;
  owner: Side;                      // whose hazard it is; it harms the other side
}

/** The public randomness for one turn. Revealed BEFORE any decision. */
export interface Oracle {
  /** Momentum: the games' damage roll, 85..100. Applied to every damage calc this turn. */
  readonly momentum: number;
  /** Focus: 1..16. A blow crits when `focus <= critWindow(piece, move)`; base window is 1 (1/16). */
  readonly focus: number;
  /** Precision: 1..100. A move lands when `precision <= effectiveAccuracy(move, attacker, defender)`. */
  readonly precision: number;
}

export interface MatchState {
  readonly position: Position;                  // the chess substrate, untouched
  readonly pieces: Map<number, PokemonPiece>;   // by piece id
  readonly field: FieldState;
  readonly hazards: Map<Square, HazardCell>;
  readonly graveyard: PokemonPiece[];           // for the material HUD and the Prize track
  oracle: Oracle;
  rng: RngState;
  /** Sub-moves taken this turn, 1..3. */
  chain: number;
  trainerActionUsed: Record<Side, boolean>;
  /** Sub-moves since the last progress event (§14.3). */
  sinceProgress: number;
  subMoveCount: number;
  history: readonly bigint[];                   // full-state hashes for repetition
}
```

### 3.1 The action space

```ts
// src/rules/actions.ts
export type Action =
  | { kind: 'advance';  from: Square; to: Square; promotion?: PromotionChoice }
  | { kind: 'assault';  from: Square; to: Square; slot: 0|1|2|3; promotion?: PromotionChoice }
  | { kind: 'art';      from: Square; slot: 1|2|3; target: Square | null }
  | { kind: 'trainer';  play: 'tera' | 'mega' | 'zpower'; on: Square; teraType?: BattleType }
  | { kind: 'declineBonus' };

export interface PromotionChoice { speciesId: string; cls: PieceClass; type: BattleType; }

export function generateActions(s: MatchState, out: Action[]): number;
export function applyAction(s: MatchState, a: Action): EffectEvent[];   // mutating, undo-stacked
export function forecast(s: MatchState, a: Action): ClashForecast | null;
export function terminal(s: MatchState): Terminal | null;
```

`generateActions` is a filter over `Position.generatePseudoLegalMovesInto` plus the ART and Trainer actions.
Three legality layers sit on top of the chess layer and nothing else:

1. an `assault` whose chosen move has effectiveness 0 against the defender's declared type, and which no
   `pierce` effect covers, is **not generated** (the video's rule 3c);
2. an action that, **under the revealed Oracle**, deterministically removes your own King is not generated
   (Atomic rule 5, §14.2);
3. a piece that cannot act (asleep, frozen, flinched, recharging) generates nothing.

Note what is *not* here: there is no state-dependent uncapturability. `Position`'s move generation stays
pure, so the transposition-table key stays cheap (`recon-tech.md` §B.5).

---

## 4. The Oracle — all randomness, revealed first

Three integers are drawn from the seeded PRNG at the start of every turn and shown in the rail, publicly,
to both players, **before any decision**:

| Name | Range | Pokémon original | Board meaning |
|---|---|---|---|
| **Momentum** `M` | 85–100 | the damage formula's random factor | every damage calculation this turn is multiplied by `M/100` |
| **Focus** `F` | 1–16 | the critical-hit roll | a blow crits when `F ≤ critWindow`; base window 1 (**1/16**) |
| **Precision** `P` | 1–100 | the accuracy check | a move lands when `P ≤ effective accuracy` |

Three things fall out, and each one is load-bearing:

- **Every clash outcome is exactly computable before you commit.** The forecast is not a probability, it is
  the answer. This is the strongest possible response to `DIRECTION.md`'s "legibility under load" constraint
  and to `recon-variants.md` §6.3's ruling that rolling after commitment costs ≈5× on variance.
- **The crit ladder is the same object in both canons.** Gen 6+ crit stages are 1/16 → 1/8 → 1/2 → always;
  `recon-tcg.md` §2.3 measures the TCG's randomiser alphabet as powers of ½ and recommends exactly 1/16
  presented as "flip four coins". So Scope Lens / Super Luck widen the window from 1 to 2 (1/8), Focus
  Energy to 8 (1/2), `willCrit` moves to 16 (always) — and the UI can honestly draw it as coins. The two
  canons agree and we did not have to choose.
- **Search has no interior chance nodes within a turn.** `recon-tech.md` §B.3 measured full chance-node
  enumeration at 121–159× and input randomness at +10 %. We take the +10 %.

One Oracle per turn, shared by both sides' calculations during that turn — including the defender's
counterblow. A three-sub-move chain runs under one Oracle, which is what makes a chain plannable rather
than a slot machine.

**Why this is not a nerf to drama.** The drama moves one step earlier, to the reveal. `M = 100` with
`F = 1` is a window: your Charizard now knocks out their Dragonite, and both players can see it. A `P = 96`
turn is a turn where every 70 %-accuracy move on the board is dead. The Oracle is a public weather-vane of
opportunity, and it is the single best new mechanic in this proposal.

```ts
// src/rules/oracle.ts
export function rollOracle(rng: RngState): { oracle: Oracle; rng: RngState };
export function critWindow(p: PokemonPiece, move: MoveEntry, field: FieldState): 1|2|4|8|16;
export function effectiveAccuracy(a: PokemonPiece, d: PokemonPiece, m: MoveEntry, f: FieldState): number;
```

---

## 5. The turn loop

```
TURN(side):

 1. REVEAL      oracle := rollOracle()                     // PUBLIC, before anything
                recompute every legal action and its exact verdict; paint verdict glyphs

 2. UPKEEP      (only for `side`'s pieces, in the published order of §10.4)
                weather chip -> terrain heal -> item residuals (by real onResidualOrder)
                -> Leech Seed -> psn -> tox -> brn -> Aqua Ring/Ingrain -> Salt Cure/Curse
                -> status counters (sleep, freeze) -> volatile & field countdowns -> Perish
                -> DEFERRED REMOVAL: every piece at hp <= 0 is removed simultaneously
                (Kings floor at 1 hp against indirect damage — the Last Stand rule, §14.5)

 3. ACT         chain := 1
                loop:
                  the player takes exactly ONE action:
                    ADVANCE  relocate along the chess pattern onto an empty square. Free.
                    ASSAULT  relocate onto an enemy square -> CLASH (§6). Spends 1 charge of the
                             chosen slot; slot 0 exhausted => the piece Struggles (§9.3).
                    ART      use slot 1/2/3 in place: ranged attack, area attack, status, boost,
                             heal, hazard, field. Spends 1 charge. The piece does NOT move.
                             A damaging ART WOUNDS but never knocks out (floors at 1 HP) — §6.2.
                    TRAINER  Terastallize / Mega Evolve / Z-Power. Once per side per game. Ends the turn.
                  resolve it fully; emit EffectEvent[]
                  if the enemy King is now capturable by any of `side`'s pieces:  break      // T3
                  if the resolution granted a BONUS and chain < 3:                           // T1
                       the player may take one more action with any piece that has neither
                       earned nor used a bonus this turn, or DeclineBonus                    // T2
                       chain := chain + 1; continue
                  break

 4. CLOSE       subMoveCount += chain
                sinceProgress := 0 if a progress event occurred this turn, else += chain
                clear earnedBonusThisTurn / usedBonusThisTurn
                push full-state hash; evaluate §14.3 terminal conditions
                toMove := other side
```

**A BONUS is granted by exactly one thing:** an ASSAULT that knocked the defender out with a
**super-effective** move, where the attacker survived. Nothing else in the game grants an extra action —
not ARTs, not area knockouts, not abilities, not items, not crits. §14.4 proves the bound on that.

### 5.1 Pacing — the seconds-per-turn defence

The objection to a battle sim is that it is slow. Here is the decomposition, for an experienced player,
with the reasoning for each line.

| Step | Median cost | Why it is that cheap |
|---|---|---|
| Read the Oracle | **0.5 s** | three glyphs in the rail, and the rail flashes only when the reading changes the board's verdicts |
| Chess deliberation | **3.5 s** | unchanged from chess; this term dominates and we do not touch it |
| Read target verdicts | **1.0 s** | the engine has already computed every clash; each target square carries one of five outcome glyphs. No arithmetic is performed by the human |
| Choose a non-default move | **+2.5 s, on 8 % of turns** | 25 % of turns are captures × 32 % where a coverage move is strictly better *(measured)*; the UI marks the better slot with a chevron so the player is told when to look |
| Commit | **0.5 s** | one click, or two in confirm mode |
| **Median total** | **≈ 5.7 s** | |
| 90th percentile | ≈ 16 s | a chain turn with a real branching decision |

For calibration, 10+0 online blitz runs ≈ 8 s/move and casual rapid ≈ 5 s/move. **Pokémon Chess turns cost
roughly what a blitz chess move costs**, because the added Pokémon decision is (a) pre-computed by the
engine, (b) defaulted correctly 68 % of the time, and (c) surfaced only when it matters. At ~42 moves per
side, a game runs **9–12 minutes**.

Animation never enters this budget: the Presenter (§21, §23.2) advances engine state instantly and any input
fast-forwards the board lane to completion (`recon-visual.md` §7.2). Default clash beat 900 ms, Fast
350 ms, Instant 0.

### 5.2 The eight-stat-bars problem, answered

A piece on the board shows, at most, six channels, and four of them are usually absent:

| Channel | Encodes | When shown |
|---|---|---|
| outer silhouette | **chess role** | always |
| enamel colour + glyph | declared type | always |
| bezel metal (bone / ink) | owner | always |
| HP arc on the bezel, 8 segments | HP | **only when below max** |
| sprite rotation / counter pips | status | only when statused |
| chevron cluster, up to 2 glyphs | net stat stages | only when non-zero |

**Base stats are never displayed on the board.** They are inputs to a calculation the engine performs, and
the player is shown the *result* — one of five verdict glyphs per target square. The full damage
calculation is one hover away, in the Battle Readout:

```
  Gengar (Ghost, Bishop)  →  Espeon (Psychic, Bishop)
  SHADOW BALL   Ghost · Special · 80 BP · charge 3/3
  STAB ×1.5   ·   super effective ×2   ·   Momentum 93
  278 damage  vs  141 HP        counterblow: PSYCHIC 1× → 0 (outsped)
  ▶ ADVANTAGE — Espeon is knocked out, Gengar takes the square, you move again
```

That is one screen, and it is the whole sim. Progressive disclosure, not fewer mechanics — which is what
`DIRECTION.md` asks for.

---

## 6. The Clash — capture resolution, every case

One resolver. It is the only place in the codebase where an outcome is decided.

```
CLASH(A: attacker, aMove: slot, D: defender, oracle):

 1. LEGALITY
      eff := chart[type(aMove)][D.chessType]
      pierces := pierceSet(A)                       // Scrappy, Mind's Eye, Mold Breaker, Ring Target(on D)
      if eff === 0 and 'immunity' not in pierces:            -> NOT GENERATED
      if ward(D) blocks type(aMove) and not pierced:         -> NOT GENERATED
            // Levitate vs Ground, Flash Fire vs Fire, Bulletproof vs bullet, Air Balloon vs Ground,
            // Wonder Guard vs anything not super effective, Protect this turn, Queenly Majesty vs bonus
      if D.volatiles & Substitute: the blow hits the Substitute instead (§9.5); no counterblow

 2. PRECISION
      if oracle.precision > effectiveAccuracy(A, D, aMove):  -> WHIFF
            A does not move, spends the charge, takes no damage; D untouched; turn continues but
            no bonus. (Known before commitment, so a WHIFF is never a surprise — the square shows it.)

 3. ORDER
      aFirst := priority(aMove) > 0
             or (priority(aMove) === 0 and speedWins(A, D, field))
      speedWins compares effSpeed = spe × stageMul(spe) × (par ? 0.5 : 1) × item/tailwind mults,
      inverted when Trick Room is up; the attacker wins exact ties (it initiated).

 4. FORWARD BLOW  (always lands — the attacker committed)
      dmgF := damage(A, D, aMove, oracle)               // §7
      D.hp -= dmgF ;  D.pristine := false
      run ON_DAMAGED(D)   // Weakness Policy, Anger Point, Berserk, Rocky Helmet, Rough Skin (contact only)
      run ON_HIT_SELF(A)  // recoil, Life Orb, drain, contact punishment

 5. COUNTERBLOW
      counters := not (D.hp <= 0 and aFirst)
      // A defender knocked out by a faster attacker never swings. OUTSPEEDING is how you take a
      // capture for free; BEING OUTSPED is how you get traded.
      if counters and D can act (not asleep/frozen/flinched):
            dmgB := damage(D, A, D.moves[0], oracle) × 0.75      // the Counterblow factor, §7.3
            A.hp -= dmgB ;  A.pristine := false ;  run ON_DAMAGED(A)

 6. (there is deliberately no outcome-conversion step here)
      Sturdy / Focus Sash / Multiscale / Ice Face / Disguise are ordinary HP effects, not outcome
      rewrites: they clamp `hp` to 1, or halve incoming damage, inside step 4. They therefore compose
      with everything automatically, and the Focus-Sash exploit that needed a bespoke one-directional
      rule in a binary-capture design cannot form here — a Sash leaves you at 1 HP, and the
      counterblow can still kill you.

 7. CLASSIFY
      dDead := D.hp <= 0 ;  aDead := A.hp <= 0
      dDead and not aDead and eff > 1  ->  ADVANTAGE
      dDead and not aDead              ->  CAPTURE
      dDead and aDead                  ->  MUTUAL
      not dDead and aDead              ->  ROUT
      neither                          ->  REPEL

 8. APPLY
      ADVANTAGE : remove D. A occupies the square. GRANT BONUS.
      CAPTURE   : remove D. A occupies the square.
      MUTUAL    : remove D, then remove A. Square is empty. (Removal order matters for §14.2/R4.)
      ROUT      : remove A. D holds the square, wounded.
      REPEL     : A returns to its origin square. Both keep their damage.
      then, if A moved: run ON_ENTER(A, square)      // hazards, Intimidate, terrain seeds
      then riders: the chosen move's `secondary` effects, gated on `oracle.precision` (§9.6)
```

### 6.1 The five outcomes, complete

| Verdict | Defender | Attacker | Square | Bonus | Video's rule it realises |
|---|---|---|---|---|---|
| **ADVANTAGE** | removed | survives | attacker takes it | **yes** | 3a "super effective → move again" |
| **CAPTURE** | removed | survives | attacker takes it | no | 3d "neutral → ordinary capture" |
| **MUTUAL** | removed | **removed** | empty | no | 3b "both pieces are removed" |
| **ROUT** | survives, wounded | **removed** | defender keeps it | no | 3b's harder cousin (see below) |
| **REPEL** | survives, wounded | survives, wounded, returns | defender keeps it | no | new: the failed assault |
| *BLOCKED* | *never generated* | | | | 3c "immune → illegal" |
| *WHIFF* | untouched | stays, spends a charge | unchanged | no | accuracy, and it is pre-announced |

**The one place the emergent behaviour disagrees with the video, stated plainly.** The video says
not-very-effective ⇒ *both* pieces die. The damage formula says: you fail to knock it out, it hits you back,
and **you** die (52 % of resisted assaults) or nothing happens (36 %). We ship the formula's answer, and we
gain from it:

- the lesson is the same and sharper — never attack into a resistance;
- the defender is left wounded, so a sacrifice is still partly productive (mean 41 % of max HP dealt on a
  resisted blow *(measured)*), which is a better version of the video's suicide tactic than the binary one;
- **true mutual destruction still happens, at 10 % of neutral clashes and 15 % of super-effective ones
  *(measured)*, and it is caused by being outsped.** "It's faster than you, expect a trade" is now a rule
  of thumb a Pokémon player already has. Mutual destruction is also directly purchasable: Explosion,
  Destiny Bond, Aftermath, Innards Out, Rough Skin, Rocky Helmet and Perish Song all produce it on purpose.

`recon-tcg.md` §11 rules that mutual destruction is supported by *neither* canon and should be labelled a
chess rule. Our version needs no label: it is a damage-formula outcome, and the Battle Readout shows the two
HP bars crossing zero.

### 6.2 Ranged and area attacks wound; they do not knock out

**The rule, and it is one of the three most important in the document:**

> A damaging ART — anything at range or in an area (`RAY_LOS`, `RAY_ANY`, `AREA_FOES`, `AREA_ALL`, `BOARD`)
> — **cannot reduce a piece below 1 HP.** It takes no counterblow, the attacker does not move, and no piece
> is ever removed by it. Only a **Clash**, or residual damage (hazards, status, weather, Leech Seed,
> recoil), can remove a piece. The single exception is a `selfdestruct` move (7 of them: Explosion,
> Self-Destruct, Misty Explosion, Final Gambit, Healing Wish, Lunar Dance, Memento) — **you may kill at
> range only by dying.**

Why, and both canons:

- **The TCG has already drawn this line.** Damage to a Benched Pokémon is real, common and printed, but the
  Knock Out happens on the Active Pokémon — `recon-tcg.md` §1.5 quotes "Don't apply Weakness and Resistance
  for Benched Pokémon" and §10.1 treats Active-vs-Bench as *the bound, not the mechanic*. A ranged attack
  in Pokémon Chess is a Bench attack.
- **Without it, this is Rifle Chess, whose failure mode is documented in one line:** "it is of no use to
  guard pieces" (`recon-variants.md` §1.2). Measured, the problem was real: Alakazam's Psychic fired at
  Chebyshev distance 2 does **280 damage** *(measured)* — more than any piece in the sample armies has —
  so unbounded ranged kills would have made ARTs the dominant action and deleted the chess.
- **It gives the design its actual loop.** Special attackers *soften*; contact attackers *finish*. Every
  removal is a chess move onto a square, so guarding, defending and protection all keep their full chess
  meaning, while HP attrition — the thing real HP exists for — becomes the mid-game's whole texture.

The other guard rails stay: an ART costs the **entire turn**, costs a charge from a slot with 1–5, and
reaches only 2 (line of sight, blockers matter) or 3 (`target: 'any'`, blockers ignored — the 21
flying/beam moves) per `recon-moves.md` §2.2. `RETALIATE` abilities and contact punishment do not fire on
an ART, so it is the *safe* attack, which is exactly what "special attacker" should mean.

Area moves are the one place `AREA_ALL` (Earthquake, Surf, Discharge, Boomburst — 15 moves) hits your own
pieces too, and it hits them for real. `recon-tcg.md` §1.5 rules that the type modifier applies only to a
move's primary target; we deviate and apply real effectiveness to every square, because with real HP an
Earthquake that ignored a bystander's Flying immunity would read as a bug. We take the *bound* that ruling
exists for instead: **an area attack never grants a bonus sub-move, however many pieces it wounds.**

Measured example (`battlesim-6-narrate.mjs`): Garchomp's Earthquake at Momentum 93 with the ×0.75 spread
factor does 307 to a Poison queen (2×) and 211 to your own Fighting pawn (1×). Both are floored at 1 HP.
Nothing dies, no tempo is gained, and the entire ring is now at execution range for a real capture.

---

## 7. The damage pipeline

`src/rules/damage.ts` — one pure function, ~90 lines, the canonical gen-9 order of operations with
`recon-tcg.md` §11's ruling on modifier ordering respected (attacker bonuses, then the type modifier, then
defender reductions, and a defender hook may only reduce).

```ts
export interface DamageInput {
  attacker: PokemonPiece; defender: PokemonPiece; move: MoveEntry;
  field: FieldState; oracle: Oracle; isCounterblow: boolean; spread: boolean;
}
export interface DamageResult {
  damage: number; effectiveness: 0|0.25|0.5|1|2|4; crit: boolean; stab: boolean;
  /** Ordered, human-readable modifier trace. This is what the Battle Readout renders. */
  trace: { label: string; factor: number }[];
}
export function computeDamage(i: DamageInput): DamageResult;
```

Order, with the exact factor at each step:

| # | Step | Factor |
|---|---|---|
| 1 | effectiveness lookup `chart[move.type][defender.chessType]` | 0 / 0.5 / 1 / 2 |
| 2 | base power after attacker base-power hooks | Technician ×1.5 (BP ≤ 60), Iron Fist ×1.2, type lens ×1.2, terrain ×1.3, Charge ×2 (Electric), Facade ×2 if statused … |
| 3 | offensive stat × stage multiplier | `n ≥ 0 ? (2+n)/2 : 2/(2−n)`, exactly as the games |
| 4 | defensive stat × stage multiplier | crit ignores the defender's positive defensive stages |
| 5 | **base** = `floor(floor(floor(22 × BP × Atk / Def) / 50) + 2)` | level 50 ⇒ the leading term is 22 |
| 6 | spread | ×0.75 when the move hits more than one square |
| 7 | weather | Fire/Water ×1.5 or ×0.5 under sun/rain; `harsh-sun` zeroes Water, `heavy-rain` zeroes Fire |
| 8 | crit | ×1.5 when `oracle.focus ≤ critWindow` |
| 9 | **Momentum** | `× oracle.momentum / 100` — the games' random factor, made public |
| 10 | STAB | ×1.5, ×2 with Adaptability; a Terastallized piece keeps STAB on both types |
| 11 | **type effectiveness** | from step 1 |
| 12 | burn | ×0.5 on Physical moves, unless Guts |
| 13 | attacker final mods | Life Orb ×1.3, Expert Belt ×1.2 (SE only), Tinted Lens ×2 (resisted only), Neuroforce ×1.25 |
| 14 | defender final mods (**may only reduce**) | Filter/Solid Rock/Prism Armor ×0.75 (SE), Multiscale/Shadow Shield ×0.5 (pristine), Thick Fat/Heatproof ×0.5, Fluffy ×0.5 (contact), resist berry ×0.5, Reflect/Light Screen ×0.5, Ice Scales/Fur Coat ×0.5 |
| 15 | **Clash Constant σ** | ×1.6 — see §7.2 |
| 16 | Counterblow factor | ×0.75 when this is the defender's reply — see §7.3 |
| 17 | floor, minimum 1 | |

### 7.1 Worked instance, step by step *(measured)*

Gengar (Ghost bishop, SpA 200 at level 50) uses Shadow Ball (Ghost, Special, 80 BP) on Espeon (Psychic
bishop, SpD 115, HP 141) with the Oracle at `M 93 · F 9/16`:

```
 22 × 80 × 200 / 115  = 3060  (floor)          the level term is 22 at L50
 3060 / 50            =   61  (floor)
 + 2                  =   63                   base damage
 × 0.93  Momentum     =   58  (floor)
 × 1.5   STAB (Ghost) =   87  (floor)
 × 2     super effective = 174
 × 1.6   CLASH σ      =  278  (floor)          ← 278 damage vs 141 HP
```

Espeon is knocked out. Speed 162 vs 162 and the attacker wins exact ties, so the counterblow never happens.
Shadow Ball was super effective, so the verdict is **ADVANTAGE**: capture, take the square, move again. Every
line above is a row of `DamageResult.trace`, and the Battle Readout renders the rows rather than prose — the
arithmetic is the engine's job, never the player's. §18.4's golden table, generated from `@pkmn/sim` at build
time, is what keeps the pipeline honest as it grows.

### 7.2 The Clash Constant σ = 1.6 — the one non-canon number, owned

Pokémon's HP economy is tuned so that a good hit takes 40–60 % of a defensive Pokémon's HP: a battle is
4–6 turns. Chess needs a capture to resolve in 1–2. That is a genuine unit mismatch, and one scalar fixes it.

**σ is chosen by measurement, not taste.** From `battlesim-3-clash.mjs`, sweeping σ with the counterblow at
0.75:

| σ | 2× ADVANTAGE | 1× CAPTURE | 0.5× attacker survives *and* captures |
|---|---|---|---|
| 1.0 (pure mainline) | 73 % | 30 % | 2 % |
| 1.45 | 86 % | 50 % | 9 % |
| **1.6 (ship)** | **86 %** | **53 %** | **11 %** |
| 2.0 | 84 % | 57 % | 22 % |

σ = 1.6 is the smallest value at which the emergent outcome frequencies match the video's *stipulated*
outcomes: super-effective ⇒ capture-and-move-again is near-certain, neutral ⇒ capture is modal, resisted ⇒
capture is rare. At σ = 1.0 a neutral capture fails 70 % of the time and the game is a siege; at σ = 2.0
resistances stop mattering.

It ships as `format.clashConstant`, is printed on the format card, and is re-fitted by the batch simulator
(§16.4). Sandbox exposes it as a slider so a playtester can see the whole family of games.

**What we traded:** exact mainline damage numbers. A player who calculates "Shadow Ball does 44 % to
Espeon" from Smogon will see 197 %. The trace makes the σ step explicit and labelled `CLASH ×1.6`, so the
deviation is visible rather than mysterious, and every *relative* comparison — every ratio a competitive
player actually reasons with — is preserved exactly.

### 7.3 The Counterblow factor 0.75 — a midpoint between two canons

The games say a defender attacks back at full force. **The TCG says the defender does not damage the
attacker at all** (`recon-tcg.md` §1.1: Weakness/Resistance modify the attacker's damage; nothing on a card
punishes the attacker for a bad matchup). `DIRECTION.md` names both canons as legitimate. We ship the
midpoint, 0.75, and say which half comes from where.

Measured consequence, and the reason it is not just a compromise: at counterblow 1.0 the attacker dies alone
in 30 % of all clashes and attacking becomes bad play; at 0.75 that falls to 23 % while mutual destruction
stays at 8 % *(measured)*. 0.75 is the value at which **initiating is correct by default** — which chess
requires — without making it free.

Explicit exceptions, all canon: the counterblow is suppressed entirely by a positive-priority Assault
(Bullet Punch, Aqua Jet, Sucker Punch — 16 moves), by Z-Power, and by knocking the defender out while
faster. It fires at full force through Rough Skin, Rocky Helmet, Iron Barbs and Aftermath, which are
damage sources rather than counterblows.

---

## 8. What a piece is worth, and how the draft prices it

### 8.1 Values

`recon-variants.md` §3.2's type-aware model is adopted wholesale, with one addition demanded by real HP:

```
V(piece) = m(cls) · (1 − α·LIAB(t) + β·ARM(t) − ε·BLOCK(t)) · (0.55 + 0.45·hp/maxHp)
         + τ · BONUS(t)
         + κ · (BST − 500)/100
```

- `m`: Berliner/AlphaZero base class values — P 1, N 3.2, B 3.3, R 5.0, Q 9.5.
- `LIAB/ARM/BLOCK/BONUS`: the four per-type scalars from `recon-variants.md` §3.2, recomputed for our
  outcome probabilities (which are now measured, not stipulated). Three precomputed 18×18 byte tables.
- **`(0.55 + 0.45·hp/maxHp)`** is the new term: a piece at 30 % HP is worth 68 % of its full value, not
  30 % — it still blocks, still threatens, still guards. Calibrated so that "chip it then take it" is worth
  doing but not dominant.
- `κ ≈ 0.9`: base stat total genuinely matters now that damage is computed. Starting coefficients
  α 0.9, β 0.5, ε 0.3, τ 0.5, κ 0.9 — **all to be re-fitted by self-play**, per Betza's lesson
  (`recon-variants.md` §1.6: hand-balanced armies came out +62 % / −71 % over 400 engine games).

### 8.2 Draft cost

```
cost(species, type) = max(0, round( 14 · (BST/600)^1.6 · typeMult(type) − 3 ))
```

`typeMult` is `V(rook, type)` from the table above, normalised to Steel 1.14 … Bug 0.86. Worked values:
Magikarp 0, Bidoof 0, Skarmory 7, Blissey 8, Garchomp 11, Arceus 15. **Budget: 60 points for 16 pieces.**
So an army is mostly cheap Pokémon with two or three real threats — which is what a Pokémon team looks like,
and which keeps a small collection competitive (§17.4).

---

## 9. Moves

### 9.1 Four slots, and how they are chosen

Four moves per piece, exactly as in the games, for the three reasons `recon-moves.md` §6.2 gives (UI
surface, AI branching, charge budget).

- Slot 0 is the **Assault**: must be a damaging move of the declared type. This is the move used by default
  on every ASSAULT action, and it is what makes "one type only" the headline rule. Its *shape* is irrelevant
  (§9.2), which is what fixes `recon-moves.md`'s own worked failure: Blissey [Normal] gets **Hyper Voice**,
  not Hyper Beam, because the scorer no longer has to satisfy a melee quota. For the 29 species with almost
  no learnset — Ditto knows only Transform, Unown only Hidden Power — slot 0 comes from the 108-id type-kit
  floor, so every piece in the game provably has a declared-type Assault.
- Slots 1–3 are free: coverage, status, boost, hazard, field, heal.
- Auto-picked at draft by `recon-moves.md` §6.3's measured scorer with both of its stated fixes (allow no
  melee move when the best melee score is negative, so Blissey stops being handed Hyper Beam; −15 for
  `flags.recharge || flags.pledgecombo`, so Charizard stops being handed Blast Burn). Measured outcome:
  **488 distinct moves appear** across auto-sets. Exactly one slot is swappable from a shortlist of 8.
- Movesets come from the **all-gens prevo-chain learnset union** with the recursive
  `changesFrom ?? battleOnly ?? baseSpecies` union, not gen-9 legality — 593 of 1417 species have no gen-9
  moves, and Rotom-Wash proves union rather than fallback is required. The 29 species still under 8 moves
  get the 108-id type-kit floor (18 types × 6).

### 9.2 Geometry — where a move can reach

Adopted verbatim from `recon-moves.md` §2.2, because it is derived from `target` plus the ranged flags and
needs no authoring:

| Shape | Count | Board geometry | Action |
|---|---|---|---|
| MELEE | 641 | step into the square along your own chess pattern | ASSAULT |
| SELF | 99 | the caster | ART |
| RING1_FOES | 62 | the 8 neighbours, enemies only | ART |
| RAY_LOS | 44 | 8 rays, Chebyshev ≤ 2, first occupied square only | ART |
| RAY_ANY | 24 | 8 rays, ≤ 3, blockers ignored | ART |
| BOARD | 24 | whole board | ART |
| RING1_ALL | 20 | the 8 neighbours, **including your own pieces** | ART |
| OWN_ARMY | 16 | your own side | ART |
| ALLY / RANDOM_FOE / REACTIVE / ENEMY_ZONE | 10 / 6 / 4 / 4 | as named | ART |

**Shape governs the ART only.** *Any* damaging move may be swung as an Assault when you move into a square —
charging in with Aerial Ace is fine, and Dragonite's auto-picked Assault *is* Aerial Ace *(measured: the
scorer prefers it over Hurricane, because Hurricane is Special on a physical attacker and only 70 %
accurate)*. A move with a ranged or area shape gains a *second* use: it may additionally be fired as an ART
without moving. This removes an entire class of edge cases ("my Assault has the wrong shape") and gives
ranged moves a genuine dual role.

### 9.3 Charges, and Struggle

`charges = clamp(round(pp/5), 1, 5)`; slot 0 always gets 5. A piece therefore has ~14 move uses per game,
which is the resource ceiling the termination argument leans on (§14.4).

**When slot 0 runs out, the piece Struggles**, and this is the faithfulness detail I would defend hardest:
Struggle is typeless (gen 5+), 50 BP, neutral against everything, and the user takes 1/4 of its max HP as
recoil. Consequences, all authentic and all good for the game: no piece is ever unable to attack; a piece
that has done all its fighting is visibly running down; Leppa Berry becomes a real draft pick; and the
Pokémon-literate player knows exactly what "Charizard is Struggling" means without being told.

### 9.4 Hazards

`ENEMY_ZONE`, 4 moves, exactly the canon numbers. The caster paints a **3-square segment** centred on its
own file, clamped at the board edge, on the enemy's third rank (rank 6 against White's opponent, rank 3
against Black's). The hazard fires when an enemy piece **ends a sub-move** on a painted square.

The clamp matters and is deliberate: casting from h1 paints only g6–h6, so hazards must be set from a
central file. Placing them is therefore a *positional* decision — walk the setter to the middle first — and
that is how a support move earns its turn.

| Hazard | Layers | Effect on landing | Canon fidelity |
|---|---|---|---|
| Stealth Rock | 1 | `hp -= maxHp × f`, where `f` is set by Rock's effectiveness against the declared type: **1/32 · 2^k**, giving 6.25 % / 12.5 % / 25 % *(measured)* | exact |
| Spikes | 3 | 1/8, 1/6, 1/4 of max HP; grounded pieces only | exact |
| Toxic Spikes | 2 | 1 layer poisons, 2 layers badly poisons; grounded only; Poison-declared pieces absorb the layer | exact |
| Sticky Web | 1 | −1 Speed stage; grounded only | exact |

Cleared by Defog, Rapid Spin, Court Change, Mortal Spin, Tidy Up. Heavy-Duty Boots ignores all four. This
is the single most literal system in the proposal — **Stealth Rock does in Pokémon Chess precisely what it
does in OU, down to the fraction** — and it exists only because HP is real.

### 9.5 Substitute, Protect, and the stalling bound

Substitute costs 25 % of max HP and creates a decoy with that much HP on the same square. Blows hit the
Substitute; while it stands there is no counterblow and no status can be applied. Protect and its 11
relatives make the piece uncapturable for one opponent reply, with Showdown's own success curve
`(1/3)^consecutive`, reset by any other action. Both bounded by charges.

### 9.6 Riders

170 damaging moves carry a `secondary`. Riders are resolved by the same public `oracle.precision`: a rider
with chance `c` lands when `precision ≤ c`. This keeps rider randomness *pre-revealed* alongside everything
else, and it lets the UI say "this turn, 30 % riders land" — which is the TCG's coin flip with the flip
happening in public, satisfying both `recon-tcg.md` §2.4's ruling (riders may be random) and
`recon-variants.md` §6.3's (never after commitment).

Rider volume, measured: brn 41 applications, par 35, psn 24, frz 13, flinch **46**. `flinch` is the largest
single rider and it maps to one line — the target loses its next activation.

### 9.7 The dangerous classes, bounded

Adopted from `recon-moves.md` §5, with the HP-specific additions:

| Class | Detected by | Bound |
|---|---|---|
| Recursion (Metronome, Copycat, Sleep Talk, …) | `callsMove` + 4 tags | `RESOLUTION_DEPTH = 1`; pool excludes all D1 and all self-KO moves; seeded so it is replayable |
| Self-KO (Explosion, Final Gambit, Memento, …) | `selfdestruct` | illegal if it would deterministically remove your own King; RING1_ALL caps the blast at 9 pieces; costs the piece |
| Stalling (Protect family) | `stallingMove` | `(1/3)^n` success curve, and charges |
| Trapping (18 moves) | `volatileStatus === 'partiallytrapped'` + tags | escapable variants 4–5 turns; inescapable capped at 3 turns and the trapper is also immobilised; **never restricts the enemy King** |
| Delayed (Future Sight, Doom Desire, Wish) | `flags.futuremove`, `slotCondition` | one scheduler, one pending entry per (side, kind), horizon ≤ 5 from `condition.duration` |
| Healing | `flags.heal`, `drain` | capped at max HP; charge-limited, which is what keeps §14.4's progress argument finite |
| OHKO (4 moves) | `ohko` | ignores HP entirely, so it is the one bypass of this proposal's core: accuracy 30 ⇒ lands only when `precision ≤ 30`, **and it is an Ace pick** (at most one per army, §17.3) |
| `willCrit` (4 moves) | `willCrit` | crit window 16, i.e. always; grants a bonus at most once per turn like any other capture |
| Population Bomb | `multihit: 10` | hits capped at 5 |

---

## 10. Status, stages and volatiles

### 10.1 The five non-volatile statuses, literally

| Status | Board effect | Source |
|---|---|---|
| **brn** | 1/16 max HP at Upkeep; Physical damage ×0.5 | games, exact |
| **psn** | 1/8 max HP at Upkeep | games, exact |
| **tox** | `n/16` at Upkeep with `n` rising each turn, capped 15/16 | games, exact |
| **par** | effective Speed ×0.5; **and the piece may neither earn nor use a bonus sub-move** | games for the halving; the second clause replaces the 25 % silent failure |
| **slp** | cannot act for 1–3 turns; **the counter is public on application** | games, with the roll pre-revealed |
| **frz** | cannot act; cleared by any Fire-type blow or a `thawsTarget` move; hard cap 3 turns; Ice-declared pieces immune | games, capped |

Two deliberate deviations, both stated: mainline paralysis' 25 % chance to fail is post-commitment hidden
randomness and `recon-tcg.md` rules it "the worst mechanic in either canon for a chess variant" — we keep
the Speed halving (which is real, and now matters enormously because Speed decides the counterblow) and
route the fail chance into a tempo cost. And `recon-tcg.md` rules that `frz` should be folded into sleep
because we have no HP for thaw damage; we **do** have HP, `thawsTarget` is meaningful, and Ice-type freeze
immunity is a type lesson worth teaching, so we keep it with a cap.

Confusion likewise: `recon-tcg.md` recommends TCG Pocket's version (a coin flip, no self-damage) *because we
have no HP*. We do. So confusion is the mainline effect made deterministic: a confused piece's Assault deals
×0.67 and the piece takes a 40-BP typeless hit on itself every Assault. No hidden coin, real self-damage,
recognisably Confusion.

**Marking, adopted from `recon-tcg.md` §3.2 unchanged, because it is the best legibility idea in the recon
set:** rotate the sprite for the mutually-exclusive class (slp / frz / par / confusion — newest wins) and
stack counter pips for the persistent class (psn / tox / brn).

### 10.2 Stat stages

Real, all seven channels, −6..+6, canon multipliers. Boost-setting moves (28 self-boost, 14 foe-debuff, 3
ally) are literal. Stages **do not decay** — Swords Dance is an investment, and a +2 piece is a threat the
opponent must answer, which is a chess-shaped consequence. Hazes, Clear Smog, phazing and Defog reset them.

Legibility: the pin shows at most two chevron glyphs (net offence, net defence), never seven numbers. The
Battle Readout's trace lists each stage as a labelled factor.

### 10.3 Field: weather, terrain, rooms

One weather and one terrain may be active at once (mainline), 5 turns, 8 with the matching rock or Terrain
Extender. `recon-tcg.md` §7.2 recommends a single Stadium slot; we deviate because the games run both and
they are visually separable — weather is a sky band across the top of the stage, terrain is a floor glow
under the squares. We **adopt its repetition closer**: a side may not set the field that is already active,
which shuts a perpetual-recast draw hole.

Effects are literal: sun/rain ×1.5 / ×0.5 on Fire and Water; sand chips 1/16 from non-Rock/Ground/Steel and
gives Rock ×1.5 SpD; snow gives Ice ×1.5 Def; Electric Terrain ×1.3 Electric and no sleep for grounded
pieces; Grassy ×1.3 Grass, heals grounded 1/16 at Upkeep, halves Earthquake; Misty ×0.5 Dragon and blocks
status on grounded pieces; Psychic ×1.3 Psychic and blocks priority moves against grounded pieces. Trick
Room inverts the Speed comparison for 5 turns — which in this design inverts *who takes counterblows*, the
best possible board-level use of it.

"Grounded" is literal: a piece is airborne if its declared type is Flying, or it has Levitate, or it holds
an unpopped Air Balloon, or Magnet Rise is up. Gravity, Smack Down, Thousand Arrows and Iron Ball ground it.

### 10.4 The Upkeep order

Published, fixed, and reproducible — this is what keeps the pure engine deterministic. It merges the TCG's
Pokémon Checkup order (`recon-tcg.md` §3.4) with the real `onResidualOrder` values in `items.json`:

1. weather damage (sand) and weather healing (Rain Dish, Ice Body, Dry Skin)
2. Grassy Terrain healing
3. item residuals in ascending real `onResidualOrder` (Leftovers 5, Black Sludge 5, Sticky Barb 28, …)
4. Leech Seed
5. **psn → tox → brn** (TCG Checkup order)
6. Aqua Ring, Ingrain
7. Salt Cure, Curse, Bind chip
8. status counters: sleep decrement, freeze cap
9. volatile countdowns, field countdowns, screen countdowns
10. Perish counters; a piece at 0 perishes
11. **deferred removal** — every piece at `hp ≤ 0` is removed simultaneously

Step 11 is what gives `recon-variants.md` §5's R4 the simultaneity it needs, and it is why "both Kings die
at once" is a case we adjudicate rather than a bug.

---

## 11. Abilities

### 11.1 Because damage is real, abilities are literal

This is the largest faithfulness dividend in the proposal. `recon-abilities-items.md` collapses 60-odd
stat abilities and 25-odd stat items into a single abstract `Vigour` counter in `[-3,+3]` because the
capture is binary and there is nothing else for them to modify. We have stats, HP and a damage formula, so:

| Ability | This design | An abstraction would say |
|---|---|---|
| Thick Fat | Fire and Ice damage against it ×0.5 | +2 to a die |
| Multiscale | incoming damage ×0.5 while at full HP | survive-once |
| Sturdy | a blow from full HP leaves it at exactly 1 HP | survive-once |
| Rough Skin | the attacker loses 1/8 of its max HP on a contact Assault | −1 Vigour |
| Regenerator | heals 1/3 of max HP on a WITHDRAW move | reset Vigour |
| Huge Power | Attack stat ×2 | +2 to a die, capped so it cannot crit |
| Guts | Attack ×1.5 while statused, and burn's ×0.5 does not apply | +2 to a die |
| Levitate | Ground-type moves cannot touch it — but Stealth Rock still can | one-shot ward |
| Wonder Guard | only super-effective moves damage it; Shedinja has **1 HP**, so hazards kill it | three-layer bespoke bound |

Huge Power needed a special "cannot manufacture a crit" clamp in the abstraction. Here it needs nothing:
doubling Attack doubles damage, which is what it does, and crits come from the Oracle.

### 11.2 The hook set

14 hook points; every one of the 311 abilities implements 1–3 and nothing else.

```ts
// src/rules/abilities/registry.ts
export interface AbilityHooks {
  onLegality?(a: PokemonPiece, d: PokemonPiece, m: MoveEntry, s: MatchState): 'block' | null;
  onBasePower?(ctx: DamageInput, bp: number): number;
  onModifyAtk?(ctx: DamageInput, atk: number): number;
  onModifyDef?(ctx: DamageInput, def: number): number;
  onModifySpe?(p: PokemonPiece, spe: number, s: MatchState): number;
  onAttackerFinal?(ctx: DamageInput, mult: number): number;
  onDefenderFinal?(ctx: DamageInput, mult: number): number;   // may only return <= 1
  onDamaged?(self: PokemonPiece, from: PokemonPiece, dmg: number, m: MoveEntry, s: MatchState): Effect[];
  onFaint?(self: PokemonPiece, by: PokemonPiece | null, s: MatchState): Effect[];
  onEnter?(self: PokemonPiece, sq: Square, s: MatchState): Effect[];
  onUpkeep?(self: PokemonPiece, s: MatchState): Effect[];
  onMobility?(self: PokemonPiece, mask: MoveMask, s: MatchState): MoveMask;
  onIdentity?(self: PokemonPiece, s: MatchState): { type?: BattleType; speciesId?: string };
  onGlobal?(s: MatchState): void;
  pierce?: ReadonlySet<'immunity' | 'ward' | 'defence' | 'stages' | 'screen'>;
}
export const ABILITIES: Record<string, AbilityHooks>;      // 118 distinct implementations
```

`recon-abilities-items.md`'s 13 archetypes are retained **as the UI vocabulary** — they are the 13 glyph
colours a player learns — while the implementations are literal. The `pierce` set is driven by
`flags.breakable` (84 abilities, measured), so Mold Breaker's target list needs no authoring.

### 11.3 Bounds kept, bounds dropped

Kept from `recon-abilities-items.md` §6: Shadow Tag / Arena Trap / Magnet Pull restricted to the king-move
ring and never restricting the enemy King; Neutralizing Gas restricted to the ring; Moody banned in ranked;
Protean/Libero once per game (which is gen 9's own rule); Speed Boost capped at +3 and only on non-capture
turns; Imposter copies movement pattern and ability but not type or class; Truant/Slow Start/INERT refund
draft budget; one Ruin ability per side; Trace legality read from the copy-protection flags.

**Dropped, because real HP makes them unnecessary:** the one-shot ward rule (§6.1 of that document), the
three-layer Wonder Guard bound (§6.2), the Huge Power crit clamp (§6.4), the thorns-cannot-kill rule
(§6.13 — Rough Skin *can* finish a wounded attacker, exactly as it does in the games), and the
survive-once outcome-conversion rule (§6.6 — Focus Sash sets HP to 1, and then the counterblow can still
kill you, so the exploit it was written to close cannot form).

---

## 12. Items

351 admitted mechanical items over ~45 primitives, reusing the same hook set. Because HP is real, the
primitives are the real numbers: Leftovers +1/16 at Upkeep, Life Orb ×1.3 damage and −1/10 max HP per
attack, Choice Band ×1.5 with a move lock, Focus Sash sets HP to 1 from full and is consumed, Rocky Helmet
1/6 to a contact attacker, Eviolite ×0.67 defence when `species.nfe`, Assault Vest ×1.5 SpD and no status
moves, Heavy-Duty Boots ignores hazards, the 18 resist berries ×0.5 with parameters read straight from
`naturalGift.type` (measured: exact for all 18).

**Format Kits, adopted from `recon-abilities-items.md` §4.3.** A format declares 12 items; each side gets
one of each; 4 pieces hold nothing. This caps the state space, forces allocation decisions, guarantees
symmetry, and makes the item layer learnable. The v1 Kit is theirs, with one substitution: **Ring Target
is replaced by Choice Specs**, because Ring Target existed to break permanent immunity and immunity is no
longer permanent (hazards and ranged attacks answer it). Life Orb, Leftovers, Focus Sash, Rocky Helmet,
Choice Scarf, Choice Specs, Air Balloon, Expert Belt, Eviolite, Sitrus Berry, a player-chosen resist berry,
Heavy-Duty Boots.

Item persistence: destroyed when the piece is removed; consumed by its own trigger; stolen only by
Magician/Pickpocket/Thief/Trick/Knock Off. No looting — that is `recon-abilities-items.md`'s ruling and it
is right: looting would make every capture a resource decision on top of a chess decision.

---

## 13. Transformations, and promotion

### 13.1 One Trainer Action per side per game

Exactly one, chosen from three, and it is a real decision because they are mutually exclusive.

| Play | Effect | Cost | Canon |
|---|---|---|---|
| **Terastallize** | the piece's declared type becomes its Tera type (default: its other real type, else the type of its Assault). It keeps STAB on **both** types. | the turn ends | games for the semantics; `recon-tcg.md` measures that Tera cards are literally printed off-type with re-derived Weakness |
| **Mega Evolve** | forme swap to the real `-Mega` forme: new base stats (HP fraction preserved), new ability, sometimes a new type the player re-declares. Requires the matching `megaStone` in the Kit. | the turn ends | "When 1 of your Pokémon becomes a Mega Evolution Pokémon, your turn ends" — the TCG's printed rule, quoted in `recon-tcg.md` |
| **Z-Power** | this Assault uses the Z-move derived from the Assault's type (`zMoveType` + the crystal BP table); the counterblow is suppressed. | it *is* the turn's action | games |

Terastallization is the one that matters, because our core axis is the declared type: a piece countered at
draft can be rescued once, which is `recon-abilities-items.md` §5.1's argument and it stands. Dynamax is
cut; the 34 Gmax sprites survive as promotion art.

### 13.2 Promotion is evolution

A pawn reaching the last rank:

1. **evolves along its real `evos` chain**, the player choosing among branches (Eevee's nine are all
   reachable); an `EVO_ITEM` in the Kit gates the stone-locked branches;
2. if already fully evolved, it may take its Mega forme if the stone is present, otherwise it gains **+1
   stage in its two highest stats**;
3. it takes a chess class of the player's choice — Queen, Rook, Bishop or Knight;
4. **HP is restored to full and all status conditions are cleared.** The TCG's rule, quoted in
   `recon-tcg.md` §6.1: evolving removes Special Conditions. This is the strongest reward in the game and
   the reason to push a pawn.
5. stats and `maxHp` are recomputed for the new species; the piece keeps its id, so it is the same
   individual, which is exactly what `Position`'s id-preserving promotion already gives us.

The video's "Pikachu is evolving… into Zapdos" is the branch we do *not* ship: promotion follows the real
evolution graph. Raichu, not Zapdos.

---

## 14. Check, the King, draws, termination

### 14.1 The model: king capture, no check-legality

`recon-variants.md` §5's R1–R7 are adopted, because its argument is decisive: checkmate requires that the
set of legal replies be knowable at adjudication, and the *opponent's* Oracle is not yet drawn.

> **R1** A player wins the moment the opposing King leaves the board, by any means.
> **R2** A move that leaves your own King capturable is legal. A King may move to an attacked square, and
> may castle through attack.
> **R3** A move is **illegal** if, under the revealed Oracle, it necessarily removes your own King.
> **R4** If one resolution removes both Kings, **the mover wins**. Removal order is defender-then-attacker.
> **R5** Exposing the enemy King ends your turn; remaining bonus sub-moves are forfeit.
> **R6** A King is never immune and never confers immunity: a 0× lookup against a King degrades to **1×**,
> so no King is ever unreachable (Stratego's "always supply the key"). `recon-variants.md` says 0.5×; with
> real HP that would mean *the attacker takes a full counterblow*, i.e. a King would be more dangerous to
> attack than a rook. Neutral is the correct degradation, and it still supplies the key.
> **R7** Check is advice, not law — see §14.5.

### 14.2 R3 is *exactly* computable here, which no other RNG design can claim

Because the Oracle is revealed, "does this action remove my own King" is a deterministic question about the
current turn. `applyAction` on a scratch copy answers it. So Atomic Chess's rule 5 —
*"It is illegal to blow up your own King, even if that destroys the opponent King as well"* — is
implemented verbatim rather than approximated. A King may not Assault into a ROUT or a MUTUAL. A self-KO
move that would remove your own King is not generated. `recon-variants.md` lists
"probabilistic self-destruction legal, deterministic illegal" as something we must invent; the Oracle
collapses it to the plain Atomic rule.

### 14.3 Draws and non-progress

| Rule | Condition |
|---|---|
| Threefold repetition | the **full-state** hash repeats three times: board + HP + status + stages + volatiles + charges + field + hazards + side to move. Excludes the RNG counter, which would make repetition unreachable |
| Non-progress | **100 consecutive sub-moves with no progress event**. A progress event is: a faint, a pawn advance, a promotion, a hazard layer added, a status newly applied, or cumulative damage ≥ 25 % of some piece's max HP |
| Both sides reduced to lone Kings | draw (Archon's precedent) |
| No legal action | that player **loses** (shogi/xiangqi convention; `recon-variants.md` rejects the alternatives explicitly) |
| Perpetual exposure | the exposing player loses (shogi's perpetual-check rule) |
| Hard cap | 300 turns per side ⇒ adjudicated on the Prize track (§20.3), which is `recon-tcg.md`'s Pokémon-skinned jishōgi |

### 14.4 Termination, proved

**Claim 1 — a turn is finite.** A bonus sub-move is granted only by an ASSAULT that knocked out the
defender. Every such sub-move strictly decreases the opponent's piece count, so a chain of length `L`
requires `L − 1` captures and `L ≤ N + 1 ≤ 17`. We additionally cap `L ≤ 3` (T1) and forbid a piece from
earning or using more than one bonus per turn (T2, English Progressive Chess). ∎

**Claim 2 — HP does not break Claim 1.** No HP effect grants an action. Enumerated: the only sources of an
extra action in the whole content set are ADVANTAGE, and nothing else — Parental Bond and Dancer are
restricted to non-capturing moves, and `STRIDE/priority` abilities (Gale Wings, Prankster, Triage) are
re-specified here as *priority within the Clash* (they suppress the counterblow) rather than as out-of-turn
actions, which removes the last irregular action source. ∎

**Claim 3 — the game is finite.** Let `P` be the number of progress events in a game. Faints ≤ 32. Pawn
advances ≤ 6 × 16 = 96. Promotions ≤ 16. Hazard layers and status applications each consume a charge, and
total charges are ≤ 16 pieces × 14 = **224 per side**. Damage-progress events are bounded by
`(total HP ever on the board + total healing) / (0.25 · minMaxHp)`; total healing is bounded because every
heal consumes a charge. So `P ≤ ~2 000`, and between consecutive
progress events at most 100 sub-moves may pass. **The loose bound is ≈2.1 × 10⁵ sub-moves; the practical
bound is the 100-sub-move progress clock and the 300-turn cap.** ∎

The one rule that would break this is any effect that adds a piece. There is none: Revival Blessing is
once per side per game and returns a piece to an empty home square, and it is counted in the bound above.

### 14.5 R7 in practice: the King Danger meter

The one thing king-capture must never do is surprise a chess player. So the engine computes, every turn, a
number rather than a warning:

**On the opponent's next turn the Oracle will take one of 16 × 2 relevant values (Momentum × crit). For
every enemy action that could remove your King, enumerate those 32 futures and report the exact
probability.** That is ≤ 32 evaluations of a handful of clashes — microseconds. The rail shows
`KING AT RISK — 6 / 32 (19 %) — Dragonite d5, Dragon Claw` and the threatening piece is ringed.

A "Guarded" mode (casual and tutorial default) filters out actions whose King-loss probability exceeds a
threshold, restoring something close to check-legality without changing the win condition. It is off in
ranked and shares its predicate with the AI's root filter.

Finally, the **Last Stand rule**: residual damage (hazards, weather, status, Leech Seed, Curse, recoil) can
reduce a King to 1 HP but never remove it. **A King can be removed only by a Clash** — which §6.2 already
guarantees against every ranged and area attack, for every piece. Without Last Stand, "Toxic the King and
run away" is a degenerate win condition that never touches the board; with it, a King at 1 HP is the most
tense object the game can produce, and it must still be taken in single combat. The canon shape is
Sturdy / Focus Sash / Endure.

Worked check *(measured)*: Garchomp's Earthquake with a crit at Momentum 100 computes **300 damage** against
Aegislash's 136 HP. Under §6.2 that is floored at 1 HP; without §6.2, walking a knight next to the enemy
King and pressing one button would have won the game. This is the interaction the ranged-attack bound was
written to close, and it was found by running the numbers rather than by argument.

---

## 15. The video's bugs, each resolved

| Bug (`BRIEF.md` §2) | Resolution |
|---|---|
| **Capture-in-check is broken** — a piece died capturing while its own King was in check, and the turn ended with the King still in check | Correct behaviour under R2. There is no check-legality: the player made a losing move, the King is exposed, and the opponent wins on their turn. What the video lacked was **information**, not a rule — and R7's King Danger meter shows `n/32` before the click. The capture that kills your own piece is legal; the capture that *deterministically removes your own King* is not generated (R3), which is the sub-case they actually stumbled into |
| **Infinite / runaway turns** | §14.4. Bonus sub-moves are paid for with enemy pieces; `L ≤ N + 1`, capped at 3, one per piece per turn. Crits do **not** grant bonuses in this design — only a super-effective knockout does — so the crit-chain engine does not exist |
| **King capture vs checkmate** | King capture, unambiguously (R1). Checkmate becomes a UI label ("your King cannot escape"), never a terminal state. Justified by the general law across variants: every ruleset that makes check hard to compute switches to king-capture |
| **Suicide-capture as a tactic** | A feature, and now a skilled one. A sacrifice is never fully wasted because the defender keeps the damage (mean 41 % of max HP on a resisted blow, *measured*), and a genuine 1-for-1 trade must be *engineered* — attack something you can knock out that is faster than you (MUTUAL, 10 % of neutral clashes) or bring Destiny Bond, Explosion, Aftermath or Rocky Helmet |
| **Draw / stalemate undefined** | §14.3: full-state threefold repetition, a 100-sub-move progress clock with an explicit progress-event list, lone-Kings draw, no-legal-action loss, perpetual-exposure loss, 300-turn Prize adjudication |
| **Zero-effectiveness immunity creates untouchable pieces** | The deepest fix in the proposal and it costs nothing: **immunity blocks a capture, not death.** A Flying piece dies to Stealth Rock (25 % of max HP, *measured*), to sandstorm, and to Toxic; it is softened to 1 HP by any ranged attack and then taken by any pawn; and it is grounded outright by Smack Down / Thousand Arrows / Iron Ball / Gravity. Coverage moves bypass the immunity in only 2 % of clashes (*measured*), so the headline lesson survives, but nothing on the board is ever unkillable. Betza's Iron Ghost cannot exist in a game with residual damage |

---

## 16. Balance

### 16.1 The skill budget

`recon-variants.md` §6.1 measures type knowledge at ≈10 pawns per game ≈ 700 Elo of chess strength, and the
video's dice at ≈5.5 pawns of pure noise. Our numbers:

| Component | Estimate | Basis |
|---|---|---|
| Chess strength | ~4.3 pawns at a 300-Elo spread | `recon-variants.md` §6.1's assumption, flagged as an assumption there and here |
| Type knowledge | ≈0.6 pawns per capture | measured: best-of-4 move choice moves ADVANTAGE from 12 % to 32 % and ROUT from 24 % to 15 % |
| **Battle-sim knowledge** (stats, Speed tiers, bulk) | new axis, ≈0.3 pawns per capture | the 68 % of clashes where the Assault is already best are the ones a chess player wins for free; the other 32 % are where a Pokémon player is paid |
| RNG | ≈0.5 pawns per game | the Oracle is *input* randomness. It shifts which actions are good, not which one you already chose. `recon-variants.md` measures input randomness at ~1/5 the variance cost of output randomness |

RNG at ~0.5 pawns is **below** `recon-variants.md`'s 20 %-of-variance target, so there is deliberate
headroom: `format.critWindowBase` can widen from 1/16 to 1/12 and `format.momentumSpread` from 85–100 to
80–100 if playtesting wants more chaos. Tune up from a safe floor.

### 16.2 The known danger, named

**Speed is the strongest stat in this design**, because it decides whether you take a counterblow. That is
authentic — Speed is the strongest stat in competitive Pokémon too — but it must be priced. Three levers,
in order: `typeMult` is already fitted by self-play, so Speed's contribution lands in `κ` and the fitted
coefficients; Trick Room exists and inverts it for 5 turns; and priority moves (16 of them) let a slow
piece buy a clean kill. The batch simulator's per-stat win-rate report (§16.4) is the instrument.

### 16.3 First-player advantage

Measured only by self-play. If it exceeds +3 % win rate, ship Bruce's 1963 Marseillais balance: White's
first turn may not grant a bonus sub-move.

### 16.4 The batch simulator is the balance instrument, not this document

`sandbox/batch.ts`, on a Worker pool, reporting per 10 000 games: win/loss/draw, game length in turns and
sub-moves, the five-outcome frequency table, per-declared-type win rate, per-stat win-rate correlation,
first-player advantage, mean HP on the board over time, charge exhaustion rate, and Struggle incidence.
`recon-tech.md` measured 26 games/s at 2 000 nodes/move single-threaded, so 10 000 games is ~6.4 minutes,
~1 minute on eight workers. σ, the Counterblow factor, `critWindowBase` and the draft coefficients are all
format parameters so the sweep is a loop, not a rebuild.

---

## 17. Draft and formats

### 17.1 The pool-source seam

```ts
export type PoolSource =
  | { kind: 'full-dex' }
  | { kind: 'collection'; owned: readonly OwnedIndividual[] }
  | { kind: 'fixed'; army: ArmySpec }            // Gym Leaders, tutorials, shared-seed friendlies
  | { kind: 'mirror'; seed: string };            // both sides draft from one generated pool

export interface Format {
  id: string; name: string;
  pool: PoolSource;
  kit: readonly string[];                        // 12 item ids
  budget: number;                                // 60
  clashConstant: number;                         // 1.6
  counterblowFactor: number;                     // 0.75
  critWindowBase: 1|2;                           // 1
  momentumRange: readonly [number, number];      // [85, 100]
  bans: readonly string[];
  acePool: readonly string[];
  validators: readonly DraftValidator[];
}
```

`src/rules/*` imports `Format` and never `PoolSource['collection']`'s contents. Capture resolution cannot
see collection state, which is `DIRECTION.md`'s hard architectural seam.

### 17.2 The draft flow — slot-first, never a 1025-item list

Adopted from `recon-visual.md` §9.2 because it is the only proposal in the recon set that solves paralysis.
16 slots in a fixed order (King, Queen, Rook, Rook, Bishop, Bishop, Knight, Knight, then 8 Pawns). For each
slot: **five candidates**, with a guaranteed spread — at least one of a type you do not yet have, at least
one under a third of your remaining budget, at most one Legendary, and a role-affinity sort using the
existing `Dex.roleAffinity`. One reroll per draft. Search is an escape hatch behind a toggle.

Per pick the player sets: declared type (1–2 radio options), ability (1–4 radio, measured: 357 species offer
no choice, 378 offer two, 631 offer three, 1 offers four), item slot from the Kit, and may swap one of the
four auto-picked moves from a shortlist of 8. **Total decisions per pick: 2 forced, 2 optional.** Sixteen
picks, ~90 seconds for a returning player.

Two teaching widgets, both from `recon-visual.md`: a Type Wheel, and an 18-cell Coverage Strip that
animates the offensive and defensive gaps a hovered candidate would close.

### 17.3 Validators

| Validator | Rule | Source |
|---|---|---|
| Budget | total cost ≤ 60 | Knightmare Chess point-buy |
| Type breadth | ≥ 10 distinct declared types per army | the video's "at least one of every type on the board", scaled to 16 pieces |
| Ace | at most **one** Ace piece per army, from a named list: the 4 OHKO moves, Wonder Guard, Imposter, Shadow Tag, Huge/Pure Power, the 4 Ruin abilities | ACE SPEC, a shipped first-party precedent measured at 33 cards in `recon-tcg.md` |
| Hazard answer | at least one piece with Defog, Rapid Spin, Mortal Spin, Court Change or Heavy-Duty Boots | hazards are now lethal, so the key must be supplied (Stratego) |
| Ruin | at most one Ruin ability | `recon-abilities-items.md` §6.16 |

Note what is **not** a validator: an immunity breaker. It is unnecessary here, because hazards and ranged
attacks are the universal key.

### 17.4 How a 20-Pokémon collection beats an 800-Pokémon one

The 60-point budget is the answer, and it is structural rather than a promise. An army is 16 pieces for 60
points, so it is *mostly* cheap Pokémon; a deep collection buys variety at the top of the curve, not raw
power, and the marginal value of the 400th owned species is near zero because you can only field two or
three expensive pieces. Ranked additionally offers a **mirror-pool** format (`PoolSource.mirror`), where
both players draft from one seeded pool — collection depth is neutralised entirely and the seed is
shareable. `recon-tcg.md`'s Prize track becomes the material HUD; `recon-variants.md`'s Chess18 procedure
screens army pairings by engine eval, and the tails are handicapped rather than banned.

---

### 17.5 The meta-game, in numbers

`DIRECTION.md` directive 4 and 6 are in scope, and `BRIEF-METAGAME.md` asks for a curve rather than an
adjective. The match rules are untouched by all of it — the only seam is `PoolSource`.

**Ownership is of individuals**, per `DIRECTION.md`'s recommendation. An owned individual carries
`{ id, speciesId, nickname, exp, koCount, matchesPlayed, caughtAt, ballSkin }` and nothing else. Declared
type, ability, item and moveset are **draft-time choices, not properties of the individual**, which is what
keeps the collection out of capture resolution and stops a collection becoming a stat-grind.

| Milestone | Individuals owned | Distinct species |
|---|---|---|
| account creation | **18** — one starter of your choice plus 17 fixed commons | 18 |
| after 1 match | 19–20 | 19 |
| after 10 | 29–33 | 26–29 |
| after 50 | 70–85 | 52–63 |
| after 500 | 380–450 | 190–240 |

A win offers a choice of **3**, a loss a choice of **2** commons — progress every match, win or lose, which
is `DIRECTION.md`'s explicit calibration. Rarity tiers are derived from `species.json` and nothing is
invented: Common (`bst < 400 && nfe`), Uncommon, Rare (`bst ≥ 500`), Exotic (`tags` ∋ Sub-Legendary /
Paradox / Ultra Beast — 107 species), Mythic (Restricted Legendary / Mythical — 104 species). Offer weights
60 / 25 / 11 / 3.5 / 0.5, with a pity floor: a guaranteed Exotic-or-better every 20 offers.

**Evolution is the progression axis**, driven entirely by real fields. An individual gains 1 Exp per match
played and 1 per knockout it scores; it evolves when `exp ≥ evoLevel / 2` (Charmander at 8, Charmeleon at
18), or on consuming the real `evoItem` won as a reward, or — for the 9 trade evolutions — **on completing
any trade**, which gives trading an authentic mechanical role rather than only a social one. Evolving
*transforms* the individual: it keeps its id, nickname and record, so nothing is consumed and nothing is
duplicated. Branching lines (Eevee's nine) present the real branch set with the real conditions.

Duplicates are immediately useful because ownership is individual; past that, **5 duplicates of one species
convert into 1 Rare Candy**, which either grants 5 Exp to any individual or rerolls one reward offer.

Ladder: Glicko-2 internally, never shown as the identity. The eight Kanto badges in canon order, then Elite
Four, then Champion as a top-100 leaderboard. "Highest badge earned" is stored separately from "current
tier", so the ladder can be brutal without the profile feeling punitive. Each badge tier is gated by a **Gym
Leader promotion match** against that Leader's mono-type army, with the compensating budget printed on the
challenge screen (§22.3). Ranked queues default to the **mirror-pool** format, so collection depth cannot buy
wins; casual and friendly queues use `full-dex`.

---

## 18. Content coverage — the ledger

`recon-data-substrate.md` is authoritative: `@pkmn/dex` strips every callback, so the generator reads
`@pkmn/sim` for the handler fingerprint and source text and emits a `coverage` class per entity that a test
walks. Nothing in this proposal derives behaviour from prose at runtime.

### 18.1 Moves — 950/950

| Class | Count | What happens |
|---|---|---|
| **Derived from declarative fields** | **787** | `type`, `category`, `basePower`, `accuracy`, `priority`, `target`, `flags`, `secondaries`, `boosts`, `status`, `volatileStatus`, `drain`, `recoil`, `heal`, `multihit`, `sideCondition`, `weather`, `terrain`, `condition.duration` compile straight into a `MoveEffect` record. With real HP, `drain`/`recoil`/`heal`/`multihit`/`damage:'level'` are literal rather than approximated — this is why this bucket is larger here than in a binary-capture design |
| **Curated tag** | **88** | a row in `Record<MoveId, Tag>` redirecting to an existing rule: `TRAP` 18, `VARPOWER` 20, `VARTYPE` 10, `LOCKOUT` 7, `STATSWAP` 7, `ABILITYMOD` 7, `PHAZE` 5, plus 14 HP-specific rows (`Pain Split`, `Endeavor`, `Super Fang`, `Belly Drum`, `Rest`, `Substitute`, `Leech Seed`, `Perish Song`, `Wish`, `Salt Cure`, `Curse`, `Nightmare`, `Bide`, `Counter`) |
| **Bespoke rule** | **79 moves in 16 rules** | `recon-moves.md` §3's set, unchanged: `B1_CallsMove` … `B16_Cleanse`. One hand-written function each |
| *of which not draftable* | 35 Z + 52 Max | Z-moves resolve as Z-Power payloads (`zMoveType` + BP table). Max moves resolve as their base move plus the Gmax field effect, reachable only when a Gmax-capable piece promotes. **Neither is inert** |
| **Total** | **950** | 0 unclassified, asserted at build time |

The **fallback** is `recon-moves.md` §4's, and it is the modal case rather than an error path: a damaging
move with nothing else recognised becomes a MELEE Assault at `basePower || 60`; a Status move with an
unrecognised payload becomes a +1 stage to the caster's single best stat for 2 turns. Splash and Celebrate
land there and that is correct. 26 moves genuinely reach it.

### 18.2 Abilities — 311/311

118 implementations over the 14 hooks; the 13 archetypes survive as the UI vocabulary and the glyph set. 8
abilities have neither handler nor flag (`Ball Fetch`, `Honey Gather`, `Run Away`, `Stall`, `Early Bird`,
`Corrosion`, `Dancer`, `No Ability`) and are hand-classified — measured, not guessed. Levitate is the named
case where `@pkmn/sim` has no handler either (the engine special-cases it), so it is hand-written and the
build asserts that the hand-written set covers exactly the 14 empty-signature abilities. `INERT` emits the
real `shortDesc` plus a visible "not yet implemented" marker and **fails the build** with a listing, so gen
10 cannot silently produce dead content.

### 18.3 Items — 536/536

351 admitted mechanical items over ~45 primitives; 12 of those primitives are parameterised purely from
structured fields (`naturalGift.type` for all 18 resist berries, `onPlate`/`onMemory`/`onDrive` for 55
type-setters, `megaStone` for 47 stones, `itemUser` for 12 species-locked items, `boosts` for 13).
185 are non-mechanical and are **repurposed, not deleted**, exactly as `recon-abilities-items.md` §3.4
specifies: TR00–TR99 become the move-picker card frames, the 28 Balls become bezel finishes, the 15 Fossils
become the Ancient frame, `Mail` becomes the emote icon, the 6 Valuables become post-game spoils, and the
35 Z-Crystals become the 18 Z-Power auras plus 17 signature animations.

### 18.4 The test that makes this a fact and not a claim

```ts
// src/rules/coverage.test.ts
it('every move resolves to a non-degenerate effect', () => {
  for (const m of dex.moves) {                      // 950
    const e = deriveMoveEffect(m);
    expect(e.coverage).toBeOneOf(['derived','tag','bespoke']);
    expect(e.power > 0 || e.payload !== 'DAMAGE').toBe(true);
    expect(e.charges).toBeGreaterThanOrEqual(1);
    expect(SHAPES).toContain(e.shape);
  }
});
it('every ability has hooks or is deliberately inert', /* 311 */);
it('every item has a primitive or a documented repurposing', /* 536 */);
it('the golden damage table matches @pkmn/sim', /* 2 000 rows, generated at build time */);
```

The golden damage table is the important one: the generator runs 2 000 real (attacker, defender, move,
modifier) combinations through `@pkmn/sim`'s own damage calculation at build time and bakes the expected
pre-σ values. Any drift in our pipeline fails CI. **That is how a battle sim proves it is a battle sim.**

---

## 19. Faithfulness — 16 named pieces of content

| Content | In Pokémon | On the board | Why a player calls it right |
|---|---|---|---|
| **Stealth Rock** | on entry, damage = 1/32 × 2^k of max HP scaled by Rock's effectiveness | paints 3 squares of the enemy's third rank; a piece ending a sub-move there loses 6.25 / 12.5 / **25 %** of max HP by declared type *(measured)* | it is the identical fraction. A Fire or Flying piece crossing rocks feels exactly like switching a Charizard into rocks |
| **Levitate** | immune to Ground moves; still takes hazard, weather and status damage | Ground moves cannot capture it; Stealth Rock, sandstorm and Toxic all kill it | `DIRECTION.md` names Levitate as the model of a good mapping. This is Levitate with nothing added and nothing removed |
| **Rough Skin** | attacker loses 1/8 max HP on contact | an Assault (contact) costs the attacker 1/8 of its max HP; a ranged ART costs nothing | the contact/non-contact split is real and now matters, so Long Reach and Protective Pads have a reason to exist |
| **U-turn** | attack, then switch out | ASSAULT, resolve the Clash, then the attacker **returns to the square it came from** even on a capture; the captured square is left empty | `DIRECTION.md` names it. Hit-and-run is what U-turn *is*, and here it visibly declines the square |
| **Choice Band** | ×1.5 Attack, locked into one move | ×1.5 Physical damage; the piece may use only that move for the rest of the game | the lock has real teeth because coverage matters (32 % of clashes) |
| **Sticky Web** | −1 Speed on grounded entry | painted squares apply −1 Speed stage | and −1 Speed now flips who takes the counterblow, which is the most consequential thing a Speed drop can do |
| **Trick Room** | inverts the turn order for 5 turns | inverts the Speed comparison, so slow pieces stop taking counterblows and fast ones start | five turns of a genuinely inverted board. Slow bulky armies become a real archetype |
| **Leftovers** | +1/16 max HP at end of turn | +1/16 at Upkeep, in the real `onResidualOrder` slot | it out-heals Spikes' 1/8 every other turn — the same arithmetic a competitive player already does |
| **Sturdy** | survives a knockout from full HP at 1 HP | HP clamps to 1; the counterblow may then still kill it | not an outcome rewrite, so it composes. A Sturdy piece at 1 HP is a legible, doomed blocker |
| **Wonder Guard / Shedinja** | only super-effective moves damage it; Shedinja has 1 HP | uncapturable except by super-effective moves, and it has **1 HP**, so any hazard, weather tick or chip removes it | this needed three hand-written bounds in a binary-capture design. Here it is the card as printed |
| **Thunder Wave** | paralysis: Speed halved | Speed ×0.5, and the piece may neither earn nor use a bonus sub-move | halving the Speed of a fast attacker takes away its clean kills. That is what paralysis does to a sweeper |
| **Belly Drum** | halve your own HP, Attack to +6 | ART: lose 50 % of max HP, Attack stages to +6 | `recon-data-substrate.md` uses Belly Drum as the example of what a fields-only design gets wrong. We implement it because we have both halves of it |
| **Explosion** | user faints; enormous damage to everything adjacent | ART, RING1_ALL, 250 BP against all 8 neighbours **including your own pieces**; the caster is removed; illegal if it would remove your own King. It is one of the 7 `selfdestruct` moves, the **only ARTs that may knock out** — you may kill at range only by dying | the friendly fire is the point, R3 makes it safe to offer, and the price of the exception is exactly the price the real move charges |
| **Rest** | full heal, then asleep for 2 turns | ART: HP to max, `slp` with a public 2-turn counter | it is the one healing move that costs you the tempo it saves, and the sleep counter being public makes the gamble legible |
| **Tera Blast / Terastallization** | changes the Pokémon's type; Tera Blast takes the Tera type | the Trainer Action changes the declared type and keeps STAB on both; the Assault re-types with it | `recon-tcg.md` measured that Tera cards are literally printed off-type with a re-derived Weakness. Both canons agree |
| **Mega Charizard X** | Fire/Flying becomes Fire/Dragon, Tough Claws, huge Attack | promotion or Trainer Action swaps the forme: new stats, new ability, and the player re-declares the type as Dragon | the type change is the mechanic, and the type change is our core axis. Also the reason to admit `Past` content |

---

## 20. Legibility

### 20.1 Role, type and owner at once — role dominant

The owner's complaint is that role is unreadable. `recon-visual.md` §2 diagnoses it correctly (a 10 px
Unicode glyph whose six variants differ only in interior detail; three size tiers for six roles; 1.2 px vs
1.4 px rings) and its solution is adopted without change:

> **Chess role is the piece's outer silhouette, and each silhouette is derived from how the piece moves.**
> Pawn = circle. Bishop = diamond (diagonals). Rook = crenellated square (orthogonals). Knight = stepped L
> (literally the knight's move). Queen = coronetted octagon (the rook's square ∪ the bishop's diamond).
> King = crowned heraldic shield that overflows its cell.

Six inline SVG paths, never a font. Then:

| Channel | Encodes | Survives at |
|---|---|---|
| outer silhouette | **role** | 24 px, greyscale, and any colour-vision deficiency |
| enamel field colour (radial pool-to-rim) + type glyph | declared type | 34 px for colour, 44 px for the glyph |
| bezel metal — bone `#F5F1E8` vs ink `#0F131A` | owner | 20 px; measured 15.2:1 army separation |
| **HP arc, 8 segments, on the bezel** | HP | 34 px; absent at full HP, so a healthy board is clean |
| sprite rotation (slp/frz/par/confusion) or stacked pips (psn/tox/brn) | status | 40 px |
| up to 2 chevrons on the plinth | net stat stages | 44 px |
| up to 4 type dots on the plinth | offensive coverage | 64 px |

The HP arc is the one addition this proposal makes to that spec, and it lands on the pin's existing bezel,
which was already a metal ring. Board slate `#5C6575` / `#818A9B` with the 1 px ink inlay, and the 5/13
liner rule, are adopted unchanged.

### 20.2 Two onboarding paths, because there are two players

- **"I know chess."** Play with the move menu closed. The engine picks your Assault; the target square
  carries one of five verdict glyphs; the only new thing to learn is what the glyphs mean. Measured: this
  plays the best available move 68 % of the time. When it does not, a chevron appears on the better slot —
  the game *tells you when to learn something*. The Type Wheel unlocks after the first ROUT.
- **"I know Pokémon."** Legal squares glow, the piece's movement pattern is drawn as a ghost overlay on
  pickup, and the tutorial teaches chess through Pokémon vocabulary: "your Bishop is a special attacker
  with unlimited range on one colour".

### 20.3 The HUD

Left rail: the Oracle (three glyphs, `M 93 · F 9/16 · P 88`), the turn chip (two chips when a bonus is
live), the King Danger meter. Right rail: the Prize track — 6 slots, premium pieces fill 2 — as the
material HUD, driven by `recon-tcg.md`'s Rule Box idea, and it doubles as the timed-game tiebreak. Bottom:
the four move slots of the selected piece with charge pips, and the Battle Readout on hover.

---

## 21. Visual and animation consequences of these rules

What the rules *oblige* the presentation to show:

| Rule | Must be shown | How |
|---|---|---|
| HP is real and persistent | current HP per piece, and every change | 8-segment arc on the bezel; damage numbers rise from the struck pin in the attacker's type colour; the arc drains on the beat grid |
| Five outcomes | each instantly distinguishable **without text** | `recon-visual.md` §4's four forms, plus one: **ADVANTAGE** 8-ray star outward, 1 death; **CAPTURE** single slash inward, 1 death; **MUTUAL** twin mirrored cracks apart, 2 deaths; **ROUT** single slash *outward from the defender through the attacker*, 1 death, defender flashes and holds; **REPEL** the attacker's pin arcs back to its origin with a dust ring at the target, 0 deaths, two damage numbers. Death count, direction and symmetry each identify the outcome alone |
| BLOCKED | a rejection, not nothing | hexagonal ward at the target and a dashed grey ring on the square from the moment the piece is picked up — you see it before you try |
| WHIFF | pre-announced | the target square shows a translucent verdict glyph with a slash the instant the Oracle is revealed |
| The bonus sub-move | impossible to miss | `recon-visual.md`'s persistent-state treatment: gold ring breathing on the pin, gold board frame, stage held 18 % dim, **two** turn chips — all until it is spent, plus an explicit `DeclineBonus` button |
| The Oracle | public, and legible as three different instruments | a 40 px Momentum die tumbling in the rail, four TCG coins for Focus, a 20 px Precision dial. Different silhouette, rotation axis and material |
| Counterblow suppressed by Speed | *why* you took no damage | a Speed comet trails the faster pin before its blow, and the Readout line reads `outsped — no counterblow` |
| Weather / terrain | board-wide, both at once | weather is a sky band above the stage with particles on `fx-over`; terrain is a floor glow under the squares on `fx-under`. Never the same layer, so they never read as one thing |
| Hazards | sitting on squares | inlaid glyphs on `fx-under`, layer count as pips; they flash when a piece lands |
| Status | afflicting a piece | rotation for the exclusive class, stacked pips for the counter class |
| Trapping, charging, Substitute | held / gone / decoyed | a chain glyph, the pin lifted off the board with a shadow left behind, a cardboard-cutout pin |
| Move identity for 950 moves | type-coloured, recognisable, no per-move table | `recon-visual.md` §6.1's composition rule, unchanged: `visual(move) = EMITTER[shape] × RESOLVER[payload] × SKIN[type] × MODIFIER[selfAfter] × intensity(power)`. 54 authored assets cover everything, and the record it composes over is the same `MoveEffect` the rules consume |

Performance: the hybrid renderer from `recon-tech.md` — the DOM board and pins stay, pins move to one
transform-positioned layer keyed by piece id, two Canvas2D layers (`fx-under`, `fx-over`) carry effects.
Sprites vendored same-origin at build time (829 KB for all 1025 gen5 stills), because Showdown's CDN sends
no `Access-Control-Allow-Origin` (verified 8/8) and canvas would be permanently tainted. Budgets: entry
chunk ≤ 110 KB gz, critical-path data ≤ 60 KB gz, frame p95 ≤ 10 ms, ≤ 1 200 particles, ≤ 250 board DOM
nodes, and a heap gate asserting no growth over moves 50→100.

---

## 22. AI opponent

### 22.1 Search

Alpha-beta negamax + PVS + quiescence, iterative deepening, in a Web Worker, per `recon-tech.md` Part B.
No `SharedArrayBuffer`, no WASM (a 2× win buys half a ply at EBF 4).

- **A ply is a sub-move.** Carry `(sideToMove, chain, bonusMask)`; do not negate on a bonus sub-move; score
  mates as `29000 − subMoveCount`; count progress and repetition in sub-moves.
- **No interior chance nodes.** The current turn is deterministic under the revealed Oracle. The
  *opponent's* Oracle at the child is collapsed to its modal value (`M = 93`, no crit, `P = 100`) plus a
  static risk bias, which is `recon-tech.md`'s measured fallback (its warning that the bias is the
  load-bearing half is respected: naive collapse over-valued a position at +1012 where sound search said
  +1906). At the root, sample `M ∈ {85, 93, 100}` with common random numbers — linear in the sample count.
- **Branching.** Larger than a binary-capture variant: ADVANCE moves, plus ASSAULT × up to 4 slots, plus
  ART × 3. Two forward-pruning rules keep it tractable, both principled: an ASSAULT slot is generated only
  if it produces a *different verdict* from slot 0 (measured: 32 % of the time), and ARTs are generated at
  depth ≤ 4 only, or deeper when they change a verdict, set a field, or add a hazard. Estimated EBF 4.5–5.
- **Target:** depth 6–7 in a 1 000 ms budget, p95 ≤ 1.3 × budget with a 350 ms floor. Honest: about one ply
  shallower than a binary-capture design at the same budget, bought back partly by the pure move
  generation (no ward flags in the TT key) and partly by an exact `staticClash`.
- **`staticClash` replaces SEE, and it is exact rather than statistical**, because `resolveClash` is a pure
  deterministic function of the Oracle. Move ordering can sort by *actual* material delta. Do **not** prune
  losing captures: taking a queen with a pawn and dying is often correct here.

### 22.2 Evaluation, tiered by cost

| Tier | Terms | Cost |
|---|---|---|
| every node, incremental | material with the HP term `V·(0.55+0.45·hp/maxHp)`, per-type count vectors, stage sums, status penalties | ~6 ns |
| lazy, inside a ±250 cp margin | mobility, threat scan folded into quiescence, King Danger (the `n/32` enumeration, root only), hazard pressure | 200–500 ns |
| once per root | army type coverage, immunity supply, charge budget remaining | free |

Quiescence follows: all ASSAULTs that change material, all bonus sub-move chains, and any Assault against a
piece at or below 35 % HP. Damaging ARTs are **not** quiescent moves — §6.2 means they can never change
material, so including them would make the quiescence search unbounded for no gain. Instead a single
`softening` eval term prices "this piece is at 1 HP and I have an Assault available next turn", which is the
positional fact an ART actually creates. Weights fitted by self-play, never by hand.

### 22.3 Difficulty, and Gym Leaders

`recon-tech.md` measured a corrupted type chart as a clean monotonic dial that never bottoms out (5 % error
→ 47 % score, 30 % → 37 %, fully type-blind → 25 %). We add a second corruption unique to this design:
**a corrupted stat model.** A beginner AI assumes every piece has median stats, so it misjudges Speed and
therefore misjudges counterblows — which is precisely the mistake a new human makes.

| Tier | Search | Type error | Stat model |
|---|---|---|---|
| Youngster | 350 ms, depth ~4 | 30 % (knows only the starter triangle) | all pieces median |
| Gym Trainer | 600 ms | 15 % (gets the 8 immunities and Steel wrong) | ±25 % noise |
| Ace Trainer | 1 000 ms | 5 % | exact |
| Elite Four | 2 000 ms | 0 % | exact + root sampling |

**Gym Leaders** field mono-type armies (Brock Rock, Misty Water, Lt. Surge Electric, Erika Grass, Koga
Poison, Sabrina Psychic, Blaine Fire, Giovanni Ground). `recon-tech.md` measured a mono-type army at 36 %
against a mixed one at equal search — a ~100–150 Elo handicap — so a Gym Leader gets a **+50 % budget bonus
and a +15 point draft budget**, both printed on the challenge screen, which is honest and thematic (a Gym
Leader is meant to have better Pokémon than you).

---

## 23. Technical architecture

### 23.1 What exists, and what it is used for

| Existing module | Role in this design | Change needed |
|---|---|---|
| `src/engine/board.ts` | all geometry, plus `KING_MOVES`/`RAYS`/`BETWEEN` reused for RING1 and RAY shapes | **none** |
| `src/engine/position.ts` | the chess substrate; pseudo-legal generation is the base of `generateActions`; persistent ids; `xorHash` seam | none; `isCheckmate`/`isStalemate` become UI labels only |
| `src/engine/typechart.ts` | `effectiveness`, `captureOutcome`, `TYPE_PROFILES` for the draft UI | none |
| `src/engine/rng.ts` | the Oracle draws from it; `fork` isolates Metronome | none |
| `src/engine/zobrist.ts` | extended with the Pokémon state words | add a factorised ~6 500-key table (52 KB) for HP buckets, status, stages, charges, field |
| `src/data/*` | the baked dex, already carrying `signalClass` | add `moveEffects.json`, `abilityMap.json`, `itemMap.json`, `damageGolden.json` |
| `scripts/gen-data.ts` | already reads `@pkmn/dex` + `@pkmn/sim` | add the derivation passes and the build-time assertions |

### 23.2 File tree (new files only)

```
scripts/
  gen-data.ts                  # extended: emits the four new bundles + the golden damage table
  gen-effects.ts               # move -> MoveEffect derivation, 5 passes, fails the build on a gap
data/curated/
  move-tags.json               # 88 rows
  move-bespoke.ts              # 16 rules, 79 moves
  ability-map.json             # 311 rows -> {archetype, primitive, params}
  item-map.json                # 536 rows -> {class, admitted, primitive, params}
  type-kit.json                # 18 x 6 fallback moves
  formats.json                 # kits, budgets, bans, ace pool, validators
src/rules/
  state.ts        # MatchState, PokemonPiece, FieldState, Oracle   (§3)
  oracle.ts       # rollOracle, critWindow, effectiveAccuracy      (§4)
  damage.ts       # computeDamage, the 17-step pipeline            (§7)
  clash.ts        # resolveClash, forecast                         (§6)
  actions.ts      # Action, generateActions, applyAction, undo      (§3.1)
  effects.ts      # Effect union + applyEffect + EffectEvent
  moveEffects.ts  # runtime reader over the baked MoveEffect records
  status.ts  field.ts  hazards.ts  upkeep.ts                       (§10)
  abilities/{registry.ts, primitives.ts}                           (§11)
  items/{registry.ts, primitives.ts}                               (§12)
  transform.ts    # Tera / Mega / Z-Power                          (§13)
  promote.ts      # promotion = evolution                          (§13.2)
  terminal.ts     # win, draw, progress clock, termination          (§14)
  format.ts       # Format, PoolSource, validators                  (§17)
  coverage.test.ts damage.test.ts clash.test.ts chess-oracle.test.ts
src/draft/
  candidates.ts  autoMoveset.ts  cost.ts  validate.ts
src/ai/
  search.ts  eval.ts  order.ts  staticClash.ts  difficulty.ts  worker.ts
src/presenter/
  presenter.ts  beatGrid.ts  cues.ts  particles.ts
src/ui/
  Board.tsx  Pin.tsx  HpArc.tsx  OracleRail.tsx  BattleReadout.tsx
  VerdictGlyph.tsx  Inspector.tsx  DraftScreen.tsx  KingDanger.tsx
  fx/{FxUnder.tsx, FxOver.tsx, emitters.ts, resolvers.ts, typeSkins.ts}
sandbox/
  batch.ts  positionEditor.ts  seedShare.ts
```

### 23.3 The four signatures the whole design hangs on

```ts
// the only place an outcome is decided
export type Verdict = 'ADVANTAGE' | 'CAPTURE' | 'MUTUAL' | 'ROUT' | 'REPEL' | 'WHIFF';
export interface ClashForecast {
  verdict: Verdict;
  forward: DamageResult; counter: DamageResult | null;
  attackerHpAfter: number; defenderHpAfter: number;
  attackerFirst: boolean; grantsBonus: boolean;
  /** Ordered, renderable explanation. The UI never recomputes anything. */
  trace: readonly { label: string; factor: number }[];
}
export function resolveClash(s: MatchState, a: Action & { kind: 'assault' }): ClashForecast;

// the frozen interface the searcher sees, so it survives ruleset churn
export interface Rules {
  generate(s: MatchState, out: Action[]): number;
  apply(s: MatchState, a: Action): void;
  undo(s: MatchState): void;
  terminal(s: MatchState): Terminal | null;
  staticClash(s: MatchState, a: Action): number;   // exact material delta in centipawns
}
```

`applyAction` mutates and pushes to an undo stack in the same style `Position.makeMove` already uses, so
search costs no allocation. `MatchState` serialises to `{ fen, pieces, field, hazards, oracle, rngState }`
and a whole game serialises to a seed plus an action list — which is what makes the server able to validate
with the identical module, per `BRIEF-METAGAME.md` §3.

---

## 24. Milestones — each one complete and playable

| # | Ships | Content | Effort |
|---|---|---|---|
| **M1** | **The Clash.** Hot-seat, two fixed 16-piece armies, real stats, real HP, the Oracle, the five verdicts, verdict glyphs, the Battle Readout, HP arcs, king capture, draws. Slot 0 only — no coverage moves, no abilities, no items, no ARTs | 0 curated rows | **1.5 wk** |
| **M2** | Role silhouettes, slate board, the five outcome animations, the Presenter and beat grid | — | 1 wk |
| **M3** | 4 move slots, charges, Struggle, ARTs (ranged / area / status / boost / heal), riders, all derived move effects | 787 derived | 2 wk |
| **M4** | Status, stat stages, hazards, weather, terrain, the Upkeep order | 88 tags | 1.5 wk |
| **M5** | Abilities and items, Format Kits | 311 + 536 | 2.5 wk |
| **M6** | AI in a Worker, difficulty ladder, `staticClash`, eval tiers | — | 2 wk |
| **M7** | Draft: slot-first candidates, cost, validators, auto-movesets, Type Wheel, Coverage Strip. First full game against an AI with a drafted army | — | 1.5 wk |
| **M8** | The 16 bespoke rules, transformations, promotion-as-evolution | 79 bespoke | 1.5 wk |
| **M9** | Sandbox: free armies, AI-vs-AI, seeds, position editor, **batch simulator**; first balance pass, σ re-fit | — | 1 wk |
| **M10** | Meta-game: local profile, collection, starter set, post-match rewards, evolution-through-play, Pokédex | — | 2.5 wk |
| **M11** | Server, friends, matchmaking, Glicko-2 + badges, Gym Leader promotion matches, trading | — | 4 wk+ |

M1 is playable by a human against a human in a week and a half and already contains the thesis. Every later
milestone is additive and none is a stub.

---

## 25. A worked game

Armies, drafted under the Standard format. Declared types in brackets; HP is the level-50 value
*(measured, `battlesim-4-worked.mjs`)*.

**White** — a1 R Swampert [Water] 176 · b1 N Arcanine [Fire] 166 · c1 B Alakazam [Psychic] 131 ·
d1 Q Nidoqueen [Ground] 166 · e1 K Slowking [Psychic] 171 · f1 B Gengar [Ghost] 136 ·
g1 N Garchomp [Ground] 184 · h1 R Skarmory [Steel] 141 ·
pawns a2 Sandshrew [Ground] 126, b2 Magnemite [Steel] 101, c2 Pikachu [Electric] 111, d2 Wooper [Water] 131,
e2 Charmander [Fire] 115, f2 Machop [Fighting] 146, g2 Zubat [Poison] 116, h2 Caterpie [Bug] 121.

**Black** — a8 R Ferrothorn [Steel] 150 · b8 N Rapidash [Fire] 141 · c8 B Chandelure [Fire] 136 ·
d8 Q Nidoking [Poison] 157 · e8 K Aegislash [Steel] 136 · f8 B Espeon [Psychic] 141 ·
g8 N Dragonite [Flying] 167 · h8 R Cloyster [Ice] 126 ·
pawns a7 Bellsprout [Grass] 126, b7 Geodude [Rock] 116, c7 Voltorb [Electric] 116, d7 Ekans [Poison] 111,
e7 Vulpix [Fire] 114, f7 Krabby [Water] 106, g7 Gastly [Ghost] 106, h7 Rattata [Normal] 106.

Every damage figure below is from `battlesim-6-narrate.mjs`, not from prose.

### Turns 1–6

**Turn 1.** Oracle `M 93 · F 11/16 · P 88`. White plays **e2–e4**, Charmander [Fire] advancing two. Nothing
resolves. Black replies **d7–d5**, Ekans [Poison]. The two pawns now face each other diagonally, and the
d5 square already carries a plain **CAPTURE** slash for White: Flamethrower is 1× on Poison.

**Turn 2.** Oracle `M 100 · F 4/16 · P 100`. Maximum Momentum, and both players can see it. White declines
the trade and plays **Ng1–f3** — Garchomp [Ground] to f3, because Garchomp's slot 2 is **Spikes** and f3 is
one step from the centre files it needs to reach. Black plays **a7–a5**, Bellsprout [Grass] stepping up.

**Turn 3.** Oracle `M 93 · F 2/16 · P 91`. White plays **ART: Garchomp → Spikes**, painting **e6–f6–g6**
(the segment is centred on Garchomp's own f-file). The whole turn and one of three charges, and no material
changes hands — this is the most Pokémon move in the opening. Every *grounded* Black piece that later ends a
sub-move on those squares pays **1/8 of its max HP**: 19 for Nidoking, 17 for Espeon, 15 for Cloyster
*(measured)*.
Black plays **Ng8–f6** — Dragonite, straight onto a Spikes square, and takes **nothing**. Dragonite's
declared type is Flying, so it is *airborne*, and Spikes is a grounded-only hazard. The airborne glyph lifts
under its pin and the square's Spikes counter greys out for that piece. One move has taught the single most
useful thing in the game: hazards and immunity are the same lesson from two directions.

**Turn 4.** Oracle `M 93 · F 8/16 · P 96`. White takes: **e4×d5**, Charmander Assaults Ekans. Fire on
Poison is 1×, Flamethrower does **148** against Ekans' 111 HP, and Charmander's Speed 117 beats 107, so
**the counterblow never happens**. Verdict **CAPTURE** — single slash inward, one death, Charmander takes d5
at full health, Readout line `outsped — no counterblow`.
Black recaptures: **Nf6×d5**, Dragonite Assaulting Charmander. Its Assault is **Aerial Ace**, not Hurricane
— the auto-picker rejected Hurricane because it is Special on a physical attacker and 70 % accurate
*(measured)*, and this turn's Precision of 96 would have made it a **WHIFF** anyway, which the square shows
before the click. Aerial Ace does **192** against 115 HP, Dragonite is faster, no counterblow. **CAPTURE.**
Black's knight now sits on d5 at full health.

**Turn 5.** Oracle `M 85 · F 15/16 · P 74`. A poor reading: low Momentum, and a Precision of 74 kills every
move on the board below 74 % accuracy for one turn. White plays **c2–c4**, Pikachu [Electric] stepping up so
that it attacks d5. Electric on Flying is **2×**, and the d5 square lights with the gold 8-ray
**ADVANTAGE** glyph — Pikachu, a pawn, is threatening a knight *and* a free move.
Black cannot take the pawn (c4 is not a knight's move from d5) so it defends instead: **Qd8–d6**, Nidoking
covering d5 so that the exchange is at least a recapture. d6 is not a Spikes square, which is why d6 and not
d7.

**Turn 6.** Oracle `M 93 · F 6/16 · P 100`. White plays **c4×d5**: Pikachu Assaults Dragonite with
**Wild Charge**. 2× super effective, **185 damage against 167 HP** — knocked out — and Pikachu's Speed 142
beats 132, so the counterblow is suppressed. Wild Charge's recoil is a third of the damage dealt: Pikachu
takes **46** and stands on d5 at **65/111**, its bezel arc down to five segments. Verdict **ADVANTAGE**: a
pawn has taken a knight, and White **moves again**.
The bonus may be spent by any piece that has neither earned nor used one this turn (T2), so not Pikachu.
White plays **Nf3–e5** with Garchomp, which is where the mid-game begins.
Black recaptures: **Qd6×d5**, Nidoking Assaulting the wounded Pikachu with Poison Jab. 1× on Electric, 222
against 65 — knocked out. But Nidoking's Speed 137 is *lower* than Pikachu's 142, so **the counterblow
lands**: Wild Charge at the 0.75 factor does **80**, and Black's queen takes the square at **77/157 — under
half health, on move 6.** Verdict **CAPTURE**, and White has traded two pawns for a knight and put the enemy
queen in the red.

Six turns have taught: Speed decides whether a capture is free; recoil is a real cost; hazards are set early
and paid for late; airborne pieces ignore Spikes; a low Precision reading disarms half the board; and a pawn
with the right type beats a knight and gets a free move for it.

### The mid-game exchange

**Move 22.** White's knight **Garchomp** [Ground] stands on **d4**. Around it: Black's queen **Nidoking**
[Poison] on e5 at 157/157; Black's rook **Cloyster** [Ice] on c5 at 95/126 (it crossed the Spikes twice);
Black's pawn **Gastly** [Ghost] on e3; and **White's own pawn Wooper** [Water] on d3. Black's bishop
**Espeon** [Psychic] is on f5, out of the ring. White's other developed pieces: **Gengar** [Ghost] on g4,
**Skarmory** [Steel] on c1 with the c-file clear, **Sandshrew** [Ground] on a4. Oracle `M 93 · F 9/16 · P 100`.

White plays **ART: Garchomp → Earthquake.** `RING1_ALL`, 100 BP, all eight neighbours, friend and foe, at
the ×0.75 spread factor. Every number measured:

| Target | Declared type | Effectiveness | Damage | After |
|---|---|---|---|---|
| Nidoking — Black's **queen** | Poison | **2×** | 307 | **1 / 157** |
| Cloyster — Black's **rook** | Ice | 1× | 73 | 22 / 126 |
| Gastly — Black pawn | Ghost | 1× | 294 | **1 / 106** |
| **Wooper — White's own pawn** | Water | **2×** | 225 | **1 / 131** |
| Espeon (f5) | — | not adjacent | — | untouched, and Black can see exactly why |

**Nothing dies.** A damaging ART wounds and never knocks out (§6.2). No bonus, no square taken, no tempo —
and Ground is super effective on Water, so White has just brought its own pawn to one hit point. Four damage
numbers rise at once and the stage holds an 18 % dim for a beat.

Black's problem is not the damage, it is the geometry. A queen at 1 HP dies to *anything*, so it needs a
square that nothing attacks — and it **cannot go home**, because e6, f6 and g6 carry White's Spikes from
move 3 and 1/8 of 157 is **19**. The retreat squares glow red under the drag preview. Along the fifth rank
a5 holds Black's own Bellsprout, c5 holds its own rook, d5 and the ring around d4 are Garchomp's. Black
plays the least-bad square, **Qe5–b5**, attacked only by the Sandshrew pawn on a4, and gambles that White's
tempo will be spent elsewhere.

**Move 23.** Oracle `M 93 · F 9/16 · P 100`. White plays **Gengar g4×f5**, Assaulting Espeon with
**Shadow Ball**: Ghost on Psychic is 2×, **278 against 141 HP**, Speed 162 versus 162 and the attacker wins
ties, so no counterblow. **ADVANTAGE.** The 8-ray star fires, the board frame turns gold, the stage holds
dim, a second turn chip appears in the rail, and Gengar's pin breathes gold until the bonus is spent.

**Bonus sub-move 2** — a different piece (T2). **Skarmory c1×c5**, Assaulting the softened rook with
**Iron Head**: Steel on Ice is 2×, **118 against 22 remaining HP**, Speed tie won by the attacker, no
counterblow. **ADVANTAGE again** — a second bonus. Chain is now 3.

**Bonus sub-move 3** — the last one T1 allows. **Sandshrew a4×b5**, a pawn Assaulting the queen with
**Earthquake**: Ground on Poison is 2×, **288 against 1 HP**. Sandshrew's Speed 92 is far below Nidoking's
137, so the counterblow *does* land — but Poison on Ground is 0.5×, so it is only **46**, and Sandshrew
survives at **80/126**. **ADVANTAGE** — and the chain is capped at 3, so the turn ends here even though a
fourth bonus was earned. The third turn chip greys out with the cap glyph.

**One turn: a bishop, a rook and the queen, all three by super-effective knockout.** And read back how it
was built:

- the Earthquake removed nothing, cost White a pawn's health, and gained no ground — and it is the reason
  every link in the chain was a one-shot;
- the Spikes laid on move 3 never damaged anything at all, and they are the reason the queen was standing on
  a square a *pawn* covered;
- Skarmory's Steel and Sandshrew's Ground were draft decisions made before the game started;
- the counterblow on the last link was survivable only because Poison is resisted by Ground;
- the chain stopped at three because the rules cap it at three, and the UI said so;
- and every single number was on screen before a click.

That is the game this proposal is for: Pokémon arithmetic, resolved on a chessboard, in public.

---

## 26. Where this deviates from a recon doc's recommendation, and why

| Doc | Its recommendation | This design | Why |
|---|---|---|---|
| `recon-abilities-items.md` §2.4 | collapse all stats and stat stages into one `Vigour` counter in [−3,+3] | real six-stat block and real ±6 stages | the abstraction exists because capture is binary. With a damage formula, Thick Fat, Huge Power, Multiscale and Sturdy are literal, and 60 abilities stop being approximations |
| `recon-abilities-items.md` §6.1 | every ward, including the type chart's 0×, is one-shot | wards are permanent; **hazards, weather, status and ranged attacks are the key** | it is what the games do, it keeps move generation pure (worth ~1 ply per `recon-tech.md` §B.5), and it is a better answer to hard problem 6 |
| `recon-abilities-items.md` §6.2, §6.4, §6.6, §6.13 | bespoke bounds for Wonder Guard, Huge Power, Focus Sash and thorns | none needed | Shedinja has 1 HP; doubling Attack doubles damage; Focus Sash sets HP to 1 and the counterblow can still kill; Rough Skin can finish a wounded attacker, as it does in the games |
| `recon-tcg.md` §3.3 | fold `frz` into sleep; drop Confusion's self-damage; re-spec paralysis as "lose one activation" | keep `frz` (capped at 3 turns); keep Confusion self-damage (deterministic); keep paralysis' Speed halving | its stated reason in each case is "we have no HP". We do. Paralysis' 25 % silent failure *is* dropped, because that reason was about hidden post-commitment randomness and stands |
| `recon-tcg.md` §1.5 | apply the type modifier only to a move's primary target | apply real effectiveness to every square an area move hits | an Earthquake that hit a Flying bystander would read as a bug. We take the bound the ruling exists for instead: **area attacks never grant a bonus** |
| `recon-tcg.md` §1.5 / §10.1 | apply no type modifier to Bench targets; treat Active-vs-Bench as a bound | **damaging ARTs wound but never knock out** (§6.2), with `selfdestruct` as the one exception | this is that ruling's principle taken further and applied where it is load-bearing: it is what stops the design becoming Rifle Chess. Measured trigger: a ranged Psychic does 280 damage, more than any piece in the sample armies has HP |
| `recon-tcg.md` §7.2 | one Stadium slot: weather *or* terrain | one weather **and** one terrain | the games run both, and they are visually separable (sky band vs floor glow). Its repetition closer — you may not re-cast the active field — is adopted |
| `recon-tcg.md` §8.3 / §5.2 | a per-piece Charge counter (0–2) gating strong moves | real PP-derived charges per slot, and **Struggle** when slot 0 empties | PP is the canon resource and the data already carries it; Struggle is a better and more famous version of "you ran out" |
| `recon-moves.md` §0 | exclude the 35 Z-moves and 52 Max moves | keep both as live data | Z-moves are the Z-Power payload; Max moves resolve through their base move for Gmax promotions. Neither is draftable, so the balance objection does not apply |
| `recon-moves.md` §2.7 | +2 Speed stages grant one extra square of movement | Speed never changes movement geometry | in this design Speed already decides the counterblow, which is a bigger lever than reach; changing chess geometry from a stat stage would break the AI's move generation and the chess player's intuition at once |
| `recon-variants.md` §6.3 | public per-turn CRIT type and FLINCH type | the Oracle: public Momentum, Focus and Precision | same principle (reveal before the decision), instantiated on the games' own three random variables rather than on invented ones |
| `recon-variants.md` §5 R6 | 0× degrades to 0.5× against a King | 0× against a King degrades to 1× | with real HP, 0.5× would mean "the attacker dies", i.e. a King would be *more* dangerous to attack than a rook. Neutral is the right degradation, and it still supplies the key |
| `recon-visual.md` §2.3 | the pin's bezel is a plain metal ring | the bezel carries the 8-segment HP arc | HP must be visible, and the bezel is the only ring-shaped real estate on the pin |

---

## 27. Risks, honestly

1. **σ = 1.6 is a visible fudge.** It is measured, parameterised, printed on the format card and re-fitted
   by the simulator — but a competitive player who calculates from Smogon will see numbers that are ~1.6×
   too big, and the `CLASH ×1.6` line in the trace is the only thing between us and that complaint.
2. **Speed may be over-strong.** It decides the counterblow, which is the most valuable thing in the game.
   Trick Room, priority moves and the fitted draft cost are the levers; the batch simulator's per-stat
   win-rate report is the detector. If it dominates, the first thing to try is a floor on the counterblow
   (e.g. it always lands at 0.4× even when suppressed).
3. **Attrition may make the mid-game mushy.** A board of half-dead pieces could feel like neither chess nor
   Pokémon. The progress clock and the HP term in the eval are the guards; the measure to watch is mean HP
   on the board over time, which the simulator reports.
4. **Branching is bigger than a binary-capture design**, so the AI is about one ply shallower at the same
   budget. The two forward-pruning rules are principled but unmeasured, and they must be validated against
   an unpruned baseline before we trust the difficulty ladder's Elo column.
5. **Residual damage is now the only non-Clash removal path**, and it may be too strong or too weak; we have
   not measured it. Stealth Rock alone takes 25 % of a Fire/Flying/Ice/Bug piece's max HP per crossing
   *(measured)*, and a Toxic plus one hazard layer kills in roughly six turns. The simulator must report the
   fraction of removals caused by residuals; the design intent is 10–15 %, and if it exceeds ~25 % the
   answer is to make the hazard-answer validator require two pieces rather than one, not to nerf the
   fractions — they are canon.
6. **The Oracle removes in-turn surprise.** Some players want the dice to hurt them. The mitigation is that
   `momentumRange` and `critWindowBase` are format parameters, so a "Wild" format can widen both, and the
   Sandbox can show a player the difference in a single afternoon.
7. **HP in the Zobrist key inflates it.** HP must be bucketed (8 buckets per piece) rather than exact, or
   the transposition table becomes useless. That is a measured-in-advance decision, not a discovery — but
   the bucketing loses some exactness in the TT and needs a mandatory best-move revalidation.
8. **`Past` content is required** (Mega formes, Shedinja, half the items). `recon-data-substrate.md`'s
   inclusion policy already admits it; if a licensing or scope decision later excludes `Past`, this design
   loses Mega Evolution and ~180 items at once.

---

## 28. The ten hard problems, answered

**1 — Content coverage at scale.** 950 moves compile to a `MoveEffect` record from declarative fields
(787), a curated tag table (88 rows), or one of 16 bespoke rules (79 moves). 311 abilities map to 118
implementations over 14 hooks, with the 13 archetypes retained as the UI vocabulary and 8 prose-only cases
hand-classified. 536 items map to ~45 primitives (351 mechanical) plus 185 documented repurposings.
Fallback: a damaging move becomes a MELEE Assault at `basePower || 60`; a Status move becomes +1 stage to
the caster's best stat. Every entity carries a `coverage` class and a test walks all 1 797 of them. Because
damage is real, `drain`/`recoil`/`heal`/`multihit` and the whole HP-touching half of the dex are literal
rather than approximated, which is why the derived bucket is larger here than in any binary-capture design.

**2 — Turn structure.** §5, in full. One action per turn: ADVANCE (free), ASSAULT (a Clash, 1 charge),
ART (a Pokémon move used in place, costs the whole turn and 1 charge), or the once-per-game TRAINER action.
**Pieces have real HP and it persists.** Capture is not binary: a Clash resolves to one of five verdicts.
Using a Pokémon move as an attack *is* the capture, so ordinary chess is never taxed; using one for anything
else costs your turn. And a damaging ART **wounds but never knocks out** (§6.2), so every removal on the
board is still a chess move onto a square — which is what keeps the game chess-shaped rather than Rifle
Chess. Median turn 5.7 s (§5.1).

**3 — Termination.** §14.4, three claims proved. Within a turn: a bonus is granted only by a
super-effective knockout, every one removes an enemy piece, so `L ≤ N + 1 ≤ 17`, capped at 3 with one
bonus earned and one used per piece. Nothing else in 950 moves, 311 abilities and 536 items grants an
action — enumerated. Across the game: progress events are bounded at ≈2 000 (faints ≤ 32, pawn advances
≤ 96, promotions ≤ 16, and every hazard, status and heal consumes one of ≤ 448 charges per side), and at
most 100 sub-moves may pass between them, giving a loose bound of ≈2.1 × 10⁵ sub-moves and a practical
bound of the progress clock plus a 300-turn cap.

**4 — Check, checkmate, mutual destruction, king capture.** §14. King capture, no check-legality, Atomic's
suicide guard, mover-wins on simultaneous royal death, exposure ends the turn, Kings never immune, and
check demoted to advice — `recon-variants.md`'s R1–R7 adopted. The Oracle makes R3 *exactly* computable
(the current turn is deterministic), so "illegal to remove your own King" is Atomic rule 5 implemented
rather than approximated. The on-camera bug is resolved by information, not by a rule: the King Danger
meter reports `n/32` with the threatening piece named, before the click. The Last Stand rule stops
indirect damage from ever removing a King, which closes "Toxic the King and run".

**5 — Balance.** Piece values from `recon-variants.md` §3.2's type-aware model with a new HP term
`(0.55 + 0.45·hp/maxHp)` and a BST term; draft cost `max(0, round(14·(BST/600)^1.6·typeMult − 3))` against
a 60-point budget. Type knowledge is worth ≈0.6 pawns per capture, measured: best-of-four move choice moves
ADVANTAGE from 12 % to 32 % and ROUT from 24 % to 15 %. RNG is input-only and worth ≈0.5 pawns a game, so
there is headroom to widen it. Every coefficient, σ, the counterblow factor and the crit window are format
parameters fitted by the batch simulator, never by hand — Betza's armies were off by more than a pawn after
master playtesting. Draft-time decision is bounded by the mirror-pool format and by Chess18-style pairing
screens.

**6 — Draft.** §17. Slot-first: 16 slots in a fixed order, five candidates per slot with a guaranteed
spread (a type you lack, an affordable option, at most one Legendary), one reroll, search behind a toggle.
Never a 1025-item list. Per pick: type (1–2 radio), ability (1–4 radio — measured, 357 species offer no
choice at all), a Kit item, and one swappable move from a shortlist of 8. Validators: 60-point budget, ≥ 10
distinct declared types, at most one Ace (the ACE SPEC precedent), at least one hazard answer, at most one
Ruin. Parameterised by `PoolSource`, so `full-dex`, `collection`, `fixed` and `mirror` are the same code
and the match rules never learn which is in play. ~90 seconds for a returning player.

**7 — Rendering and performance.** §21. Hybrid: keep the 64-button DOM board and its accessibility tree,
move pins into one transform-positioned layer keyed by piece id, add two Canvas2D layers. Reject
WebGL/Pixi on a measured 231 KB gz bundle *and* on the CORS blocker — Showdown's CDN sends no
`Access-Control-Allow-Origin`, so canvas is permanently tainted; sprites are vendored same-origin at build
time (829 KB for all 1025 gen5 stills) and precached by a service worker for offline play. Budgets, all
CI-enforced: entry chunk ≤ 110 KB gz, critical-path data ≤ 60 KB gz, frame p95 ≤ 10 ms on a scripted
worst-frame replay, ≤ 1 200 particles, ≤ 250 board DOM nodes, no heap growth over moves 50→100. One rAF
ticker with a fixed read → simulate → write → draw order; six z-index custom properties and a lint rule
banning any other; a Presenter with `settle()` so the engine never waits on the UI and input never waits on
a flourish.

**8 — AI opponent.** §22. Alpha-beta + PVS + quiescence in a Worker, a ply is a sub-move, mates scored as
`29000 − subMoveCount`. **No interior chance nodes**, because the Oracle is revealed before decisions —
`recon-tech.md` measured full chance-node enumeration at 121–159× and input randomness at +10 %, and we
take the +10 %. The child's Oracle is collapsed to its modal value with a static risk bias; the root
samples three Momentum values with common random numbers. `staticClash` replaces SEE and is *exact*
because `resolveClash` is pure. Two principled forward-pruning rules keep the larger action space
tractable (a slot is generated only if it changes the verdict; ARTs only shallow or when they change a
verdict/field/hazard). Target depth 6–7 at 1 000 ms, p95 ≤ 1.3× budget with a 350 ms floor. Difficulty by
corrupted type chart (measured monotonic, 5 % → 47 %, 30 % → 37 %) plus a corrupted stat model unique to
this design, so a beginner AI misjudges Speed exactly as a beginner human does. Gym Leaders field mono-type
armies with a printed, compensating budget bonus, because a mono-type army was measured at 36 %.

**9 — Legibility.** §20. Role is the outer silhouette, derived from the piece's own movement, in six SVG
paths — role dominant, and it survives 24 px and greyscale. Type is the enamel field plus a glyph; owner is
the bezel metal at a measured 15.2:1 separation. HP is an 8-segment arc that is *absent* at full health, so
the board is clean until something is hurt. **Base stats are never on the board**: the engine computes and
the square shows one of five verdict glyphs, with the whole calculation one hover away in the Battle
Readout. A chess player can play with the move menu closed and be right 68 % of the time, measured, and the
UI raises a chevron exactly when that is not true — the game tells you when to learn something. Two
onboarding paths, colour never used alone, `prefers-reduced-motion` served by static outcome stamps held
1 200 ms, and a Notation mode for screen readers.

**10 — Scope order.** §24. **M1 in a week and a half** is a hot-seat game with real stats, real HP, the
Oracle, all five verdicts, verdict glyphs, HP arcs and king capture — the entire thesis, playable, with
zero curated content. Then role silhouettes and the five animations (M2), the move layer (M3), status and
field (M4), abilities and items (M5), the AI (M6), the draft (M7), the bespoke rules and transformations
(M8), the sandbox and the first measured balance pass (M9), the meta-game (M10), the server and ladder
(M11). Roughly 21 weeks to M11 for one engineer; ~11 weeks to a complete single-player game with a draft
and an AI. Nothing on the list is a stub, and every milestone boundary is a thing a player can sit down and
play.
