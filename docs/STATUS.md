# Implementation status — what's complete, partial, and missing

An honest map of the codebase against `docs/design/SPEC.md` and `docs/design/DIRECTION.md`, so it is
clear what "a complete game" still needs. Updated 2026-08-28.

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
| **Executing effects inside a live Clash** | ○ | **The big gap.** The compiler produces effect descriptors; the Clash resolver does not yet *run* them. Today a capture is the melee slot-0 exchange only — coverage moves, abilities, items, status, hazards and weather do not yet fire in a real game. Wiring the ISA ops into `variant.ts`/`clash.ts` is the next major engine milestone. |
| Status conditions (data model) | ◑ | `engine/status.ts` exists (TCG marking model) but is not yet applied during play. |
| Move slots / movesets per piece | ○ | Pieces fight with slot 0 only; the 4-slot moveset auto-picker (§8.2) is not built. |

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
| **Client UI for accounts/profile** | ○ | **The immediate next step.** The backend exists but the React app has no sign-up, login, profile, or customizer screen yet — nothing calls the API. |
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
| **Tutorial** (DIRECTION directive 7) | ○ | designed in SPEC §18; not built. Required, and high priority — three stacked rulesets. |
| Sandbox / batch simulator | ○ | designed in BRIEF-METAGAME §19; not built. It is how balance gets *measured*. |

## Suggested order from here

1. **Client account/profile UI** — sign-up, login, the character customizer, profile view. Makes the
   backend real to a player; smallest step with the largest visible payoff.
2. **Execute compiled effects in the Clash** — the biggest engine gap; turns the content layer from
   descriptors into a game where moves, abilities, items and status actually fire. Status (already
   modelled) is the natural first slice.
3. **The tutorial** — required, and cheap once effects run, because it is data over the same systems.
4. **The ladder & Gym Leader matches** — single-player progression spine; needs only the backend that
   now exists plus the AI that now exists.
5. **Multiplayer** — the largest remaining tract; the netcode, matchmaking, and live-game server.
6. **Trading, sandbox/batch simulator, richer visuals** — round out the complete game.
