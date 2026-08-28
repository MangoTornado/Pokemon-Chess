# Pokémon Chess — Canonical Specification

**Status: THE specification. This is the document the implementation is built from.**

It supersedes all four proposals (`proposal-battle-sim.md`, `proposal-systems-compiler.md`,
`proposal-competitive-first.md`, `proposal-systems-first.md`). Those remain in the repository as design
history and are not to be implemented. Where this document and a proposal disagree, **this document wins**.

**Documents that outrank this one:** [`DIRECTION.md`](./DIRECTION.md) (product steering, the owner's own
words) and [`recon-data-substrate.md`](./recon-data-substrate.md) (measured facts about the dataset).
[`BRIEF.md`](./BRIEF.md) and [`BRIEF-METAGAME.md`](./BRIEF-METAGAME.md) set the problems. The other recon
documents (`recon-moves`, `recon-abilities-items`, `recon-variants`, `recon-tcg`, `recon-tech`,
`recon-visual`) are authoritative on their own subject matter and are *cited*, not restated, wherever their
tables are the deliverable — an implementer needs this document plus those six.

**Provenance.** Every figure marked *(measured)* was computed on this machine against `@pkmn/sim@0.10.11`
and `@pkmn/dex@0.10.11`, or against the repository's own generated bundle. Numbers new to this document come
from `/tmp/pkmn-probe/chief-designer-verify{,2}.mjs`, `chief-clash-model{,2,3}.mjs`, `chief-clash-final.mjs`
and `chief-spread.mjs`. Numbers inherited from a recon document are attributed to it.

**What changed from the leading proposals, and why — read this before anything else.**

