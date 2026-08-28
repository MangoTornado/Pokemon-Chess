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
(`recon-data-substrate.md` §2). `@pkmn/sim` keeps the functions *and their source text*: **~1 700 handler
functions, ~450 KB of source, ~156 distinct handler names** across admitted moves, abilities and items
*(measured locally; a flat scan of top-level handlers gives 1 319 / 349 KB / 128, and including each
entry's nested `condition` sub-object — where a move's persistent effects live — gives 1 704 / 450 KB /
156, which is the figure that matters because those nested handlers carry real behaviour)*. This is a
whole-dex figure; `recon-data-substrate.md` §3 separately measures the ability handlers alone at 142 KB. Those handlers speak a small mutation API, their names parse under an
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
Affordable — a 17-step pipeline is projected at **~136 ns per full clash forecast** against ~4 ns for a
bare chart lookup *(projected from `recon-tech.md`'s measured per-eval-term costs of 4–496 ns; the clash
forecast itself does not exist yet, so this is a target, not a measurement)* — but the invalidation rule
must be stated or it becomes a
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

## 13. The content system: the compiler

> **950 moves, 311 abilities and 536 items do not become board effects because someone wrote 1 797
> functions. They become board effects because a build-time compiler reads the vocabulary `@pkmn/sim` is
> already written in — its handler names, the mutation calls in its handler bodies, and the return values
> and field assignments those bodies make — and emits a small instruction set. *(measured)* 1 604 of 1 797
> entries derive with zero authoring; the remainder are named diffs against the compiler's own proposal;
> nothing is undefined; eight CI gates say so by name on every build.**

This is `DIRECTION.md`'s "coverage is total, and it is testable" made into a program rather than a promise,
and it is `proposal-systems-compiler.md`'s spine, corrected in the two places real HP changes it (§13.6).
The claim the whole document rests on is a ratio: **245 hand-written table rows against 1 797 content
entries — one row per 7.3 entries** — and a test (`coverage.test.ts`, §21.3) that regenerates and re-asserts
the ledger on every build so the claim cannot rot into prose.

### 13.1 Why a compiler, and why it is possible at all

`@pkmn/dex` — the declarative projection the client would naturally ship — **strips every behaviour
callback without leaving a marker.** *(measured, `recon-data-substrate.md` §2)* Belly Drum reports no
`boosts` field, Rest reports no `status`, Soak reports no type change, and Freeze-Dry reports nothing that
says it beats Water; all four look inert. `@pkmn/sim` keeps the functions **and their source text**, so
`String(fn)` yields the body. Across the admitted set that is **1 675 handler functions, 440 KB of source,
150 distinct handler names** *(measured; three independently written scanners agree on the mutation-site
count to within one site in a thousand — 1 072 / 1 071 / 1 071 — which is the corroboration the ISA claim
needed)*. The compiler reads that source, not the stripped projection, which is why nothing has to be
authored by hand that the games already implement.

**Four measured signal channels**, in the order the compiler consults them:

| # | Channel | What it is | Volume |
|---|---|---|---|
| **C1** | declarative fields | `status`, `boosts`, `secondaries`, `sideCondition`, `weather`, `target`, `priority`, `multihit`, `ohko`, `drain`, `recoil`, `heal`, `selfdestruct`, … read verbatim | 425 moves + 230 items derive from C1 alone *(measured)* |
| **C2** | the handler-name grammar | `on + Scope? + Phase? + Stem` parses into a **Trigger** and, with the receiver path, a **Region** | **148 of 150 names parse** *(measured)*; the two failures are exactly `onTry` and `onWeather`, one table line each |
| **C3** | the handler body, read as **calls** | every method call in every body, receiver-agnostic, mapped to an op or a guard | 2 845 call sites; **1 072 mutations** across 45 verbs, 521 predicates *(measured)* |
| **C4** | the handler body, read as **returns and field assignments** | 494 handlers make no call at all — their whole semantics is a `return` value or a `move.X =` assignment | **494 handlers, 29.5 % of the surface, invisible to any call-site census** *(measured)* |

C4 is the channel `proposal-systems-first.md` missed and the reason its coverage figure was too high: a
method census cannot see `onEffectiveness → return 1` (Freeze-Dry) or `onTakeItem → return false` (Sticky
Hold, and 97 other refusals), because those handlers call nothing. **A 14-row return grammar covers every
one of the 494.** The build fails if any handler falls into none of the four channels (CI gate 8, §13.5).

### 13.2 The ISA — twenty ops

An effect is a triple: **when it fires (Trigger), which squares or pieces it touches (Region), and what it
does (a list of Ops).** The Trigger and Region axes are `recon-moves.md`'s measured 14-trigger / 16-region
vocabulary (§8.3 lists the 16 regions verbatim; the 14 triggers are `ON_ACT`, `ON_ENTER`, `ON_EXIT`,
`ON_RESTACK`, `ON_CHECKUP`, `CLASH_LEGAL`, `CLASH_CHART`, `CLASH_ROLL`, `CLASH_RESULT`, `ON_DAMAGED`,
`ON_STRUCK`/`ON_SURVIVE`, `ON_KO`, `ON_CAPTURE`, `ALWAYS`). The **Op** axis is a twenty-instruction set,
and it is the one place this section corrects `proposal-systems-compiler.md`, because that document
enumerated **nineteen** ops for a *binary-capture* engine and real HP changes three of them (§13.6).

```ts
// src/rules/ops.ts — the complete op vocabulary. Every row is a pure function
//   (PokeState, Target[], ClashCtx) → void over the journal (§20.3) and the events it emits.
export type Op =
  // ── A. STATE WRITES (9): one per mutable field of the state model (§20.1) ─────────────
  | { op: 'REMOVE' }                                              // existence — the only op that deletes a piece
  | { op: 'RELOCATE'; to: 'origin'|'push'|'pull'|'swap'|'random-legal'; dist?: 1|2 }
  | { op: 'MARK';   mark: MarkId; dur?: number|'persist'; layers?: 1|2|3; data?: number }
  | { op: 'UNMARK'; filter: MarkFilter }
  | { op: 'BOOST';  d: Partial<Record<Stat, number>> }            // the 7-vector, clamped ±6 (§9.3)
  | { op: 'MEND';   frac: [number, number]; of: 'max'|'cur' }     // RESTORE hp (heal, drain, Leftovers)
  | { op: 'BECOME'; type?: TypeSpec; forme?: FormeSpec; cls?: PieceClass }
  | { op: 'EQUIP';  ability?: AbilitySpec; item?: ItemSpec|null; consume?: boolean }
  | { op: 'CHARGE'; slot: 0|1|2|3|'all'; d: number }

  // ── B. THE CLASH & DAMAGE PIPELINE (6): each a distinct point in §5's order of operations ─────
  | { op: 'CLASH';  slot: 0|1|2|3 }                               // the only op that can capture (§4)
  | { op: 'STRIKE'; frac: [number, number]; of: 'max'|'cur' }     // deal hp loss from a NON-Clash source
  | { op: 'MODIFY'; slot: DamageSlot; x: number }                 // a multiplier into a named §5 slot
  | { op: 'CLAMP';  to: 1; when: 'pristine'|'always' }            // HP floor after a blow — survive-once
  | { op: 'CHART';  d?: -2|-1|1|2; set?: 0|1; union?: BattleType } // rewrites the type reading itself (§4.2 1b)
  | { op: 'VETO';   scope: VetoScope }                            // boolean: makes an action ILLEGAL

  // ── C. LEGALITY & CONTROL FLOW (4) ────────────────────────────────────────────────────
  | { op: 'PIERCE'; scope: VetoScope[] }                          // cancels named VETOs (Mold Breaker family)
  | { op: 'TEMPO';    kind: 'grant-bonus'|'end-turn'|'skip-next'|'react'|'act-last'|'lock-slot' }
  | { op: 'SCHEDULE'; delay: 1|2|3|4|5; then: Effect }            // Future Sight, Wish; horizon ≤ 5
  | { op: 'INVOKE';   pool: InvokePool; depth: 1 }                // depth is 1 IN THE TYPE — recursion unconstructible

  // ── D. INFORMATION (1) ──────────────────────────────────────────────────────────────
  | { op: 'REVEAL'; what: 'item'|'slots'|'threats' };             // Frisk, Forewarn, Anticipation

export type Stat       = 'atk'|'def'|'spa'|'spd'|'spe'|'acc'|'eva';
export type DamageSlot = 'bp'|'atk'|'def'|'spa'|'spd'|'final'|'crit-window';  // §5's numbered steps
export type VetoScope  = 'type'|'element'|'class'|'chain'|'indirect'|'rider'|'ally'|'absolute'|'bind'
                       | 'item-theft'|'mark'|'boost';
```

Four properties are load-bearing and are asserted by `termination.test.ts` and `journal.test.ts` (§21):
**no op increases the piece count** — `SUMMON` does not exist, and CI gate 5 fails the build if it appears
(this is the monovariant §12.5's termination proof rests on); **`INVOKE.depth` is literally `1` in the
type**, so Metronome→Metronome is unconstructible rather than guarded at runtime; **the eight ops that
write no persistent state — `VETO`, `PIERCE`, `CHART`, `MODIFY`, `CLAMP`, `STRIKE` at read time, `TEMPO`,
`REVEAL` — are the only ops legal at the four `CLASH_*` triggers**, which is what makes the forecast (§5.3)
re-entrant and safe to compute speculatively; and **every state-writing op has a single-entry inverse**,
which is the journal of §20.3.

Three ops deserve a word because the games embody rather than call them, so they are unmeasurable from the
call channel and were added by argument:

- **`CLASH`** is Showdown's whole `runMove → getDamage → spreadDamage` pipeline collapsed into the one op
  that resolves the bounded exchange of §4. It is the only op that can remove a piece other than `REMOVE`.
- **`CHART`** writes the *type reading* of a Clash, in Showdown's own log₂ units, before the exchange. It is
  the one op `proposal-systems-first.md` could not see, because its seven carriers (Freeze-Dry, Flying
  Press, Thousand Arrows, Tar Shot, Freeze-Dry's kin, Iron Ball, plus the `d`-form on Tar Shot) express
  themselves entirely as `onEffectiveness` return values (C4). `CHART` cannot be folded into `MODIFY`:
  `MODIFY` scales a slot in the §5 pipeline *after* the type modifier, whereas `CHART` edits the modifier
  itself, which is why Freeze-Dry flips Ice→Water from 0.5× to 2× rather than merely hitting harder at
  0.5×. §4.2 step 1b is where it resolves; R6 is applied *after* it, so no chart rewrite can re-immunise a
  King. `chart.test.ts` (§21.3) pins all seven.
- **`REVEAL`** is information — Frisk, Forewarn, Anticipation are *entirely* `this.add(...)` log calls — and
  information is a first-class op here (a board-analysis affordance, §17) rather than deleted content.

### 13.3 The five compiler passes

`tools/compile/` runs at **build time**, reads `@pkmn/dex` + `@pkmn/sim` + `data/curated/*.json`, and emits
`src/data/generated/*`. It is deterministic — same inputs, byte-identical output, asserted in CI — and it
replaces the shipped `scripts/gen-data.ts`, whose output it is a strict superset of. `proposal-systems-compiler.md`
lists six passes; the SPEC folds its two source-reading passes (calls, then returns/assignments) into one
**handler-source** pass, because both read the same `String(fn)` and differ only in which grammar they
apply, giving five:

```
pass 1  ADMIT     filter by isNonstandard; assign stable uint16 ids; build the 165-row mark table
pass 2  FIELDS    C1: read declarative fields                          -> Effect[]   (425 moves + 230 items complete)
pass 3  NAMES     C2: parse handler names AND receiver paths           -> Trigger + Region per handler (2-D, §8.3)
pass 4  SOURCE    C3 calls (45 verbs) + C4 returns/assigns (14 rows)    -> Op[] + Guard[] + params
pass 5  PATCH     apply data/curated/*.json as a DIFF; emit; assert totality and the eight gates
```

Passes 2–4 **accumulate into the same `Effect[]`; they do not compete.** Where both the call channel and the
return channel speak for one handler *(measured: 93 entries)*, the call channel supplies the payload and the
return channel supplies the guards and vetoes — the correct precedence, because Wonder Guard's `onTryHit`
returns `false` *guarded by* a `runEffectiveness` predicate the call channel found. The generator writes
`build/compile-report.json` recording, per entry, which pass produced each op, so §13.4's ledger is
regenerated on every build rather than asserted in a document.

**The derivation rules, from Showdown field to op.** These are the compiler's whole front end and they are
short enough to state:

- A string-literal argument → `markOf(literal)`: `addVolatile('flinch')`, `setWeather('raindance')`,
  `trySetStatus('par')` all become a `MARK` whose id is the interned literal.
- An object-literal argument → a boost vector: `boost({atk:12})` (Belly Drum), `boost({atk:-1})`
  (Intimidate) become `BOOST`.
- An HP fraction → `MEND`/`STRIKE` with the literal fraction: `heal(maxhp/16)` (Leftovers) → `MEND [1,16]
  of:'max'`; `damage(baseMaxhp/8)` (Rough Skin) → `STRIKE [1,8] of:'max'`. **This is the largest single
  correction the SPEC makes to the proposal** (§13.6): the proposal mapped these onto four `damage-counter`
  buckets because capture was binary; with real HP the fraction is carried literally into the HP field the
  handler's own stem names.
- A numeric `chainModify(x)` → `MODIFY{slot, x}`: `chainModify(0.5)` on `onModifyDef` (Fur Coat) →
  `MODIFY{slot:'def', x:2}`; `chainModify(1.5)` on `onModifyAtk` (Choice Band) → `MODIFY{slot:'atk',
  x:1.5}`. **The handler's stem names the slot**, so the multiplier lands in the right place in §5's
  pipeline. This is the repair §1 change 3 describes: the receiver-blind `chainModify → ±1 roll modifier`
  conversion that inverted Fur Coat, Chlorophyll and 83 others *no longer exists*.
- A `return` expression → the 14-row C4 grammar: `return typeMod + 1` → `CHART{d:+1}`; `return 0`/`return 1`
  from `onEffectiveness` → `CHART{set}`; `return false` from `onTakeItem` → `VETO('item-theft')` (98
  handlers, the single largest C4 class); `return target.hp - 1` from `onDamage` → `CLAMP{to:1}`; `return
  critRatio + n` → `MODIFY{slot:'crit-window'}`.
- A `move.<field> =` assignment → `BECOME`/`MODIFY`/`PIERCE`: `move.type = 'Water'` → `BECOME`;
  `move.ignoreAbility = true` → `PIERCE`; `move.multihit =` → the multi-hit loop.

Five field-level guards are non-negotiable, each measured, because each closes a silent bug:

1. **`m.basePower || 60`.** *(measured)* **43 damaging moves have `basePower === 0`** (Gyro Ball, Low Kick,
   Seismic Toss, …); without the guard they compile to a strength-0 attack, which reads as a bug.
2. **Read `secondaries` only, never `secondary`.** *(measured)* `move.secondary` is the *identical object*
   already inside `move.secondaries` in all 204 cases, so a compiler reading both applies every rider twice
   — every Thunderbolt would roll paralysis twice. The shipped `MoveEntry` schema already declares only
   `secondaries?`, so the bundle is safe; this is a rule for the compiler.
3. **`ignoreImmunity` read as the rule it states.** *(measured)* `true` on **270 of 271** Status moves and
   on exactly three damaging moves; it is the dataset stating "support moves bypass type immunity", which
   is what makes §4.5's status-through-immunity answer correct from data with no special case.
4. **Hazard layer counts come from the move**: Spikes 3, Toxic Spikes 2, Stealth Rock 1, Sticky Web 1.
5. **`condition.duration` must be emitted.** *(measured)* 123 moves carry a `condition` object with a
   maximum duration of 5, which is what bounds the §20 scheduler horizon; the shipped `MoveEntry` schema
   has no field for it, so `tools/compile` adding `dur` per mark is a named M0 deliverable (§22).

### 13.4 The coverage ledger, and the curated override layer

Inclusion policy is `recon-data-substrate.md` §1 verbatim (moves `isNonstandard ∈ {null, Past, LGPE,
Unobtainable, Gigantamax}`, abilities `∈ {null, Past}`, items `∈ {null, Past, Unobtainable}`), which is
what the shipped `manifest.json` already records. Admitted: **950 moves, 311 abilities, 536 items = 1 797
entries** over **1 367 formes / 1 025 base formes** *(measured)*.

| Kind | Admitted | Derived (C1–C4) | Curated | Inert by design |
|---|---|---|---|---|
| Moves | **950** | 902 | ~48 | 0 |
| Abilities | **311** | 261 | ~42 | 8 |
| Items | **536** | 441 | ~27 | 60 |
| **Total** | **1 797** | **1 604 (89.3 %)** | **~117 (6.5 %)** | **68 (3.8 %)** |

**Derived with zero authoring: 1 604 of 1 797. Missing: 0.** The curated share is a *ceiling*, not a
target: `proposal-systems-compiler.md` measured 125 curated for a binary-capture engine; real HP moves a
handful the other way, because entries it had to curate for "which rung does a survive-once produce"
(Tinted Lens, Disguise, Ice Face, the Filter family) become literal `MODIFY`/`CLAMP` operations and derive
(§13.6). **The CI gate stays at ≤ 140 regardless** (gate 6), because a coverage claim should only ever be
revised downward under scrutiny, and the compiler's own `build/compile-report.json` is the source of truth
that `coverage.test.ts` reads — the number in this table is what the report says on a given build, not a
promise.

**The curated set is the entire hand-written content surface, and every entry is a *diff* against the
compiler's proposal, not an authoring task.** `data/curated/overrides.json` carries, per entry, a `reason`,
a `proposalHash` (so a `@pkmn/dex` bump that changes the compiler's output for a patched entry fails the
build rather than silently keeping a stale patch), and either a `replace` or a `patch`. The set falls into
three honest classes:

- **~48 variable-power moves** whose magnitude lives in a `basePowerCallback` or `damageCallback` returning
  a computed expression *(measured: 53 and 11 such functions)*. The compiler reads the function perfectly;
  it cannot decide what "power scales with the target's Speed" means, so Gyro Ball is a one-line curated
  tier-3 attack with a conditional modifier. A Pokémon expert will notice the approximation; that is the
  honest cost, and it is 48 rows of 950.
- **~14 flags-only abilities and items** with a real engine-implemented effect but no handler the compiler
  can read — **Levitate is the exemplar** *(measured: `flags:["breakable"]`, no `handlers` key, and
  `signalClass:"fields"` — the bundle asserting a derivability it does not have)*. The compiler emits
  `curated` with `archetype:'UNDERDETERMINED'`, the build report lists it, and the row supplies the veto.
- **A handful of true design calls** where the literal reading is right but the *board presentation* is a
  decision — Iron Ball's `CHART{set:1}` is derived, but the board wants the grounding visible, so it is
  curated into a persistent `grounded` mark carrying the same op.

**68 entries are inert by design, all named** in `data/curated/item-classes.json`: 8 abilities with neither
handler nor flag (`No Ability`, `Ball Fetch`, `Corrosion`, `Dancer`, `Early Bird`, `Honey Gather`, `Run
Away`, `Stall`), which display their real `shortDesc` with a "flavour only" badge and **refund 1 draft
point** (§15.5, the same mechanism that makes Slaking a bargain rather than a trap), and 60 items (40
evolution items that live in the promotion pool, 15 fossils, 5 valuables) repurposed per §10.4.

### 13.5 The total fallback, and the eight CI gates

The fallback is not an error path; it is the **modal case**. 167 of 950 moves are plain damage with no
signal at all, and that is *correct* — Tackle should be a plain capture.

```ts
function fallback(e: AdmittedEntry): Effect[] {
  if (e.kind === 'move' && e.category !== 'Status')
    return [{ when:'ON_ACT', where: REGION_OF_TARGET[e.target] ?? 'MELEE',
              ops:[{op:'CLASH', slot:0}], power: tierOf(e.basePower || 60),
              charge: clamp(Math.round(e.pp/5), 1, 5) }];
  if (e.kind === 'move')                                   // an unrecognised Status move
    return [{ when:'ON_ACT', where: REGION_OF_TARGET[e.target] ?? 'SELF',
              ops:[{op:'BOOST', d:{ [bestStatOf(e.owner)]: +1 }}], dur: 2 }];
  return [];   // an unrecognised ability/item: 'inert' + real shortDesc + "flavour only" badge + 1 draft point
}
```

So a damaging move is always at least an ordinary capture at a real strength tier, an unclassified Status
move is always a small visible self-buff, and inert content is honest rather than hidden. Nothing is ever a
silent no-op a player mistakes for a bug — which is `DIRECTION.md`'s "all content resolves to something
coherent" discharged by construction.

The generator **fails the build** on any of eight conditions, and `coverage.test.ts` re-asserts them:

1. any admitted entry produces no `Effect[]` (**totality**);
2. an override names a vanished entry, or whose `proposalHash` no longer matches (semantic-drift guard);
3. an **82nd** handler stem, a **46th** mutation verb, a **15th** return-grammar row, or an unknown
   `isNonstandard` value appears — a dependency bump that introduces new vocabulary fails the build rather
   than dropping content;
4. any op references a `MarkId` outside the generated 165-row mark table;
5. **`INVOKE` appears with `depth !== 1`, or any op named `SUMMON` exists** — gate 5 *is* the termination
   proof of §12.5, enforced by CI rather than by discipline;
6. the derived share falls below 88 % or the curated list exceeds 140 entries;
7. the unclassified call-site share exceeds 1 % *(currently 0.4 %)*;
8. **any handler falls into none of the four channels** — the five-way partition of the 1 675 handlers must
   sum exactly. This is the gate that would have caught `CHART`: a handler that calls nothing, matches no
   return-grammar row and assigns nothing is *unexplained*, and the build prints its name.

### 13.6 Where real HP corrects the compiler proposal — read this before implementing

`proposal-systems-compiler.md` is the primary source for this section, but it was written for a
**binary-capture** engine in which a piece was alive or dead and "damage" was four buckets of a
`damage-counter` track. The SPEC's §1–§12 replaced that with **real HP and a real gen-9 damage pipeline**
(§4, §5). Three op-level consequences follow, and an implementer must apply them rather than the proposal's
originals:

| Proposal op (binary capture) | SPEC op (real HP) | Why it changed |
|---|---|---|
| `MEND{counters: ±n}` — signed moves on a 0–3 damage-counter track | **`MEND{frac,of}`** (restore HP) and **`STRIKE{frac,of}`** (deal HP) as two ops | With real HP the ~200 chip/heal entries carry literal fractions (Leftovers `1/16`, Rough Skin `1/8`, Life Orb `1/10`, Stealth Rock `1/32·2^k`). Splitting heal from chip is what §4.5's Softening floor and §9.5's Checkup ordering attach to |
| `TILT{scope,d}` — an integer addend to a single public roll | **`MODIFY{slot,x}`** — a multiplier into a named step of §5's pipeline | There is no single roll to add to; there is the real damage formula. `chainModify(2)` on `onModifyDef` becomes `×2` in the `def` slot, so Fur Coat is literal and the receiver-blind inversion that made it "+2 attack" is gone (§1 change 3). `crit-window` survives as a `MODIFY` slot |
| `WARP{from,to,once}` — rewrites a decided ladder rung | **`CLAMP{to:1}`** for survive-once; **`MODIFY`** for partial reductions | Sturdy, Focus Sash, Endure, Multiscale, Ice Face and False Swipe are **ordinary HP effects** (§4.2, §5 step 16): they clamp HP to 1 or halve incoming damage, so they compose with everything and raise no ordering question. Filter/Solid Rock ×0.75 and Tinted Lens ×2 are `MODIFY` in the final slot |

Net: the proposal's 19 ops become **20** — `TILT` and `WARP` retired (both were artefacts of a
roll-and-rung resolution that no longer exists), and `MODIFY`, `CLAMP` and `STRIKE` added for the literal
HP pipeline. Two further proposal features are **absent** by the SPEC's earlier decisions and must not be
reintroduced in §13's name: the **per-piece Charge counter** (cut in §10.5 change 4 — `flags.charge`,
`flags.recharge` and Speed Boost are literal, and ARTs are gated only by slot charges), and the **Band
Cap / five-rung ladder / single Tempo Roll** (superseded by the bounded exchange of §4 and the
Momentum/Focus/Precision instruments of §6). Wonder Guard is **permanent and literal** here, not
class-scoped (§10.3), so its C4-derived `VETO('absolute')` is guarded on "not super-effective" rather than
on evolution stage.

