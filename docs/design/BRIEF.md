# Pokémon Chess — Design Brief (shared ground truth)

> This file is the single source of truth for the design phase. Every design agent reads it.
> Facts in "Verified data facts" were measured directly on this machine — trust them over your priors.

## 1. The goal

Build **a fully-fledged, good-looking, performant digital game** of Pokémon Chess:

- Chess, played with Pokémon as the pieces.
- **All** Pokémon (National Dex, 1025 dex numbers), and the mechanics must **make sense with all Pokémon
  moves, items, and abilities**, integrated coherently with chess mechanics.
- Runs in a browser. Must look good and perform well.

The original concept (a YouTube video by Little Z) is a *tabletop* game with four rules. Our job is to keep
its soul — Pokémon type knowledge is the edge that lets you beat a better chess player — while expanding it
into a real game with the full Pokémon toolkit.

## 2. The original ruleset (from the video, verbatim intent)

1. **Draft.** Pokémon are assigned to chess piece classes. Before each game both players draft their team:
   2 kings, 2 queens, 4 bishops, 4 knights, 4 rooks, 16 pawns are laid out and players alternate picks.
   Class flavour used in the video: bishops = special-attacking / "magical" Pokémon; rooks = physically
   defensive / bulky Pokémon; knights = Pokémon you can ride; kings/queens = royal-flavoured Pokémon.
2. **One type only.** Each Pokémon has exactly one type in Pokémon Chess, chosen at draft time from its
   real typing (Nidoking = Poison, Slowking = Psychic, Lapras = Water *or* Ice — the player picks).
   The video also wanted "at least one of every type on the board".
3. **Type matchups on capture.** When your piece captures an opponent's piece, compare attacker type vs
   defender type:
   - **Super effective** → capture succeeds and **your piece immediately moves again** (a free extra move).
   - **Not very effective** → **both pieces are removed** (mutual destruction).
   - **Immune (0×)** → **the capture is illegal**; you cannot take that piece at all
     (Ground cannot capture Flying; Normal cannot capture Ghost).
   - **Neutral (1×)** → ordinary chess capture.
4. **Dice RNG (added for the final game).** On each capture attempt roll a d6:
   - **6 = critical hit** → capture succeeds and you move again (regardless of type).
   - **1 = miss** → the attack fails and **both pieces die**.
   - Explicitly framed as "the mechanic that lets the worse player win" — RNG is a feature, not a bug.