| # | Change | Consequence |
|---|---|---|
| 1 | **The Clash Constant σ = 1.6 is deleted.** A Clash is a *bounded exchange* — the attacker swings twice, the defender swings in Speed order until the attacker's second swing lands — resolved with the real gen-9 damage formula at σ = 1.0. | *(measured)* This reproduces the target outcome distribution — super-effective 84%, neutral 51%, resisted 14% — with **no invented multiplier anywhere in the game**. It also gives the player the most native sentence in competitive Pokémon: *"is this a 2HKO?"* |
| 2 | **The content system is a compiler, not a hook registry.** Four measured signal channels over `@pkmn/sim`'s own source, a 20-op ISA, an 81-stem handler grammar, a 2-D region derivation, and eight CI gates. | 0 hand-written ability functions instead of 163. A `@pkmn/dex` bump adds content with no code change. |
| 3 | **Real HP deletes the compiler's largest defect for free.** The receiver-blind `chainModify → ±1 roll modifier` conversion that inverted Fur Coat, Chlorophyll, Slow Start and 82 other entries **no longer exists**: a multiplier is carried into the damage pipeline slot the handler's own stem names. | 85 entries repaired by removing a table, not by adding one. |
| 4 | **The per-piece Charge counter is cut.** It existed to subsume `flags.charge`, `flags.recharge` and Speed Boost; with real stats and real HP all three have a literal canon implementation. | One fewer counter on the pin, one fewer thing to teach. This is the pattern of the whole synthesis: *the abstraction existed because capture was binary.* |
| 5 | **The type-based status immunities are DATA, not a hand-written table.** *(measured)* `Type.damageTaken` maps `psn`/`tox`/`brn`/`par`/`frz`/`hail`/`sandstorm`/`powder`/`prankster`/`trapped` to `3` (immune) alongside the 18 type keys — Steel `{psn:3, tox:3, sandstorm:3, Poison:3}`, Fire `{brn:3}`, Electric `{par:3}`, Ice `{frz:3, hail:3}`, Grass `{powder:3}`. | Zero authoring. "Status ignores type immunity" — the answer three proposals gave to the untouchable-piece problem — is now correct rather than a hole. |
| 6 | **The bonus sub-move has exactly one source and crits are not it.** An ADVANTAGE, and nothing else. | The video's crit-chain engine does not exist. Termination is one grep, enforced by CI. |
| 7 | Nineteen judge-identified fatal flaws are fixed and the rest are dismissed with an argument. | [Appendix A](#appendix-a--every-fatal-flaw-accounted-for) enumerates all of them by name. |

---

## Table of contents

1. [Thesis](#1-thesis)
2. [The player's mental model](#2-the-players-mental-model)
3. [Board, army, pieces, stats](#3-board-army-pieces-stats)
4. [The Clash](#4-the-clash--capture-resolution-every-case)
5. [The damage pipeline](#5-the-damage-pipeline)
6. [Randomness](#6-randomness--the-public-roll)
7. [The turn loop](#7-the-turn-loop)
8. [Moves](#8-moves)
9. [Status, stages, field, hazards, the Checkup](#9-status-stages-field-hazards-the-checkup)
10. [Abilities and items](#10-abilities-and-items)
11. [Transformations and promotion](#11-transformations-and-promotion-as-evolution)
12. [The King, win conditions, draws, termination](#12-the-king-win-conditions-draws-termination)
13. [The content system: the compiler](#13-the-content-system--the-compiler)
14. [Faithfulness ledger](#14-faithfulness-ledger)
15. [Balance, the draft, formats](#15-balance-the-draft-formats)
16. [Visuals and animation](#16-visuals-and-animation)
17. [UX flow](#17-ux-flow)
18. [The tutorial](#18-the-tutorial)
19. [The AI opponent](#19-the-ai-opponent)
20. [Engine contract](#20-engine-contract)
21. [Budgets and tests](#21-budgets-and-tests)
22. [Milestones](#22-milestones)
23. [A worked game](#23-a-worked-game)
24. [Appendix A — every fatal flaw accounted for](#appendix-a--every-fatal-flaw-accounted-for)
25. [Appendix B — rejected alternatives](#appendix-b--rejected-alternatives)
26. [Appendix C — open questions](#appendix-c--open-questions)

---

## 1. Thesis

> **A capture is a battle, and it is resolved the way Pokémon resolves one. All the content that decides
> that battle is compiled out of Pokémon's own source code rather than written by hand.**

Two claims, and the whole design is their product.

**Claim one — the outcomes are not rules we impose; they are what the damage formula already does.**
Pieces have real HP from real base stats. Damage uses the real gen-9 formula. A capture is a *bounded
exchange of blows*: you swing twice, they swing in Speed order until your second swing lands. Nothing is
compressed, scaled or fudged. Measured over 25 000 real pairings at level 50 (`chief-clash-final.mjs`):

| Slot-0 matchup | attacker takes the square | attacker dies instead | nothing happens | pairs |
|---|---|---|---|---|
| **2× super effective** | **84.1 %** | 15.7 % | 0.2 % | 51 of 324 |
| **1× neutral** | **50.9 %** | 44.0 % | 5.1 % | 204 of 324 |
| **0.5 × resisted** | 14.4 % | **62.6 %** | 23.0 % | 61 of 324 |
| **0× immune** | the action is never generated | | | 8 of 324 |

Read that against `BRIEF.md` §2 rule 3. *Super effective → capture, and you move again* (84 %).
*Neutral → an ordinary chess capture* (51 %, the modal outcome, decided by Speed and bulk).
*Not very effective → you lose your piece* (63 %). *Immune → the capture is illegal.* **The source
ruleset is the emergent behaviour of the real damage formula, and it needs no scalar to make it so.**

The mean exchange is **1.98 blows** and the modal exchange is **one blow** *(measured)* — a
super-effective hit is usually a one-shot, which is precisely the tempo a ×2 Weakness buys in the TCG
(`recon-tcg.md` §1.4 measured the modal Weakness as worth exactly one turn).

**Claim two — 1 797 content entries become board effects by a compiler.** `@pkmn/dex` strips every
behaviour callback with no marker, so Belly Drum looks inert and Rest looks like it does nothing
(`recon-data-substrate.md` §2). `@pkmn/sim` keeps the functions *and their source text*: **1 675 handler
functions, 440 KB of source, 150 distinct handler names** *(measured, three independent scanners agreeing
to one call site in a thousand)*. Those handlers speak a small mutation API, their names parse under an
81-row grammar, and their return values and field assignments — **494 handlers, 29.5 % of the surface,
invisible to any call-site census** — parse under a 14-row grammar. Five compiler passes turn all of it
into a 20-op instruction set. **1 604 of 1 797 entries derive with zero authoring; the rest are named
diffs against the compiler's own proposal; nothing is undefined, and eight CI gates say so by name.**

**Why the two claims need each other.** The compiler's single largest defect, measured across the whole
dex, was that it had to convert Showdown's multipliers into integer roll modifiers and the conversion was
receiver-blind: Fur Coat's `onModifyDef ×2` became *+2 attack*, Slow Start's `Atk ×0.5` became *+2
defence*, and 26 type lenses, 34 Plates, Expert Belt and Life Orb all became inert because they are ×1.2
and the threshold was 1.4. With a real damage formula there is no conversion: `chainModify(2)` on
`onModifyDef` writes `×2` into the `def` slot, because the handler's own stem names the slot. **The
resolution model repairs the content system, and the content system is what makes the resolution model
affordable.** That is the reason this is one design and not two.

### 1.1 What this buys, enumerated

1. **Bulk exists.** *(measured, level 50)* HP spans **1 (Shedinja) / 96 (Magikarp) / median 144 / 362
   (Blissey)**. A Blissey is genuinely harder to remove than a Magikarp — the most basic Pokémon property
   there is, and the one thing no binary-capture design can express.
2. **~200 entries are literal instead of bucketed.** `drain`, `recoil`, `heal`, `multihit`,
   `damage:'level'`, Stealth Rock's `1/32 · 2^k`, Spikes' `1/8 · 1/6 · 1/4`, burn's `1/16` and its
   Physical halving, toxic's `n/16`, Leftovers' `1/16` in its real `onResidualOrder` slot, Life Orb's
   `×1.3` and `1/10`, Rocky Helmet's `1/6`, Rough Skin's `1/8`, Sturdy, Multiscale, Focus Sash, Pain
   Split, Endeavor, Super Fang, Substitute, Belly Drum, Perish Song, the 18 resist berries at `×0.5`.
3. **Hard problem 6 dissolves without a fudge.** A Flying piece that no Ground move can capture still
   dies to Stealth Rock, to sandstorm, to Toxic, and to being softened to 1 HP by a ranged attack and
   taken by any pawn. **Immunity blocks a capture; it does not block death** — which is exactly what it
   does in the games, which is why `DIRECTION.md` names permanent Levitate as its model of a *good*
   mapping. No one-shot ward, so capture legality stays a pure function of position.
4. **Shedinja needs no bespoke bound.** *(measured)* `species.maxHP` is `1` and Shedinja is **the only
   species in the dex carrying that override** — so Wonder Guard can be literal and hazards still kill it.
   §3.4 makes reading `maxHP` a named, tested requirement, because the HP formula alone would give 77.
5. **Attrition gives chess the thing it lacks and Pokémon has: the wounded piece.** *(measured)* the
   winner of a neutral exchange is left at **68 %** of max HP, of a resisted exchange at **50 %**. A rook
   at 30 % is a liability you must protect or trade, so guarding matters — which is the failure mode
   `recon-variants.md` §1.2 warns about via Rifle Chess.
6. **Every outcome is exactly known before you commit.** All randomness that can cost a piece is revealed
   before the decision (§6), so the board stamps a *verdict*, not a probability, on every reachable
   square. The engine does the arithmetic; the player reads a shape.

---

## 2. The player's mental model

Eight lines. Everything else in this document is an elaboration of them.

1. Your piece moves like a chess piece. **That never changes.**
2. Moving onto an enemy starts a **Clash**. You pick which of your four moves to swing with; slot 0 —
   always a move of your own declared type — is chosen for you by default.
3. **You swing twice. They swing in Speed order until your second swing lands.** Faster is better.
4. HP does not come back. Everything that chips HP in Pokémon chips it here.
5. Knock something out with a **super-effective** move and you **move again** — with a different piece.
6. A ranged or area attack **wounds but never kills**. Softeners and finishers are different jobs.
7. A **0×** matchup means the capture is not offered at all, and the square says why.
8. Every one of those results is printed on the square **before** you commit.

---

## 3. Board, army, pieces, stats

### 3.1 The board and the army

| Item | Value | Source |
|---|---|---|
| Board | 8×8, standard chess geometry, `src/engine/board.ts` **unchanged** | — |
| Army | **16 pieces: 1 King, 1 Queen, 2 Rooks, 2 Bishops, 2 Knights, 8 Pawns** | `STANDARD_ARMY`, already exported |
| Starting squares | standard (`STARTING_SQUARES`), so opening intuition transfers | — |
| Chess rules retained | castling, en passant, the two-square pawn advance, promotion geometry | — |
| Declared type | **exactly one per piece**, chosen at draft from the species' real `types` | `BRIEF.md` §2 rule 2 |
| Types in play | **18**. `Stellar` is excluded — 0 species, 1× both ways, so it would be a strictly dominant defensive declaration | `recon-variants.md` §8.1; `typechart.ts` already exports `DRAFTABLE_TYPES` |
| Level | every piece is **level 50** | — |

A legal army is 16 pieces, always, in both directions: no format may field 17, and any collection-based
format must guarantee its owner can field 16 on day one (§15.6).

### 3.2 Chess class is derived from real data

Flavour does not scale to 1025 species and it does not survive a ladder, because players argue about it.
Class comes from the dataset and the derivation is published, so the argument is about the formula.

```ts
// src/draft/classify.ts   — a pure function of baked fields
const canEvolve = (s: SpeciesEntry) => s.evos.length > 0;          // measured: 450 of 1025 base formes
const isRoyal   = (s: SpeciesEntry) =>
  s.tags.some(t => ['Restricted Legendary','Sub-Legendary','Mythical','Paradox','Ultra Beast'].includes(t));

/** The single best class, used for sorting, the AI's army summary and the Pokédex label. */
export function classOf(s: SpeciesEntry): PieceClass {
  if (canEvolve(s)) return 'pawn';                                  // a pawn has not finished growing
  const b = s.baseStats, bulk = b.hp + b.def + b.spd, off = Math.max(b.atk, b.spa);
  if (isRoyal(s) && s.bst >= 580)        return 'king';
  if (s.bst >= 540 && off >= 100)        return 'queen';
  if (b.spa > b.atk + 10 && b.spa >= 90) return 'bishop';           // the video's "magical" bishops
  if (b.spe >= 95)                        return 'knight';           // the video's "rideable" knights
  if (bulk >= 280 || b.def >= 100)        return 'rook';             // the video's bulky rooks
  if (s.bst >= 480)                       return 'queen';
  return 'knight';
}

/** SET-valued, and this is the one the draft pool uses. */
export function eligible(s: SpeciesEntry): ReadonlySet<PieceClass> {
  if (canEvolve(s)) return new Set(['pawn']);
  const b = s.baseStats, bulk = b.hp + b.def + b.spd, off = Math.max(b.atk, b.spa);
  const e = new Set<PieceClass>();
  if (b.spe >= 85 || (b.spe >= 70 && b.atk >= 90))  e.add('knight');
  if (b.spa >= b.atk && b.spa >= 80)                e.add('bishop');
  if (bulk >= 270 || b.def >= 100 || b.spd >= 100)  e.add('rook');
  if (s.bst >= 500 && off >= 95)                    e.add('queen');
  if (isRoyal(s) || s.bst >= 580)                   e.add('king');
  if (e.size === 0) e.add(s.bst >= 470 ? 'rook' : 'knight');        // total fallback: never empty
  return e;
}
```

*(measured)* **450 pawn candidates / 575 officers, no overlap and no gaps.** Single-best distribution
K 76 / Q 143 / B 103 / N 162 / R 91. Mean **1.88 eligible classes per species**, and **no empty
(type × class) cell** — which matters, because a strict single mapping leaves Fighting with zero bishops
and makes the every-type-on-the-board goal unreachable.

> **"A pawn is a Pokémon that has not finished growing, and promotion is its evolution."** That is the
> video's own on-camera reading, it is the TCG's model of evolution as an action played onto a piece
> already in play, it scales to 1025 without a flavour argument, and it is one field (`evos.length`).

**The King is gated.** `eligible` admits `king` only for `isRoyal(s) || bst >= 580`. This is not
decoration: it is what structurally forecloses the Shedinja King (bst 236), which is otherwise a free
unloseable piece (§12.6).

### 3.3 Stats: two canon spreads, chosen by the species' own stat line

Every piece is level 50 with 31 IVs. The EV spread and nature are **derived from the base stats**, because
a universal all-out-attacker spread would make Blissey and Shuckle max-Speed sweepers — systematic, and
thematically wrong, which `DIRECTION.md` classes as a defect.

```ts
// bulk-versus-offence, measured against the whole dex
const isBulwark = (b: BaseStats) => b.hp + b.def + b.spd >= Math.max(b.atk, b.spa) + b.spe + 60;
```

| Spread | EVs | Nature | Who gets it |
|---|---|---|---|
| **Assault** | 252 in the higher of `atk`/`spa`, 252 `spe`, 4 `hp` | +10 % on that offensive stat | 543 of 1025 *(measured)* |
| **Bulwark** | 252 `hp`, 252 in the higher of `def`/`spd`, 4 `spe` | +10 % on that defensive stat | **482 of 1025 (47 %)** *(measured)* |

*(measured)* The predicate lands every named piece where a competitive player expects: Blissey, Chansey,
Shuckle, Ferrothorn, Skarmory, Snorlax, Toxapex, Dondozo, Steelix and Lapras are **Bulwark**; Garchomp,
Gengar, Pikachu and Magikarp are **Assault**.

Resulting ranges at level 50 *(measured)*: HP **1 / 96 / median 144 / 362**; Speed **25 / median 117 /
252**. Both spreads are wide enough to matter and narrow enough to hold in your head, and both are real
competitive builds rather than an invention. The predicate's threshold is a `format` parameter and is
re-fitted by the batch simulator (§15.8).

### 3.4 Shedinja: `maxHP` is a named, tested read

```ts
export const maxHpOf = (s: SpeciesEntry, level = 50): number =>
  s.maxHP ?? Math.floor((2 * s.baseStats.hp + 31 + 1) * level / 100) + level + 10;
```

*(measured)* **Shedinja is the only species in the dex with a `maxHP` override, and it is `1`.** The HP
formula alone gives **77**, which would ship a 77-HP Wonder Guard piece — precisely the untouchable piece
the literal reading exists to retire. `scripts/gen-data.ts` must emit `maxHP`, `schema.ts` must carry it,
and `stats.test.ts` asserts `maxHpOf(shedinja) === 1` and `maxHpOf(blissey) === 362` by name.

### 3.5 Declared type: defence is the piece, offence is the move

> **A piece's declared type is what it is *attacked as*. The type of the move it uses is what it *attacks
> with*. Slot 0 — the Melee slot — is always a damaging move of the piece's own declared type, so an
> ordinary chess capture is always "attack with your own type". Slots 1–3 are your coverage.**

This is how Pokémon works, and it is what makes the 950-move layer *matter* rather than decorate. Gengar
declared Ghost cannot touch a Dark piece with slot 0 (Ghost→Dark is 0.5×) but can with Sludge Bomb
(Poison→Dark 1×) or Focus Blast (Fighting→Dark 2×). The video's headline rule survives **exactly where it
is load-bearing** — on the default line of play and on defence, which is what makes a piece's identity
legible to the opponent.

Three measured consequences:

- A coverage slot rescues an outright-illegal slot 0 in only **2 %** of clashes, so immunity keeps its
  teeth; it is *strictly better* than slot 0 in **36 %** *(measured, `chief-clash-final.mjs`)*.
- On a 0.5× slot-0 matchup, a literate player choosing the best of four slots converts the capture rate
  from **14.4 % to 40.4 %** *(measured)*. That is the type-knowledge edge, quantified, and it is paid out
  on every capture rather than on one turn in ten.
- The moveset auto-picker carries a **type-coverage quota** (§8.2) which raises mean distinct attacking
  types per piece from 1.00 to **2.42** and cuts pairs with no legal capture from 2.47 % to **0.37 %**
  (`proposal-competitive-first.md` §5.2, measured there).

---

## 4. The Clash — capture resolution, every case

One resolver, `src/rules/clash.ts`. **It is the only place in the codebase where an outcome is decided.**

### 4.1 The exchange rule

> **A Clash is a bounded exchange of blows. Blows alternate in Speed order. The exchange ends the moment
> a piece faints, or when the attacker has swung twice — whichever comes first.**

That is the whole rule. It produces exactly two sequences:

| | Sequence | Max blows |
|---|---|---|
| the attacker is faster (or has priority) | **A · D · A** | 3 |
| the defender is faster | **D · A · D · A** | 4 |

The attacker always lands the final blow, and its edge over the defender is exactly one swing — which is
what makes initiating correct by default, which chess requires. Being outsped costs you a blow, which is
the most recognisable pattern in competitive Pokémon.

**Why this replaces σ.** Pokémon's HP economy is tuned so a good hit takes 40–60 % of a defensive
Pokémon's HP: a battle is 4–6 turns. Chess needs a capture to resolve in one action. `battle-sim`'s answer
was a global `×1.6` on every damage number, which makes a knowledgeable player's own arithmetic wrong.
**The exchange is the same compression expressed entirely in canon units:** two turns of a real battle,
resolved in one chess action. *(measured)* two swings at σ = 1.0 reproduce a σ = 1.6 single blow almost
exactly — 84 % vs 86 % at 2×, 51 % vs 53 % at 1× — so nothing is lost and the fudge is gone.

### 4.2 The resolver

```
CLASH(A: attacker, slot, D: defender, roll):

 1. LEGALITY                                              (booleans only; no dice, no damage)
      t       := slot === 0 ? A.declaredType : moveTypeOf(A.slots[slot])
      pierces := run(CLASH_LEGAL, A)                      // Scrappy, Mind's Eye, Mold Breaker family,
                                                          //   Infiltrator, Thousand Arrows, Ring Target(D)
      vetoes  := run(CLASH_LEGAL, D) ++ run(CLASH_LEGAL, board)
                                                          // Levitate, Flash Fire, Volt/Water Absorb,
                                                          //   Bulletproof, Soundproof, Overcoat, Wonder
                                                          //   Guard, Protect, Damp, Queenly Majesty, BIND
      live := vetoes \ pierces

 1b. THE CHART READING                                    (the CHART op's stage; still no dice)
      lg := chart[t][D.declaredType] === 0 ? IMMUNE : log2(chart[t][D.declaredType])
      for each CHART op in run(CLASH_CHART, A) ++ run(CLASH_CHART, D)   // dispatch order, §13.5
           if op.union   : lg := lg + log2(chart[op.union][D.declaredType])      // Flying Press
           if op.set  != null : lg := op.set - 1                                 // Iron Ball, Thousand Arrows
           if op.d    != null : lg := (lg === IMMUNE ? IMMUNE : lg + op.d)       // Freeze-Dry, Tar Shot
      eff := lg === IMMUNE ? 0 : clamp(2 ** lg, 0.25, 4)
      if eff === 0 and D is a King:  eff := 1              // R6 — a King is never unreachable
      if eff === 0:  live += 'type'
      if live is non-empty:  THE ACTION IS NOT GENERATED   // never offered, never searched, never animated

 2. ACCURACY                                              (pre-revealed per action, §6)
      if not roll.hits:  -> REPEL
            A returns to its origin square, spends the charge, takes no damage; D untouched.
            The sub-move is consumed and the chain ends. The square SAID SO before the click.

 3. ORDER
      aFirst := priority(move) > 0
             or (priority(move) === 0 and effSpeed(A) >= effSpeed(D))    // the attacker wins exact ties
      effSpeed(P) = P.stats.spe x stageMul(P.stages.spe) x (par ? 0.5 : 1) x itemMul x tailwindMul
      Trick Room inverts the comparison for 5 turns.
      A negative-priority move (Avalanche, Focus Punch, Beak Blast) makes aFirst false unconditionally.

 4. THE EXCHANGE
      swings := 0 ; order := aFirst ? [A, D] : [D, A]
      loop:
        for P in order:
          if P is A:
              swings += 1
              blow(A -> D, slot, roll, crit = (roll.crit and swings === 1))
              if D.hp <= 0: break loop
              if swings === 2: break loop
          else:
              if D cannot act (asleep, frozen, flinched, recharging): continue
              blow(D -> A, slot 0, roll, crit = false)
              if A.hp <= 0: break loop

      blow(X -> Y, slot, roll, crit):
        dmg := computeDamage(X, Y, move, field, roll, crit)          // §5, allocation-free
        Y.hp := max(0, Y.hp - dmg) ; Y.pristine := false
        run(ON_DAMAGED, Y)     // Rocky Helmet, Rough Skin (contact only), Weakness Policy, Anger Point,
                               //   Berserk, Static, Flame Body, Cursed Body, Weak Armor
        run(ON_STRUCK, X)      // recoil, Life Orb, drain, Shell Bell
        // Sturdy / Focus Sash / Endure / Multiscale / Ice Face / Disguise are ORDINARY HP EFFECTS here:
        // they clamp `hp` to 1 or halve the incoming damage. They are not outcome rewrites, so they
        // compose with everything automatically and no ordering question arises.
        multi-hit: n blows inside ONE swing, each rolling damage; crit applies to hit 1 only.

 5. CLASSIFY
      dDead := D.hp <= 0 ; aDead := A.hp <= 0
      dDead and not aDead and eff > 1  ->  ADVANTAGE
      dDead and not aDead              ->  CAPTURE
      dDead and aDead                  ->  MUTUAL
      not dDead and aDead              ->  ROUT
      neither                          ->  REPEL

 6. APPLY
      ADVANTAGE : remove D; A occupies the square; GRANT BONUS (the only source in the game)
      CAPTURE   : remove D; A occupies the square
      MUTUAL    : remove D, THEN remove A; the square is empty       (order matters for R4, §12.3)
      ROUT      : remove A; D holds the square, wounded
      REPEL     : A returns to its origin square. Both keep their damage. The sub-move is consumed.
      then, if A moved: run(ON_ENTER, A, square)      // hazards fire, Intimidate, terrain seeds
      then riders: the used move's `secondaries`, each gated on its own TCG coin count (§6.3)
      then run(ON_KO) for anything removed                            // Aftermath, Innards Out, Destiny Bond
```

### 4.3 The five outcomes, complete

| Verdict | Defender | Attacker | Square | Bonus | Video rule realised |
|---|---|---|---|---|---|
| **ADVANTAGE** | removed | survives | attacker takes it | **yes** | 3a "super effective → move again" |
| **CAPTURE** | removed | survives, usually wounded | attacker takes it | no | 3d "neutral → ordinary capture" |
| **MUTUAL** | removed | **removed** | empty | no | 3b "both pieces are removed" |
| **ROUT** | survives, wounded | **removed** | defender keeps it | no | 3b's sharper cousin — see below |
| **REPEL** | survives, wounded or untouched | survives, returns to origin | defender keeps it | no | the failed assault, and the miss |
| *BLOCKED* | *the action is never generated* | | | | 3c "immune → illegal" |

**The one place the formula disagrees with the video, stated plainly.** The video says not-very-effective
⇒ *both* pieces die. The formula says: you fail to knock it out, it hits you back twice, and **you** die
(62.6 % of resisted assaults) or nothing happens (23 %). We ship the formula's answer:

- the lesson is identical and sharper — *never attack into a resistance*;
- the defender is left wounded (*measured*: at **71 %** of max HP after a losing resisted assault), so a
  sacrifice is partly productive and sets up a second piece — which the baton rule (§7.3) already rewards;
- **true mutual destruction is real, frequent and purchasable**, from thirteen named sources, all canon.

### 4.4 Where MUTUAL comes from

*(measured)* ordinary blows produce MUTUAL **0 %** of the time under strict Speed ordering — a fainted
Pokémon does not swing, which is correct. So MUTUAL is a *content* outcome, and it is deliberately
over-supplied:

| Source | n | Mechanism |
|---|---|---|
| Recoil moves | 12 | Brave Bird, Flare Blitz, Double-Edge, Head Smash, Volt Tackle, Wood Hammer, Wave Crash, Take Down, Wild Charge, Struggle, Chloroblast, Light of Ruin — the attacker's own blow can finish it |
| `selfdestruct` | **7** *(measured)* | Explosion, Self-Destruct, Misty Explosion (`always`); Final Gambit, Healing Wish, Lunar Dance, Memento (`ifHit`) |
| Thorns | ~10 abilities + 3 items | Rough Skin / Iron Barbs `1/8`, Rocky Helmet `1/6`, Sticky Barb — **once per contact swing**, so a 4-blow exchange ticks twice |
| Posthumous | 2 | Aftermath (`1/4` to a contact attacker), Innards Out |
| Bond | 2 | Destiny Bond, Perish Song |
| Item cost | 1 | Life Orb `1/10` per blow |
| **Hazards on arrival** | 4 | an attacker that *wins* a Clash and steps onto Stealth Rock can die there — which makes hazards a genuine defensive tool |
| Simultaneous Checkup | — | two pieces reaching 0 HP in the same Checkup are removed together (§9.5) |

Target rate **8–15 % of captures**, measured by the batch simulator (§15.8) and tuned there, not here.
`recon-tcg.md` §11.2 is correct that neither canon supports capture-kills-the-capturer as a *type* rule;
under this design it is not one — it is recoil, thorns and self-sacrifice, all of which are canon, and the
UI names the cause (§16.4).

### 4.5 The Softening rule — ranged and area attacks wound, they do not knock out

> **A damaging action that is not a step-in Clash — `RAY_LOS`, `RAY_ANY`, `RING1_FOES`, `RING1_ALL`,
> `BOARD` — cannot reduce any piece below 1 HP.** It takes no counterblow, the attacker does not move, and
> no piece is ever removed by it. **Only a Clash, or residual damage, removes a piece.** The single
> exception is the 7 `selfdestruct` moves: **you may kill at range only by dying.**

**This is a chess rule and it is labelled as one.** Its citation is Rifle Chess (Seabrook 1921), whose
documented failure mode is one line: *"it is of no use to guard pieces"* (`recon-variants.md` §1.2). It
was found by measurement, not by taste: Alakazam's Psychic fired at Chebyshev distance 2 does **280
damage** *(measured)* — more than any sampled piece has — so unbounded ranged kills would make area
attacks the dominant action and delete the chess. It is also what closes the largest exploit in the design
phase: *(measured)* **67 admitted area damaging moves, 47 at basePower ≥ 70, spanning 17 of 18 types**, on
~19 % of auto-picked slots. Without this rule a Dazzling Gleam removes up to eight pieces in one action.

**What it is not.** It is *not* the TCG's Bench rule, and this document does not claim it is. What the TCG
actually says — quoted on hundreds of cards — is *"Don't apply Weakness and Resistance for Benched
Pokémon"*, i.e. the **type modifier** does not apply off the point of contact. We **deviate** from that
and apply real per-target effectiveness on every square an area move touches, because with real HP an
Earthquake that ignored a bystander's Flying immunity would read as a bug. We take the *bound* the TCG
ruling exists for instead, in a stronger form.

Four further guards, all pre-existing:

1. An area or ranged action costs the **entire turn** and one charge from a slot with 1–5.
2. It grants **no bonus sub-move**, however many pieces it wounds.
3. `RETALIATE` abilities and contact-triggered effects **do not fire** — the `contact` flag is real data,
   so a ranged attack is the *safe* attack, which is exactly what "special attacker" should mean.
4. Reach is 2 (`RAY_LOS`, blockers matter) or 3 (`RAY_ANY`, `target:'any'` — the 24 flying and beam
   moves, of which **15 are Flying-type** *(measured)*, so "it flies over them" is free from the data).

**And it gives the design its loop:** special attackers **soften**, contact attackers **finish**. Every
removal is still a chess move onto a square, so guarding, defending, blocking and protection all keep
their full chess meaning, while HP attrition — the thing real HP exists for — becomes the mid-game's
entire texture.

Status, hazard, boost and field ARTs resolve **fully** and are not floored: an area status move can
poison four pieces, and a poisoned piece dies at the Checkup. That is the third and best answer to the
untouchable-piece problem, and *(measured)* **270 of 271 Status moves carry `ignoreImmunity`** so it needs
no special case. (The one exception is **Thunder Wave**, which canonically cannot paralyse a Ground type —
a data fact worth keeping, not smoothing.)

### 4.6 Priority resolves inside the Clash. There are no out-of-turn actions.

`priority > 0` (16 damaging moves *(measured: 42 moves at ≥ +1, of which 19 damaging)*) makes the attacker
strike first regardless of Speed, so the defender loses a swing. Gale Wings, Prankster and Triage grant
priority **within the Clash** in exactly the same way. `priority < 0` (14 moves, 10 damaging) makes the
attacker strike last, so the defender swings twice — compensated by high base power, exactly as in the
games.

**Nothing in this design lets a player act on the opponent's turn.** That is deliberate, and it is the
single most important architectural decision in the rules layer: an out-of-turn "Reaction" puts an
opponent *decision node* inside the attacker's sub-move, which simultaneously breaks "the search is
deterministic within a turn", forces nested journal frames, multiplies move generation by the defender's
options at every candidate capture, interrupts the capture animation mid-beat, and undermines the
new-exposure proof of §12.3. Folding priority into the Clash costs nothing and removes the last irregular
action source. `Counter`, `Mirror Coat`, `Metal Burst` and `Comeuppance` (the 4 `target:'scripted'` moves)
are therefore a **mark** set on your own turn that fires automatically when you are next attacked — not a
decision.

---

## 5. The damage pipeline

`src/rules/damage.ts`. One pure function, the canonical gen-9 order of operations, **with no invented
factor at any step**. `recon-tcg.md` §11.4's ruling on modifier ordering is respected: attacker bonuses,
then the type modifier, then defender reductions, and **a defender hook may only ever reduce**.

| # | Step | Factor |
|---|---|---|
| 1 | effectiveness, already computed at Clash step 1b (including any `CHART` rewrite) | 0 / 0.25 / 0.5 / 1 / 2 / 4 |
| 2 | base power after attacker `basePower` hooks | Technician ×1.5 (BP ≤ 60), Iron Fist ×1.2, Tough Claws ×1.3, type lens ×1.2, plate ×1.2, terrain ×1.3, Charge ×2 (Electric), Facade ×2 while statused, Analytic ×1.3 … |
| 3 | offensive stat × stage multiplier | `n >= 0 ? (2+n)/2 : 2/(2-n)`, exactly as the games |
| 4 | defensive stat × stage multiplier | a **crit ignores the defender's positive defensive stages** |
| 5 | `base = floor(floor(floor(22 · BP · Atk / Def) / 50) + 2)` | the level term is `2·50/5 + 2 = 22` at level 50 |
| 6 | spread | **×0.75** when the action hits more than one square |
| 7 | weather | Fire/Water ×1.5 or ×0.5 under sun/rain; `harsh-sun` zeroes Water, `heavy-rain` zeroes Fire |
| 8 | crit | **×1.5**, on the attacker's first swing only, when `roll.crit` |
| 9 | **Momentum** | `× roll.momentum / 100`, `momentum ∈ [85,100]` — the games' own random factor, made public |
| 10 | STAB | ×1.5; ×2 with Adaptability; a Terastallized piece keeps STAB on **both** types |
| 11 | type effectiveness | from step 1 |
| 12 | burn | ×0.5 on Physical moves, unless Guts |
| 13 | attacker final modifiers | Life Orb ×1.3, Expert Belt ×1.2 (super-effective only), Tinted Lens ×2 (resisted only), Neuroforce ×1.25, Sheer Force ×1.3 |
| 14 | defender final modifiers — **may only reduce** | Filter / Solid Rock / Prism Armor ×0.75 (SE), Multiscale / Shadow Shield ×0.5 (pristine), Thick Fat / Heatproof ×0.5, Fluffy ×0.5 (contact), Ice Scales / Fur Coat ×0.5, resist berry ×0.5, Reflect / Light Screen / Aurora Veil ×0.5, Eviolite ×0.67 (`species.nfe`) |
| 15 | floor, minimum 1 (0 if effectiveness is 0, but that action is not generated) | |
| 16 | HP clamps | Sturdy / Focus Sash / Endure at `pristine` clamp the survivor to **exactly 1 HP** and consume; False Swipe clamps always |

**There is no step 17.** No σ, no counterblow factor, no fitted scalar. Every factor above is a real
number from the real games, and `recon-abilities-items.md`'s abstract `Vigour ∈ [−3,+3]` is not used
anywhere — it existed because capture was binary.

### 5.1 Worked instance, step by step *(measured)*

Gengar (Ghost bishop, Assault spread, SpA 200) uses Shadow Ball (Ghost, Special, 80 BP) on Espeon (Psychic
bishop, Assault spread, SpD 115, HP 141) at Momentum 93 with no crit:

```
 floor(22 x 80 x 200 / 115)     = 3060
 floor(3060 / 50) + 2           =   63     base damage
 x 0.93  Momentum               =   58
 x 1.5   STAB (Ghost)           =   87
 x 2     super effective        =  174     <- 174 damage vs 141 HP: a one-shot
```

Espeon's Speed is 162, Gengar's is 162, and the attacker wins exact ties — so the exchange is
**A** and stops: Espeon is knocked out on swing 1, Gengar is untouched. Shadow Ball was super effective,
so the verdict is **ADVANTAGE**: capture, take the square, move again. **Every line above is canon
arithmetic a Smogon reader can check**, which is the whole point of deleting σ.

### 5.2 Two entry points, and why

```ts
/** Hot path. Table lookups and arithmetic only. Allocates nothing. Called by the search. */
export function computeDamage(i: DamageInput): number;

/** UI path only, behind an explicit call. Returns the ordered modifier trace. */
export function explainDamage(i: DamageInput): DamageExplanation;
export interface DamageExplanation {
  readonly damage: number; readonly effectiveness: 0|0.25|0.5|1|2|4;
  readonly crit: boolean; readonly stab: boolean;
  readonly trace: readonly { label: string; factor: number }[];
}
```

A single function returning `{ damage, trace }` would allocate an array of objects **per damage
computation on the single hottest path in the program**, which is how `recon-tech.md`'s measured 42–333 ms
GC spikes come back at depth 9. The split is non-negotiable and a lint rule forbids `src/ai/**` from
importing `explainDamage`.

### 5.3 The forecast, and its cache

Picking up a piece needs a verdict for every reachable target: up to 4 slots × 8 targets × up to 4 blows.
Affordable — a synthetic 17-step pipeline measures **136 ns per full clash forecast** against 3.9 ns for a
bare chart lookup *(measured, `recon-tech.md`)* — but the invalidation rule must be stated or it becomes a
30 ms hover stall.

```ts
/** Keyed on (epoch, momentum, attackerId, slot, defenderId). Cleared whenever `epoch` changes. */
export interface ForecastCache { get(k: number): Verdict | undefined; set(k: number, v: Verdict): void; clear(): void; }
```

`epoch` is the slow-moving state word of §20.4 — it changes on a type mutation, a Tera, a forme change, a
weather or terrain change, a screen going up or down, a hazard layer, an item consumed, a stat stage, a
status applied or cured, and any HP change. In practice that is once or twice per sub-move, so the cache
serves an entire pickup-and-hover session. **The AI does not share this cache** — it calls
`computeDamage` directly through the journal, because a shared cache across search nodes is a correctness
hazard.

---

## 6. Randomness — the public roll

> **The one line that governs all of it: no hidden roll may ever cost a player a piece. Every die that can
> remove a piece is revealed before any decision that could be affected by it. Coins are flipped after
> commitment only for riders, which can never remove a piece on the turn they are flipped.**

This is `recon-variants.md` §6.3's biggest measured lever (≈5× on σ_dice at equal rate) and
`recon-tech.md` §B.3's biggest measured saving (full chance-node enumeration costs **121–159×**; input
randomness costs **+10 %**). It is also, decisively, the only thing that makes `DIRECTION.md`'s required
die lessons teachable at all (§18.4).

### 6.1 Three instruments, and only one of them is board-wide

| Instrument | Scope | Range | Pokémon original | Revealed |
|---|---|---|---|---|
| **Momentum** | **one value per turn**, applied to every damage calculation that turn by **both** sides | 85–100 | the damage formula's random factor | at turn start, in the rail, publicly |
| **Focus** | **drawn per candidate action** | pass / fail against `critWindow` | the critical-hit roll | on the target square, as part of the verdict |
| **Precision** | **drawn per candidate action** | pass / fail against effective accuracy | the accuracy check | on the target square, as part of the verdict |

Momentum is board-wide because it is *mild* (±18 % on damage, which flips a 2-hit exchange into a 3-hit
exchange only at the margin) and because it is symmetric: a Momentum 100 turn is a violent turn for the
defender's counterblows too. It gives the turn a public character — *"Momentum 100, this is the turn to
strike"* — and it is the reveal beat the animation layer needs.

**Focus and Precision are per-action, and that is a deliberate correction.** A single board-wide accuracy
value would kill or pass every sub-100-accuracy move on the board simultaneously; board-wide accuracy
weather has no referent in either canon and reads as noise rather than variance. Instead:

```ts
/** Pure. Same state, same action, same values — regardless of the order the UI or the search asks. */
export function actionRoll(s: MatchState, a: Action): ActionRoll;
export interface ActionRoll { readonly momentum: number; readonly crit: boolean; readonly hits: boolean; }

// implementation: rngForkAt(s.rng, `${s.subMoveCount}:${a.from}:${a.to}:${a.slot ?? 0}`)
```

`rng.ts` gains one pure helper — `rngForkAt(state, label): RngState` — because the existing
`Rng.fork(label)` advances the parent stream and therefore is not a pure function of state. That is a
four-line addition and it is a named M0 deliverable.

Consequences:

- **Every clash outcome is exactly computable before you commit.** The forecast is not a probability; it is
  the answer. The target square carries a *verdict*.
- **Search has no interior chance nodes within a turn**, and no chance node at the root at all. At the ply
  boundary the opponent's future Momentum is a 16-way chance node, collapsed to three representative
  values `{85, 93, 100}` with a static EV bias (§19.2).
- **A miss is never a surprise.** A 70 %-accuracy move that will miss this turn shows a REPEL stamp before
  the click, so the player simply does not use it — which is exactly the lesson directive 7 requirement 3
  asks for, and the tutorial makes them feel it (§18.4).

### 6.2 The crit ladder is the same object in both canons

Gen-6+ crit stages are 1/16 → 1/8 → 1/2 → always. *(measured)* `recon-tcg.md` §2.3 measures the TCG's
randomiser alphabet as powers of one half and recommends exactly **1/16, presented as "flip four coins"**.
So Scope Lens / Razor Claw / Super Luck / Sniper / Leek / Lucky Punch widen the window from 1 to 2 (1/8),
Focus Energy and Dragon Cheer to 8 (1/2), the 5 `willCrit` moves *(measured: Flower Trick, Frost Breath,
Storm Throw, Surging Strikes, Wicked Blow)* to always. The UI draws the window as coins. **The two canons
agree and we did not have to choose.**

A crit does **not** grant a bonus sub-move. It multiplies the first swing by 1.5 and ignores the
defender's positive defensive stages — which frequently converts a ROUT into a CAPTURE, i.e. it *rescues*.
That is a better crit than a free move, and it is why the video's crit-chain engine does not exist here.

### 6.3 Riders: coins, after commitment, TCG-authentic

*(measured)* **212 rider entries** across the admitted set. **`move.secondary` must never be read**: it is
the identical object already inside `move.secondaries` in **204 of 204 cases** (`Object.is` true, 0
distinct), so a compiler that reads both applies 204 riders **twice** — every Thunderbolt would roll
paralysis twice. This is one sentence of specification and it prevents a content bug that is invisible in
review.

Chances are snapped to the TCG's alphabet and *presented as coins*, per `recon-tcg.md` §2.3:

```
coins(chance):  >= 90 -> ALWAYS (0 coins) | >= 60 -> 3/4 (2 coins, >=1 head)
                >= 35 -> 1/2 (1 coin)     | >= 15 -> 1/4 (2 coins, both heads)
                else  -> 1/8 (3 coins, all heads)
```

*(measured)* buckets: `100 % → 63, 30 % → 55, 10 % → 53, 20 % → 23, 50 % → 14, 40 % → 3, 70 % → 1`.
Rider coins are flipped **after** the Clash resolves, because losing the flip costs a status application,
never a piece — which is the exact synthesis `recon-tcg.md` §2.2 and §11.12 arrive at: *output randomness
is fine when the stake is a rider and catastrophic when the stake is a piece.* Riders can never change the
verdict.

### 6.4 The variance budget

| Component | Estimate | Basis |
|---|---|---|
| Chess strength | ~4.3 pawns at a 300-Elo spread | `recon-variants.md` §6.1, flagged there and here as a modelling assumption |
| **Type knowledge** | **≈0.6 pawns per capture** | *(measured)* best-of-four slot choice converts a resisted matchup from 14.4 % to 40.4 % capture, and coverage is strictly better on 36 % of clashes |
| Battle-sim knowledge (Speed tiers, bulk, spreads) | ≈0.3 pawns per capture | the 64 % of clashes where slot 0 is already best are the ones a chess player wins for free |
| **RNG** | ≈0.5 pawns per game | input-only. It shifts *which* actions are good, never the one you already chose |

RNG is deliberately **below** `recon-variants.md`'s 20 %-of-variance target, so there is headroom.
`format.momentumRange` (default `[85,100]`) and `format.critWindowBase` (default 1) are the two knobs, and
the batch simulator moves them. **Tune upward from a safe floor rather than downward from the video's
1/6.**

---

## 7. The turn loop

```
TURN(side):

 1. REVEAL      momentum := rng.roll(16) + 84                         // PUBLIC, before anything
                exposedAtStart := the set of squares from which `side` can already capture the enemy King
                recompute every legal action and its exact verdict; paint the annotations

 2. ACT         sub := 0 ; acted := {}
                loop:
                  the player takes exactly ONE action:
                    MOVE      relocate along the chess pattern onto an empty square. Free, uncharged.
                              Onto an enemy square -> CLASH with the chosen slot (default 0).  §4
                    ART       use slot 1/2/3 from where the piece stands: ranged, area, status, boost,
                              heal, hazard, field. Spends 1 charge. The piece does not relocate unless
                              an op relocates it. A damaging ART WOUNDS but never knocks out.  §4.5
                    ACE       Terastallize or Burst. Once per side per game. Ends the turn.  §11
                    DECLINE   legal only when sub > 0: forgo the remaining bonus sub-moves
                  resolve it fully; emit EffectEvent[]
                  acted += the acting piece
                  if the enemy King left the board:                       return WIN(side)      // R1
                  if a NEW exposure of the enemy King now exists
                     (an attacking square not in exposedAtStart):         break                 // T3
                  if the resolution granted a BONUS
                     and sub < 2
                     and some piece not in `acted` has a legal action:    sub += 1 ; continue    // T1,T2
                  break

 3. CHECKUP     over `side`'s own pieces only, in the §13.5 dispatch order, in this published order:  §9.5

 4. CLOSE       subMoveCount += sub + 1
                progress accounting (§12.4); push the repetition hash; test the terminal conditions
                toMove := the other side
```

### 7.1 The bonus sub-move has exactly one source

> **A BONUS is granted by exactly one thing: an ADVANTAGE — a step-in Clash in which the defender was
> knocked out by a super-effective blow and the attacker survived the whole exchange. Nothing else in the
> game grants an extra action: not crits, not ARTs, not area knockouts, not abilities, not items, not
> priority, not promotion.**

This is the design's termination argument, and it is one grep: `grantBonus()` is called from exactly one
line of `clash.ts`, and **CI gate 6** asserts that the identifier appears exactly once in `src/rules/`.
The video's runaway-turn bug was crit-grants-a-move stacking with super-effective-grants-a-move; deleting
the crit branch removes the engine entirely and makes type knowledge the *sole* route to tempo, which is
the concept's whole thesis.

### 7.2 Where Pokémon moves fit relative to chess moves

**The ordinary chess capture already *is* a Pokémon move.** Capturing means using your Melee slot: no
charge, no extra decision, no tax on chess. Ordinary chess must always work, so slot 0 has infinite
charges and is never gated by anything.

The additions are the **charged ART actions**, and each costs your whole turn plus one charge. A ranged
ART buys the genuinely new power — attack without occupying the square — and pays a turn and a charge for
it. That is the entire relationship, and it is why the action space stays chess-shaped.

### 7.3 The three caps, and their prior art

| Cap | Rule | Prior art |
|---|---|---|
| **T1** | `L <= 3` sub-moves per turn (one ordinary + at most two bonus) | *(measured)* `P(L>=3)` is 7.5 % under the video's own rules, so the cap binds in the top few percent and removes the whole tail. It also bounds the animation at 700 + 420 + 420 = **1 540 ms** |
| **T2** | **The baton rule** — a bonus sub-move must be made by a piece that has **not yet acted this turn** | English Progressive Chess: *"no piece may move twice until every other piece with a legal move has moved once"*. Kills the "one super-typed piece mows the board" fantasy and makes a chain a **team combo**, which is both better Pokémon flavour and a far better read on the board |
| **T3** | Creating a **NEW** exposure of the enemy King ends your turn | Marseillais Chess; Scottish Progressive Chess. §12.3 proves the safety property |

Plus two clauses that each remove a dead end:

- **A bonus is not granted at all when no unacted piece has a legal action.** Without this, a turn can end
  in a phase whose only legal action is `DECLINE`, which reads as a bug. The `clash` event says why.
- **The bonus is optional** (`{kind:'decline'}` is a real action). A mandatory extra move is an undesigned
  zugzwang mechanic players will report as a bug, and the search needs the branch to evaluate chains
  honestly.

### 7.4 Pacing, as a falsifiable number

| Step | Median cost | Why it is that cheap |
|---|---|---|
| Read Momentum | **0.4 s** | one number in the rail; the rail flashes only when the reading changes a verdict |
| Chess deliberation | **3.5 s** | unchanged from chess. This term dominates and we do not touch it |
| Read the target verdicts | **1.0 s** | the engine has already computed every clash; each square carries one of five stamps. The human performs no arithmetic |
| Choose a non-default slot | **+2.5 s on ~9 % of turns** | 25 % of turns are captures × 36 % where a coverage slot is strictly better *(measured)*; the UI marks the better slot with a chevron, so the game **tells you when to look** |
| Commit | 0.4 s | one click |
| **Median** | **≈5.5 s** | 10+0 online blitz runs ≈8 s/move; casual rapid ≈5 s |
| p90 | ≈16 s | a chain turn with a real branching decision |

At ~42 moves per side a game runs **9–13 minutes**. Animation never enters this budget: the Presenter
advances engine state instantly and any input fast-forwards the board lane to completion (§16.6).

---

## 8. Moves

### 8.1 Four slots

Four moves per piece, exactly as in the games, for the three reasons `recon-moves.md` §6.2 gives: four
buttons is a chess player's whole new UI surface; legal-action count becomes `chessMoves × ~1.4` rather
than `× 54`; and `charges = clamp(round(pp/5), 1, 5)` gives a piece ~14 uses per game, which the
termination argument leans on.

- **Slot 0 is the Melee slot** and must be a damaging move of the declared type. It has **infinite
  charges**, because ordinary chess must always work. §3.5.
- **Slots 1–3 are free**: coverage, status, boost, hazard, field, heal. Each has `clamp(round(pp/5),1,5)`
  charges.
- Movesets come from the **all-gens prevo-chain learnset union** with the recursive
  `changesFrom ?? battleOnly ?? baseSpecies` union — *not* gen-9 legality, because **593 of 1417 species
  have no gen-9 moveset** and Rotom-Wash proves union rather than fallback is required
  (`recon-moves.md` §6.1). *(measured)* median 79 candidates.
- **29 species still have fewer than 8 moves** after all fallbacks (Caterpie 5, Ditto 1, Unown 1, the
  Rotom formes 1 each). They get the **type-kit floor**: a curated `18 types × 6 moves = 108-id` table,
  which also guarantees every one of the 1367 formes has a declared-type slot-0 candidate. Asserted at
  build time.

### 8.2 The auto-picker, and the two quotas

Adopted from `recon-moves.md` §6.3 with all four measured fixes:

```
score(species, move) =
  +30  if move.type in species.types                        # STAB
  +20  if (Physical and atk >= spa) or (Special and spa > atk) else -10
  +min(30, (basePower || 60) / 4)
  +rarity(move)              # +45 one learner, +35 two-three, +25 four-ten, +10 11-50, 0 51-150, -10 >150
  + 8  if priority > 0
  + 6  if shape in {RAY_LOS, RAY_ANY}
  + 6  if shape in {RING1_FOES, RING1_ALL}
  - 8  if accuracy < 80
  -15  if flags.recharge or flags.pledgecombo               # no more Blast Burn Charizard
  -60  if isJunkStatus(move)                                # no more Hold Hands Charizard, Happy Hour Magikarp

slot 0: best damaging move of the DECLARED TYPE                            (mandatory; type-kit floor if none)
slot 1: best ranged or area damaging move
slot 2: best damaging move of a type NOT already present                   <- the COVERAGE quota
slot 3: best Status move with a real structured payload
        (fill any unfilled slot with the best remaining candidate)

isJunkStatus(m) = category === 'Status' && no status && no volatileStatus && no boosts && no self.boosts
                  && no sideCondition && no weather && no terrain && no pseudoWeather && no slotCondition
                  && no heal && !flags.heal && !forceSwitch && !selfSwitch && !callsMove
```

The **coverage quota is the single highest-leverage change in the picker** and it is measured
(`proposal-competitive-first.md` §5.2): mean distinct attacking types per piece **1.00 → 2.42**, pairs
with no legal capture **2.47 % → 0.37 %**, forced self-destruct matchups **18.8 % → 3.6 %**, with the
type-knowledge edge unchanged. It is what makes the type question the substance of *every* capture rather
than a rare tiebreak. Skarmory (Steel/Flying) gets **Drill Run**, the answer to Steel's own worst matchup;
Blissey gets **Mud Bomb**; Lapras gets a Bug move for Psychic and Dark walls.

*(measured)* **525 distinct moves appear** across auto-generated kits over all 1025 base formes. **Player
control:** the draft shows the auto-kit and **one slot is swappable** from a shortlist of the 8 best
alternatives by the same score, filtered to a different shape. An `Advanced` toggle exposes the full union.
**Legality is baked** — the bundle ships `species → uint16[]` — so there is no runtime validation surface
and no way to smuggle an illegal move into a rated game.

### 8.3 Geometry — the 16 regions

Adopted verbatim from `recon-moves.md` §2.2, derived from `target` plus the ranged flags, with four
regions added for abilities and items. Region resolvers are written entirely in terms of `board.ts`'s
existing exports (`RAYS`, `KNIGHT_MOVES`, `KING_MOVES`, `BETWEEN`, `SLIDING_DIRECTIONS`, `PAWN_ATTACKS`,
`reachableSquares`, `kingDistance`, `fileOf`, `squareAt`) — **`board.ts` is not modified**.

| Region | Geometry | Derived from | Moves |
|---|---|---|---|
| `MELEE` | the square you step onto along your own chess pattern. **For an ART: any square your own pattern reaches, without moving** | `normal`, `adjacentFoe` | 683 |
| `SELF` | the caster | `self` | 99 |
| `RING1_FOES` | the 8 neighbours, enemies only | `allAdjacentFoes` | 60 |
| `RING1_ALL` | the 8 neighbours, **friend and foe** | `allAdjacent` | 20 |
| `RAY_LOS` | 8 rays, Chebyshev ≤ 2, **first occupied square only**; caster does not move | `flags.distance｜pulse｜bullet｜sound｜wind` | 37 |
| `RAY_ANY` | 8 rays, Chebyshev ≤ 3, **blockers ignored** | `target:'any'` | 24 |
| `BOARD` | every square / the global field | `all` | 24 |
| `OWN_SIDE` | your own army | `allySide`, `allyTeam` | 16 |
| `ALLY` | one adjacent friendly piece | `allies`, `adjacentAlly`, `adjacentAllyOrSelf` | 10 |
| `RANDOM_FOE` | a seeded-random adjacent enemy | `randomNormal` | 6 |
| `REACTIVE` | whoever last attacked me | `scripted` | 4 |
| `FOE_ZONE` | a 3-square segment of the enemy's third rank counted from their own back rank — rank 6 when White casts, rank 3 when Black casts — spanning the caster's file ± 1, clamped at the a- and h-files | `foeSide` | 4 |
| `TARGET` | the current Clash's defender | handler scope `Source` | — |
| `KING_RING` | the 8 squares around **this piece** — the bounded form of "board-wide" | handler scope `Any` | — |
| `SQUARE` | the square this piece stands on | handler scope `Self`, square-level | — |
| `NONE` | no spatial extent (a pure standing modifier) | trigger `ALWAYS` | — |

**The MELEE-as-ART clause is load-bearing and closes a real hole.** *(measured)* **105 admitted Status
moves have `target: normal` or `adjacentFoe`** and therefore MELEE shape. Without the clause, Thunder
Wave, Spore, Toxic, Will-O-Wisp and Confuse Ray would have no legal use at all. With it, they are used
from where the piece stands, against any square its own pattern reaches. `regions.test.ts` asserts every
one of the 105 has at least one legal target from a non-empty board.

`KING_RING` is where the balance bound on board-wide abilities becomes a **compiler invariant** rather
than a rule someone must remember: Neutralizing Gas, Teraform Zero, Shadow Tag and Arena Trap *cannot* be
global, because the compiler has no global region for an ability to reach.

### 8.4 Charges, and Struggle

`charges = clamp(round(pp/5), 1, 5)`. *(measured)* distribution `1→208, 2→319, 3→174, 4→159, 5→90`.
Charges do not regenerate except by Leppa Berry (which is a named, measured exception, and §12.4 handles
its consequence for the progress clock).

> **When a piece's slot 0 has been replaced — that is, when a Choice item has locked it out, or Disable /
> Torment / Encore forbids it, or Imprison suppresses it — and no other damaging slot has charges, the
> piece Struggles.** Struggle is **typeless** (gen 5+), **50 BP**, **neutral against everything**, and the
> user takes **1/4 of its max HP** as recoil.

Slot 0 itself has infinite charges, so Struggle is reached only through the lockout layer. That is a
deliberate narrowing of `battle-sim`'s version (which exhausted slot 0) and it fixes the contradiction
`competitive-first` shipped: **Struggle is never freely available**, so it can never be used to bypass a
0× immunity or a bad matchup. Consequences, all authentic: no piece is ever unable to act (which matters
because "no legal action ⇒ you lose"); Leppa Berry becomes a real draft pick; and a Pokémon-literate
player knows exactly what *"Charizard is Struggling"* means without being told.

### 8.5 Hazards

`FOE_ZONE`, exactly 4 moves, exactly the canon numbers. The caster paints a **3-square segment** centred
on its own file, clamped at the board edge, on the enemy's third rank. The hazard fires when an enemy
piece **ends a sub-move** on a painted square. This is the single most literal system in the design and it
exists only because HP is real.

| Hazard | Layers | Effect on arrival | Fidelity |
|---|---|---|---|
| **Stealth Rock** | 1 | `hp -= maxHp × 1/32 · 2^k` where `k` is Rock's effectiveness exponent against the declared type: **6.25 % / 12.5 % / 25 %** | exact |
| **Spikes** | 3 | **1/8, 1/6, 1/4** of max HP; grounded pieces only | exact |
| **Toxic Spikes** | 2 | 1 layer poisons, 2 badly poisons; grounded only; a **Poison-declared** piece absorbs the layer | exact |
| **Sticky Web** | 1 | **−1 Speed stage**; grounded only | exact |

Cleared by Defog, Rapid Spin, Mortal Spin, Tidy Up and Court Change. Heavy-Duty Boots ignores all four.
Sticky Web's −1 Speed stage now lands on the single most consequential thing a Speed drop can affect: who
swings first, and therefore how many blows the defender gets.

The **edge clamp is deliberate**: casting from h1 paints only g6–h6, so hazards must be set from a central
file. Placing them is a *positional* decision — walk the setter to the middle first — and that is how a
support move earns its turn.

### 8.6 The dangerous classes, each bounded

| Class | Detected by | Bound |
|---|---|---|
| Recursion | `callsMove` *(measured: 7 — Assist, Copycat, Me First, Metronome, Mirror Move, Nature Power, Sleep Talk)* + 4 tagged (Mimic, Sketch, Transform, Instruct) | `INVOKE.depth` is literally `1` **in the type**, so a depth-2 invoke is unconstructible. Pool excludes every `callsMove` and every `selfdestruct` move. Seeded, so replayable |
| Self-KO | `selfdestruct` *(measured: 7)* | Illegal if it would deterministically remove your own King (R3). `RING1_ALL` caps the blast at 9 pieces. The **only** ARTs that may knock out |
| Stalling | `stallingMove` *(measured: 11)* | Showdown's own `(1/3)^consecutive` success curve, reset by any other action, fed by the `ON_RESTACK` trigger; plus charges |
| Trapping | `volatileStatus === 'partiallytrapped'` (10) + 8 hard-trap tags + 5 `BIND` abilities | `KING_RING` region only (a compiler invariant); **never restricts the enemy King**; escapable 4–5 turns; inescapable capped at 3 turns and the trapper is itself immobilised |
| Delayed | `flags.futuremove`, `slotCondition` | One scheduler, **one pending entry per (side, kind)**; horizon provably ≤ 5 because *(measured)* the maximum `condition.duration` in the entire dataset is 5 |
| Healing | `flags.heal`, `drain` | Capped at max HP; charge-limited. **Healing is not a progress event** (§12.4) |
| OHKO | `ohko` *(measured: 4 — Fissure, Guillotine, Horn Drill, Sheer Cold)* | Ignores HP entirely, so it is the one bypass of the core: accuracy 30 makes it land only when `roll.hits`, **and it is an Ace pick** (≤1 per army) |
| `willCrit` | `willCrit` *(measured: 5)* | Crit window 16 (always). A crit grants no bonus, so this is not a chain engine |
| Multi-hit | `multihit` *(measured: 31)* | `n` blows inside **one swing**, each rolling damage; crit applies to hit 1. **Faces are never re-used and no "best of n" rule exists.** Population Bomb's 10 is capped at 5 |
| Evasion | `boosts.evasion` (3 moves) | Total evasion effect capped at +2 stages — a second route to the untouchable-piece bug |

---

## 9. Status, stages, field, hazards, the Checkup

### 9.1 The six statuses, literally, with the TCG's marking system

| Status | Board effect | Canon |
|---|---|---|
| **brn** | `1/16` max HP at Checkup; Physical damage ×0.5 | games, exact |
| **psn** | `1/8` max HP at Checkup | games, exact |
| **tox** | `n/16` at Checkup with `n` rising each turn, capped at `15/16` | games, exact |
| **par** | effective Speed ×0.5, **and the piece may neither earn nor use a bonus sub-move** | games for the halving; the second clause replaces the 25 % silent failure |
| **slp** | cannot act; duration 1–3 turns, **and the counter is public on application** | games, with the roll pre-revealed |
| **frz** | cannot act; cleared by any Fire-type blow or a `thawsTarget` move; **hard cap 3 turns**; Ice-declared pieces are immune | games, capped |

Two deliberate deviations, both stated. Mainline paralysis's 25 % silent failure is hidden
post-commitment randomness on a full move, which `recon-tcg.md` §11.3 rules *"the worst mechanic in either
canon for a chess variant"*; we keep the Speed halving (which is real and now matters enormously) and
route the failure chance into a tempo cost. And `recon-tcg.md` §11.11 recommends folding `frz` into sleep
*because we have no HP for thaw damage* — we do have HP, `thawsTarget` is meaningful, and Ice-type freeze
immunity is a type lesson worth teaching, so `frz` survives with a cap.

**Confusion** likewise: `recon-tcg.md` recommends TCG Pocket's coin-flip version *because we have no HP*.
We do. So confusion is the mainline effect made deterministic: **a confused piece's blows deal ×0.67 and
it takes a 40-BP typeless hit on itself on each of its own swings.** No hidden coin, real self-damage,
recognisably Confusion — and it can never cost you a turn to a coin you did not see.

**Marking, adopted from `recon-tcg.md` §3.2 unchanged, because it is the best legibility idea in the recon
set:** the mutually-exclusive class (slp / frz / par / confusion — **newest wins**) **rotates the pin 90°**;
the persistent class (psn / tox / brn) **stacks counter pips** on the bezel rim. Rotation-class marks
clear on a `WITHDRAW` move (U-turn, Volt Switch, Flip Turn, Baton Pass, Teleport, Parting Shot, Shed Tail,
Chilly Reception — *(measured)* 9 `selfSwitch` moves) and on promotion; counter-class marks persist.

### 9.2 Type-based immunity to status, hazards and weather — from data

This is the hole every proposal left, and it turns out to be **derivable with zero authoring**.
*(measured)* `Type.damageTaken` carries non-type keys alongside the 18 type keys, and `3` means immune:

```
Steel    { psn:3, tox:3, sandstorm:3, Poison:3 }      Fire     { brn:3 }
Poison   { psn:3, tox:3 }                              Electric { par:3 }
Ice      { frz:3, hail:3 }                             Grass    { powder:3 }
Ground   { sandstorm:3, Electric:3 }                   Rock     { sandstorm:3 }
Ghost    { trapped:3, Fighting:3, Normal:3 }           Dark     { prankster:3, Psychic:3 }
Flying   { Ground:3 }                                  Normal   { Ghost:3 }
Fairy    { Dragon:3 }
```

`tools/compile` emits a `STATUS_IMMUNITY: Record<BattleType, MarkId[]>` table from exactly this field.
So *"support moves always land on an immune piece"* — the answer three proposals gave to the
untouchable-piece problem — is now **correct**: a Steel piece cannot be poisoned, a Fire piece cannot be
burned, an Electric piece cannot be paralysed, an Ice piece cannot be frozen, a Grass piece is immune to
powder, and a Ghost piece cannot be trapped. `immunity.test.ts` asserts all 13 rows against the shipped
bundle. Corrosion is the named exception that poisons Steel and Poison anyway.

### 9.3 Stat stages

Real, all seven channels, −6…+6, canon multipliers `n >= 0 ? (2+n)/2 : 2/(2-n)`. Boost-setting moves
*(measured: 28 self-boost, 14 foe-debuff, 3 ally)* are literal, so **Swords Dance and Iron Defense are
visibly different effects** — which the abstract single-counter collapse could not express and which
`DIRECTION.md` classes as a defect.

**Stages do not decay.** Swords Dance is an investment and a +2 piece is a threat the opponent must
answer, which is a chess-shaped consequence. Haze, Clear Smog, phazing and Defog reset them.

**Legibility:** the pin shows at most **two chevron glyphs** (net offence, net defence), never seven
numbers. `spe`, `acc` and `eva` surface as three badges, not numbers. The full stage list is a labelled
row in the Battle Readout. **Base stats are never displayed on the board.**

### 9.4 Field: weather, terrain, rooms

One weather **and** one terrain may be active at once, 5 turns, 8 with the matching rock or Terrain
Extender. This **deviates** from `recon-tcg.md` §7.2's single Stadium slot because the games run both and
they are visually separable — weather is a sky band above the stage, terrain is a floor glow under the
squares (§16.5). We **adopt its repetition closer verbatim**: *a side may not set the field that is
already active*, which shuts a perpetual-recast draw hole (W3).

Effects are literal: sun/rain ×1.5 / ×0.5 on Fire and Water; sand chips `1/16` from non-Rock/Ground/Steel
and gives Rock ×1.5 SpD; snow gives Ice ×1.5 Def; Electric Terrain ×1.3 Electric and blocks sleep for
grounded pieces; Grassy ×1.3 Grass, heals grounded `1/16` at Checkup and halves Earthquake; Misty ×0.5
Dragon and blocks status on grounded pieces; Psychic ×1.3 Psychic and blocks positive-priority moves
against grounded pieces. **Trick Room inverts the Speed comparison for 5 turns**, which in this design
inverts *who gets the extra swing* — the best possible board-level use of it, and the single most
consequential thing five turns of inversion can do.

**"Grounded" is literal:** a piece is airborne if its declared type is Flying, or it has Levitate, or it
holds an unpopped Air Balloon, or Magnet Rise is up. Gravity, Smack Down, Thousand Arrows and Iron Ball
ground it.

### 9.5 The Checkup — one published order

The TCG's Pokémon Checkup (`recon-tcg.md` §3.4) merged with the real `onResidualOrder` values in
`items.json`. A **fixed, published order is what makes a pure engine reproducible** — `BRIEF.md` §4.2
requires same seed + same action list ⇒ identical game, and a residual system with ambiguous ordering is
the classic way to lose that.

```
CHECKUP(side)  — at the END of side's turn, over side's own pieces, in the §13.5 dispatch order:
  1. weather damage (sand) and weather healing (Rain Dish, Ice Body, Dry Skin)
  2. Grassy Terrain healing
  3. item residuals in ascending real `onResidualOrder`      (Leftovers 5, Black Sludge 5, Sticky Barb 28, ...)
  4. Leech Seed
  5. psn -> tox -> brn                                       (the TCG's own Checkup order)
  6. Aqua Ring, Ingrain
  7. Salt Cure, Curse, Bind chip
  8. status counters: sleep decrement, freeze cap
  9. volatile, field, screen and mark durations decrement; expire at 0, firing ON_EXIT
 10. Perish counters; a piece at 0 perishes
 11. SCHEDULE entries whose delay reached 0 fire
 12. DEFERRED SIMULTANEOUS REMOVAL: every piece at hp <= 0 is removed at once
```

Step 12 is the TCG's own rule — *"any Pokémon that has no HP remaining is Knocked Out"* only after both
players finish their checks — and it is precisely the simultaneity discipline the both-Kings-die case
needs (§12.3, R4). It is also where two pieces can die together, which is the Checkup's contribution to
MUTUAL.

---

## 10. Abilities and items

### 10.1 Because damage is real, abilities are literal

This is the largest faithfulness dividend in the design and it is worth naming as a table, because it is
the exact place where the abstract single-counter model and the real-HP model diverge:

| Ability | This design | An abstraction would say |
|---|---|---|
| Thick Fat | incoming Fire and Ice damage ×0.5 | +2 to a die |
| Fur Coat / Ice Scales | incoming Physical / Special damage ×0.5 | +1 to a die — **and the published conversion inverted it into +2 ATTACK** |
| Multiscale | incoming damage ×0.5 while at full HP | survive-once |
| Sturdy | a blow from full HP leaves it at exactly 1 HP | survive-once |
| Rough Skin | the attacker loses `1/8` max HP **per contact swing** | −1 to a counter |
| Regenerator | heals `1/3` of max HP on a WITHDRAW move | reset the counter |
| Huge Power | Attack stat ×2 | +2 to a die, **plus a bespoke clamp so it cannot manufacture a crit** |
| Guts | Attack ×1.5 while statused, and burn's ×0.5 does not apply | +2 to a die |
| Chlorophyll / Swift Swim / Sand Rush | Speed ×2 in the matching weather, so you keep the extra swing | +1 movement — **and the published conversion turned it into +2 attack** |
| Slow Start / Defeatist | Attack ×0.5 | **the published conversion turned a drawback into +2 defence** |
| Levitate | Ground moves cannot touch it — but Stealth Rock still can | a one-shot ward |
| Wonder Guard | only super-effective moves damage it; Shedinja has **1 HP**, so hazards kill it | three layers of bespoke bound |
| Life Orb | ×1.3 damage, `1/10` max HP per attack | +1 attack / −1 counter |
| The 26 type lenses, 34 Plates, Expert Belt | ×1.2 base power | **inert, because the published threshold was 1.4** |

Huge Power needs no clamp here: doubling Attack doubles damage, which is what it does, and crits come from
the pre-revealed Focus draw and grant no tempo.

### 10.2 The ability and item interface is the ISA. There is no hook registry.

`recon-abilities-items.md`'s 115 "primitives" are **not a competing instruction set** — they are 115
*parameterisations* of the 20 ops in §13.2, which is exactly what a data layer should be:

```
WARD/elemental (11 abilities)  = { when:'CLASH_LEGAL', where:'NONE', ops:[{op:'VETO', scope:'element'}], params:{type} }
BULWARK/flat   (Fur Coat)      = { when:'CLASH_ROLL',  where:'SELF', ops:[{op:'MODIFY', slot:'def', x:2}] }
EDGE/escalate  (Moxie)         = { when:'ON_CAPTURE',  where:'SELF', ops:[{op:'BOOST', d:{atk:1}}] }
RETALIATE/thorns (Rough Skin)  = { when:'ON_DAMAGED',  where:'TARGET', ops:[{op:'MEND', frac:[-1,8], of:'max'}],
                                   guard:{contact:true} }
```

We keep that document's **13 archetypes as the UI glyph vocabulary** — they are excellent for that, and
they are the 13 low-chroma colours a player learns — and discard the 115 as an *implementation* unit,
because they would be 115 hand-written functions and ~1 700 LOC of which the compiler already writes 100 %.
**Zero ability functions are hand-written.**

`flags.breakable` *(measured: 81 of the 311 admitted abilities)* drives the `PIERCE` target set, so Mold
Breaker / Teravolt / Turboblaze / Unseen Fist need no authoring at all.

### 10.3 Wards: the canon decides per entity

> **The type chart's 0× and ability wards are PERMANENT. Only item wards whose printed text says they pop
> are one-shot.**

| Ward | Bound | Why |
|---|---|---|
| The type chart's 0× (8 ordered pairs, 2.5 %) | **permanent** | `BRIEF.md` §2 rule 3c, and it is the most memorable Pokémon fact a chess player can learn |
| Levitate, Flash Fire, Volt Absorb, Water Absorb, Sap Sipper, Storm Drain, Lightning Rod, Motor Drive, Earth Eater, Well-Baked Body, Dry Skin, Bulletproof, Soundproof, Overcoat, Wind Rider, Good as Gold, Damp, Telepathy, Magic Guard, Shield Dust, Magic Bounce | **permanent** | *(measured)* 28 `WARD` abilities. `DIRECTION.md`'s single named example of a **good** mechanic is *"Levitate makes a piece uncapturable by Ground, because that is exactly what Levitate does."* A ward that stops working after one attempt is not what Levitate does; it is Air Balloon's printed text applied to 28 abilities that do not carry it |
| **Air Balloon, Focus Sash, Focus Band** | **one-shot** | their printed text says so. *"Pops when holder is hit."* |
| Wonder Guard | **permanent and literal** — only super-effective moves damage it | Shedinja has 1 HP *(measured)*, so hazards, weather, status and any chip remove it. **Not class-scoped**: the TCG card scopes on *evolution stage*, and chess class here is a free draft choice with no relationship to evolution, so borrowing the card's shape without its variable would let a Charmander pawn kill Shedinja while a Blissey rook could not — arbitrary, and exactly the "systematic but thematically wrong" defect `DIRECTION.md` tells the reviewer to report |

**Permanent wards keep capture legality a pure function of position**, which is worth about a ply
*(measured: state-dependent legality costs 3.4× at depth 9)* and means `generate()` is cacheable and the
transposition key needs no ward state.

And the untouchable-piece problem is answered **five ways**, of which four are free from data:

1. **Coverage slots** (§3.5) — "immune" only ever means "immune to that piece's Melee slot"; measured 2 %
   of clashes are rescued this way, so the headline lesson survives.
2. **Status, hazards, weather and residual damage** — *(measured)* 270 of 271 Status moves ignore
   immunity, and §9.2's type-based status immunity table means the exceptions are correct too.
3. **The Softening rule** — any ranged or area attack takes an untouchable piece to 1 HP, after which any
   pawn finishes it.
4. **`CHART{set:1}`** — Iron Ball and Thousand Arrows read an immune pair as **exactly neutral**, which is
   what their printed text says and is weaker and better-shaped than piercing: the capture becomes
   possible without becoming good.
5. **The validator-guaranteed key** — every format requires each side to end the draft with at least one
   immunity breaker: a `Scrappy`/`Mind's Eye` piece, a `Mold Breaker`-family piece, a Ring Target holder,
   or a piece with `Thousand Arrows`/`Smack Down`. Ring Target is in the Standard 12 Kit, so the floor is
   met by default. *(Stratego over-supplies Miners 5 to 6 Bombs; we do the same.)*

*(measured)* immunity is arithmetically local: each defending type is immune to at most **two** attacking
types (only Ghost), so no piece is anywhere near Betza's Iron Ghost.

### 10.4 Items: Format Kits

*(measured)* **536 admitted items; 351 are mechanical; 185 are non-mechanical and are repurposed rather
than deleted** (TR00–TR99 become the move-picker card frames, the 28 Balls become bezel finishes, the 15
Fossils become the Ancient frame, `Mail` becomes the emote icon, the 6 Valuables become post-game spoils,
the 35 Z-Crystals become the Burst auras and signature animations). `recon-abilities-items.md` §3.4 is
adopted verbatim.

**A format declares a Kit: an ordered list of 12 items, and each side gets one of each.** 16 pieces, 12
items, so four pieces hold nothing. That one constraint caps the state space, forces real allocation
decisions ("who gets the Sash?"), guarantees both sides face the same toolbox, and makes the item layer
*learnable* — a returning player already knows every item on the board.

**The Standard 12**, one per admitted class so the twelve glyphs teach the twelve archetypes:

| # | Item | Teaches |
|---|---|---|
| 1 | **Leftovers** | HP regeneration, and the `1/16`-versus-Spikes arithmetic a competitive player already does |
| 2 | **Life Orb** | damage as a cost, and it self-limits capture chains |
| 3 | **Focus Sash** | `pristine`, and survive-once |
| 4 | **Rocky Helmet** | attacking is not free |
| 5 | **Choice Scarf** | lock-in trade-offs, and Speed as the swing count |
| 6 | **Air Balloon** | the one-shot ward, the template for popping |
| 7 | **Ring Target** | **that immunity is beatable** — the answer to hard problem 6, in the default Kit |
| 8 | **Expert Belt** | knowing the type chart pays ×1.2 |
| 9 | **Eviolite** | drafting un-evolved pieces; legality from `species.nfe` |
| 10 | **Sitrus Berry** | consumables |
| 11 | **A type-resist berry** (the player picks the type) | type-resist tech; parameters from `naturalGift.type`, *(measured)* exact for all 18 |
| 12 | **Heavy-Duty Boots** | the hazard layer |

Later formats swap the Kit wholesale ("Weather Kit": 4 weather rocks, 4 terrain seeds, Utility Umbrella,
Damp Rock, Light Clay, Terrain Extender; "Signature Kit": 12 `itemUser`-locked items and you must draft
their owners). **This is how the remaining 339 admitted items enter the game — as formats, not as an
inventory screen.** Nothing is missing; it is queued.

**Persistence:** destroyed when the piece is removed; consumed by its own trigger; stolen only by
Magician / Pickpocket / Thief / Trick / Switcheroo / Knock Off; protected by Sticky Hold and Ability
Shield. **No looting** — looting would make every capture a resource decision on top of a chess decision
and would make the winning side snowball.

### 10.5 The bounds kept, and the bounds no longer needed

**Kept** from `recon-abilities-items.md` §6: Shadow Tag / Arena Trap / Magnet Pull and Neutralizing Gas /
Teraform Zero confined to `KING_RING`, and **never** restricting or suppressing anything about the enemy
King; Moody banned in rated formats (there is no decision to preserve); Protean / Libero once per game
(gen 9's own rule); Speed Boost `+1 spe` stage per turn the piece does not capture, capped at +3; Imposter
copies movement pattern and ability but **not** type or class; Truant / Slow Start / the 8 `INERT`
abilities **refund 1 draft point**, so Slaking is a bargain with a drawback rather than an undraftable
joke; at most one Ruin ability per side and they do not stack; Trace legality read from
`flags.notrace / noentrain / noreceiver / failroleplay / failskillswap / notransform`.

**No longer needed, because real HP makes them unnecessary** — and each deletion is a rule the player does
not have to learn:

| Bound that is gone | Why |
|---|---|
| The blanket one-shot ward rule | §10.3 — the canon decides per entity, and the answer to permanence is hazards |
| The three-layer Wonder Guard bound | Shedinja has 1 HP |
| The Huge Power crit clamp | doubling Attack doubles damage; crits grant no tempo |
| The one-directional survive-once rule | Focus Sash sets HP to 1 and **the exchange continues**, so the "Sash a pawn, throw it at the queen, get a free queen" line cannot form. There is no outcome to rewrite, so there is no ordering ambiguity between Sturdy and a critical hit |
| The thorns-cannot-kill rule | Rough Skin *can* finish a wounded attacker, exactly as it does in the games — and that is one of the design's MUTUAL sources |
| The per-piece Charge counter | `flags.charge` is a real 2-turn `MARK` with real untargetability, `flags.recharge` is a real 1-turn `MARK`, and Speed Boost is a real `spe` stage. All three are literal |

---

## 11. Transformations and promotion as evolution

### 11.1 One Ace per side per game

Exactly one, chosen from two, **mutually exclusive**, which makes the choice sharp. Declared on your turn;
**it ends your turn**, which is the TCG's own printed price: *"When 1 of your Pokémon becomes a Mega
Evolution Pokémon, your turn ends."*

| Ace | Effect | Canon |
|---|---|---|
| **Terastallize** | one piece's declared type becomes any type it could legally have declared at draft, plus the type of its slot-0 move. **Permanent and public**; the enamel repaints. It keeps STAB on **both** types | games for the semantics. *(measured by `recon-tcg.md` §0.2)* Tera cards are literally printed off-type with a re-derived Weakness — Tera Charizard ex is a **Darkness** card weak to **Grass**. Both canons agree |
| **Burst** (the Z-move shell) | declare before a Clash: the attacker's first swing is a guaranteed crit that **pierces every ward**, and the defender does not swing at all | games. The 35 Z-Crystals are demoted to its art: 18 type auras, 17 signature animations |

Terastallization is the flagship because our core axis *is* the declared type: a piece countered at draft
can be rescued once. It costs zero data (the chart already exists), applies uniformly to all 1025 Pokémon
with no haves and have-nots, and is the single most legible transformation to a chess player — *"my bishop
stops being weak to Ghost."*

**Dynamax and Gigantamax are cut.** Dynamax's primary effect is doubling max HP, which is a magnitude
change on a piece that already has real HP and would simply be "a bigger number"; and *(measured)* only 41
of 1025 species can Gigantamax, which makes it a draft trap rather than a mechanic. The 34 `-Gmax` sprites
survive as promotion art.

### 11.2 Promotion is evolution

A pawn reaching the last rank:

1. **Evolves along its real `evos` chain**, the player choosing among branches — Eevee's nine are all
   reachable, `Dex.evolutionLineOf` and `Dex.evolutionsOf` already exist. The real `evoItem` is consumed
   from the side's promotion pool if held, otherwise that branch is unavailable, which is exactly what a
   Fire Stone is for. Trade evolutions are available inside a match (there is no trading in a match); the
   meta-game honours the real condition.
2. **Re-declares its type** from the *new* species' real typing. Charmeleon (Fire) → Charizard may declare
   **Fire or Flying**, and that is a genuine decision with a chart consequence. *(measured)* 526 of 1025
   base formes are dual-typed, so ~51 % of declarations are a real choice.
3. **Chooses a chess class** from Queen / Rook / Bishop / Knight, with a suggestion from
   `Dex.roleAffinity` (already implemented).
4. **Mega Evolves instead** if the resulting species has a Mega forme and the side's Kit holds the
   matching stone. `megaStone` names the exact target forme, so this is declarative data for all 47 real
   stones plus the 2 Primal orbs. New base stats, new ability, sometimes a new type the player re-declares.
5. **Regains full HP and clears all status.** The TCG's rule — evolving removes Special Conditions — plus
   the strongest reward in the game and the reason to push a pawn. Counter-class marks are also cleared
   *(deviating from the TCG here, deliberately, because with real HP the heal is the reward)*.
6. **The piece keeps its `PieceId`**, so it is the same individual. `position.ts` already gives every
   piece a persistent id that survives promotion, which is exactly the shape evolution needs.
7. **A promoted piece may not earn a bonus sub-move on the promoting move**, even if that move was a
   super-effective capture. The TCG's own "you may not evolve the turn a Pokémon entered play" restriction,
   and a free tightening of the chain bound.
8. If the species is already final and no Mega is available, it promotes without a species change and
   gains a **Champion Ribbon: +1 stage in its two highest stats, permanently.** Promotion is never a dead
   end.

The video's *"Pikachu is evolving… into Zapdos"* is the one branch we do **not** ship: promotion follows
the real evolution graph. Raichu, not Zapdos.

---

## 12. The King, win conditions, draws, termination

### 12.1 Why king capture

**Checkmate is not a well-formed predicate under these rules, and that — not sloppiness — is the actual
root cause of the on-camera bug.** Orthodox legality asks "does the resulting position leave my King
attacked?", but "attacked" here means "there exists a capture that would succeed", which depends on the
opponent's *future* Momentum draw and on their own per-action Focus and Precision draws, none of which
exist yet. You cannot ask "is this move legal" without collapsing a distribution you have not drawn.

Across the prior art, **every variant where check is hard to compute switches to king capture**: Fog of
War (hidden information), Duck Chess (post-move mutation), ICC Atomic (collateral), single-die Dice Chess
(RNG). We are in that family, and this is the standard resolution rather than an invention.

**The shipped code proves it independently.** `src/engine/variant.ts` keeps checkmate and decides mate via
`position.isInCheck()` — a method on the deliberately Pokémon-ignorant `position.ts`, which is therefore
**type-blind**. The shipped game will declare checkmate when the only "mating" attacker is a Normal piece
aimed at a Ghost king, a capture that is *illegal*; and it will equally miss that a resisted "mating"
piece dies if it tries. Making `isInCheck` type-aware does not fix it, because whether an attack succeeds
depends on a roll that has not happened.

### 12.2 R1–R8

> **R1 — Win condition.** A player wins the moment the opposing King leaves the board, by any means
> (CAPTURE, ADVANTAGE, MUTUAL, or a Burst). There is no checkmate terminal state.
> *[Fog of War; Duck Chess; Losing Chess; single-die Dice Chess; ICC Atomic.]*
>
> **R2 — No check-legality.** A move that leaves your own King capturable is **legal**. A King may move to
> an attacked square. Castling through or out of attack is legal. *[Duck Chess.]*
>
> **R3 — Suicide guard, and it is exact here.** A move is **illegal** if, under this turn's revealed
> Momentum and the action's own revealed Focus and Precision, its resolution **necessarily** removes your
> own King. Because every die that can cost a piece is public before the decision, this is a decidable
> predicate rather than a probabilistic fudge — a strict improvement on Atomic's version of the same rule,
> and only possible because §6 pre-reveals. A move that merely *risks* your King, because the opponent may
> reply, is legal, and the UI must show the exact odds before the click. *[Atomic Chess rule 5, verbatim.]*
>
> **R4 — Simultaneous royal death.** If one resolution removes both Kings, **the mover wins.** Deaths
> apply defender-then-attacker (§4.2 step 6) and the game ends the first moment a King leaves the board.
> *[Lichess Atomic: "any move that results in blowing up the opposite king will result in an immediate
> victory, overriding all checks and checkmates."]* A draw here would create a degenerate strategy: a
> losing player hunting mutual annihilation for half a point.
>
> **R5 — A NEWLY CREATED exposure ends the turn.** After each sub-move resolves, if any of your pieces can
> now capture the enemy King *from an attacking square that could not do so at the start of your turn*,
> your turn ends immediately: the resolution completes and only the remaining sub-moves are forfeit. An
> exposure that was **already** on the board when your turn began does **not** end your turn and may be
> cashed in by any sub-move. *[Marseillais Chess; Scottish Progressive Chess.]*
>
> **R6 — Kings are never immune and never confer immunity, and no ward may protect one.** A King's
> declared type governs its own attacks and the multiplier when it is captured, but **0× never applies to
> a King as defender: it is read as exactly 1×**, wired into §4.2 step 1b *after* the `CHART` stage so no
> chart rewrite can re-immunise a King. Additionally: **no `VETO` from any ability or item has effect when
> the defender is a King** — Wonder Guard, Levitate, Air Balloon, Bulletproof and Protect all fail against
> a royal target. *[Stratego's "always supply the key"; `recon-variants.md` R6, extended to the ward layer
> because the type chart alone was only half of the Shedinja-King exploit.]*
>
> **R7 — The Regicide rule: a game is won by a Clash.** Residual damage — hazards, weather, status ticks,
> Leech Seed, Curse, Salt Cure, recoil, Perish — lands on a King in full and is fully visible, and it may
> reduce a King to **1 HP**; but a King is **removed only by a step-in Clash**. This is a rule about the
> *win condition*, not an immunity: the Pokémon layer touches the King completely, it simply may not
> deliver the final blow. It composes with the Softening rule (§4.5), which already forbids a ranged or
> area attack from removing anything. Without it, "Toxic the King and run away" is a win condition that
> never touches the board; with it, **a King at 1 HP is the most tense object the game can produce, and it
> must still be taken in single combat.** The canon shape is Sturdy / Focus Sash / Endure.
>
> **R8 — Check is advice, not law.** Every turn the engine computes and displays which of your pieces are
> capturable, by what, at which verdict, and with what probability — and specifically a persistent
> **"YOUR KING CAN BE TAKEN"** banner naming the attacker and the exact outcome under each of the
> opponent's 16 possible Momentum values. Mate-like positions are *labelled* ("your King cannot escape")
> but are never terminal.
>
> **R9 — Guarded mode.** Casual and tutorial default: the action list hides actions that leave your King
> capturable with probability ≥ p (default p = 1/16). Off in rated play. **It is a filter over
> `generate()`'s output, never a second generator**, so the AI shares the predicate. And **the filter may
> never empty the action list**: if every action is filtered, Guarded mode degrades to showing the safest
> available actions with the banner up, because a UI that offers nothing reads as a crash.

**Cost accepted, stated plainly:** king capture removes stalemate as a drawing resource and shifts endgame
theory (on no-check Atomic, K+R vs K becomes a forced win where it is a book draw). R8 and R9 are the
mitigations, and Chess960's rationale applies for free: because the army is drafted, opening memorisation
is neutralised on both sides before the chart even applies.

### 12.3 R5's safety property, proved

**Claim.** The enemy King can only ever be captured on a turn where its exposure was already on the board
at the start of that turn — so **the defender always gets a full turn to answer any threat to their King.**

**Proof.** Suppose the King is captured by sub-move `k`.
- If `k = 0`, the exposure existed at turn start by definition: sub-move 0 is chosen from the action list
  computed in step 1 of the turn loop, before anything has moved.
- If `k > 0`, then sub-moves `0 … k−1` all resolved without ending the turn, so by R5 none of them created
  a new exposure; therefore the exposure that sub-move `k` exploits was present at turn start. ∎

`exposure.test.ts` asserts the property **by search** rather than asserting the rule: from 200 random
positions it enumerates every legal turn to depth 3 and checks that no King is ever captured from an
attacking square absent from `exposedAtStart`.

**Why "newly" is load-bearing and the coarse form is a live exploit.** Written as *"if the enemy King is
capturable by any of your pieces, break"*, the rule becomes a **defensive weapon**: since check is not law
(R2) and a King cannot be worn down (R7), the defender parks their King permanently adjacent to a piece
that can generate a Clash but can never win it — a resisted slot 0 against a bulky King — and the
opponent's every turn ends after one action, forever. That does not endanger the King; it switches off the
extra-move engine that is the whole game, for free, at no cost to the defender. The set difference against
`exposedAtStart` keeps the defender's guaranteed reply while removing the shutdown, and it is one line.

### 12.4 Draws, and the progress clock

| Rule | Detail |
|---|---|
| **Threefold repetition** | on the **repetition hash**: piece placement, declared types, **HP bucketed to eighths**, stat stages, status, volatiles, per-slot charges, per-piece marks, square marks, side marks, board marks, castling rights, en passant, side to move. **Two fields are excluded and both exclusions are load-bearing:** the **PRNG counter** (it advances monotonically, so including it makes repetition unreachable by construction and the rule silently never fires) and **`momentum`** (re-rolled every turn, same fatal effect). Conversely, including HP, marks and charges is load-bearing the other way: without them, Protect/Recover cycles hash-collide and produce *false* draws. **The rule: the hash covers every field a player can influence and no field the RNG writes.** |
| **No progress** | 100 consecutive **sub-moves** with no progress event ⇒ draw. *[Progressive Chess recounts the 50-move rule in sub-moves.]* |
| **Perpetual exposure** | repeatedly exposing the enemy King with no progress ⇒ **the exposing player loses**. *[Shogi.]* Closes "chase forever with bonus-move tempo". |
| **No legal action** | that player **loses**. Under king capture there is no being *forced* into check, so orthodox stalemate cannot arise; total immobility is a loss. *[Shogi / xiangqi; Really Bad Chess.]* |
| **Both sides reduced to lone Kings** | draw. *[Archon: "if the last piece on each side kills the other, the game is a draw."]* |
| **Hard cap** | **300 turns per side ⇒ adjudicated on the Prize track**, and this sits in the **ordinary draws table, not behind a format flag.** §12.5 explains why that is non-negotiable. |

**The progress set is defined only over strictly monotone quantities.** This is the single most important
correction in the termination section, because *every* proposal's progress definition was falsifiable by
named admitted content:

| Progress event | Bound | Monotone because |
|---|---|---|
| A piece is removed | ≤ 31 | no op places a piece on the board (CI gate 5) |
| A pawn advances | ≤ 6 × 16 = 96 | pawns never move backwards |
| A promotion | ≤ 16 | a pawn promotes once |
| **A new lifetime-minimum HP octile for any piece** | ≤ 8 × 32 = **256** | `lifetimeMinOctile` is a per-piece integer in `[0,8]` that only ever decreases. Healing cannot farm it |
| **Total** | **P ≤ 399** | |

**Explicitly NOT progress, each exclusion closing a named loop:**

| Not progress | The loop it closes | Why the naive version fails |
|---|---|---|
| Healing, or any HP change that is not a new lifetime minimum | Leftovers versus poison | resets the clock forever |
| Applying or curing a status | Toxic / Lum Berry ping-pong across two pieces | ditto |
| **Spending a slot charge** | **Harvest + Leppa Berry.** *(measured)* Harvest is *"If last item used is a Berry, 50 % chance to restore it each end of turn. 100 % in Sun"* on 9 admitted species; Leppa Berry *"Restores 10 PP to the first of the holder's moves to reach 0 PP"*. So charge expenditure is **regenerable and therefore not monotone** — every proposal that counted "a charge spent" as progress had a constructible infinite game | this is the exploit that broke three of four termination proofs |
| **Consuming an item or a ward** | the same Harvest loop, one door over | ditto |
| **Laying a hazard layer** | lay–clear–relay, via Defog / Rapid Spin / Court Change | hazards are clearable, so hazard layers are not monotone |
| Moving a piece back and forth | ordinary shuffling, exactly as in chess | |
| A REPEL that consumes no ward | attack–bounce–attack. It is nonetheless self-limiting: a REPEL from a *miss* costs a charge and a REPEL from a lost exchange costs HP, and HP loss eventually produces a new lifetime minimum, which **is** progress | |

**The bound.** `P ≤ 399` progress events, at most 100 sub-moves between consecutive events, so a game is
at most `100 × 400 = 40 000` sub-moves. Crude, but **proved**, and independent of the RNG. The practical
caps bite far sooner: the 100-sub-move clock and the 300-turn hard cap.

### 12.5 Turn-bound termination, proved

**Claim 1 — a turn is at most 3 sub-moves.** By construction: `grantBonus()` is called from one line,
gated on `sub < 2`, and CI gate 6 asserts the identifier appears exactly once in `src/rules/`. ∎

**Claim 2 — even without the cap, a turn is finite, and the argument is RNG-independent.** A bonus
requires an ADVANTAGE; every ADVANTAGE removes exactly one enemy piece; **no op in the ISA places a piece
on the board** — `SUMMON` does not exist and CI gate 5 fails the build if any op named `SUMMON` appears or
if any op increases the piece count. So the enemy piece count `N` is monotonically non-increasing,
`N ≤ 16` always, and a chain of length `L` requires `L − 1` distinct captures, giving `L ≤ 17` — and
`L ≤ 16` once the King is excluded as a chain target, because T3 ends the turn the instant a new exposure
appears. ∎

This forces the right content mappings, which is a feature: **Revival Blessing compiles to a heal, not a
resurrection; Substitute compiles to a mark that absorbs one Clash, not to a second occupant.**

**Claim 3 — nothing outside the Clash grants an action.** Enumerated over all 950 moves, 311 abilities and
536 items: Parental Bond and Dancer grant a **non-capturing** move only, so they cannot extend a capture
chain; `STRIDE/priority` (Gale Wings, Prankster, Triage, Quick Claw) is re-specified as **priority inside
the Clash** (§4.6) rather than as an out-of-turn action, which removes the last irregular action source;
and `TEMPO('grant-bonus')` has exactly one producer. ∎

**And the backstop, which is why the proof's correctness is not load-bearing.** Every termination proof
written in this design phase was falsifiable by named admitted content, so the design ships **a universal
300-turn-per-side hard cap in the ordinary draws table** — not behind a ranked flag, not default-off. That
is the honest posture: casual, sandbox and the batch simulator must terminate too, and a batch simulator
that can hang is not an instrument.

### 12.6 The Shedinja King, closed three ways

*(measured)* Shedinja is admitted (`isNonstandard: 'Past'`), has `maxHP` 1, has Wonder Guard as its only
ability, and has `bst` 236. Combine a literal Wonder Guard with the Regicide rule and the Softening rule
and you get a King that is immune to every hazard, every weather tick, every Toxic, every thorn and every
ranged attack, capturable only by a super-effective move or a Mold Breaker piece — **a game decided at
draft time by a 0-point pick.** It is closed three ways, and all three ship:

1. **King class eligibility** (§3.2): `eligible` admits `king` only for `isRoyal(s) || bst >= 580`.
   Shedinja is neither. It is not a legal King in any format.
2. **R6, extended:** no `VETO` from any ability or item has effect when the defender is a King. Even if a
   format admitted a Wonder Guard King, the ward would not apply.
3. **The immunity-breaker validator** (§10.3, bound 5) is **restored**. `battle-sim` deleted it on the
   grounds that hazards are the universal key — which is exactly what the Regicide rule exempts a King
   from. Every format guarantees each side at least one piercer.

Wonder Guard is additionally an **Ace** pick: at most one Ace piece per army (§15.5).

---