### 13.7 Fifteen pieces of content, traced end to end

Each row is a compiler output, not an illustration: the measured dex fields, the channel that fired, the
emitted `Effect[]` in SPEC ops, and the board behaviour. Chosen to be as different from one another as the
dex allows.

| # | Content | Measured fields → channel | Emitted `Effect[]` (SPEC ops) | On the board |
|---|---|---|---|---|
| 1 | **Trick Room** | `pseudoWeather 'trickroom'`, `priority −7`, `condition.duration 5`; no handlers → **C1 + C2** | `[{ON_ACT, BOARD, [MARK trickroom dur:5]}]` | for 5 turns the §4.2 Speed comparison inverts, so the slower piece takes the extra swing — the single most consequential thing five turns of inversion can do. It is the one field slot (§9.4); a side may not re-cast the field already active |
| 2 | **Baton Pass** | `selfSwitch 'copyvolatile'`; `onHit` is a switch request → **C1 + one curated row** | `[{ON_ACT, SELF, [RELOCATE origin, MARK legacy persist data:carry-boosts+marks]}]` | retreat to your origin square and **leave your accumulated boosts and marks on the vacated square**; the next friendly piece to end a move there inherits them, capped at +2 total. `LEGACY` is in the repetition hash so a pass-and-repass cannot draw by accident |
| 3 | **Metronome** | `callsMove true`, `flags failinstruct/…`; `onHit: this.sample(...)` → **C1 + C3** | `[{ON_ACT, SELF, [INVOKE pool:'metronome-flagged' depth:1]}]` | samples one move (seeded, replayable) from the metronome pool ∩ your slots, minus every `callsMove` and `selfdestruct`, and **shows it before resolving** so it can never cost a piece by surprise. `depth:1` in the type makes recursion unconstructible |
| 4 | **Transform** | `basePowerCallback`-adjacent; a species/slot copy → **curated** (1 of ~48) | `[{ON_ACT, TARGET, [BECOME {type:'target', forme:{species:copy}, cls:keep}, EQUIP {ability:'copy-target'}]}]` | copies the target's species, declared type, ability and moveset (not its HP or chess class). Curated because "copy everything but keep the pin" is a design call, not a field |
| 5 | **Perish Song** | `pseudoWeather`-scoped counter via `condition`; `onEnd` faint → **C1 + C2** | `[{ON_ACT, BOARD, [MARK perish dur:3 data:3]}]`; the mark's tick `[{ON_CHECKUP, SELF, [STRIKE cur:all when data hits 0]}]` | every piece on the board carries a counter that decrements each Checkup; at 0 it perishes (§9.5 step 10). A **bond MUTUAL** source (§4.4): both sides' pieces can perish together |
| 6 | **Sketch** | `onTry` (one of the two names that do not parse) → **curated** | `[{ON_ACT, SELF, [EQUIP {slot: copy-last-move}]}]` | permanently writes the last move used against you into one of your own slots. Curated because the copy semantics is engine logic, not a field; bounded to one use by its 1 charge |
| 7 | **Wonder Guard** | `onTryHit: if (runEffectiveness ≤ 0 ‖ !runImmunity) return false` → **C4 row 2**, then curated for the *bound* | `[{CLASH_LEGAL, SELF, [VETO 'absolute'], guard:{not:{superEffective:true}}}]` | only a super-effective Clash may damage it — **permanent and literal**, not class-scoped (§10.3). Shedinja has 1 HP *(measured)*, so hazards, weather, status and any chip still kill it; and no VETO holds against a King (R6). `overrides.json` supplies the guard the call channel found |
| 8 | **Shadow Tag** | `tryTrap` (the §13.1 residue correction) → **C3** | `[{CLASH_LEGAL, KING_RING, [VETO 'bind'], guard:{not:{class:['king']}}}]` | adjacent enemies may not move *away*. The `KING_RING` region is a **compiler invariant** (§8.3): there is no global region for it to reach, so it *cannot* be board-wide, and it **never binds the enemy King** |
| 9 | **Belly Drum** | `@pkmn/dex` reports no `boosts`; C3 extracts `directDamage(maxhp/2)` and `boost({atk:12})` → **C3** | `[{ON_ACT, SELF, [STRIKE [1,2] of:'max', BOOST {atk:+12}]}]` | halve your own HP, gain the maximum Attack boost (clamped to +6 by the shared `BOOST` clamp). Read out of Showdown's source, so it is the real trade with zero authoring — a headline demo of why the compiler reads `@pkmn/sim`, not `@pkmn/dex` |
| 10 | **Air Balloon** | `onTryHit` veto + `target.item=''` on hit → **C3 + C4 row 2** | `[{CLASH_LEGAL, SELF, [VETO 'element'], guard:{vsType:['Ground']}}, {ON_DAMAGED, SELF, [EQUIP {item:null, consume:true}]}]` | Ground captures are illegal until the balloon pops; **one-shot**, because the item's own printed text says so (§10.3). It is the template every one-shot ward is measured against — contrast Levitate, which is permanent |
| 11 | **Choice Specs** | `isChoice`, `onModifySpA: chainModify(1.5)`, `addVolatile('choicelock')` → **C1 + C3** | `[{CLASH_ROLL, SELF, [MODIFY {slot:'spa', x:1.5}]}, {ON_ACT, SELF, [MARK choicelock persist, TEMPO 'lock-slot']}]` | ×1.5 Special damage, and **the first slot it uses is the only slot it may ever use again** for the game. Illegal on King and Queen (§15.3). The lock is the item's identity, derived not designed |
| 12 | **Focus Sash** | one `onDamage` handler; the source *is* the spec → **C4 row 8** | `[{CLASH_RESULT, SELF, [CLAMP {to:1, when:'pristine'}, EQUIP {item:null, consume:true}]}]` | a Clash that would remove this **pristine** piece leaves it at exactly 1 HP and shatters the Sash (§5 step 16). `target.hp === target.maxhp` maps onto `pristine` exactly. It clamps, it does not rewrite the outcome, so the "Sash a pawn, throw it at the Queen" exploit cannot form — the exchange continues (§10.5) |
| 13 | **Sticky Web** | `sideCondition 'stickyweb'`, `target foeSide` → **C1 + C2** | `[{ON_ACT, FOE_ZONE, [MARK stickyweb persist]}]`; tick `[{ON_ENTER, SELF, [BOOST {spe:-1}], guard:{grounded:true}}]` | paints a 3-square band of the enemy third rank; a grounded piece that ends a move there drops a Speed stage — which lands on the single most consequential thing a Speed drop can affect: who swings first (§4.2) |
| 14 | **Explosion** | `bp 250`, `target allAdjacent`, `selfdestruct 'always'` → **C1** | `[{ON_ACT, RING1_ALL, [CLASH slot:0]}, {ON_CAPTURE, SELF, [REMOVE]}]` | a Clash against all 8 neighbours, friend and foe, then remove yourself: at most 9 pieces, never the board. One of the seven `selfdestruct` moves that are the **sole** exception to the Softening rule (§4.5) — you may kill at range only by dying |
| 15 | **Substitute** | `volatileStatus 'substitute'`, `directDamage(maxhp/4)` → **C1 + C3** | `[{ON_ACT, SELF, [STRIKE [1,4] of:'max', MARK substitute data:hp/4]}]` | spends a quarter of your HP to place a decoy mark that absorbs the next Clash against you, then breaks — **not a second occupant** (§12.5). The termination proof forbids any op that adds a piece, so Substitute is a mark, which is also exactly what it is in the games |

The point of the table is that fifteen mechanics this different — a field inverter, a state-transfer, a
random-move caller, a full identity copy, a board-wide countdown, a move-thief, an immunity, a trap, a
self-halving buff, a one-shot ward, a lock-in item, a survive-once item, a hazard, a self-destruct and a
decoy — are **all lists of the same twenty ops**, and thirteen of the fifteen needed no authoring at all.
That is the compiler's entire argument, and it is why §16's animation layer, §18's tutorial, §19's AI and
§15's draft each cost a table rather than a project.

---

## 14. Faithfulness ledger

`DIRECTION.md`'s load-bearing test is *"a Pokémon player must recognise this as that thing behaving the way
it behaves in the real games,"* and it names **both** canons — the mainline games and the TCG — as
legitimate, requiring only that we record which one each mechanic came from. This section is that record.
Every type multiplier below is against `typechart.ts`; every measured count is from the recon set. A
mechanic that a Pokémon player calls wrong is filed as a **defect** against this table, not as a
preference (§24).

### 14.1 Mechanics from the mainline games

| Mechanic | In the games | On the board | Where in this spec |
|---|---|---|---|
| **Real HP and the damage formula** | every capture is a battle resolved by the gen-9 formula with real base stats | pieces carry real HP; a capture is a bounded exchange of blows at σ = 1.0 | §4, §5 — *the whole resolution model is canon arithmetic a Smogon reader can check* |
| **The 18×18 type chart** | 0 / 0.25 / 0.5 / 1 / 2 / 4 effectiveness | the multiplier decides which of five verdicts a Clash reaches | §4.3; the TCG supplies the *vocabulary* (§14.2), the games supply the *chart* |
| **STAB and dual-type products** | ×1.5 same-type, product of two type rows | slot 0 is always your declared type, so an ordinary capture is STAB; `CHART{union}` gives Flying Press its product | §5 step 10, §13.7 |
| **Speed decides order** | the faster Pokémon acts first | effective Speed decides who swings first, and therefore who gets the extra blow | §4.2 step 3 |
| **Freeze-Dry beats Water** | the famous chart exception (Ice→Water 2×) | its slot rewrites Ice→Water to 2×, flipping the worst matchup into the best | §4.2 1b, §13.2 `CHART` |
| **Levitate / the elemental wards** | permanent immunity to a move type | a permanent `VETO`; the capture is never generated | §10.3 — `DIRECTION.md`'s own named example of a *good* mapping |
| **U-turn / self-switch** | hit, then switch out | capture, then return to your origin square, clearing rotation-class marks | §9.1, §13.7 kin |
| **Sticky Web / Spikes / Stealth Rock / Toxic Spikes** | hazards that punish arrival, Stealth Rock scaling with the arriver's type | a 3-square band on the enemy third rank; Stealth Rock does `1/32·2^k` | §8.5 — layer counts, persistence and type scaling all from data |
| **Rough Skin / Rocky Helmet / recoil** | contact damages the attacker | a contact capturer loses HP per swing, a canon MUTUAL source | §4.4, §10.1 |
| **Belly Drum, Swords Dance, the 7 stat stages** | literal HP-for-Attack and per-stat boosts | `STRIKE` + `BOOST`; Iron Defense and Swords Dance are visibly different | §9.3, §13.7 |
| **Choice items, Sturdy, Focus Sash, Multiscale, Thick Fat, Huge Power, Life Orb** | literal multipliers and clamps | `MODIFY`/`CLAMP`; each is the real number, not an abstraction | §5, §10.1 |
| **Weather, terrain, Trick Room** | 5-turn field effects | one weather + one terrain slot; Trick Room inverts the Speed comparison | §9.4 |
| **Terastallization** | a piece's type changes once per battle, at a cost | once per side, declared type becomes any legal declaration, keeps STAB on both types | §11.1 |
| **Promotion as evolution** | a Pokémon evolves into its real next stage | a pawn evolves along its real `evos` chain and re-declares type | §11.2 |
| **The 950-move, 311-ability, 536-item corpus** | the real dataset | compiled, not authored | §13 |

### 14.2 Mechanics from the TCG

`DIRECTION.md` singles out the TCG as the better precedent for a board game with a small action budget, and
names five places to prefer it. All five are taken:

| Mechanic | In the TCG | On the board | Card / measurement a player would recognise |
|---|---|---|---|
| **Coins, not dice** | the randomiser alphabet is powers of ½; *"flip a coin"*, never a d6 | Focus (crit) and rider chances are presented as coin flips; 1/16 crit is *"four heads"* | `recon-tcg.md` §2.3 — measured 1-coin ×310, 2-coin ×57, 4-coin ×10, "flip until tails" ×29 across the SV era |
| **Weakness / Resistance vocabulary** | the type chart printed on the card as a ×2 / −30 modifier | the capture banner reads **WEAKNESS** and **RESISTANCE**; super-effective → move again | *(measured)* the modal Weakness is worth **exactly one turn** of tempo (1 306 of 3 683 SV-era attacks), which is precisely the one bonus sub-move an ADVANTAGE grants — `recon-tcg.md` §1.4 |
| **Status marking** | Asleep/Paralyzed/Confused rotate the card (newest wins); Poisoned/Burned place stacking markers | the rotation class rotates the pin 90°; the persistent class stacks counter pips on the bezel | `recon-tcg.md` §3.2; §9.1 |
| **The Pokémon Checkup order** | psn → brn → slp → par, then simultaneous knock-out | the §9.5 Checkup runs psn→tox→brn and defers removal to a single simultaneous step | `recon-tcg.md` §3.4; §9.5 step 12 |
| **Modifier ordering** | attacker bonuses → Weakness/Resistance → defender reductions, and a defender hook may only reduce | §5's pipeline in exactly that order; step 14 defender modifiers "may only reduce" | `recon-tcg.md` §11.4; §5 |
| **One Stadium slot / fields visible to both** | a Stadium alters play for both sides and is replaced, not stacked; a new one may not share a name with the active one | one weather + one terrain, both public; a side may not re-cast the active field (closes draw hole W3) | `recon-tcg.md` §7.2; §9.4 |
| **Held items and Tool cards, public** | items are face-up and visible to both players | abilities and items are public, always, both sides; the "hand" analogue is the draft | §10.4 |
| **Tera cards printed off-type** | Tera Charizard ex is a **Darkness** card weak to Grass, with a re-derived Weakness | Terastallization repaints the enamel and re-derives the chart reading | `recon-tcg.md` §0.2; §11.1 — *both canons agree, so we did not have to choose* |
| **Evolution as a played action** | evolution is a card played onto a Pokémon in play, removing Special Conditions | promotion evolves the piece and clears all status | §11.2 |
| **Marking status rather than modelling thaw** | freeze/paralysis are turn-scoped and cleared by a defined event | par/slp are marked; the failure chance is routed to a tempo cost, not a hidden roll | §9.1 |

### 14.3 The two mechanics that are neither, stated plainly

Honesty required by `recon-tcg.md` §11.2 and §11.1:

- **Mutual destruction (MUTUAL, ROUT) is chess canon, not Pokémon.** Neither canon has an attack that kills
  the attacker on a bad matchup. It is Kamikaze Chess (Laws, 1928) and Stratego's equal-rank rule (§4.4,
  §25). The UI's Why panel labels it as a **chess** rule, not a Pokémon one. What redeems it: every one of
  its content-level sources (recoil, thorns, Perish, `selfdestruct`) *is* canon, and the three answers to
  it — Freeze-Dry, Tar Shot, and simply not attacking into a resistance — are all faithful, so the player's
  response to the one unfaithful rule is itself faithful.
- **King capture, not checkmate, is a chess-variant decision, not either Pokémon canon** — but it is the
  standard resolution across every variant where "check" is hard to compute (§12.1), and it is what the
  video itself reached for. The cost (loss of stalemate; K+R vs K becomes a forced win) is stated in §12.2.

---

## 15. Balance, the draft, formats

Balance here has a specific meaning: because the army is *drafted*, the question is not "are the pieces
equal" — they are deliberately not — but "is every reasonable draft viable, and is the point list an honest
description of what a piece is worth on *this* board." The answer is a valuation formula that reprices the
standard chess values under the type chart, a draft that is a usability device rather than a balance
guarantee, and a batch simulator that fits every coefficient by self-play rather than by argument.

### 15.1 What a piece is worth — the valuation formula that reprices under the chart

Base class values come from the published sets, not the folk 1/3/3/5/9 (which assume binary capture and
fixed movement): **P 1, N 3.2, B 3.3, R 5.0, Q 9.5** (Berliner / AlphaZero, `recon-variants.md` §3.1). The
type term uses `recon-variants.md` §3.2's model, whose shape is right because *what you risk when you
attack* and *what an attacker risks coming at you* both scale with how much piece is at stake:

```
V(piece) = m · (1 − α·LIAB(t) + β·ARM(t) − ε·BLOCK(t)) + τ · BONUS(t)
             α = 0.9, β = 0.5, ε = 0.3, τ = 0.5 pawns   (starting values; fitted by self-play, §15.8)

LIAB(t)  = Σ_d ŵ_d · P(attacker dies | a piece of type t attacks a piece of type d)   // MUTUAL or ROUT
ARM(t)   = Σ_a ŵ_a · P(attacker dies, is repelled, or is blocked | a attacks t)
BLOCK(t) = Σ_d ŵ_d · [chart(t,d) = 0]                                                  // capture illegal
BONUS(t) = Σ_d ŵ_d · P(ADVANTAGE | t attacks d)                                        // a free move earned
```