5. **Evolution.** Observed in play: pawn promotion is reskinned as evolution ("that becomes a queen and then
   your Magnemite has evolved"; "Pikachu is evolving… into Zapdos").

### Known problems with the original rules that our design must resolve

These came up on camera and are real design debt, not trivia:

- **Capture-in-check is broken.** A player's piece died capturing while their king was in check, and the
  turn ended with the king still in check ("your piece died in check… it's my turn"). Mutual destruction
  interacts illegally with the check rules. Needs a real answer.
- **Infinite / runaway turns.** "Super effective → move again" plus "crit → move again" can chain. Needs a
  provable termination bound.
- **King capture vs checkmate.** Players resolved a game by *taking the king* on a crit ("straight up take
  your king"), which contradicts checkmate. Pick one model and make it consistent.
- **Suicide-capture as a tactic.** "My ice type is so worthless that the suicide is worth it" — mutual
  destruction makes bad-typed pieces into cheap trading tools. Is that a bug or a feature?
- **Draw / stalemate** under these rules is undefined ("if I kill it with Gengar and I kill you it's a draw").
- **Zero-effectiveness immunity creates untouchable pieces** — a Flying piece that no Ground piece can ever
  capture distorts the board. Bounded how?

## 3. Verified data facts (measured on this machine — do not guess these)

Data source: `@pkmn/dex@0.10.11` + `@pkmn/data@0.10.11` (the Pokémon Showdown dataset, npm-installable,
typed, offline-capable). A probe workspace already exists at **`/tmp/pkmn-probe`** — you may `cd` there and
run `node`-based probes against the real data to check any claim.

Counts (full dex, no generation filter):

| Resource | Count |
|---|---|
| Species entries (incl. all formes) | 1517 |
| Species with `!isNonstandard` | 911 |
| Standard base formes only | 733 |
| Max dex number | 1025 |
| Moves (all gens) | 954 |
| Moves (gen 9 legal) | 685 |
| Abilities | 320 |
| Items | 583 |
| Types | 19 (18 + `???`) |

Gen-9 move taxonomy (this is the raw material for any move→board-effect mapping):

- Categories: `Physical` 275, `Special` 196, `Status` 214.
- Targets: `normal` 468, `self` 80, `allAdjacentFoes` 48, `any` 21, `all` 18, `allAdjacent` 15, `allySide` 10,
  `randomNormal` 6, `foeSide` 4, `allies` 4, `scripted` 4, `adjacentAlly` 4, `allyTeam` 1, `adjacentFoe` 1,
  `adjacentAllyOrSelf` 1.
- Flags present (count): `metronome` 577, `mirror` 540, `protect` 538, `contact` 219, `snatch` 72,
  `reflectable` 70, `bypasssub` 65, `allyanim` 49, `noassist` 39, `failcopycat` 35, `heal` 32, `nonsky` 31,
  `sound` 30, `failinstruct` 29, `slicing` 25, `distance` 24, `nosleeptalk` 23, `contact`…, `bullet` 19,
  `punch` 18, `wind` 17, `charge` 13, `dance` 12, `defrost` 10, `failencore` 9, `bite` 8, `recharge` 8,
  `noparentalbond` 8, `powder` 7, `minimize` 7, `pulse` 7, `gravity` 6, `nosketch` 6, `mustpressure` 5,
  `pledgecombo` 3, `cantusetwice` 2, `futuremove` 2.
- Non-volatile statuses: exactly 5 — `slp, par, psn, tox, brn`.
- Volatile statuses (37 distinct): `aquaring, attract, banefulbunker, partiallytrapped, burningbulwark,
  charge, confusion, curse, defensecurl, destinybond, protect, disable, dragoncheer, encore, endure,
  focusenergy, followme, gastroacid, helpinghand, imprison, ingrain, leechseed, magnetrise, minimize,
  noretreat, powertrick, ragepowder, substitute, silktrap, smackdown, spikyshield, stockpile, tarshot,
  taunt, torment, yawn`.

Per-entity structured fields available (verified shapes):

- **Species**: `num, name, types[], baseStats{hp,atk,def,spa,spd,spe}, bst, weightkg, abilities{0,1,H,S},
  evos[], prevo, nfe, tier, gen, isNonstandard, baseSpecies, forme, otherFormes[], canGigantamax`.
- **Move**: `num, name, type, category, basePower, accuracy (number|true), pp, priority, flags{}, target,
  secondary/secondaries[{chance,status,volatileStatus,boosts}], status, volatileStatus, boosts{}, drain[],
  recoil[], selfSwitch, critRatio, multihit, willCrit, ignoreImmunity, isZ, isMax, desc, shortDesc, gen`.
- **Ability**: `num, name, flags{breakable,…}, desc, shortDesc, gen, isNonstandard`.
  **Important:** ability *behaviour* is prose only (`desc`/`shortDesc`) — there is **no** machine-readable
  effect schema. Any ability system must derive behaviour from curated classification, not parsing.
- **Item**: `num, name, fling{basePower}, onResidualOrder, desc, shortDesc, gen, isNonstandard`.
  Same caveat: behaviour is prose.
- **Type chart**: `gen.types.get(t).totalEffectiveness(defenderTypeOrTypes)` returns the exact multiplier.
  Verified: Ground→Flying `0`, Normal→Ghost `0`, Ground→Steel `2`, Fire→Steel `2`,
  Electric→[Water,Flying] `4`.
- **Learnsets**: `await gen.learnsets.get(id)` → `{learnset: {moveid: [...sources]}}`. Available for all
  species; this is the legal-moveset ground truth (~3.2 MB raw for the whole dex).

Sprites / art, all reachable (HTTP 200 verified):

- `@pkmn/img@0.3.4` — resolves sprite URLs/spritesheet offsets for Showdown art (gen1–gen5 stills,
  `ani/` animated GIFs, plus item icons). Animated GIF example ~26 KB.
- PokéAPI official artwork, e.g.
  `raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/{num}.png`
  (~200 KB each — high quality, too big to ship 1025 of naively).
- Showdown `gen5/{id}.png` stills are tiny (~0.5 KB–few KB).

Toolchain: node **v24.19.0**, npm **11.17.0** (no pnpm, no bun). Network access works. `chess.js@1.4.0` is
installable and is useful as a **test oracle** for standard-chess legality, not as our engine.

## 4. Pre-decided constraints (not up for debate — design within these)

1. **TypeScript, strict mode.** Vite for build/dev. npm as package manager.
2. **The rules engine is a pure, dependency-free, deterministic TS module** with a seeded PRNG. No DOM, no
   React, no I/O inside it. Same seed + same move list ⇒ identical game. This is what makes it testable,
   replayable, network-ready, and AI-searchable.
3. **Pokémon data is baked at build time**, not fetched at runtime by the game. A generator script reads
   `@pkmn/dex` and emits compact JSON/binary bundles. The shipped bundle must be small enough to load fast;
   state your budget and how you hit it.
4. **Vitest** for tests. The engine must be heavily tested, including property tests against `chess.js` for
   positions where our variant reduces to standard chess.
5. **No hand-writing 954 move implementations.** Whatever you propose must scale by *deriving* behaviour
   from the structured fields above, with a curated override layer for iconic content. Say exactly where the
   derived/curated line falls and how large the curated set is.
6. Single-player vs AI must work offline. Hot-seat local multiplayer must work. Network play may be designed
   for but need not be implemented first.

## 5. The hard problems your design must actually solve

Do not hand-wave these. A proposal that ducks them scores zero on the coverage lens.

1. **Content coverage at scale.** How do 954 moves, 320 abilities, 583 items become chess-board effects
   *systematically*? What is the taxonomy? What is the generic fallback for content with no bespoke rule, so
   that nothing is simply missing? How do you avoid 900 unbalanced special cases?
2. **Turn structure.** Where do moves/PP/HP/damage fit relative to chess moves? Does a piece have HP, or is
   capture still binary? Does using a Pokémon move cost your chess turn? Be concrete: write the turn loop.
3. **Termination.** Prove your extra-move / chain rules cannot loop forever. State the bound.
4. **Check, checkmate, mutual destruction, king capture.** One coherent model. Resolve the video's bug.
5. **Balance.** Type immunity, mutual destruction, crit chains and the draft all warp value. What is a
   piece worth? How does a player who knows types win without the game being decided at draft time?
6. **Draft.** With 1025 Pokémon, how is the draft not paralysing? Formats, presets, legality, "one type
   each", the every-type-on-board goal.
7. **Rendering & performance.** Concrete architecture and budgets: board, 32+ pieces, type-matchup FX,
   animation. Frame budget, asset budget, load time. Justify DOM/CSS vs Canvas2D vs WebGL/Pixi.
8. **AI opponent.** The variant breaks chess: extra moves, mutual destruction, illegal captures, RNG.
   Standard alpha-beta assumptions and existing engines do not transfer. Propose a search that handles
   stochastic captures and chained moves, with a concrete strength/latency target.
9. **Legibility.** A player who knows chess but not Pokémon, and a player who knows Pokémon but not chess,
   must both be able to play. How does the UI teach 18 types and your added systems without a manual?
10. **Scope order.** What ships first, what is v2. Be honest about effort.

## 6. Output contract

Follow the instructions in your own prompt for where to write your proposal. Be concrete and specific:
name the types, the fields, the formulas, the file layout. Prefer a precise rule over an evocative one.
Where you make a judgement call, say what you traded away.
