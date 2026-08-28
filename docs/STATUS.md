# Implementation status — what's complete, partial, and missing

An honest map of the codebase against `docs/design/SPEC.md` and `docs/design/DIRECTION.md`, so it is
clear what "a complete game" still needs. Updated 2026-08-28 (status effects executing + rendered).

Legend: **✅ done & tested** · **◑ partial** · **○ not started**

## The match engine — largely complete

| Area | State | Notes |
|---|---|---|
| Board geometry, movement, perft | ✅ | `engine/board.ts`, `engine/position.ts` — perft-exact on all 6 standard positions, `chess.js` differential. |
| Type chart & the four outcomes | ✅ | `engine/typechart.ts` — canonical 8/51/61 split. |
| Real HP, stats, spreads | ✅ | `rules/stats.ts` — Assault/Bulwark, Blissey 362, Shedinja 1. |
| Damage pipeline | ✅ | `rules/damage.ts` — gen-9 formula, reproduces the SPEC worked example (174). |
| The Clash (exchange of blows) | ✅ | `rules/clash.ts` — five verdicts, A·D·A / D·A·D·A sequences. |
| King capture, guarded mode, termination | ✅ | `engine/variant.ts` — Regicide rule, R6 king-never-immune, bounded chains. |
| RNG (seeded, serialisable) | ✅ | `engine/rng.ts` — fair d6/coins, replayable. |
| Determinism / replayability | ✅ | game = seed + action list; the property tests rely on it. |

## The content system — complete at the descriptor level, not yet executed in the Clash

| Area | State | Notes |
|---|---|---|
| The ISA (20 ops, 14 triggers, 16 regions) | ✅ | `content/isa.ts`, with its invariants type-enforced. |
| Move compiler | ✅ | `content/compileMoves.ts` — all 950, 74% field-derived, 0 accidental fallbacks. |
| Ability & item compilers | ✅ | `content/compile{Abilities,Items}.ts` — all 311 + 536, faithfulness-reviewed. |
| Coverage & faithfulness audit | ✅ | tested; an adversarial workflow caught and fixed 13 unfaithful mappings. |
| **Executing effects inside a live Clash** | ◑ | **The big gap, now partly closed.** Status riders on moves now fire (see below); the auto-picked coverage slot is chosen against the defender's type in a real capture. Still not run: abilities, items, hazards, weather, and the wider ISA op set. Wiring the remaining ISA ops into `variant.ts`/`clash.ts` is the next major engine milestone. |
| Status conditions (applied + rendered) | ✅ | `engine/status.ts` model is now applied during play: move riders inflict status on a surviving defender, a deterministic end-of-turn **Checkup** ages burn/sleep/paralysis and runs the poison death-clock (R7 clamps a king to 1 HP instead of removing it), a sleeping/paralyzed piece offers no moves, and burn taxes physical damage. Rendered on the board — sprite tilt for rotation-class, counter pips for poison/burn. |
| Move slots / movesets per piece | ✅ | `game/moveset.ts` — 4-slot auto-picker (§8.2): slot 0 the declared-type STAB melee, 1–3 type-diverse coverage from the real learnset; `bestSlotAgainst` picks the most effective slot per capture. |

## Transformations & progression mechanics

| Area | State | Notes |
|---|---|---|
| Promotion (pawn → back-rank class) | ✅ | via the chess core; "evolution" reskin not yet surfaced. |
| Evolution as progression, Mega/Z/Tera/Dynamax | ○ | data is all present (`species.json` has evo chains, mega stones); no gameplay yet. |

## The opponent

| Area | State | Notes |
|---|---|---|
| AI search + evaluation | ✅ | `ai/search.ts`, `ai/evaluate.ts` — type-aware negamax, four difficulties, beginner misjudges types. |
| Playable vs AI in the app | ✅ | title-screen opponent/difficulty picker; AI plays its turn automatically. |
| Web Worker / off-thread search | ○ | runs on the main thread; fine at low depth, would stutter at Champion on a full board. |

## The meta-game — backend built, client and ladder pending

| Area | State | Notes |
|---|---|---|
| Accounts, passwords, sessions | ✅ | `server/` — scrypt, secure cookies, zero native deps. |
| Profiles (display name, bio, status) | ✅ | server-side; validated and moderated-by-shape. |
| Character customization (avatar) | ✅ | `profile/avatar.ts` — games-faithful, shared client/server model. |
| Collection / Pokédex (individuals) | ◑ | stored; starter grant on register. No acquisition loop (rewards, evolution, trading) yet. |
| Client UI for accounts/profile | ✅ | `ui/AccountScreen.tsx`, `ui/AvatarCustomizer.tsx`, `ui/useSession.ts`, `net/api.ts` — sign-up, login, profile fields, and the region-grouped trainer customizer, wired to the backend and routed from `App.tsx`. |
| Ranked ladder + gym badges | ○ | rating column exists on the profile; no matchmaking, no ladder, no Gym Leader matches. |
| Multiplayer (friends, matchmaking, live games) | ○ | the pure engine makes server-authoritative play possible; none of the netcode is built. |
| Trading | ○ | not started. |

## Presentation & onboarding

| Area | State | Notes |
|---|---|---|
| Board, pieces, type colours, role legibility | ✅ | `ui/` — the king/pawn identity problem is solved. |
| Capture-outcome animations | ✅ | five distinct motions, reduced-motion path. |
| HP bars, forecast preview, refusal affordance | ✅ | on the board. |
| Effect animations for moves/abilities/items | ○ | depend on effects executing in the Clash first. |
| **Tutorial** (DIRECTION directive 7) | ✅ | `src/tutor/` + `ui/TutorScreen.tsx` — a lesson is a real game on a hand-built position, not a script (§18.1). Twelve lessons across the two branch tracks (movement, type chart) and the shared spine: the four capture outcomes each caused by the player, the untouchable-piece refusal, the miss and crit reveals, a status lesson, and king capture. `lessons.test.ts` proves every goal reachable and every beat producible against the live engine — a rotted lesson fails CI. |
| Sandbox / batch simulator | ○ | designed in BRIEF-METAGAME §19; not built. It is how balance gets *measured*. |

## Suggested order from here

1. ~~Client account/profile UI~~ — **done.** Sign-up, login, profile, and the trainer customizer ship.
2. **Execute compiled effects in the Clash** — ◑ **status slice done** (riders, Checkup, movement lock,
   burn penalty, board markers). Remaining: abilities, items, hazards, weather, and the wider ISA op set.
3. ~~The tutorial~~ — **done.** Twelve lessons, rot-proofed against the engine (§18.1).
4. **The ladder & Gym Leader matches** — single-player progression spine; needs only the backend that
   now exists plus the AI that now exists. **Next.**
5. **Multiplayer** — the largest remaining tract; the netcode, matchmaking, and live-game server.
6. **Trading, sandbox/batch simulator, richer visuals** — round out the complete game.