The crucial change from `proposal-systems-compiler.md` is the source of the four probabilities: that
document read them off its five-rung ladder, but here they are the **measured outcome frequencies of the
real bounded exchange** (§4.1's 84.1 % / 50.9 % / 14.4 % table), so the price list is a description of the
resolution model that actually ships. `α·LIAB` and `β·ARM` *multiply* `m` — they reproduce the queen's
collapse under mutual destruction, the Marseillais finding that a double-move game halves the queen — while
`τ·BONUS` is *additive*, because a free move is worth the same tempo to a pawn as to a queen. `ŵ_d` is the
count-weighted share of enemy pieces of type `d`; the published price list uses a uniform `1/18`, and the
AI's evaluation (§19.2) uses the live board's distribution.

The repricing is real and it is the point: under this formula **Steel is the most valuable defensive
declaration and Bug and Grass the least** *(each has seven self-destructive attacking matchups; Ice is a
good attacker with the worst defence on the board — `recon-variants.md` §3.2)*. The spread between the best
and worst type of one class is on the order of **1.2×–1.5×** — narrower than a naive type-driven design
because a resisted attacker often merely REPELs rather than dying, and a super-effective one occasionally
backfires — and it lands mostly in **tempo, not material**: `BONUS(t)` ranges roughly 2× across the types,
which is where the type edge belongs, because tempo is felt immediately and cannot be bought with points.
The exact table is a §15.8 output, re-fit whenever the σ, Momentum range or extra-move rules move; it is
never hand-set, because Betza's four "balanced" armies later scored +62 % / −71 % over 400 engine games
and *hand-balancing asymmetric armies does not work* (`recon-variants.md` §1.6).

### 15.2 The draft loop — slot-first, never a 1 025-item browser

Choosing 16 pieces from 1 025 species, each with a type, an ability, a moveset and an item, is a search
space that paralyses. The draft is therefore **slot-first**, adopting `recon-visual.md`'s solution:

1. The 16 slots fill in a fixed order (King, Queen, Rooks, Bishops, Knights, then Pawns).
2. For the one slot being filled, **five candidates** are offered with a guaranteed spread: at least one
   Pokémon of a type you do not yet cover, at least one well under your remaining per-slot budget, at most
   one Legendary/Mythical, and at most one Ace-restricted piece.
3. Each candidate card shows the sprite, both real types (**pick one**), the 1–4 ability radio, the
   auto-picked moveset (§8.2) with **one swappable slot**, its point cost, and an **18-cell Coverage
   Strip** that animates the chart gaps this pick would close. A candidate carrying a `CHART` move
   annotates the strip differently: Lapras-as-Ice shows Water as *covered with a hatched cell*, because
   Freeze-Dry covers it while the Ice row does not — which is how the chart layer becomes a draft decision
   rather than a surprise.
4. **One reroll** per slot; full search is an escape hatch behind an `Advanced` toggle, never the default.
5. **Quick Draft** (accept all suggestions) completes a legal army in under 60 seconds; a themed preset
   (Kanto, Mono-Steel, a Gym Leader mirror) completes it in one click. `src/game/autodraft.ts` already
   ships the first version of this path.

### 15.3 What the validator enforces, and the banlists

| Requirement | Rule | Why |
|---|---|---|
| Legal army | exactly 1 K / 1 Q / 2 R / 2 B / 2 N / 8 P | chess; already `STANDARD_ARMY` |
| Budget | `Σ cost ≤ budget`, quarter-pawn granularity | a *usability* device, never a balance guarantee (`recon-variants.md` §1.6) |
| Type spread | ≥ 10 distinct declared types among your 16 | the every-type-on-the-board goal is impossible for one side (18 types, 16 pieces); the candidate generator makes the *union of both armies* cover 18 overwhelmingly likely |
| **Immunity breaker** | ≥ 1: a Scrappy/Mind's Eye piece, a Mold-Breaker-family piece, a Ring Target holder, or a `Thousand Arrows`/`Smack Down`/`Iron Ball` piece | Stratego's over-supplied key (§10.3 bound 5); Ring Target is in the Standard 12 Kit, so the floor is met by default |
| **Ace limit** | ≤ 1 Ace piece (§15.5) | keeps OHKO moves, Wonder Guard, Imposter, Shadow Tag, Huge/Pure Power and the four Ruin abilities to one outlier per side |
| Ruin limit | ≤ 1 Ruin ability | they do not stack (§10.5) |
| Choice items | illegal on King and Queen | a +2-Speed or locked-in royal covers too much board |
| Moody | banned in rated formats | there is no decision to preserve |

Banlists live in the `Format` record as `{ moves, abilities, species }` id lists, so a ban is a data row,
not code. The default rated banlist is empty beyond the structural limits above; format-specific banlists
(a Legendary ban, a weather ban) are how the metagame is tuned after §15.8 reports a dominant strategy.

### 15.4 Point costs

```
cost(piece) = round(4 · V(type, class)) / 4                            // §15.1, quarter-pawn granularity
   + 0.5   for a Legendary / Mythical / Paradox tag
   − 0.25  if species.nfe                                              // undeveloped, and it wants Eviolite
   − 1.0   for an INERT / drawback ability (Run Away, Truant, Slow Start — the refund that makes Slaking a bargain)
   + 0.25  for a slot-0 move at power tier ≥ 4
   + 0.25  for any slot carrying a CHART op                            // 7 entries; priced, not banned
```

Costs are **published on the card**, so drafting is a transparent optimisation rather than a guessing game.
`recon-variants.md`'s Knightmare-Chess precedent gives a shipped answer to a skill gap between two known
players: a **voluntary handicap** — take a smaller budget.

### 15.5 Ace picks

> **Exactly one piece per army may be an Ace: a piece drawing on the game's most swingy, least
> interchangeable content.** The Ace list is `{ OHKO moves (Fissure, Guillotine, Horn Drill, Sheer Cold),
> Wonder Guard, Imposter, Huge Power, Pure Power, the four Ruin abilities, Shadow Tag }`.

The Ace limit exists because each of these is *individually* fine and *collectively* degenerate: two OHKO
pieces plus a Wonder Guard King (foreclosed anyway by §3.2) plus a Ruin stack is not a game. One is a
spice; the draft validator enforces `≤ 1`. This is also the structural reason the Shedinja King is closed a
third way (§12.6): Wonder Guard is an Ace, and a King cannot also be the army's Ace-slotted piece under a
format that puts Wonder Guard on the list. The Ace is declared at draft, shown on the piece card, and
public like everything else.

### 15.6 Formats, keyed to the pool source

> **A format is a data record. Its single most important field is `pool`, and the match rules never see
> it.** (§15.7.)

```ts
export interface Format {
  id: string;
  pool: PoolSource;                    // 'full-dex' or 'collection' — the ONLY place collection state enters
  budget: number;                      // point-buy total, quarter-pawn granularity
  kit: ItemId[];                       // exactly 12 (§10.4)
  bans: { moves: MoveId[]; abilities: AbilityId[]; species: SpeciesId[] };
  aceSlots: 1;
  requirements: DraftRequirement[];    // §15.3
  rules: RulesProfile;                 // 'standard' | 'classic' | 'guarded'
}
```

The shipped formats, and which pool each draws from:

| Format | Pool | Budget / Kit | Purpose |
|---|---|---|---|
| **Sandbox** | `full-dex` | free, any Kit, no budget | playtesting and AI-vs-AI; no account (§17.2) |
| **Standard (casual)** | `full-dex` | 60 pts, Standard 12 Kit | the default game a stranger plays first |
| **Ranked** | `collection` | 60 pts, Standard 12 Kit | the ladder; drafts only what the account owns |
| **Mirror Pool (ranked default)** | a shared 40-candidate pool seeded per match | 60 pts | collection depth is worth exactly zero (§15.7) |
| **Gym Leader** | `full-dex` (yours) vs a mono-type AI army | 60 pts | the badge gate (§17.9, DIRECTION §6) |
| **Weather / Signature / Chart Kits** | either | wholesale Kit swaps | how the other ~340 items enter play over time (§10.4) |

`RulesProfile` is where the shipped `variant.ts` lives on as `classic` (ladder-free, dice-off; §20.5),
`standard` is the full ruleset of §4–§12, and `guarded` adds the R9 casual filter.

### 15.7 The pool-source seam, and fairness against collection depth

`DIRECTION.md` calls collection-driven pay-to-win *"the problem most likely to kill the game."* The seam is
one type and one lint rule: `draft(format, rng) → Army`, where `Army` is 16 fully-resolved `PieceSpec`s and
`PoolSource` is consumed **only** inside `draft`. `src/rules/` may not import `src/meta/`, enforced by an
ESLint `no-restricted-imports` rule that fails CI, so collection state *cannot* reach capture resolution
because the resolver's input type does not contain it.

Fairness is then layered, and every layer is `DIRECTION.md`'s own recommendation:

- **Ranked is point-buy budgeted**, so a 20-Pokémon account and an 800-Pokémon account field armies of
  equal cost. Depth buys *options*, never *power*.
- **Mirror Pool is the ranked default**: both sides draft from one shared 40-candidate pool, where a large
  collection contributes nothing.
- **Type-scoped seasons** (a Steel-legal season) cap the value of hoarding by restricting the pool.
- **Matchmaking pairs on rating *and* pool depth** (§17.10), so a new player is never fed to a deep
  collection in a collection-pool queue.

### 15.8 The batch simulator is the instrument, not the argument

Every number in §15.1 is a *starting value*. The headless batch simulator (`src/sim/`, shipped at M6, §22)
runs thousands of AI-vs-AI games under a format and reports: outcome distribution, game length in turns and
sub-moves, capture-outcome frequencies, per-type win rate, first-player advantage, bonus-chain length
histogram, MUTUAL rate (target 8–15 % of captures, §4.4), and draw-cause breakdown. From those it re-fits
the four coefficients α/β/ε/τ, the `isBulwark` threshold (§3.3), `format.momentumRange` and
`critWindowBase` (§6.4), and the point list. This is `DIRECTION.md`'s "batch simulation that *tests* the
balance claims" made a shipped tool, and it doubles as the puzzle generator (§18.6) and a player-facing
curiosity in the sandbox. It is also the reason the SPEC states targets as *numbers* — MUTUAL 8–15 %,
first-player skew within a few percent, RNG below 20 % of variance — rather than as adjectives: a target
that cannot be measured cannot be tuned, and a batch simulator that could hang (hence the 300-turn hard cap
of §12.4) is not an instrument.

---

## 16. Visuals and animation

`DIRECTION.md` ranks visuals *alongside correctness*: "a mechanically perfect game that looks like a
prototype has failed this brief." Four things are named as acceptance criteria — a distinct readable
animation per capture outcome, the free extra move dramatised, moves/abilities/items with visual identity,
and animation that never gates play — and this section discharges all four with the numeric budgets
`recon-tech.md` and `recon-visual.md` measured.

### 16.1 Art direction

The identity, from `recon-visual.md` §1: **a national championship, played at night, with gym badges for
pieces.** The board is a honed slate slab with an ink-inlaid grid; each piece is a **cloisonné enamel pin**
— a metal bezel enclosing a type-coloured enamel field with the Pokémon sprite set into it — and the pin's
*outer silhouette is its chess role*. It must not read as a dark-mode dashboard, a wooden lichess board, a
neon board, or a cutesy mobile puzzle.

The palette's spine is fixed: **the 18 type colours in `src/ui/typeColors.ts` are not to be changed**
(`DIRECTION.md` names them explicitly). Everything else is deliberately low-chroma and blue-cool
(`recon-visual.md` §1.4: CIELAB C\* ≤ 18) so the type colours are the only saturated thing on screen. Board
squares are cool slate `--sq-dark #5C6575` / `--sq-light #818A9B` with a 1 px ink inlay, chosen because
*(measured)* against the shipped tan board **all 18 type colours fall below 3:1 contrast**. Two reserved
colours carry meaning nothing else may borrow: **`--gold #FFC53D`** for an unspent bonus move, and
**`--crit #FF7A45`** for a coin-flip critical hit. Typography is Archivo (display) over IBM Plex Sans (UI)
and IBM Plex Mono (notation), two families, `font-display: swap`, ≈34 KB + 3×22 KB woff2.

### 16.2 Chess-role legibility — the solved problem

The owner's report that "you cannot tell a king from a bishop" is the project's most important legibility
defect, and `recon-visual.md` §2 measured *why* the shipped approach cannot work: the current
`BoardPiece.tsx` carries role in three channels — a Unicode glyph badge, a sprite-size hierarchy
(`ROLE_SPRITE_SCALE`), and a ring weight (`ROLE_RING_WEIGHT`) — and at a 40 px cell the glyph is ~10 px and
indistinguishable, three size tiers cannot separate six roles, and the ring weight difference is sub-pixel
(1.2 px vs 1.4 px). **The shipped `BoardPiece.tsx` is nonetheless the right *structure*** and the fix builds
on it: it already renders three orthogonal channels — a type-coloured ring (type), a sprite, and a role
badge whose own light/dark treatment names the owner — and it already scales in container-query units
(`cqmin`) so it works from a 40 px mobile square to a 96 px desktop one. The upgrade, adopted from
`recon-visual.md` §2.2, is to **make role the pin's outer silhouette rather than a badge**:

| Role | Silhouette (derived from how it moves) | Cell fill |
|---|---|---|
| Pawn | circle | 66 % |
| Bishop | diamond (its diagonals) | 74 % |
| Rook | crenellated square (its orthogonals) | 76 % |
| Knight | stepped "L" (literally its move) | 74 % |
| Queen | coroneted octagon (rook ∪ bishop) | 86 % |
| King | crowned shield that **overflows the cell** | 92 % |

Six inline SVG paths in a 64×64 viewBox, never a font. This gives three orthogonal variables, one per
question: **shape = role, fill = type, bezel lightness = owner** (measured 15.2:1 between the two armies),
with the king additionally breaking its cell boundary so it is identifiable in peripheral vision. The
channels switch on by container query (≤ 34 px: silhouette + army metal; 44–64 px: add the type glyph; ≥ 64
px: add the archetype glyph). Because colour is never the only channel — each outcome and type also carries
a glyph — the board survives greyscale and the seven type-colour pairs that collapse under deuteranopia.

**One prerequisite refactor, ~2 days** (`recon-tech.md` §A.4 / `recon-visual.md` §7.4): the shipped
`App.tsx` renders each `BoardPiece` as a child of its square's `<button>`, so a piece physically cannot
travel between squares. Pieces move into a single transform-positioned layer keyed by piece id; the square
buttons remain as hit targets and the accessibility tree. This is the first UI task and it is a
prerequisite for *any* capture animation.

**Real HP changes one recon-visual detail.** `recon-visual.md`'s 0–3 counter pips were designed for the
binary-capture damage-counter track; with real HP a piece is instead ringed by a thin **HP arc** on the
bezel that depletes as it is wounded (a rook at 30 % reads as a liability from across the board, §1.1
consequence 5). The rotation-class status marks (pin rotates 90°) and the persistent-class rim pips
(poison/burn) are kept from `recon-visual.md` §2 unchanged.

### 16.3 The capture-outcome animations

The five verdicts of §4.3 plus BLOCKED are encoded by **form, direction, symmetry and death count — never
by hue** (`recon-visual.md` §4 measured the natural outcome hues at ΔE 11–19 from the nearest type colour,
two collapsing under protanopia). This is how `DIRECTION.md`'s "instantly distinguishable without reading
text" is met for colour-blind players too.

| Verdict | Form | Deaths | Attacker ends | Duration |
|---|---|---|---|---|
| **ADVANTAGE** (super-effective KO) | 8-ray gold star outward from the defender's square, then persistent gold state | 1 | on the square, gold-ringed | 700 ms, then persistent |
| **CAPTURE** (neutral KO) | a single slash inward along the attack vector; the survivor's HP arc visibly drops | 1 | on the square, wounded | 520 ms |
| **MUTUAL** (both die) | twin mirrored cracks flying apart; both pins shatter | **2** | gone | 760 ms |
| **ROUT** (attacker dies alone) | the attacker lunges, is thrown back and shatters; the defender stays, HP arc dropped | 1 (the attacker) | gone | 620 ms |
| **REPEL** (bounce / miss) | a hexagonal ward flash; the attacker slides back to its origin; both keep their damage | 0 | back on origin | 620 ms |
| **BLOCKED** (illegal) | a dashed grey ring, drawn **from the moment the piece is picked up** | 0 | never moved | static |

MUTUAL and ROUT are the two forms `recon-visual.md`'s four-outcome scheme did not separate, because it
predated the SPEC's split of "not very effective" into three real outcomes; they are distinguished by death
count (2 vs 1) and by whether the attacker's shards fly *apart* (MUTUAL) or are *thrown back* (ROUT), which
also matches the mechanical story — MUTUAL is a trade, ROUT is a failed assault. `DIRECTION.md`'s "mutual
destruction should visibly destroy both pieces" and "an illegal capture should read as a rejection, not as
nothing happening" are both satisfied by construction.

**The bonus move is persistent board state, not a flourish** — this is the single named `DIRECTION.md`
requirement that the free extra move must never be missed. A gold ring breathes around the piece that
earned it, the board frame turns gold, the stage dims 18 %, the HUD shows two turn chips, and **the pieces
eligible to take it (the baton rule, T2) are lit while every other piece is dimmed** (`recon-visual.md`
§4.1). A flourish can be missed; a board that stays visibly different until the bonus is spent cannot.

### 16.4 The coin-flip crit beat, and the reveal instruments

The three public instruments of §6 get three silhouettes, learnable in one game (`recon-visual.md` §5):

- **Momentum** is read at turn start as a value 85–100 in the rail; the rail flashes only when the reading
  changes a verdict on the board. It costs the reveal beat the animation layer needs and gives the turn a
  public character — *"Momentum 100, this is the turn to strike."*
- **Focus and Precision** stamp the target square as part of the verdict, before the click (§6.1), so a
  miss (REPEL) or a crit is never a surprise.
- **The crit is a coin beat, per the TCG.** A brass coin spins edge-on (`rotateY 0→1080°`, 300 ms); the
  crit window is drawn as *n* coins and a crit is *all heads* (§6.2). A critical hit does **not** get its
  own outcome animation — it plays the verdict it produced (usually rescuing a ROUT into a CAPTURE) with
  the star core recoloured to `--crit` and the coin result stamped as the cause. **Cause and consequence
  are orthogonal**: the coin/type chip says *why*, the outcome form says *what*. This is what lets the
  tutorial (§18.4) teach "a crit rescued you" as felt drama rather than a hidden reroll.

### 16.5 Effect vocabulary derived from the ISA — 58 assets for 1 797 entries

The compiler (§13) is also the VFX pipeline, because an effect already carries its Region, its dominant Op
and its type:

```
visual(effect) = REGION_GEOMETRY[effect.where]   // 16 spatial forms: melee lunge, ray beam, ring sweep, board wash…
               × OP_ANIMATION[dominantOp(effect)] // 20 verbs: MARK stamps, MEND drips, STRIKE chips, CHART chart-flips…
               × TYPE_SKIN[type]                  // 18 palettes + 18 glyphs, from typeColors.ts
               × INTENSITY[power]                 // 5 scales, from the base-power tier
```

**16 + 20 + 18 + ~4 noise/particle profiles ≈ 58 authored assets** cover every move, ability and item, and
there is **no per-move VFX table to fall out of date** — a move compiled from a dependency bump gets correct
effects automatically, the same dividend the compiler gives the tutorial and the AI. Type-coloured
particles come from the enamel hue; the eight particle primitives (spark, droplet, mote, shard, wisp,
petal, ring, dust) live in one 8×8 atlas, one `drawImage` each, no per-particle gradients. The marquee
cases `DIRECTION.md` names get literal treatments: hazards are inlaid decals sitting on their squares with
layer pips; status afflicts the pin (rotation, or rim pips); weather is a sky band above the stage,
terrain a floor glow under the squares (they are visually separable, which is why §9.4 runs both at once);
a trapped piece shows a chain arc; `CHART` marks (Tar Shot's smear, the grounded shackle) draw *across* the
bezel because their whole point is that they change what a *different* piece can do.

### 16.6 The motion system, and the guarantee that animation never gates play

Rendering follows `recon-tech.md`'s measured architecture: keep the 64-`<button>` DOM board and its aria
tree, put pieces in one transform layer (§16.2), add two Canvas2D effect layers (`fx-under` for
hazards/terrain, `fx-over` for explosions/weather). **Canvas is 17× cheaper per moving thing than DOM**
(*measured*: 10 000 particles at 0.84 ms/frame vs DOM's 5.38 ms at 4 000), and PixiJS is rejected on a
measured 231 KB gzipped bundle it does not earn. Sprites are **vendored same-origin at build time**, because
the Showdown CDN sends no `Access-Control-Allow-Origin` (*verified 8/8*), which would otherwise taint the
canvas and foreclose every pixel effect and offline play.

The engine/Presenter split is what makes animation non-blocking: the pure engine advances state
*instantly* and emits a serialisable `EffectEvent[]`; a Presenter lays those events on a fixed beat grid;
**nothing in the engine ever awaits a frame, and any input calls `settle()` first**, fast-forwarding the
board lane to completion. This is `DIRECTION.md`'s "animation must never gate play" as an architecture
rather than a promise, and it is the same event log that drives replays, spectating and the Why panel.

Beat grid (`recon-tech.md` §A.7.4 / `recon-visual.md` §7): a capture resolves in ≤ **700 ms** at Normal
speed (INTENT → MOVE → CLASH → VERDICT → AFTERMATH → GRANT); a three-sub-move chain is bounded at 700 + 420
+ 420 = **1 540 ms**, which is why T1 caps the turn at three (§7.3). Duration tokens run 90 ms (instant) to
900 ms (event) to 1 900 ms (promotion, the one cinematic). Speed control offers 0.5× / 1× / 2× / Off and a
Skip (Space); only `transform` and `opacity` animate on the board lane.

**Reduced-motion path**, honouring `prefers-reduced-motion` (`recon-visual.md` §7.3): it defaults to
*Essential*, not Off — piece travel is an instant cut, particles and breathing loops are removed, and each
outcome animation is replaced by its **static silhouette stamp held 1 200 ms** (which is precisely why the
six forms in §16.3 were designed to be distinguishable as stills: `✳` star, `╱` slash, `⤡⤢` twin cracks,
`⬡` ward, dashed ring). The persistent state — the gold bonus ring, the gold frame, the dim, hazard decals,
status marks, the HP arc — is *always* kept, because it is information rather than motion.

### 16.7 The numeric budgets

Every figure is measured, CI-gated (`budget.test.ts`, §21), and stated as a fail threshold:

| Budget | Target | Fail | Measured |
|---|---|---|---|
| Frame time p95 during any effect, mid device @60 Hz | ≤ 10 ms | 16 ms | 8.4 ms at the particle cap |
| Dropped frames during a capture | 0 | > 2 | 0 |
| Live canvas particles | ≤ 240 hard cap (`recon-visual.md` §7.4) | — | tech §A.3 allows a 1 200 design ceiling; the FX layer uses the stricter 240 and culls oldest |
| Persistent DOM nodes inside the board | ≤ 250 | 400 | ~129 |
| Concurrent composited CSS animations | ≤ 200 | 400 | — |
| JS heap after 100 moves with effects | ≤ 60 MB **and no growth** over moves 50→100 | 120 MB | — (pre-allocated struct-of-arrays particle pool; zero per-frame allocation) |
| FX asset bill (58 assets + noise tile + particle atlas) | — | — | ≈ 12 KB |
| Icon sheet (any of 1 025 species) | 1 request | — | 383 KB, offsets baked into `species.json` |
| Board fully painted (32 sprites) | ≤ 500 ms | 1 000 ms | ~105 ms |

**One asset constraint discovered by measurement** (`recon-data-substrate.md` §6, echoed by `DIRECTION.md`):
animated sprites exist for only part of the dex — **Miraidon and Pecharunt fall back to a static gen-5
PNG** — so animation quality comes from *the effects we draw*, never from assuming animated source art.
Animated GIFs are off by default; the 383 KB icon sheet plus the drawn FX layer are the visual floor every
species meets.

---

## 17. UX flow

This section is signposted so an implementer can build each screen without a second document: for each, what
it shows, what it does, and which engine or meta-game types it reads. The through-line is `DIRECTION.md`'s
"the game must be playable within seconds of loading, before any sign-up" — so the default path is Title →
Sandbox with no account, and everything account-shaped is reachable but never gating.

### 17.1 Title

A single stage-lit board behind four actions: **Play** (→ Sandbox or, if signed in, the ladder), **Learn**
(→ the tutorial, §18), **Collection** (→ progression, greyed until an account exists), **Settings**. A
returning player lands on their last context. First launch shows the one branching question of §18.2
("which would you rather skip?") before anything else. No modal, no forced sign-up; the account affordance
is a quiet "Sign in to save" chip in the corner.

### 17.2 Sandbox

`DIRECTION.md`'s "first-class environment, not a debug menu," and the default entry point. Full dex, no
progression, **no account**. It offers: free choice of both armies (Quick Draft or full slot-first draft,
§15.2), a side picker (play White, Black, or watch AI-vs-AI), an AI-strength slider (§19.5), a **seed
field** so a surprising game can be reproduced and shared, and a **position editor** for constructing a
specific board. The batch simulator (§15.8) is exposed here as a player-facing curiosity: run *N* AI-vs-AI
games and see the outcome distribution, game length and per-type win rates draw as charts. Because the
engine is seeded and serialisable, every sandbox game is a shareable `{formatId, seed, actions}` triple.

### 17.3 Draft

The slot-first loop of §15.2, the same screen for casual, ranked and Gym Leader (only the `pool` and
`budget` differ, and the screen never learns which). Left: the 16 slots filling in fixed order, each
showing its committed pick or a "choose" prompt, with the running budget and the 18-cell army Coverage
Strip. Centre: the five candidate cards for the current slot. Right: the opponent's army when it is public
(it always is, from move one), so drafting is a *read* against a known enemy. Quick Draft and presets are
one click; `Advanced` reveals full search and the whole move union. A "why is this greyed?" affordance
explains any validator refusal in place (missing immunity breaker, over budget, two Aces) — the same
in-place-explanation discipline `DIRECTION.md` §7 requires of the board.

### 17.4 The match, and the HUD

The board (§16) fills the centre. The HUD carries exactly what the rules create and nothing that lives in a
menu:

- **The Momentum rail** (left): this turn's 85–100 value, flashing only when it changes a verdict (§16.4).
- **The Prize track** (top): captured material per side, which is also the adjudication tiebreak (§12.4).
- **The turn chips** (top): one, or two when a bonus is unspent and breathing gold (§16.3).
- **The threat banner** (R8, §12.2): a persistent **"YOUR KING CAN BE TAKEN"** naming the attacker, the
  verdict, and the odds under each of the opponent's possible Momentum values. Mate-like positions are
  *labelled* ("your King cannot escape") but never terminal.
- **The Why panel** (right, collapsible): every resolution renders its `EffectEvent[]` as sentences — one
  source of truth for "why did that happen," which is the answer to `DIRECTION.md`'s legibility-under-load
  constraint. First-time hints (§18.5) surface here, once each.
- **The piece card** (hover/long-press): name, role, declared type, the ability and Kit-item glyphs with
  their real `shortDesc`, the four slots with type chips, and the resolved verdict for each reachable
  square when the piece is picked up (§10.4 — the affordance that teaches the chart).

Controls: pick-up highlights every reachable square with its verdict stamp; slot chips re-annotate
instantly; the ART menu opens on a piece with charged slots; Ace and Decline are explicit buttons.

### 17.5 Post-game

The result (WIN/LOSS/DRAW with the terminal reason: king capture, immobility, perpetual, adjudication), the
Prize track, a one-line story ("Machamp took three pieces in one turn on move 25"), and three actions:
**Rematch** (same format, new seed), **Replay** (§17.7), and — in progression — **Claim reward** (§17.8's
post-match Pokémon choice). A loss still offers a modest reward, because `DIRECTION.md`'s "challenging but
not too difficult" means losing must not stall progress.

### 17.6 Settings

Grouped: **Display** (animation speed 0.5×/1×/2×/Off, Effects Full/Essential/Off, reduced-motion honoured
by default, Notation mode that swaps sprites for `K Q R B N P`), **Gameplay** (Guarded mode on/off for
casual, confirm-captures, board orientation), **Audio**, **Account** (sign in, export/import, clear — with
an explicit statement of what clearing destroys, §17.11), **Accessibility** (colour-blind glyph emphasis,
larger HUD text). Simple settings (theme, default AI strength) are also reachable from the match's pause
menu.

### 17.7 Save, load, replay

Because a whole game is `{formatId, seed, actions: Action[]}` (§20.6), save/load/replay are nearly free.
A game auto-saves its action list; **Replay** re-runs it through the same engine at any speed, with a
scrubber, and can be forked into the position editor at any ply. Replays and shared seeds are the same
object, so "share this game" is a link. Reconnection to a live multiplayer game is replay-to-current-state
(§17.10). Local profiles persist on-device; the collection and settings export to a single JSON blob.

### 17.8 Progression screens: collection, Pokédex, badges

- **Collection.** A windowed grid of owned individuals (`DIRECTION.md` recommends owning *individuals*, not
  species, §15 / §20.1), each showing species, chosen type preference, ability, nickname, cosmetic and
  win/games record. Filter and sort by type, rarity, class eligibility. Selecting an individual shows its
  evolution line (`Dex.evolutionLineOf`) and its progress toward evolving through play. **Duplicates are
  useful**, because you own individuals — three Pikachu are three fieldable pieces.
- **Pokédex.** Every one of the 1 025 species as caught/uncaught, with the class-eligibility label from
  §3.2, rarity from real `tags`/`bst`/`tier` (`DIRECTION.md`: rarity is *grounded in data, not invented*),
  and the completion count. Completing it is the long-tail pursuit; Legendaries and Mythicals are gated by
  a pity counter so an unlucky streak cannot stall it forever.
- **Badge case.** The eight Kanto badges in canon order — **Boulder, Cascade, Thunder, Rainbow, Soul,
  Marsh, Volcano, Earth** — then the Elite Four tiers and Champion, displayed *cumulatively as earned*
  (`DIRECTION.md`). **"Highest badge earned" is stored separately from "current tier"**, so the ladder can
  be brutal without stripping a badge the player earned.

### 17.9 Gym Leader promotion matches

To promote past a badge tier the player defeats that Gym Leader — a named AI fielding a **mono-type army**
(Brock/Rock, Misty/Water, Lt. Surge/Electric, Erika/Grass, Koga/Poison, Sabrina/Psychic, Blaine/Fire,
Giovanni/Ground). This is `DIRECTION.md`'s strongly-recommended mechanic and it is *exactly* the right idea
here, because type is the core mechanic: a mono-type army has known weaknesses, and beating it is a
solvable type puzzle that teaches the chart by making the player use it. A mono-type army is measured at a
~100–150 Elo composition handicap (§19.6), so each Gym Leader gets a compensating search budget and a
hand-checked army the batch simulator verifies lands in a 45–55 % band before shipping. It is also, as
§13's Freeze-Dry trace shows, the one place a `CHART` move pays off hardest — one Freeze-Dry Ice piece is
the most satisfying possible answer to Misty's all-Water gym.

### 17.10 Multiplayer: friends, friendly games, matchmaking, ranked

In `DIRECTION.md`'s dependency order, all sitting above the pure-engine seam (§20.6):

- **Friends.** Add, accept, block, presence, invite-to-game.
- **Friendly games.** Direct challenge with agreed settings, no rating effect; the natural home for a
  specific format or a shared seed.
- **Matchmaking.** Queue against strangers with rating-based pairing and a widening window (target 30 s,
  widening 50 Glicko points every 10 s). **It pairs on rating *and* pool depth**, per `DIRECTION.md`'s
  explicit requirement: the ranked default is the **Mirror Pool** queue where depth is neutralised
  (§15.7), and collection-pool queues pair within a depth band so a new player is never fed to an
  800-Pokémon account. Below a healthy population the queue offers a Gym Leader match rather than making
  the player wait.
- **Ranked.** Glicko-2 internally, badges on top (§17.8). Turn timers: 60 s per turn plus a 3-minute
  reserve, with **bonus sub-moves drawing on a separate 20 s budget** so a three-capture turn cannot be
  lost to the clock; 60 s reconnect grace, then forfeit; abandonment in the first three turns is a
  no-rating cancel. Champion is a top-N leaderboard, not a rating threshold, so it stays scarce.
- **Chat** is a fixed quick-chat vocabulary in public matchmaking, free text only between mutual friends —
  `DIRECTION.md`-adjacent and `recon`-backed, because Pokémon's audience includes children and free text
  between strangers is a moderation liability. Reporting and blocking are first-class.

### 17.11 What the implementer must not forget

Two invariants that cut across every screen: **no core play is ever gated behind an account** (the profile
is local-first and binds to a server account later without a migration nightmare, §20.6), and **collection
state never reaches the match** (the `PoolSource` seam, §15.7). A screen that violates either — a sign-in
wall on the sandbox, a collection-power number on a piece card — is a bug against `DIRECTION.md`, not a
feature.

---

## 18. The tutorial

`DIRECTION.md` directive 7 makes an interactive tutorial a **shipped, required feature** and names it the
single most important thing for the game's survival, because "this game has three rulesets stacked on each
other — chess, the type chart, and the variant on top — and no player arrives knowing all three." It is
treated here as a design surface with the match's own standards: if the tutorial is dull, the game is dull,
because it is the first thing anyone plays.

### 18.1 Why the tutorial is cheap — a lesson is a seed, not a script

The naive way to guarantee a player *causes* a specific outcome is a scripting engine: a parallel cheating
code path that forces a die, suppresses a rule, and drifts out of sync with the real game within a month.
**This design needs no such thing, and the reason is three properties §1–§12 already gave it:**

| Property already in the design | What it buys the tutorial |
|---|---|
| the engine is **pure, deterministic and seeded** (`rng.ts`, shipped, with `RngState` serialisation) | a lesson is a **seed**. To make Momentum 100 come up, or a Focus crit, or a Precision miss, search for a seed whose reveal produces it. There is no forced-die path because there is nothing to force |
| the reveal instruments are **public and precede every decision** (§6) | the player *sees* Momentum, the crit coin and the accuracy stamp before choosing, so "a bad roll is information, not bad luck" is teachable at all — under a post-commitment die it is not |
| every resolution emits **`EffectEvent[]`** and the Why panel renders it as sentences (§17.4) | the explanatory text is generated from the same events the real game emits, so a lesson cannot describe an outcome the engine did not produce |

So a lesson is a row of data — a position (FEN plus a Pokémon overlay), a seed chosen so the intended
outcome is *reachable*, a machine-checkable goal, and beats keyed to `EffectEvent` types:

```ts
export interface Lesson {
  id: string; track: 'chess-player' | 'pokemon-player' | 'shared' | 'draft' | 'meta';
  position: string;                 // FEN + overlay: species, declaredType, ability, item, marks per piece
  seed: string;                     // chosen so the reveal makes the intended outcome REACHABLE
  goal: Goal;                       // the machine-checkable success condition
  allow?: ActionFilter;             // restrict the action list, e.g. only this piece, only captures
  beats: { on: EffectEvent['t'] | 'enter' | 'fail'; say: string; point?: Square[] }[];
}
export type Goal =
  | { kind:'causeVerdict'; verdict:'ADVANTAGE'|'CAPTURE'|'MUTUAL'|'ROUT'|'REPEL' }
  | { kind:'attemptBlocked' } | { kind:'spendBonus' } | { kind:'captureKing' }
  | { kind:'surviveMiss' } | { kind:'critRescue' } | { kind:'applyMark'; mark:MarkId };
```

`tutorial.test.ts` (§21.3) runs every lesson headlessly and asserts that its goal is achievable from the
position and seed, and that its beats reference only event types the engine emits on a successful run — so
**a lesson that has rotted after a rule change fails CI.** This is the same discipline as `coverage.test.ts`,
applied to onboarding, and it is what makes a tutorial survive a year of rule edits.

### 18.2 The two tracks, and the branch that is not remedial

The branch is a single first-launch question — **"Which of these would you rather skip?"** — with two
equal-weight cards, *"I know how chess pieces move"* and *"I know the Pokémon type chart,"* and both, or
neither, can be chosen. Framing it as *what you may skip* rather than *what you need taught* is the whole
trick (`DIRECTION.md`: "make neither branch feel remedial").

| Track | Teaches | Must never assume |
|---|---|---|
| **Pokémon player** (skips the chart) | how each of the six silhouettes moves, taught by the silhouette itself (the diamond moves diagonally, the stepped L *is* the knight's move); then that the goal is the enemy King; then five mate-in-one puzzles | any chess vocabulary — "develop", "file", "fork" never appear before they are shown |
| **Chess player** (skips the geometry) | the three heuristics every human half-knows — Water beats Fire, Fire beats Grass, **nothing hits Ghost with Normal** — then that the board *tells you the answer before you commit*, never a 324-cell table | that the player will read a chart; `DIRECTION.md` forbids trying to teach 324 interactions |
| **Shared** (nobody skips) | §18.3's four outcome lessons, §18.4's two reveal lessons, then hazards, status, the ART menu | — |

`DIRECTION.md`'s "do not attempt to teach 324 type interactions" is honoured structurally, not by restraint:
the tutorial teaches the player *where to look*, and §10.4's per-square verdict stamp is the thing they look
at. A player who never learns a single matchup still plays correctly, because every reachable square is
stamped with the outcome it would produce; the chart is then learned *inductively*, over games, from the
same gold star appearing every time Fighting meets Steel.

### 18.3 The four capture outcomes, each learned by causing it

`DIRECTION.md` requires the player to *personally cause* each of the four outcomes. Each is one `Lesson`
row; the seed is chosen so the reveal makes the intended verdict the outcome of the bounded exchange. Every
type fact is against `typechart.ts`.

| # | Outcome | Position and reveal | The beat, after it happens |
|---|---|---|---|
| 1 | **CAPTURE** (neutral) | your **Bidoof** *(Normal)* pawn takes a **Rattata** *(Normal)* pawn. Normal→Normal is 1×; the seed's Momentum is middling so the exchange is a clean one-blow capture | "Normal into Normal — neither type has an edge. An ordinary chess capture. Notice the single slash and that your pawn is now a little wounded: HP does not come back." |
| 2 | **ADVANTAGE, and spend the bonus** | **Machop** *(Fighting)* takes **Onix** *(Rock)*. Fighting→Rock is 2×, so a super-effective KO. Goal is `spendBonus`, so the lesson is not done until the bonus is used | "**WEAKNESS ×2** — you knocked it out and the board turned gold. You move again, but with a **different** piece: a bonus move must be made by a piece that has not acted this turn." |
| 3 | **ROUT — you attacked into a resistance and died** | your **Bellsprout** *(Grass)* is offered a **Skarmory** *(Steel)* rook, a rook for a pawn, and the square is stamped as a ROUT. Grass→Steel is 0.5×; the seed makes the assault fail | "Grass into Steel is **RESISTANCE**. You failed to knock it out, it hit you back, and *you* died — the board warned you with the shatter-back mark before you clicked. Never attack into a resistance… unless the trade is worth it." |
| 4 | **BLOCKED — the most important moment in the tutorial** | your **Gengar** *(Ghost)* bishop and an undefended **Bidoof** *(Normal)* pawn on its diagonal. Ghost→Normal is 0×; `allow` restricts the list so the player *tries* it. Goal is `attemptBlocked` — the lesson requires the refusal to fire | the square is drawn with a dashed grey ring **from the moment Gengar is picked up**, and the click is refused: "*Ghost cannot touch Normal. Not unlikely — impossible, in the games too. This is the one rule that feels like a bug the first time. Use a different piece, or a different move: Gengar's Sludge Bomb is Poison, and Poison into Normal is 1×.*" |

`DIRECTION.md` calls lesson 4 the most important single moment, because untouchability is the concept's most
surprising consequence and the one that otherwise reads as a bug. The directive then requires the same
explanation *permanently, outside the tutorial* — which §10.4 already delivers, because the dashed grey ring
and its one-line reason are properties of the board (R8/§16.3), not of the tutorial.

### 18.4 Teaching the reveal — variance as felt drama

`DIRECTION.md` requires the player to see a miss destroy a winning attack and a crit rescue a losing one, so
that variance registers as a designed mechanic rather than as the game cheating. Because Momentum, Focus and
Precision are public *before* the click (§6), both are teachable as drama:

- **"You were right and it still missed."** The player's **Machop** *(Fighting)* can take a Rock rook — a 2×
  matchup they were just taught to seek — but this turn's **Precision** stamp shows a REPEL: the move will
  miss. The square carries a bounce mark, not a gold star, and the lesson completes only when they find a
  *different* action. Beat: "*You read the chart correctly and the reveal still said no. That is exactly why
  the accuracy is on the table before you choose — a miss you can see is not bad luck, it is a plan.*"
- **"A crit rescued you."** The mirror: a neutral matchup that would ROUT (the defender is bulkier), but
  this turn's **Focus** coin shows *all heads* — a critical hit that ignores the defender's defensive stages
  and converts the ROUT into a CAPTURE. The `--crit` star plays and the coin is stamped as the cause. Beat:
  "*Four heads — a critical hit. It hit hard enough to take the piece you would otherwise have lost it to.
  A crit rescues; it does not hand you a free move.*"

The pairing converts variance from "the game cheated" into "the game told me and I planned around it," which
is `DIRECTION.md`'s exact requirement, and neither lesson is teachable under a post-commitment die.

### 18.5 First-time hints, and never nagging

Contextual first-time hints fire in real games, one per mechanic, each shown **once ever**, each anchored to
the thing that just happened, each dismissible permanently from its own body: the first MUTUAL, the first
bonus sub-move, the first hazard tick, the first status, the first ward pop, the first `CHART` rewrite, the
first promotion-evolution, the first Tera. They are the same `Lesson.beats` rows fired by the same
`EffectEvent` types, with `position`/`seed`/`goal` absent — **one authoring format, not two.** Completion is
tracked **per lesson**, so a returning player opens a Lessons list grouped by track, sees which are new since
they last played, and replays any single one. The whole tutorial is skippable from the first screen, and the
skip is remembered; nothing is ever gated behind it, because the sandbox is the account-free default entry
point (§17.2).

### 18.6 Practice mode and puzzles

Distinct from the sandbox: **no stakes, no free play, a stated goal**, and — crucially — generated *by the
batch simulator* (§15.8) rather than hand-authored, which is what makes a hundred of them affordable:

| Family | Prompt | Generated from |
|---|---|---|
| **Type puzzles** | "Win this in one move using a type advantage" | positions the simulator logged where exactly one action produces an ADVANTAGE or a King capture |
| **Refusal puzzles** | "Three captures are available and two will kill you. Find the third" | positions where ≥ 2 legal captures resolve to ROUT/MUTUAL under the revealed Momentum |
| **Chain puzzles** | "Take three pieces this turn" | positions with an `L = 3` chain available, which also teaches the baton rule by making it the obstacle |
| **Chart puzzles** | "Your Ice bishop cannot touch that Water rook. Take it anyway." | positions where the *only* winning action uses a `CHART` slot (Freeze-Dry, Tar Shot, Ring Target) — the only way to teach the chart layer |

The puzzle corpus is a by-product of the tool §15.8 already requires: one instrument, two uses.

### 18.7 Teaching the draft and the meta-game

`DIRECTION.md` §7.9 requires drafting to have its own teaching, and the collection and ladder to be taught
at first contact rather than at sign-up:

1. **"Why one type per piece is a decision."** The player is handed **Lapras** and asked to declare Water or
   Ice, with the Coverage Strip animating both futures. *(measured: 526 of 1 025 base formes are dual-typed,
   so 51 % of picks are a real choice.)* Choosing Ice shows Water as a *hatched* covered cell: "*Ice is the
   worst defensive type on the board — and Lapras learns Freeze-Dry, the one move that deletes the matchup
   that would punish it. Taken as Water you are safe; taken as Ice you are dangerous.*"
2. **"Read the matchup."** Shown the opponent's revealed army, the player picks the candidate that closes
   the largest gap in the Coverage Strip.
3. **"An army, not a pile of favourites."** The validator's requirements (§15.3) are taught as consequences:
   the player is *allowed* to build an army with no immunity breaker, shown the warning, then dropped into a
   rigged game against a Levitate Flying piece they cannot touch. One game teaches it permanently.
4. **Collection and ladder lessons fire at first contact:** the first post-match reward explains rarity from
   real `tags`; the first evolution explains that it transforms *your* individual (§17.8); the first Gym
   Leader match explains that a mono-type army is a solvable puzzle and shows the Coverage Strip against
   that type.

---

## 19. The AI opponent

`recon-tech.md` measured this problem against this exact ruleset's shape, and its architecture is taken
wholesale. The headline that governs everything below: **the reveal instruments of §6 are public at the
turn boundary, so the interior of a turn has no chance nodes at all** — which is the single most
consequential thing the randomness design does for the AI, worth a measured ~150× over full chance-node
enumeration.

### 19.1 Search architecture — alpha-beta, and a ply is a sub-move

Alpha-beta negamax with principal-variation search and quiescence, in a Web Worker. **A ply is a
sub-move**, not a turn: the node carries `(sideToMove, subsLeft, actedMask)`, does *not* negate the score
on a bonus sub-move (because the same side is still moving), scores a king capture as `29000 − subMoveCount`
(so a faster win is preferred), and counts progress and repetition in sub-moves to match §12.4. `recon-tech.md`
compared this against MCTS and expectiminimax and rejected both: MCTS because the branching factor is
chess-like (mean 30.9 legal actions, not Go's 250) and random rollouts are worthless under mutual
destruction; expectiminimax because there is nothing to average over inside a turn.

*(measured)* a variant searcher with the real chart, illegal captures, mutual destruction and bonus chains
runs at **7.1 M nodes/s in plain JS at EBF 3.8–4.2** — depth 8 in 148 ms, depth 9 in 601 ms. Move ordering
uses a precomputed **`staticClash(attackerType, defenderType, momentumBucket) → { pDie, pBonus, ΔHP }`**
table in place of SEE; critically, **losing captures are not pruned**, because taking a queen with a pawn
at 0.5× (both die) is often excellent in this variant. The exact verdict for a candidate comes from
`computeDamage` (§5.2) on the real pieces through the journal — the AI does *not* share the UI's forecast
cache (§5.3), because a cache shared across search nodes is a correctness hazard — while `staticClash` is
the cheap type-level oracle for ordering and quiescence pruning.

### 19.2 The one chance node, and how it collapses

Within a turn the search is fully deterministic, because this turn's Momentum, and each action's Focus and
Precision, are already drawn and public (§6.1). *(measured)* the cost of that input randomness over a
deterministic search is **+10 % at depth 6 and +0 % at depth 8**, against **121–159×** for full chance-node
enumeration and a measured *negative* result for Ballard star1 pruning (the branching is too small and the
per-capture swing too large for star1 to help).

The *only* chance node is at the ply boundary: the opponent's next turn will reveal a Momentum in 85–100,
which the searcher models as a 16-way node collapsed to **three representative values `{85, 93, 100}` with
weights `{¼, ½, ¼}` plus a static EV bias**. The bias is the load-bearing half — naive modal collapse
mis-valued a measured position badly — and it is computed as `Σ P(m)·eval(m) − eval(modal)`. Focus and
Precision at the boundary are collapsed to their expectation, because a rider coin can never remove a piece
and a boundary miss only reshapes which of the opponent's actions is best, not the one the AI has already
chosen. This is the §6.1 chance-node collapse referenced there.

### 19.3 The evaluation function

Tiered by cost and frequency (`recon-tech.md` §B.6.1):

- **Tier 0, every node, incremental, ~4 ns.** Type-aware material `Σ sign · V(piece)` using the §15.1
  valuation with the *live* board's type distribution; a piece-square term by class; a tempo term for the
  side to move; a **fractional-HP term** (a piece at 30 % HP is worth ~0.7 of itself *and* is a step from
  handing tempo to its attacker, so the term is larger than pure HP would suggest); a ward-intact term; a
  status term (slp/frz ≈ the piece worth ~0 for its duration, par ≈ −15 % of `m`, brn/psn as a countdown);
  and an **unspent-bonus term** (a live bonus sub-move ≈ 40 cp).
- **Tier 1, lazy inside a ±250 cp margin, ~470 ns.** Mobility (type-illegal captures count as 0 moves);
  super-effective *threats*; super-effective *vulnerability*, weighted **higher** than threats because "fear
  beats greed"; king-ring pressure × (1 − immunity fraction), with **no check term because king capture is
  terminal**; hazard pressure; bound-piece count. `recon-tech.md`'s one-line advice: if you implement a
  single non-chess term, implement super-effective vulnerability.
- **Tier 2, root only, once per search, ~50 µs.** Army-level type coverage, an immunity-shield term, and
  scarce-type ownership.

All weights are fitted by self-play (SPSA/Texel), never chosen by hand — the same discipline as the point
list (§15.1).

### 19.4 Engineering

- **Web Worker, no `SharedArrayBuffer`** (so no COOP/COEP headers, keeping static hosting). The worker
  loads only the type chart (0.33 KB), the packed move-effects (~21 KB) and the ability/item archetypes —
  never `species.json` or `learnsets.json`. A serialized position is a ~1 KB `ArrayBuffer`. A lint rule
  forbids anything under `src/ui/**` from importing the search, and the search never touches the main
  thread (0 ms block).
- **WASM is rejected.** *(measured)* 7.1 M nodes/s in JS; a realistic WASM win is 1.5–2.5×, which at EBF 4
  buys ~0.5 plies, against four cheaper wins already banked (input randomness ~4 plies, an epoch-split TT
  ~1 ply, lazy eval ~1.25 plies, LMR+futility ~1–2 plies).
- **The mutation path is `makeAction`/`unmakeAction` over the op journal (§20.3), not `apply`.** *(measured)*
  a deep clone of the state per node costs 20.8 µs (48 000 nodes/s) and a sparse clone 5.1 µs, against the
  journal's **53 ns (18.9 M nodes/s)** — so the immutable-only path would cap search ~148× below its own
  target, about four plies. The journal is one inverse per state-writing op, nesting inside `position.ts`'s
  existing `makeMove`/`unmakeMove` undo array, and it gets the Zobrist restore for free because `makeMove`
  already snapshots the whole key.
- **Zobrist keying of Pokémon state is factorised, never a product** (`recon-tech.md` §B.5): independent
  XORed tables for piece, **declared type (64×18 — the table a chess engine lacks)**, ward, status, marks,
  charges, and a bucketed HP field — **HP is bucketed to eighths before it enters the key** (matching the
  repetition hash of §12.4), because raw HP would make the transposition table useless. ~6 500 keys, 52 KB.
  The PRNG counter and Momentum are *never* mixed, which is what makes repetition reachable at all (§12.4).
- **Transposition table**: 2²⁰ × 16 B = 16 MB, `{key32, move16, score16, depth8, flags8}`. One-shot wards
  make capture legality state-dependent, which measurably costs ~1 ply (depth 9: 601 → 2 069 ms with the TT
  reduced to a move cache); paid for with an epoch-split probe key (the slow-moving state word of §5.3) and
  mandatory TT-move revalidation.
- **`CHART` costs the search one 7-entry lookup, not a table dimension.** `staticClash` is keyed on the
  effective defender type; a `CHART` op rewrites that reading before the exchange, so the searcher computes
  `effType = chartOf(slot, defender)` once per move-generation and indexes the same table. Its marks (Tar
  Shot, grounded) are already in the Zobrist key because every mark is.

### 19.5 Difficulty is a corrupted effectiveness table — the beginner misjudges *types*

This is the dial `DIRECTION.md` explicitly asks for ("an AI that misjudges *types* at lower difficulties"),
and it is thematically perfect because it makes the AI wrong in the exact way a new Pokémon player is wrong.
Difficulty is a **corrupted copy of the AI's own effectiveness table**: *(measured)* 5 % corruption scores
47 % against the full-strength AI, 15 % → 45 %, 30 % → 37 %, 50 % → 30 %, and **a fully type-blind AI still
scores 25 % because it still plays real chess.** The corruption is structured, not uniform — a beginner AI
knows the starter triangle but gets Steel's resistances and the eight immunities wrong, and **does not know
the chart layer at all** (the seven `CHART` entries are simply absent from its `chartOf`), so it walks its
Water rook next to a Freeze-Dry Lapras, which is the most human mistake in the game and costs one line of
config. Two further dials: army quality (a weaker draft, Really-Bad-Chess-style) and a contempt/risk knob
that changes how the AI values MUTUAL and ROUT trades.

### 19.6 Latency targets, and the Gym Leader handicap

| Level | Hard budget | Depth | Type-error rate | Est. strength |
|---|---|---|---|---|
| Rookie | 150 ms | 5–6 | 100 % (type-blind) | ~800 |
| Trainer | 300 ms | 6–7 | 50 % | ~1200 |
| Gym Leader (default) | 700 ms | 8–9 | 15 % | ~1500 |
| Elite Four | 1500 ms | 9 + root sampling | 0 % | ~1750 |
| Champion | 3000 ms | 9–10, larger TT | 0 % | ~1900+ |

Latency contract: soft budget 0.55× (do not start a new depth past it), hard budget 1.30× (abort mid-depth,
return the last completed), **350 ms think-time floor**, and a CI gate that Elite Four's p95 stays ≤ 1 200
ms over 200 stored positions. The Elo column is an estimate (~50–70 Elo/ply); the relative ordering is
measured, the absolute numbers are not.

**Gym Leaders need care.** *(measured)* a mono-type army scores **36 %** against a mixed army at equal
search — a ~100–150 Elo composition handicap — so each Gym Leader gets a compensating search budget and a
hand-checked army, and the batch simulator (§15.8) verifies each gate lands in a 45–55 % band before it
ships (§17.9). A Gym Leader is not made harder by a *less* corrupted chart; that would be off-theme. It is
made harder by more search and a better-tuned mono-type army, which is the fair, legible difficulty a type
puzzle deserves.

---

## 20. Engine contract

This is the exact public surface of the rules layer, written to be compatible with the shipped
`src/engine/position.ts` and `src/data/schema.ts` and to sit *above* them without modifying either. The
governing principle is `DIRECTION.md`'s purity requirement: nothing in `src/rules/` may touch `Date`,
`Math.random` or the DOM, an ESLint rule and a CI check enforce it, and a whole game therefore serialises to
a seed plus an action list (§20.6). Every signature below is syntactically valid TypeScript and consistent
with the shipped `Position`, `Move`, `Piece`, `RngState`, `BattleType`, and the board unions.

### 20.1 State

```ts
// src/rules/state.ts
import { Position } from '../engine/position.ts';
import type { Move, Piece } from '../engine/position.ts';
import type { PieceClass, Side, Square } from '../engine/board.ts';
import type { BattleType } from '../data/schema.ts';
import type { RngState } from '../engine/rng.ts';

export type MarkId    = number;   // index into the generated 165-row mark table
export type MoveId    = number;   // uint16 into moves.bin
export type SpeciesId = number;   // uint16 into species.bin
export type AbilityId = number;
export type ItemId    = number;   // 0 = none / consumed
export type PieceId   = number;   // Position's persistent id — survives moves and promotion

/** Sparse packed mark: (markId << 8) | durationOrLayers ; 0 = empty slot. */
export type PackedMark = number;

/**
 * Per-piece Pokémon state, keyed by Position's persistent piece id. Position itself stays
 * Pokémon-ignorant; this is the layer above it, exactly as `variant.ts` keys its `Loadout` off `id`.
 */
export interface PokePiece {
  readonly id: PieceId;
  species: SpeciesId;             // mutable: Mega, Stance Change, promotion-evolution (§11)
  declaredType: BattleType;       // THE central field — exactly one, defence-side (§3.5)
  ability: AbilityId;             // public
  item: ItemId;                   // public; 0 once consumed or destroyed
  slotMoves: Uint16Array;         // length 4; slot 0 is the Melee slot, the declared type (§8.1)
  slotCharges: Uint8Array;        // length 4; slot 0 is 255 = unlimited (§8.4)
  hp: number;                     // REAL HP (§3). Never below 0; a King is removed only by a Clash (R7)
  maxHp: number;                  // from maxHpOf(species) (§3.4) — Shedinja's is 1
  pristine: boolean;              // hp === maxHp && never yet marked — Sturdy / Focus Sash (§5 step 16)
  boosts: Int8Array;              // length 7 [atk,def,spa,spd,spe,acc,eva], each clamped ±6 (§9.3)
  marks: Uint16Array;             // length 8 PackedMarks — measured max simultaneous is 5
  flags: number;                  // WARD_INTACT | CHOICE_LOCKED | USED_ACE | ACTED | KO_PENDING
}

export interface PokeState {
  chess: Position;                // the shipped chess substrate — geometry, legality, castling, ep, hash
  pieces: PokePiece[];            // dense array indexed by PieceId; never a Map (§20.3)
  squareMarks: Uint16Array;       // 64 × 2 PackedMarks — hazards live here
  sideMarks: Uint16Array;         // 2 × 8 — screens, Tailwind, Safeguard, Perish
  boardMarks: Uint16Array;        // 4 — the one weather + one terrain + one room slot (§9.4)
  schedule: ScheduledEffect[];    // ≤ 1 per (side, kind); horizon provably ≤ 5 (§20.4)
  momentum: number;               // 85–100, PUBLIC, one per turn (§6.1). EXCLUDED from the repetition hash
  sub: 0 | 1 | 2;                 // bonus sub-moves already taken this turn (§7.3)
  actedThisTurn: number;          // bitmask over PieceId — the baton rule T2 (§7.3)
  exposedAtStart: Square[];       // attacker squares that could take the enemy King at turn start — R5 (§12.3)
  progress: number;               // sub-moves since the last progress event (§12.4)
  ace: [boolean, boolean];        // Tera-or-Burst budget per side (§11.1)
  prizes: [number, number];       // the material HUD and the ranked adjudication tiebreak (§12.4)
  epoch: number;                  // §5.3 — bumped on any slow-moving-state change; keys the forecast cache & TT
  rng: RngState;                  // the shipped 4-tuple; advances only on Momentum, rider coins, seeded picks
  journal: Journal;               // §20.3 — search only; empty on the immutable path
}

export interface ScheduledEffect { fireOn: number; side: Side; kind: string; then: Effect; }
```

Four decisions with a non-obvious rationale, stated so nobody removes them as redundant. **`pieces` is a
dense array, not a `Map`** — `PieceId` is already a small dense integer from `position.ts`, and the journal
indexes it directly. **`marks` are sparse-packed** — *(measured)* a dense 165-byte-per-scope encoding costs
18.9 KB per state; the packed form costs ~1.4 KB, which is what goes on the wire, into snapshots and into
the TT. **`hp` and `maxHp` replace the proposal's 0–3 damage-counter track** — this is the real-HP change
of §1, and `maxHp` is a named read (§3.4) because Shedinja's is 1. **There is no `charge` counter** — §10.5
cut the per-piece Charge counter, so ARTs are gated only by `slotCharges`.

### 20.2 The action space and the reducer

```ts
// src/rules/reducer.ts
export type Action =
  | { kind: 'move';    from: Square; to: Square; slot?: 0 | 1 | 2 | 3; promote?: PromotionChoice }
  | { kind: 'art';     from: Square; slot: 1 | 2 | 3; target: Square | 'self' }
  | { kind: 'ace';     piece: PieceId; mode: 'tera'; type: BattleType }
  | { kind: 'ace';     piece: PieceId; mode: 'burst' }
  | { kind: 'decline' };

export interface PromotionChoice { cls: 'queen'|'rook'|'bishop'|'knight'; species: SpeciesId; type: BattleType; }

/** The five verdicts of §4.3. A BLOCKED action is never generated, so it is not a Resolution value. */
export type Verdict = 'ADVANTAGE' | 'CAPTURE' | 'MUTUAL' | 'ROUT' | 'REPEL';

/** The public roll for one candidate action, §6.1. Pure: same state + action ⇒ same values. */
export interface ActionRoll { readonly momentum: number; readonly crit: boolean; readonly hits: boolean; }

/** The complete, pre-committed forecast the target square shows (§5.3). Not a probability — the answer. */
export interface Forecast {
  readonly verdict: Verdict | 'BLOCKED';
  readonly effectiveness: 0 | 0.25 | 0.5 | 1 | 2 | 4;
  readonly attackerHpAfter: number;   // for the HP arc; the wounded-survivor read of §1.1
  readonly defenderHpAfter: number;
  readonly blockedBy?: 'type' | 'ward' | 'legality';   // why, for the in-place refusal (§10.4, R8)
}

export interface Rules {
  /** Every legal action for the side to move, already filtered by CLASH_LEGAL and R3 (§4.2, §12.2). */
  generate(s: PokeState): Action[];

  /** Immutable. Server, replay, UI. Defined as clone-then-makeAction, so there is one resolution path. */
  apply(s: PokeState, a: Action): { next: PokeState; events: EffectEvent[] };

  /** Mutable. Search only. Pushes a journal frame, mutates in place, returns the events. */
  makeAction(s: PokeState, a: Action): EffectEvent[];
  /** Pops the last frame, replaying every entry backwards. Exact, O(writes). */
  unmakeAction(s: PokeState): void;

  /** The pre-revealed roll for one action — §6.1, `rngForkAt(s.rng, label)`, pure. */
  actionRoll(s: PokeState, a: Action): ActionRoll;
  /** The verdict stamped on a target square before commitment (§5.3, cached on epoch). */
  forecast(s: PokeState, a: Action): Forecast;

  terminal(s: PokeState): Terminal | null;

  /** The AI's ordering/quiescence oracle (§19.1). An 18×18×momentum-bucket table. */
  staticClash(attacker: BattleType, defender: BattleType, momentumBucket: number): ClashEstimate;
}

export interface ClashEstimate { readonly pDie: number; readonly pBonus: number; readonly dHp: number; }
```

Note what is **absent** relative to `proposal-systems-compiler.md`: there is **no `react` action.** §4.6
folds priority into the Clash and makes Counter/Mirror Coat a *mark* set on your own turn, because an
out-of-turn decision node breaks the "search is deterministic within a turn" property and the R5 safety
proof. An implementer must not reintroduce it.

`computeDamage`/`explainDamage` (§5.2) are the pure damage functions the reducer and forecast call;
`DamageInput` carries the attacker, defender, move, field and the drawn `ActionRoll`, and `explainDamage`
adds the ordered modifier trace for the Why panel. The lint rule forbidding `src/ai/**` from importing
`explainDamage` (§5.2) is part of this contract.

### 20.3 The journal — the AI's undo for free

Every state-writing op has a bounded inverse, because it writes a fixed number of fields with a known
previous value. That is what makes `makeAction`/`unmakeAction` possible and it is the difference between the
AI's measured 7.1 M nodes/s and a clone-based 48 000 (§19.4):

```ts
// src/rules/journal.ts — one 4-int entry per field written; flat, growable; position.ts's own pattern.
export interface Journal { buf: Int32Array; sp: number; frames: number[]; }
```

Three properties keep it safe: `apply` is *defined in terms of* `makeAction` (clone once, call `makeAction`,
never unmake), so the immutable and mutable paths cannot drift; the RNG needs no journal entry because
`RngState` is a 4-tuple copied whole; and the Zobrist key is journaled by `position.ts` for free, because
Pokémon words are mixed with `Position.xorHash(hi, lo)` and `makeMove`/`unmakeMove` already snapshot and
restore the whole key. `journal.test.ts` (§21.3) asserts byte-identical restoration over 10 000 random
actions and event-for-event agreement between `apply` and `makeAction`.

### 20.4 What stays, and what changes, in the shipped modules

| Module | Verdict |
|---|---|
| **`board.ts`** | **untouched.** `regions.ts` is written entirely in terms of its exports (`RAYS`, `KNIGHT_MOVES`, `KING_MOVES`, `BETWEEN`, `SLIDING_DIRECTIONS`, `PAWN_ATTACKS`, `reachableSquares`, `kingDistance`, `fileOf`, `squareAt`), exactly as §8.3 requires |
| **`position.ts`** | **untouched, and it is the chess substrate.** `generateMovesInto` supplies candidates that `legality.ts` filters through `CLASH_LEGAL`; `isAttacked`/`attackersOf`/`isAttackedIgnoring` are R5's and R3's exact primitives; the shipped `withPieceRemoved`, `withTurnReturned` and the `makeMove`/`unmakeMove` undo array are the pieces the variant layer already needed. `repetitionCount()` becomes Pokémon-aware for free once the words are mixed (§12.4), so the proposal's separate repetition accumulator is *deleted from the plan* |
| **`typechart.ts`** | **used as-is.** `chart.ts` (the `CHART` composition, §4.2 1b) sits above `effectiveness()` and never modifies it — the chart is immutable, a `CHART` op edits only one Clash's reading, which is what keeps `TYPE_PROFILES` valid as the draft's Coverage Strip source |
| **`rng.ts`** | **used as-is, plus one four-line pure helper** `rngForkAt(state, label): RngState` (§6.1), because the shipped `Rng.fork(label)` advances the parent stream and is therefore not a pure function of state. A named M0 deliverable |
| **`schema.ts`** | **gains** the `Effect`/`Op`/`Trigger`/`Region`/`MarkRow` types, a `coverageClass` output field (superseding `SignalClass` as the coverage authority, because `signalClass` reports Levitate as `fields`), a `maxHP` field (§3.4), and a `condition` field carrying `duration` (§13.3, currently absent) |
| **`dex.ts`** | **API unchanged**, with one measured change to `load()`: learnsets move off the critical path (worth 74 KB gz), fixing the 268 KB → 37.6 KB bundle problem §13/§21 gate |
| **`variant.ts`** | **superseded, migrated — §20.5** |

`epoch` (§20.1) is the slow-moving state word `recon-tech.md` prescribes and §5.3 already names: it bumps on
a type mutation, a Tera, a forme change, weather/terrain/hazard/screen change, an item consumed, a stat
stage, a status applied or cured, and any HP change — in practice once or twice per sub-move — so it keys
both the forecast cache (§5.3) and the transposition table's probe (§19.4).

### 20.5 The `variant.ts` migration — checkmate to king capture, precisely

The shipped `src/engine/variant.ts` is a **playable** provisional Pokémon Chess, and its header says its
decisions "await the full specification." Most of it is right and is kept: `Loadout` keyed by persistent
piece id, one declared type per piece, type-illegal captures never generated, an explicit `VariantRules`
config, `maxExtraMovesPerTurn: 2` (T1), the extra-move stall guard, the immutable `play()` with search
intended to use the mutable `Position` path, and `ResolvedMove`/`outcomes.ts` carrying the roll, the
multiplier, the cause and the removed ids. **The SPEC's §12 changes five provisional decisions, and the
first is not cosmetic — it fixes a concrete defect:**

| # | `variant.ts` today | This spec | Why it must change |
|---|---|---|---|
| 1 | **Checkmate is the win condition** (`result()` returns `{kind:'checkmate'}` via `position.isInCheck()`); capturing a king is filtered out of `legalMoves()` | **King capture** (R1, §12.2); checkmate becomes a UI *label* | `isInCheck()` lives in the deliberately Pokémon-ignorant `position.ts` and is **type-blind**: the shipped game declares checkmate when the only "mating" attacker is a Normal piece aimed at a Ghost king — an *illegal* capture — and misses that a 0.5× "mating" piece dies if it tries. Making `isInCheck` type-aware does not fix it, because success depends on the opponent's future Momentum, not yet drawn (§12.1) |
| 2 | the die is rolled **inside `play()`, after commitment**; `legalMoves()` may not depend on it | **Momentum/Focus/Precision are public at turn start** (§6.1) | the shipped doc comment's own objection — a roll deciding a game "reads as unfair" — is correct, and pre-revealing is the answer; it also buys the ~150× AI saving (§19.2) and is what makes changes 1 and 3 decidable |
| 3 | `captureIsSafe()` forbids any capture that **could** leave your king attacked under mutual destruction | **R2/R3**: leaving your king capturable is legal; only a resolution that *necessarily* removes your own king is illegal | with a hidden die "could" is the only computable quantifier, so the shipped rule is right *given* a hidden die; once the roll is public, "necessarily" is exactly decidable, so the rule tightens to Atomic's real formulation with strictly less collateral (§12.2 R3) |
| 4 | the extra move **must be played by the capturing piece** | **T2, the baton rule**: a bonus sub-move is played by a piece that has **not** yet acted this turn (§7.3) | the shipped rule is the "one super-typed piece mows the board" degeneracy; the baton rule makes a chain a team combo, which reads far better and bounds the tail (§23 shows the difference) |
| 5 | the extra move is **mandatory** | `{kind:'decline'}` is a real action (§7.3, §20.2) | a mandatory extra move is an undesigned zugzwang players report as a bug, and the AI needs the branch to evaluate chains honestly |

Two changes are additive, not corrections: `Resolution` grows from the shipped four values to the **five
verdicts plus BLOCKED** (§4.3), so `outcomes.ts`'s `OUTCOME_PRESENTATION` must be re-keyed from
`CaptureOutcome` to `Verdict` (it already declares "never colour alone", so its structure survives); and
`GameResult` grows the terminal set of §20.1's `Terminal`.

**Migration shape, and it is small.** `variant.ts` becomes the **`classic` rules profile** of `src/rules/`:
its four-outcome, checkmate-based resolver is the special case `profiles.classic` selects (dice off, ladder
off), which keeps the currently playable game working *throughout* the migration and keeps its
`variant.test.ts` and any `classic-vs-chessjs.test.ts` meaningful. `PokemonChess` is reshaped into the six
`Rules` methods with its current bodies as the first `standard`-profile implementation. **So M1 (§22) is not
"build the rules layer" but "evolve the shipped one"**, which is why its estimate is credible and why the
game is playable at every commit.

### 20.6 The replay serialisation format

> **A whole game is `{ formatId: string; seed: string; actions: Action[] }`.** Nothing else is needed,
> because the engine is pure and seeded.

```ts
export interface GameRecord {
  formatId: string;                 // resolves to the Format (§15.6): pool, budget, kit, bans, rules
  seed: string;                     // the FNV-hashed seed of rng.ts; the server owns it in multiplayer
  armies?: [Army, Army];            // omitted when the draft is itself seeded and reproducible from formatId+seed
  actions: Action[];                // the ordered action list; a sub-move is one entry
}
```

This is `DIRECTION.md`'s load-bearing network property discharged: the same `src/rules/` module runs in
Node and the browser, so the server validates every action with the identical code the client runs; a
replay is a re-run; spectating is a live re-run; **reconnect is replay-to-current-state**; and desync is a
state-hash comparison (the wire carries the client's hash on every `act` and the server's on every
`applied`, §17.10). The **server owns the seed and the Momentum draw** — with public dice that is the only
thing worth cheating on, and it is exactly one value per turn. The local-first profile (§17.11) stores its
own games as `GameRecord`s and binds to a server account later without migration, because a `GameRecord` is
account-independent. Any impurity in `src/rules/` forfeits all of this at once, which is why the ESLint ban
on `Date`/`Math.random`/DOM access is a CI gate, not a guideline.

---

## 21. Budgets and tests

Every budget below is a measured number with a fail threshold, and every claim in this document that could
rot is a test. This is `DIRECTION.md`'s "coverage is total, and it is testable" and "performance is part of
looking good" made into CI, so a regression is a red build rather than a discovered defect.

### 21.1 Performance budgets

| Budget | Target | Fail | Measured / basis |
|---|---|---|---|
| **Critical-path data, gzip** | ≤ 60 KB | 80 KB | 37.6 KB at M1, ≈52 KB with all content — *the shipped bundle is 268 KB because `Dex.load()` eagerly awaits all five bundles including 74 KB of learnsets; the fix is four one-line `dex.ts` changes plus a columnar species emit* |
| **Entry chunk (JS), gzip** | ≤ 110 KB | 130 KB | 65.2 KB (59.3 KB of it React; `preact/compat` reclaims 52 KB if ever needed) |
| **CSS, gzip** | ≤ 12 KB | 20 KB | 0.5 KB |
| **Total bytes to first playable** | ≤ 250 KB | 300 KB | ~192 KB |
| **FCP (localhost)** | ≤ 300 ms | 600 ms | 76 ms |
| **TTI, Slow-4G + 4× CPU** | ≤ 1.5 s | 3.0 s | modelled, not yet measured |
| **Frame time p95 during any effect, mid device @60 Hz** | ≤ 10 ms | 16 ms | 8.4 ms at the particle cap; 6.2× headroom on the worst capture frame |
| **Dropped frames during a capture** | 0 | > 2 | 0 |
| **JS heap after 100 moves with effects** | ≤ 60 MB **and no growth** over moves 50→100 | 120 MB | pre-allocated struct-of-arrays particle pool; zero per-frame allocation |
| **Live canvas particles** | ≤ 240 | — | culls oldest; the FX layer uses `recon-visual.md`'s stricter cap over `recon-tech.md`'s 1 200 ceiling |
| **Board DOM nodes** | ≤ 250 | 400 | ~129 |
| **Move-gen, one legal sub-move set** | ≤ 5 µs | 20 µs | **0.194 µs** — 8.5 M legal-nodes/s |
| **Full clash forecast (17-step pipeline)** | — | — | **~136 ns** projected, against ~4 ns for a bare chart lookup (§5.3) |
| **Search throughput** | — | — | **7.1 M nodes/s** plain JS, EBF 3.8–4.2; depth 8 @148 ms, depth 9 @601 ms |
| **Journal make/unmake per node** | — | — | **53 ns** (18.9 M nodes/s), versus 20.8 µs for a deep clone (§19.4) |
| **Batch-sim throughput** | ≥ 20 games/s per worker at 2 000 nodes/move | — | 25.9; 10 000 games ≈ 6.4 min single-threaded, ≈1 min on 8 workers |

### 21.2 AI think-time budgets, per difficulty

From §19.6, restated as the latency contract CI enforces: soft budget 0.55× the difficulty's hard budget
(do not start a new depth past it), hard budget 1.30× (abort mid-depth, return the last completed depth),
a **350 ms think-time floor** at every level, and **0 ms main-thread block** (the search is in a Worker).
The gate: Rookie 150 ms, Trainer 300 ms, Gym Leader 700 ms, Elite Four 1 500 ms, Champion 3 000 ms hard
budgets, and **Elite Four's p95 must stay ≤ 1 200 ms over 200 stored positions** (`ai-regression.test.ts`).

### 21.3 The test surface

The single most valuable test is the coverage audit, because it turns `DIRECTION.md`'s coverage requirement
from prose into a build gate:

| Test | What it protects |
|---|---|
| **`coverage.test.ts`** | the whole content claim, all **1 797 entries, on every build.** For each entry it asserts totality (a non-empty `Effect[]`), that its `coverageClass ∈ {C1,C2,C3,C4,curated,inert}`, that an `inert` entry is on the named 68-entry allowlist, that a flags-only entry (Levitate) is curated rather than claiming derivability, that every op is a real op, that `INVOKE.depth === 1`, that no op is `SUMMON`, and that every damaging move contains a `CLASH`. It also asserts the eight gates of §13.5 — derived share ≥ 88 %, curated ≤ 140, unclassified sites ≤ 1 %, ≤ 81 stems / 45 verbs / 14 return rows, and — **gate 8** — that the five-way handler partition sums to 1 675. **This is the `signalClass`/`coverageClass` audit `DIRECTION.md` §"coverage is total" requires**, and it walks the entire content set rather than asserting in prose |
| **`perft` (exists)** | standard chess is correct: `perft(1..5)` exact, `perft(5) = 4 865 351` — already validated on the shipped `position.ts` |
| **`classic-vs-chessjs.test.ts`** | the **differential test against a known engine**: under `profiles.classic` the variant reduces to chess exactly, so perft to depth 5 from 20 positions must equal `chess.js` — a second independent oracle beyond the built-in perft |
| **`clash.table.test.ts`** | the resolver against a hand-written expectation table: all 324 ordered type pairs × representative Momentum × Focus/Precision states, including the regression cases — a wounded defender is easier to capture, a `def −2` defender is easier, a King is capturable at what would be 0× (R6), Sturdy/Focus Sash clamp to 1 and the exchange continues (not an outcome rewrite), and the seven `selfdestruct` moves are the only ranged removals |
| **`chart.test.ts`** | all seven `CHART` entries: Freeze-Dry makes Ice→Water read 2× and *only* Water; Flying Press composes to 2× vs Grass, 1× vs Steel, **0× vs Ghost**; `CHART{d}` never crosses 0×; `CHART{set:1}` yields exactly neutral; two stacked `CHART`s clamp at 4×; a `CHART` cannot re-immunise a King (R6 after step 1b) |
| **`journal.test.ts`** | `unmakeAction(makeAction(s,a))` restores a byte-identical serialisation for 10 000 random actions from 200 positions, and `apply` agrees with `makeAction` event-for-event |
| **`dispatch.test.ts`** | a state serialised, reloaded and re-run emits a byte-identical `EffectEvent[]` — the desync and determinism guard |
| **`termination.test.ts`** | no turn exceeds 3 sub-moves; no action sequence increases total piece count; `INVOKE.depth` is always 1 (the §12.5 proof, enforced) |
| **`progress.test.ts`** | the Leftovers-vs-poison loop, the Harvest+Leppa charge loop and the hazard lay-clear-relay loop all reach the no-progress draw (§12.4) |
| **`repetition.test.ts`** | two positions differing only in HP octile, marks or charges hash differently; identical positions with different RNG counters and Momentum hash the same |
| **`exposure.test.ts`** | R5 by search: from 200 random positions, no King is ever captured from an attacking square absent from `exposedAtStart` (§12.3) |
| **`legality.r3.test.ts`** | every action that necessarily removes your own King under the revealed roll is absent from `generate()` |
| **`immunity.test.ts` / `stats.test.ts`** | the 13-row type-based status-immunity table against the bundle (§9.2); `maxHpOf(shedinja) === 1` and `maxHpOf(blissey) === 362` by name (§3.4) |
| **`tutorial.test.ts`** | every `Lesson` goal is achievable from its position and seed, and every beat references an event the engine emits — **a rotted lesson fails CI** (§18.1) |
| **`budget.test.ts`** | critical-path gzip ≤ 60 KB, entry chunk ≤ 110 KB, learnsets absent from the initial load, no `@pkmn/*` in the client bundle, and the frame/heap gates of §21.1 |
| **the batch-simulator harness (`src/sim/`)** | not a pass/fail test but the tuning instrument (§15.8): it runs thousands of AI-vs-AI games and reports the outcome distribution, game length, capture-outcome frequencies (MUTUAL 8–15 %), per-type win rate, first-player advantage and draw causes, and it doubles as the puzzle generator (§18.6). It must terminate, which is why the 300-turn hard cap (§12.4) is not behind a flag |

The batch simulator is where the numbers in §15 stop being starting values: it is `DIRECTION.md`'s required
"headless batch simulation that *tests* the balance claims," and it is the reason this spec states targets
as numbers a script can check rather than as adjectives.

---

## 22. Milestones

`DIRECTION.md`'s "'very functional' means shipped, not sketched" is the constraint that shapes this plan:
**each milestone is complete and playable, never a half-wired system.** The starting point is not zero — the
repository already ships a playable hot-seat board with the deterministic four-outcome capture and the
coin-flip crit (`variant.ts`, `GameBoard.tsx`, `autodraft.ts`, `outcomes.ts`) — so the early milestones
*evolve* what exists rather than replacing it, which is why the game is playable at every commit and why the
process runs in incremental checkpoints as `DIRECTION.md` §"process preference" asks.

| # | Ship | Contents | Depends on | Playable end state |
|---|---|---|---|---|
| **M0** | **The compiler, headless** | `tools/compile/` passes 1–5 (§13.3), the ~245 table rows, `build/compile-report.json`, `coverage.test.ts` green over all 1 797 entries with gate 8 enforced, `condition.duration` and `maxHP` emitted, the columnar species bundle, and `budget.test.ts` green at 37.6 KB. `rngForkAt` added. | — | no game yet — but the content claim is **proved** before any rule depends on it, and the 268 KB bundle is fixed before it is inherited |
| **M1** | **Playable hot-seat Pokémon Chess** — *by evolving `variant.ts`* (§20.5) | `src/rules/` complete for the **Melee slot only**: the bounded exchange (§4), real HP and the damage pipeline (§5), Momentum/Focus/Precision public at turn start (§6), the turn loop with the baton rule and Decline (§7), the Checkup (§9.5), king capture R1–R9 (§12), draws and the progress clock (§12.4), promotion-evolution (§11.2), **and the journal from day one** (§20.3) because retrofitting it means writing every op twice. Silhouette pieces (§16.2), the six outcome animations, the per-square verdict affordance, the Why panel. `variant.ts` is the `classic` profile throughout. | M0 | **a complete game a stranger can play, 15 days in** — full chess + the chart + real-HP attrition + king capture, hot-seat |
| **M2** | **The AI** | worker search over `makeAction`/`unmakeAction`, `staticClash`, tiered eval, the five difficulty tiers by corrupted chart (§19), `ai-regression.test.ts`, the boundary chance-node collapse (§19.2). | M1 | single-player vs a bot that misjudges types at low difficulty |
| **M2b** | **The tutorial and practice mode** | `src/tutor/`, the two tracks, the four outcome lessons, the two reveal lessons, first-time hints, per-lesson completion, `tutorial.test.ts`. **Ships before moves/abilities/items**, because the M1 ruleset is already the hardest thing to teach and a tutorial written against a stable rule set is not rewritten twice. | M2 | onboarding that teaches all three stacked rulesets by playing them (DIRECTION §7) |
| **M3** | **Moves, including the chart layer** | ART actions, all 16 regions, slot charges, riders (coins), hazards, status, the 14 triggers, **`CHART` and §4.2 step 1b**, FX derived from the ISA (§16.5). The 950-move layer arrives *as data*; this milestone is mostly region geometry and UI. Each new mechanic adds one hint row and one lesson row. | M2b | the full move layer; ranged softeners, status, hazards, weather, the chart-rewrite moves |
| **M4** | **Abilities and items** | trigger dispatch for the remaining hooks, the Standard 12 Kit (§10.4), the ward layer (§10.3), the draft's ability radio. Again mostly data — the ops exist. | M3 | 311 abilities and the Kit item layer live |
| **M5** | **Draft and formats** | slot-first draft (§15.2), point-buy (§15.4), the validator (§15.3), presets, the Coverage Strip, and the `PoolSource` seam (§15.7) with its lint rule. | M4 | drafted armies against the bot, full-dex |
| **M6** | **Sandbox and the batch simulator** | AI-vs-AI, seeds, the position editor, the §15.8 metric set, then **retune** σ (via the Momentum range), the extra-move rules, `isBulwark`, and the point list from measurements; emit the four puzzle families (§18.6) as a by-product. | M5 | the balance-testing environment DIRECTION §"sandbox" requires; the balance claims become tested rather than asserted |
| **M7** | **Tera, Burst, Mega, evolution-promotion art** | the remaining `BECOME` payloads (§11) and their art. | M4, M5 | the transformation layer complete |
| **M8** | **Collection and progression** | local-first profile, ownership of **individuals** (§20.1), starter grant, post-match rewards (3 on a win, 1 on a loss), evolution-through-play, the Pokédex and badge case (§17.8), rarity from real data. | M5, M7 | the meta-game DIRECTION §4 requires, single-device |
| **M9** | **Server, multiplayer, and the ranked ladder** | authoritative server validating with the identical `src/rules/` module (§20.6), friends, friendly games, matchmaking on rating and pool depth, the Mirror Pool queue, Glicko-2 with the Kanto badge ladder, Gym Leader promotion matches (§17.9), reconnection and forfeit policy. | M8 | **the first ranked-ladder release** — the target of this plan |

Four arguments are built into the order:

- **M0 before M1.** If the compiler cannot reach total coverage, that must be known before a ruleset is
  built on the assumption that it can. M0 ships no game and is still the most valuable days in the plan; it
  also retires the 268 KB bundle problem before it is inherited.
- **The journal ships in M1, not M2.** `makeAction`/`unmakeAction` is one inverse per op, so writing the
  twenty ops without their inverses means writing them twice.
- **M1 is a complete game without moves, abilities or items.** The Melee slot means ordinary chess plus the
  chart plus real-HP attrition is already the game — five verdicts, king capture, draws, promotion, the
  verdict affordance, the Why panel — and it is the point where the shipped `variant.ts` becomes the
  `classic` profile and the new ruleset lands beside it, so nothing is ever un-playable during the
  migration.
- **M2b before M3.** Teaching comes before content. Building all 950 moves and *then* working out how to
  explain them is how a maximalist game becomes unplayable; writing the tutorial against the M1 rule set
  forces that rule set to be teachable, and every milestone after it pays a one-lesson, one-hint tax.

The dependency spine is M0 → M1 → M2 → M2b, then M3/M4/M5 in sequence with M7 branching off M4/M5, then
M8 → M9. Nothing after M1 fills in a skeleton: M3 and M4 are largely *data arriving* rather than systems
being invented, which is the dividend of building the content substrate (§13) first.

---

## 23. A worked game

Format: Standard, `full-dex`, the Standard 12 Kit. Hot-seat. Every type value below is against
`typechart.ts`; the chess is plausible rather than engine-validated, because the point of this section is
the *feel* — how Momentum changes a turn's character, how real HP leaves a board of wounded pieces, how the
baton rule turns a chain into a team play, and how one draft decision made twenty-five moves earlier decides
the game.

**White (Bone army).** K **Slowking** *(Psychic)* e1 · Q **Nidoqueen** *(Ground)* d1 · R **Steelix**
*(Steel)* a1, **Forretress** *(Steel)* h1 · B **Alakazam** *(Psychic)* c1, **Gengar** *(Ghost)* f1 ·
N **Rapidash** *(Fire)* b1, **Garchomp** *(Dragon)* g1 · pawns a2–h2: Bidoof *(Normal)*, Zubat
*(Flying)*, Sandshrew *(Ground)*, Roselia *(Grass)*, **Machop** *(Fighting)*, Magnemite *(Steel)*, Pikachu
*(Electric)*, **Lapras — declared *Ice*, slots `Ice Shard | Freeze-Dry | Sparkling Aria | Life Dew`**.
Machop holds **Expert Belt**; Gengar holds **Focus Sash**; Forretress holds **Heavy-Duty Boots**.

**Black (Ink army).** K **Tyranitar** *(Rock)* e8 · Q **Gardevoir** *(declared Psychic — the decision this
game turns on)* d8 · R **Onix** *(Rock)* a8, **Skarmory** *(Steel, Sturdy)* h8 · B **Chandelure** *(Ghost)*
c8, **Starmie** *(Water)* f8 · N **Zebstrika** *(Electric)* b8, **Mudsdale** *(Ground)* g8 · pawns a7–h7:
Rattata *(Normal)*, Ekans *(Poison)*, Cubone *(Ground)*, **Bellsprout** *(Grass)*, Charmander *(Fire)*,
Gastly *(Ghost)*, **Wooper *(Water)***, Snorunt *(Ice)*.

The draft asymmetry the game turns on: Black declared **two Water pieces** (Starmie, Wooper) and could have
made Snorunt a third; White has **one Ice piece with Freeze-Dry**. Both armies are public from move one, so
this is a read Black could have made and did not.

### Turns 1–6

**Turn 1. White, Momentum 91.** A strong-ish turn, but nothing to strike. **e2–e4**, Machop *(Fighting)* to
the centre. **Black, Momentum 87.** **e7–e5**, Charmander *(Fire)* contests it. Fighting→Fire is 1×, so
neither pawn wants to be the one to strike — a neutral capture is a coin-flip on bulk, and neither is bulky.

**Turn 2. White, Momentum 96.** Develop toward a target: **Ng1–f3**, Garchomp *(Dragon)* eyes e5. **Black,
Momentum 84 — the worst kind of turn.** At Momentum 84 every capture on the board resolves a hair weaker,
so Black develops rather than trades: **Nb8–c6**, Zebstrika *(Electric)* defends e5. The Momentum rail is
already teaching the tempo of the game: 84 is a turn to build, 96 is a turn to strike.

**Turn 3. White, Momentum 88.** A middling turn is a support turn. **Forretress (h1) uses Stealth Rock** —
an ART: it does not move, it spends 1 of its charges, and the `FOE_ZONE` region paints the enemy's third
rank on the caster's file ±1, so **g6 and h6 are now under Stealth Rock.** Two details pay off later: the
rook did not move, so **White keeps its castling rights**, and Forretress holds Heavy-Duty Boots, so Black's
hazards will not touch it in return. **Black, Momentum 93.** **d7–d5**, Bellsprout *(Grass)* to d5, opening
the d-file — which White notices.

**Turn 4. White, Momentum 100 — the most violent turn the game offers.**
- **Sub-move 1: e4xd5.** Machop *(Fighting)* captures Bellsprout *(Grass)*. Fighting→Grass is 1×, neutral,
  but at Momentum 100 against a frail pawn the bounded exchange is a clean one-blow **CAPTURE**: Bellsprout
  is removed, Machop takes d5 at **74 % HP**. Neutral, so **no bonus.**
- **Black, Momentum 85.** Black wants the d5 pawn back — Qd8xd5 is Psychic→Fighting, **2×** — but at
  Momentum 85 the forecast still shows a clean **ADVANTAGE** for the queen (2× against a wounded pawn), and
  taking a pawn with the queen to earn one bonus move is a real temptation. Black takes it: **Qd8xd5**,
  Gardevoir super-effective, the board turns gold, **and the baton passes** — the bonus must go to a piece
  that has not acted. Black plays **Bc8–e6** (Chandelure, Ghost) with the bonus, developing. The queen is
  now exposed in the centre, which White notices harder than Black did.

**Turn 5. White, Momentum 90.** **Nf3xe5** — Garchomp *(Dragon)* captures Charmander *(Fire)*, defended by
Zebstrika on c6. Dragon→Fire is 1×; at Momentum 90 it is a **CAPTURE**, Garchomp landing at **69 % HP**, and
**Nc6xe5** recaptures next: Electric→Dragon is 1× (Zebstrika neutral into a wounded Garchomp). But look at
the forecast Black's board draws for that recapture: Garchomp is *wounded* to 69 %, so the exchange favours
the attacker — **CAPTURE**, Zebstrika takes e5 and Garchomp is gone. This is the attrition texture real HP
buys: the second capture in a spot is cheaper than the first, because the first left a wounded piece
behind. **Black, Momentum 95.** **Nc6xe5**, as forecast. Material is level; the board is a scatter of
half-health pieces.

**Turn 6. White, Momentum 100 again.**
- **Sub-move 1: Bf1xd5** — no: d5 is Black's queen, and Gengar *(Ghost)* into Gardevoir *(Psychic)* is
  **2×**. **Bf1–b5** first would be a quiet develop; instead White strikes: **Bf1–b5** is skipped for the
  kill — Gengar has a clear diagonal f1–b5? No; the diagonal to d5 runs f1–e2–d3–c4–b5, not through d5.
  White instead plays **Qd1xd5**: Nidoqueen *(Ground)* into Gardevoir *(Psychic)*, Ground→Psychic is 1×, at
  Momentum 100 a clean **CAPTURE** of the queen — a queen for a queen after Black over-extended. No bonus
  (neutral). Black is down its queen's activity and White's Ground queen sits on d5, wounded to 71 %.
- **Black, Momentum 86.** Black steadies: **g7–g6**, Wooper *(Water)* to g6 — **and g6 is under Stealth
  Rock.** The hazard's `ON_ENTER` fires: Rock→Water is 1×, so Wooper takes `1/32·2^0 = 3.1 %` — a nick, one
  notch off its HP arc. Had that pawn been Snorunt *(Ice)*, Rock→Ice is 2× and it would have taken 12.5 %.
  The hazard is a slow tax that reads its victim's type, exactly as in the games.

Six turns in, the board is what real HP makes it and binary capture cannot: not a clean material count but a
field of wounded pieces where every square carries a different verdict depending on who is hurt and what
Momentum the turn rolled. A chess player reads the geometry; a Pokémon player reads the HP arcs and the type
chips; the game rewards both.

### The mid-game exchange this design exists for

Move 25. White has walked **Lapras — declared Ice, Freeze-Dry in slot 1 — up to e5**, and pushed **Machop**
to the seventh rank, where it promoted into **Machamp** *(Fighting, Expert Belt)* on b8. Black's queen is
long gone; its surviving force is King **Tyranitar** *(Rock)* g8, Rook **Skarmory** *(Steel, Sturdy)* c5,
Knight **Gogoat** *(Grass)* d4, Bishop **Chandelure** *(Ghost)* b7, a Rook on f8, and pawns including
**Snorunt *(Ice)*** on e6 and **Starmie *(Water)*** — the rook that walked to d6.

**White's Momentum: 100.** What follows is fully determined — no hidden roll, nothing to hope for — because
the whole turn's Momentum, and each action's Focus and Precision, are on the table before the first click.

- **Sub-move 1 — Machamp b4xc5.** Machamp *(Fighting)* captures Skarmory *(Steel)*. Fighting→Steel is
  **2×**; Expert Belt fires because the matchup is super-effective (×1.2); at Momentum 100 the first blow is
  a one-shot. Skarmory has **Sturdy**, but Sturdy is a `CLAMP{to:1}` that only holds from full HP — Skarmory
  was chipped earlier, so it is not pristine, and Sturdy does not fire. **ADVANTAGE**: the rook is removed,
  the 8-ray gold star plays, the board frame turns gold, Machamp takes the square. *A pawn's evolution has
  just taken a rook and kept the tempo.*
- **Sub-move 2 — the baton passes to Gengar, Bg2xd5… no: to the Freeze-Dry.** Actually the decisive stroke
  is Lapras. **Lapras uses Freeze-Dry on the Water rook (Starmie) on d6** — an ART, slot 1, one charge.
  Without it, Lapras's Melee slot (`Ice Shard`, Ice) into Starmie *(Water)* reads **0.5×**, and at any
  Momentum a resisted assault is a **ROUT** — Lapras dies, the rook lives. The square draws twin-cracks-back
  for the melee slot. But Freeze-Dry's `CHART{d:+1}` fires at step 1b, guarded on Water: Ice→Water reads
  **2×**. The forecast repaints from a shatter-back to a **gold star** in place — *you watch the verdict
  change as you select the slot.* It resolves **ADVANTAGE**: the rook is removed, and because the ART does
  not relocate the attacker (§4.5), **Lapras stays on e5 and d6 is left empty.** The bonus is earned.
- **Sub-move 3 — the baton passes again**, to a piece that has not acted: **Rook Steelix e1xe6**, capturing
  Snorunt *(Ice)*. Steel→Ice is **2×**, another one-shot at Momentum 100. That would earn a fourth
  sub-move, but **T1 caps the turn at three**, so the turn ends. Three captures, by three different pieces,
  in one turn — a rook, a rook and a pawn — and it was a *team* play, not one piece rampaging, because the
  baton rule forced the tempo through Machamp, then Lapras, then Steelix.
- **R5 held throughout:** after each sub-move the engine checked whether Tyranitar became newly capturable;
  it never did, so no sub-move was forfeited. Had a sub-move created a *new* line to the King, the turn
  would have ended there, and Black would have kept its guaranteed full reply.

**The counterfactual that is the whole game.** Black declared Gardevoir as **Psychic** back at the draft.
Ghost→Psychic is 2×, which is why Gengar was a standing threat to it all game. Had Black declared Gardevoir
as **Fairy** — its other real type — Ghost→Fairy is 1×, the queen would have been a neutral capture rather
than a super-effective one on turn 6, White would have earned no bonus there, and the tempo that
snowballed into this position would never have started. **The draft decision, made twenty-five moves
earlier, is what turned a good position into a won one.**

**Black's reply. Momentum 88.** Black is lost on material and has one instrument left: a deliberate trade.
**Gogoat d4xe6** — Gogoat *(Grass)* captures Steelix *(Steel)* on e6. Grass→Steel is **0.5×**, a resisted
assault, and at Momentum 88 the forecast is a clean **MUTUAL** — twin mirrored cracks, both pieces shatter,
e6 left empty. Black spent a knight to delete the rook that just ate its pawn, and **it chose that outcome
knowing it exactly**, because the verdict was stamped on the square before the click. That is the one place
the game rewards a losing player: mutual destruction is a chess rule (§14.3), it is visible, and it is a
choice — never a die that stole a piece.

The feel, in one sentence: **you read the type chart to know what a square means, you read the HP arcs to
know how much a wounded piece can still take, you read the Momentum to know whether this is a turn to build
or to strike, and every one of those is on the board before you commit — so a loss is a plan you got wrong,
never a roll that betrayed you.**

---

## Appendix A — every fatal flaw accounted for

The design phase raised a set of fatal flaws — some in `BRIEF.md` §5's "hard problems", some in the judges'
scoring, most in the four proposals' own RISKS sections. This appendix enumerates every one and states
whether it was **fixed** (and where) or **dismissed** (and why). The reconstruction draws on
`proposal-battle-sim.md` §27, `proposal-competitive-first.md` §13/§14/§23, `proposal-systems-first.md`
§10.5, and `proposal-systems-compiler.md` §19.4, plus the watch-list `BRIEF.md` §5 names.

### 24.1 Resolution and randomness

| # | Flaw | Status | Where / why |
|---|---|---|---|
| 1 | **The σ = 1.6 Clash Constant is a visible fudge** — a Smogon reader's own arithmetic comes out ~1.6× wrong | **FIXED** | §4.1: σ is deleted. The Clash is a *bounded exchange* at σ = 1.0 — two swings, defender in Speed order — which reproduces the target 84 % / 51 % / 14 % distribution with **no invented multiplier anywhere in the game** |
| 2 | **RNG steals pieces** — a hidden roll can lose you a piece you correctly committed | **FIXED** | §6: every die that can cost a piece (Momentum, Focus, Precision) is revealed *before* the decision. Coins are flipped after commitment only for riders, which can never remove a piece on the turn they are flipped |
| 3 | **d6 vs coin — which randomiser** | **DISMISSED as a false choice** | §6.2: gen-6 crit stages (1/16 = "four heads") and the TCG's coin alphabet are the same object, so both canons agree. Momentum is the damage formula's own random factor made public; there is no invented sixth |
| 4 | **Public dice make the game feel flat** — knowing the outcome removes drama | **DISMISSED, with a lever** | §6.4/§18.4: the drama moves to *which* Momentum turn you strike on and *which* slot you spend where. If playtests report flatness, the lever is `momentumRange` and `critWindowBase`, tuned up from a safe floor (§15.8) |
| 5 | **Receiver-blind multiplier conversion** — `chainModify ×2` on defence became "+2 attack", inverting Fur Coat, Chlorophyll, Slow Start and 82 others | **FIXED** | §1 change 3, §13.6: with real HP the multiplier is carried into the damage-pipeline slot the handler's stem names (`MODIFY`), so the conversion table that inverted them *no longer exists* — 85 entries repaired by removing a table |
| 6 | **The survive-once "shield" rule enables a free queen** — Sash a pawn, throw it at the queen, both die, take the queen | **FIXED** | §10.5, §5 step 16: Focus Sash/Sturdy `CLAMP` HP to 1 and *the exchange continues*; there is no outcome to rewrite, so the exploit cannot form and no ordering ambiguity with a crit arises |

### 24.2 Termination and turn structure

| # | Flaw | Status | Where / why |
|---|---|---|---|
| 7 | **Unbounded turns / crit chains** — the video's crit-grants-a-move stacking with super-effective-grants-a-move | **FIXED** | §7.1: a bonus has exactly one source (an ADVANTAGE); crits grant no tempo. `grantBonus()` is one line, CI gate 6 asserts it. The crit-chain engine does not exist |
| 8 | **Extra-move chains run away** — one super-typed piece mows the board | **FIXED** | §7.3: T1 caps a turn at 3 sub-moves; T2 (the baton rule) forces each bonus onto a piece that has not acted, making a chain a team combo; T3 ends the turn on a new King exposure. And no op adds a piece (gate 5), so `L ≤ 16` regardless of the RNG (§12.5) |
| 9 | **The progress clock never fires** — Leftovers-vs-poison, Harvest+Leppa, hazard lay-clear-relay each reset it forever | **FIXED** | §12.4: progress is defined only over strictly monotone quantities (removals, pawn advances, promotions, new lifetime-minimum HP octiles); healing, status churn, charge spend and hazard layers are explicitly *not* progress. Plus a universal 300-turn hard cap in the ordinary draws table |
| 10 | **Three sub-moves is too much tempo to plan against** | **DISMISSED, gated** | §7.3: *(measured)* `P(L≥3)` is a few percent; the animation bound is 1 540 ms. Self-play at M6 decides; the fallback `L ≤ 2` is a one-constant change |
| 11 | **A mandatory extra move is undesigned zugzwang** | **FIXED** | §7.3, §20.5 change 5: `{kind:'decline'}` is a real action, and a bonus is not granted when no unacted piece can act |

### 24.3 Immunity and the untouchable piece

| # | Flaw | Status | Where / why |
|---|---|---|---|
| 12 | **The untouchable-piece problem** — a 0× or warded piece nothing can remove | **FIXED five ways** | §10.3: coverage slots (immunity is only vs the Melee slot), status/hazards/weather ignoring immunity (270 of 271 Status moves), the Softening rule taking any piece to 1 HP, `CHART{set:1}` reading immune pairs as neutral, and a validator-guaranteed immunity breaker per side. Four of the five are free from data |
| 13 | **The Shedinja King** — a bst-236 Wonder Guard piece as an unloseable King | **FIXED three ways** | §12.6: King eligibility gates on `isRoyal ‖ bst ≥ 580`; R6 makes no VETO hold against a King; and the immunity-breaker validator is restored. Wonder Guard is also an Ace (§15.5) |
| 14 | **Wonder Guard needs three bespoke bounds** | **FIXED, made literal** | §10.3: Shedinja has 1 HP *(measured, the only `maxHP` override)*, so a *literal* Wonder Guard already dies to hazards and chip. Permanent, not class-scoped — the SPEC's one correction to the proposal's TCG reading |
| 15 | **Area moves remove the whole board** — Dazzling Gleam takes eight pieces | **FIXED** | §4.5: a ranged or area attack **wounds but never kills** (the Rifle-Chess rule); only a Clash or residual removes a piece; the seven `selfdestruct` moves are the sole exception. *(measured)* Alakazam's Psychic at range 2 does 280 damage, more than any piece has — so this is load-bearing |

### 24.4 Chess integrity

| # | Flaw | Status | Where / why |
|---|---|---|---|
| 16 | **Checkmate is ill-posed under randomness** — "attacked" depends on a roll not yet drawn (the on-camera bug) | **FIXED** | §12.1: king capture, not checkmate. This is the standard resolution across every variant where check is hard to compute, and the shipped `variant.ts` proves the defect independently (its type-blind `isInCheck`) |
| 17 | **Out-of-turn reactions break the search and the safety proof** | **FIXED / DISMISSED** | §4.6: nothing lets a player act on the opponent's turn. Priority is folded into the Clash; Counter/Mirror Coat are marks set on your own turn. There is no `react` action (§20.2) |
| 18 | **King capture makes the endgame degenerate** — mutual-annihilation hunting, lost stalemate | **DISMISSED, mitigated** | §12.2: R4 (mover wins simultaneous royal death) removes the annihilation-for-a-draw strategy; R8/R9 (check as advice, Guarded mode) are the mitigations; Chess960's rationale covers opening memorisation for free because the army is drafted |
| 19 | **First-player advantage** | **DISMISSED, measured** | §15.8: the batch simulator reports it; if it exceeds a few percent, Bruce's 1963 Marseillais balancing (White's first turn grants no bonus) is a one-rule fix. The draft already neutralises opening theory |
| 20 | **Speed is over-strong** — it decides who gets the extra swing, the most valuable thing | **DISMISSED, levered** | §4.2, §9.4: Trick Room, priority moves and Sticky Web are the counters; the draft prices Speed; the simulator watches it. Speed mattering *is* the most recognisable pattern in competitive Pokémon |
| 21 | **Attrition makes the mid-game mushy** — a board of half-dead pieces | **DISMISSED, watched** | §1.1 consequence 5: attrition is the *point* — the wounded piece is what chess lacks and Pokémon has. The progress clock and the MUTUAL rate are watched at M6; if draws exceed 20 %, the lever is the Momentum range |

### 24.5 The content system

| # | Flaw | Status | Where / why |
|---|---|---|---|
| 22 | **900 unbalanced special cases** — a hook registry of hand-written ability functions | **FIXED** | §13: the content system is a compiler, not a registry. 0 hand-written ability functions; 245 table rows for 1 797 entries |
| 23 | **A third of moves have code-only behaviour no field-derivation recovers** | **FIXED** | §13.1: the compiler reads `@pkmn/sim`'s handler *source* (calls + returns/assignments), not the stripped `@pkmn/dex` projection, so Belly Drum, Rest, Soak and Freeze-Dry derive |
| 24 | **A fourth channel (return values) is invisible to a call-site census** — the flaw that sank the systems-first coverage figure and would have shipped Freeze-Dry as "+2 to a roll" | **FIXED** | §13.1 C4, §13.5 gate 8: the 14-row return grammar covers all 494 call-free handlers, and the build fails on any handler none of the four channels explains |
| 25 | **`signalClass` over-claims derivability** — it reports Levitate as `fields` on one flag | **FIXED** | §13.4: `coverageClass` supersedes it as the coverage authority, with a `flags-only` state that resolves to `curated`; `coverage.test.ts` asserts it |
| 26 | **The op-to-board mapping is systematically right but thematically wrong somewhere large** | **OPEN — the standing top risk** | §13.4: cannot be retired by measurement because it is a taste judgement. Mitigations: the §14 faithfulness ledger as a review artefact; the rule that a wrong mapping is a *data* fix in `overrides.json`; and gate 8, which converts "we might be missing a class" into a build error (it is how C4 was found) |

### 24.6 Meta-game, performance, assets

| # | Flaw | Status | Where / why |
|---|---|---|---|
| 27 | **Collection pay-to-win** — a deeper collection simply wins | **FIXED** | §15.7: point-buy budgeting (depth buys options, not power), the Mirror Pool ranked default (depth worth zero), type-scoped seasons, and matchmaking on pool depth |
| 28 | **The 16-piece floor** — a new account cannot field a legal army | **FIXED** | §17.8, §20.1: ownership of *individuals* with a starter grant of ~20; duplicates are immediately fieldable |
| 29 | **GC / performance spikes** — DOM transform writes spike to 42–333 ms | **FIXED** | §16.6, §21.1: Canvas2D effect layers (17× cheaper per moving thing), a pre-allocated struct-of-arrays particle pool (zero per-frame allocation), and a heap gate asserting no growth over moves 50→100 |
| 30 | **The AI is capped ~148× below its target** by an immutable-only reducer | **FIXED** | §20.3: `makeAction`/`unmakeAction` over the op journal (53 ns/node vs 20.8 µs to clone); `apply` is defined as clone-then-`makeAction`, so the paths cannot drift |
| 31 | **HP in the Zobrist key makes the transposition table useless** | **FIXED** | §19.4, §12.4: HP is bucketed to eighths before it enters the key (and the repetition hash), which is exact enough for transposition and coarse enough to hit |
| 32 | **The shipped bundle is 268 KB, 4.5× the gate** | **FIXED** | §13.3, §21.1: `Dex.load()` eagerly awaits learnsets; four one-line changes plus a columnar species emit land it at 37.6 KB, gated by `budget.test.ts` from M0 |
| 33 | **Animated sprites do not exist for the whole dex** (Miraidon, Pecharunt) | **DISMISSED, designed around** | §16.7: animation quality comes from the effects we *draw*, never from assuming animated source art; the 383 KB icon sheet is the floor every species meets |
| 34 | **`Past` content is required** — Megas, Shedinja, ~half the items depend on it | **ACCEPTED as a stated dependency** | §13.4: the inclusion policy admits `Past`; if licensing later excludes it, Mega Evolution and ~180 items go at once. Flagged, not fixable within the design |
| 35 | **The tutorial rots as the rules change** | **FIXED** | §18.1, §21.3: `tutorial.test.ts` runs every lesson headlessly; a lesson whose goal became unreachable or whose beat references a vanished event fails CI |

Counting the fixed rows lands near the SPEC's headline of "nineteen judge-identified fatal flaws fixed and
the rest dismissed with an argument"; the two rows deliberately left open (26, the thematic-mapping risk;
34, the `Past` dependency) are open because one is a taste judgement no measurement can close and the other
is an external constraint no design can remove — and both are stated rather than hidden.

---

## Appendix B — rejected alternatives

For each significant fork where the SPEC picked one good option over another, the alternative and the
argument. Several of these were live disagreements between the four proposals, so the "rejected" column is
a real position someone held, not a straw man.

| Choice the SPEC made | Alternative rejected | Why the SPEC picked its way |
|---|---|---|
| **Real HP + a bounded exchange** (§4, §5) | `battle-sim`'s **σ = 1.6 Clash Constant** over the real formula; and the two proposals' **binary capture with a 5-rung ladder** driven by a public d6 | σ makes a knowledgeable player's own arithmetic wrong (§4.1); the ladder needs a "Band Cap" to stop buffs manufacturing tempo. Two swings at σ = 1.0 reproduce the σ = 1.6 distribution exactly *(measured)* with **no invented multiplier**, and real HP gives the mid-game the wounded piece binary capture cannot express (§1.1) and repairs the compiler's largest defect for free (§13.6) |
| **King capture** (§12) | Checkmate, made type-aware | Checkmate is not a well-formed predicate when "attacked" depends on a roll not yet drawn — the actual root cause of the on-camera bug, and the reason every hard-to-compute-check variant switched to king capture (§12.1). The shipped `variant.ts` proves the defect independently |
| **A compiler over `@pkmn/sim` source** (§13) | `battle-sim`'s / `recon-abilities-items`'s **hook registry of ~115–163 hand-written ability functions** (~1 700 LOC) | The 115 "primitives" are parameterisations of 20 ops, not a competing instruction set. 0 hand-written ability functions, a `@pkmn/dex` bump adds content with no code change, and the same ops give the AI its undo, the replay its serialisation and the tutorial its lessons (§13, §20.3) |
| **Real HP + a 7-vector of boosts** (§9.3) | `recon-abilities-items`/`competitive-first`'s **single `Vigour` counter** collapsing all stats and stages | The fidelity is free (the compiler reads `{atk:2}` and `{def:2}` verbatim), and the collapse would make Swords Dance and Iron Defense the *same effect* and delete Unaware, Contrary, Simple and every `spe` mechanic — the "systematic but thematically wrong is a defect" failure `DIRECTION.md` names. The legibility problem the collapse solved is a UI problem, solved by showing two numbers (§9.3) |
| **A 20-op ISA** (§13.2) | The proposal's **19 ops** (with `TILT` for a roll addend and `WARP` for a rung rewrite) | Real HP has no single roll to tilt and no rung to warp: `TILT` becomes `MODIFY` (a multiplier into a §5 damage slot), `WARP` becomes `CLAMP` (a literal HP floor for survive-once), and `MEND` splits into `MEND`/`STRIKE` (heal vs chip). Net 19 → 20 (§13.6). *This reconciliation is the SPEC's, flagged for review* |
| **Public Momentum/Focus/Precision** (§6) | `competitive-first`'s **fully deterministic** capture (no die at all); `systems-first`'s **post-commitment** probabilistic backlash | Full determinism deletes the story generator and the two die lessons the tutorial needs (§18.4); a post-commitment die can steal a piece and costs the AI ~4 plies (§19.2). Pre-revealed randomness keeps the drama and the variance-reduction at once, which is `recon-variants.md`'s biggest measured lever |
| **Coins for the crit, Momentum for damage** (§6) | A single mechanic — all-d6, or all-coin | *(measured)* gen-6 crit stages and the TCG coin alphabet are the same object (1/16 = "four heads"), and Momentum is the damage formula's *own* random factor. Framing the crit as coins and damage as Momentum means both canons agree and neither is invented |
| **Wards decided per-entity: type-chart 0× and ability wards permanent, item wards one-shot** (§10.3) | `systems-first`'s **every ward is one-shot** (including the type chart's 0×) | A ward that stops working after one attempt is not what Levitate does — it is Air Balloon's *printed text* applied to 28 abilities that do not carry it. `DIRECTION.md` names permanent Levitate as its model of a *good* mapping, and permanence keeps capture legality a pure function of position (worth ~1 ply, §10.3) |
| **Wonder Guard permanent and literal** (§10.3) | The proposal's **class-scoped** Wonder Guard (uncapturable by Q/R/B/N, any pawn/king gets through, per the TCG card) | Chess class here is a free draft choice with no relationship to evolution stage, so borrowing the card's shape without its variable would let a Charmander pawn kill Shedinja while a Blissey rook could not — arbitrary. Shedinja's 1 HP makes the literal games reading already safe (§10.3). *This is the SPEC's deviation from the proposal, flagged* |
| **The baton rule** — a bonus goes to a piece that has not acted (§7.3) | `variant.ts`'s shipped rule: **the capturing piece continues** | The shipped rule is the "one super-typed piece mows the board" degeneracy every extra-move variant documents; the baton rule makes a chain a *team* combo, which reads far better on the board and is what §23's mid-game exchange turns on |
| **One Ace: Tera *or* Burst, keeping STAB on both types** (§11.1) | Two separate once-per-game budgets; mono-type Tera | Two budgets are a "legibility disaster" (`competitive-first` §9.3); a mono-type Tera throws away half the point (the piece's original STAB). Keeping STAB on both types matches the games, and the TCG prints Tera cards off-type with a re-derived Weakness, so both canons agree (§14.2) |
| **Dynamax and Gigantamax cut** (§11.1) | Ship them as a transformation | Dynamax's primary effect is doubling max HP — a magnitude change on a piece that already has real HP, i.e. "a bigger number" — and *(measured)* only 41 of 1 025 species can Gigantamax, making it a draft trap. The `-Gmax` sprites survive as promotion art |
| **No per-piece Charge counter** (§10.5) | The proposal's **Charge counter (0–2)** gating tier-4/5 ARTs | With real HP and real stats, `flags.charge` (a 2-turn mark), `flags.recharge` (a 1-turn mark) and Speed Boost (a `spe` stage) all have a literal canon implementation, so the abstraction that existed to subsume them is one fewer counter on the pin and one fewer thing to teach |
| **Real per-target effectiveness on every square an area move touches** (§4.5) | The TCG's Bench rule — **splash targets resolve neutral**, no Weakness/Resistance off the point of contact | With real HP, an Earthquake that ignored a bystander's Flying immunity would read as a bug. The SPEC takes the *bound* the TCG ruling exists for (area attacks wound, never kill) in a stronger form, and applies real effectiveness everywhere — a stated deviation (§4.5) |
| **Ownership of individuals** (§20.1) | Ownership of **species** | Owning individuals clears the 16-piece floor trivially, makes duplicate rewards immediately useful, and matches how Pokémon works — `DIRECTION.md`'s own recommendation |
| **Mirror Pool as the ranked default** (§15.7) | Ranked from the raw `collection` pool | A raw collection pool makes depth pay, which is the pay-to-win failure `DIRECTION.md` calls most likely to kill the game. Mirror Pool neutralises depth entirely; collection queues still exist, paired within a depth band |
| **Two EV/nature spreads, chosen by the stat line** (§3.3) | A universal all-out-attacker spread | A universal spread makes Blissey and Shuckle max-Speed sweepers — systematic and thematically wrong. The `isBulwark` predicate lands every named piece where a competitive player expects *(measured)* |
| **Set-valued class eligibility** (§3.2) | A single best class per species | A strict single mapping leaves Fighting with zero bishops and makes the every-type-on-the-board goal unreachable. The set-valued `eligible` has no empty (type × class) cell *(measured)* |
| **`Stellar` excluded from draftable types** (§3.1) | Admit all 19 chart types | *(measured)* Stellar has 0 species and is 1× both ways, so as a declaration it is a strictly dominant defensive choice — a piece that can never be mutual-destructed and never blocked. The working chart is 18×18 |

Two rows above are the SPEC's own reconciliations of `proposal-systems-compiler.md` rather than choices the
proposals debated — the **20-op ISA** and **permanent Wonder Guard** — and both are flagged so the owner can
overrule them without disturbing the rest of the document.

---

## Appendix C — open questions

These are genuinely undecided and need a decision before or during implementation. Each states the
question, the current lean, and when it must be settled. They are not risks (those are §24) — they are
places the design deliberately leaves a choice open.

**Before M0 (they shape the compiler and the types):**

1. **The 20-op ISA reconciliation.** The SPEC retires `TILT` and `WARP` and adds `MODIFY`, `CLAMP` and
   `STRIKE` to reach twenty ops for the real-HP world (§13.6). This is the SPEC's own reconciliation of a
   proposal written for binary capture, not a number §1–§12 pinned down. *Lean:* the reconciliation as
   written. *Decide:* before the ISA is frozen in `ops.ts`, because everything downstream types against it.
2. **The final curated count.** `proposal-systems-compiler.md` measured 125 curated for a binary-capture
   engine; real HP moves several (Tinted Lens, Disguise, Ice Face, the Filter family) from curated to
   derived, so the SPEC estimates ~117 (§13.4). *Lean:* let the M0 `compile-report.json` be the source of
   truth; the CI gate stays ≤ 140 regardless. *Decide:* at M0, by measurement, not by argument.
3. **Wonder Guard: permanent-literal or class-scoped.** The SPEC makes it permanent and literal (§10.3),
   deviating from the proposal's TCG class-scoped reading. Both are defensible; the SPEC's turns on
   Shedinja's 1 HP making the literal reading already safe. *Lean:* permanent-literal. *Decide:* before M4
   (abilities), and it is a one-row change in `overrides.json` either way.

**During M6 (the batch simulator settles them by measurement):**

4. **The valuation coefficients α = 0.9, β = 0.5, ε = 0.3, τ = 0.5** (§15.1) and the point list they
   produce. These are starting values; Betza's evidence is that hand-balancing does not work, so they must
   be fitted by self-play. *Decide:* M6, and re-fit whenever σ or the extra-move rules move.
5. **The MUTUAL target band (8–15 % of captures, §4.4)** and the `momentumRange`/`critWindowBase` that
   produce it. Is 8–15 % the right amount of mutual destruction for the feel? *Decide:* M6, then playtest.
6. **First-player advantage.** Measured at M6; if it exceeds a few percent, Bruce's Marseillais balancing
   (White's first turn grants no bonus) is the fix. *Decide:* only if the measurement demands it.
7. **The `isBulwark` threshold and the Assault/Bulwark split** (§3.3). The `+60` constant is a `format`
   parameter re-fit by the simulator. *Decide:* M6.
8. **`L ≤ 3` vs `L ≤ 2`** (the sub-move cap, §7.3). *(measured)* `P(L≥3)` is a few percent; if three
   sub-moves per turn proves too much tempo to plan against, the fallback is a one-constant change.
   *Decide:* M6 self-play plus playtest.

**Product / meta-game decisions (needed by M8–M9, `DIRECTION.md` §4/§6 pose most of them):**

9. **The acquisition curve numbers** — starter grant size (~20), post-match reward counts (3 on a win, 1 on
   a loss), rarity offer weights, and the Legendary/Mythical pity counter. `DIRECTION.md` requires the
   expected collection after 1 / 10 / 50 / 500 matches to be stated and tuned against the simulator.
   *Lean:* the proposal's `~23 / ~45 / ~130 / ~500` curve. *Decide:* M8, tuned.
10. **How much per-individual state** an owned Pokémon carries (nickname, cosmetic, games-played record) —
    `DIRECTION.md` calls this "the one place the match rules constrain you," because more state means deeper
    progression but worse legibility, and per-individual *power* must never exist (it would reopen
    pay-to-win). *Lean:* the record of §20.1's `OwnedIndividual`, no power. *Decide:* M8.
11. **Is trading net-positive for balance at all?** `DIRECTION.md` §18 explicitly asks this to be argued.
    The SPEC includes trading mainly because trade evolutions are real (Machoke → Machamp), server-atomic
    and friend-gated with a cooldown (§17). But whether it improves the game or merely adds a farming
    surface is unsettled. *Decide:* before M9 ships trading; it can be cut without disturbing the rest.
12. **Champion scarcity, season length and decay** — Champion is a top-N leaderboard (§17.8), which needs a
    defined population, a reset policy and a tie-break; soft-reset formula and rating decay are unset.
    *Decide:* M9.
13. **The backend stack, hosting and cost at small scale.** `DIRECTION.md` §20: "a design requiring a team
    to run is the wrong design." The engine's purity makes the netcode small (§20.6), but the concrete
    stack is unchosen. *Decide:* M9.
14. **New-player protection and anti-cheat beyond move validation** — provisional ratings, restricted early
    pairing, smurf/derank handling, and win-trading / collusion / botting / multi-account reward farming
    (`DIRECTION.md` §11/§12). Move validation is free (§20.6); everything else is unspecified. *Decide:* M9.
15. **The quick-chat vocabulary and moderation flow.** The SPEC commits to fixed quick-chat in public games
    and free text only between friends (§17.10); the actual phrase set, the reporting flow and the appeals
    process are unwritten. *Decide:* M9.

**Small but real, decide at the relevant milestone:**

16. **The particle cap: 240 or 1 200.** `recon-visual.md` §7.4 says 240; `recon-tech.md` §A.3 allows 1 200.
    The SPEC uses the stricter 240 (§16.7), but the two recon docs disagree and an implementer should pick
    one consciously. *Decide:* M1's FX layer.
17. **Whether `frz` stays a distinct status.** `recon-tcg.md` recommended folding Frozen into Asleep
    (`frz` has zero primary applications); the SPEC keeps it with a 3-turn cap because real HP makes
    `thawsTarget` meaningful and Ice-type freeze immunity is a type lesson (§9.1). *Lean:* keep it.
    *Decide:* M3, revisit if it proves fiddly.
18. **The confusion model.** The SPEC ships a deterministic confusion (×0.67 blows + a self-hit) rather than
    the TCG Pocket coin-flip version, because we have HP (§9.1). *Lean:* keep. *Decide:* M3, by playtest.

None of these blocks the critical path: M0 needs only questions 1–3, and each of the rest attaches to a
milestone that is a long way out. That is the point of stating them here rather than pretending the design
is closed where it is not.

