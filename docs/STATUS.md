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
| **Executing effects inside a live Clash** | ◑ | **The big gap, progressively closing.** Now firing: status riders on moves; coverage-slot choice against the defender's type; and **ability-granted type immunities** (`rules/abilities.ts` — Levitate, Volt Absorb, Flash Fire, Sap Sipper, Wonder Guard…), which extend untouchability from types to individuals and are named in the board's refusal caption. Still not run: item effects, stat stages, hazards, weather, and the wider ISA op set — the remaining frontier. |
| Status conditions (applied + rendered) | ✅ | `engine/status.ts` model is now applied during play: move riders inflict status on a surviving defender, a deterministic end-of-turn **Checkup** ages burn/sleep/paralysis and runs the poison death-clock (R7 clamps a king to 1 HP instead of removing it), a sleeping/paralyzed piece offers no moves, and burn taxes physical damage. Rendered on the board — sprite tilt for rotation-class, counter pips for poison/burn. |
| Move slots / movesets per piece | ✅ | `game/moveset.ts` — 4-slot auto-picker (§8.2): slot 0 the declared-type STAB melee, 1–3 type-diverse coverage from the real learnset; `bestSlotAgainst` picks the most effective slot per capture. |

## Transformations & progression mechanics

| Area | State | Notes |
|---|---|---|
| Promotion (pawn → back-rank class) | ✅ | via the chess core; "evolution" reskin not yet surfaced. |
| Evolution as progression | ✅ | **Evolution through play (§17.8).** Each owned individual trains as your team wins (a win grants team XP, gym or ranked online); once trained (`EVOLVE_XP`) the Collection screen offers its evolution(s) — a branching line like Eevee lets you choose. Server-validated against the species' real `evos`. |
| Mega / Z / Tera / Dynamax | ○ | data is present (mega stones, etc.); no in-battle transformation yet. |

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
| Collection / Pokédex (individuals) | ◑ | `ui/CollectionScreen.tsx` — the owned grid (duplicates counted) and a Pokédex figure of distinct species / 1025. **Acquisition loop shipped:** a Gym win offers three Pokémon to catch (`RewardChooser`), claimed via `POST /api/collection/claim`. Evolution-through-play and trading remain. |
| Client UI for accounts/profile | ✅ | `ui/AccountScreen.tsx`, `ui/AvatarCustomizer.tsx`, `ui/useSession.ts`, `net/api.ts` — sign-up, login, profile fields, and the region-grouped trainer customizer, wired to the backend and routed from `App.tsx`. |
| Ranked ladder + gym badges | ◑ | **Single-player ladder shipped.** `src/ladder/` + `ui/LadderScreen.tsx` — eight Kanto Gym Leaders fielding mono-type armies (`game/gymArmy.ts`), gyms unlock in canon order, Elo rating with league tiers, and a badge case a losing streak never strips (§17.8). Local-first, syncing to the account when signed in (`POST /api/ladder/result`, server-authoritative). Missing: human matchmaking (needs the multiplayer tract). |
| Multiplayer (matchmaking, friendly games, live games) | ◑ | **Online play shipped and now server-authoritative.** `server/matches.ts` + `ui/OnlineScreen.tsx` — in-memory rooms, matchmaking (random pairing, **ranked**) and private games by shareable code (friendly). Since a game is a seed + action list, both clients draft the same armies from the shared seed; the server runs the engine (`server/gameValidator.ts`, dex read from disk) to validate every move — illegal or out-of-turn moves are rejected, king capture ends the game, and ranked games settle both ratings (`Accounts.recordHeadToHead`). Board plays via GameBoard controlled mode; client polls. Pending: friends graph/presence, chat, turn timers. |
| Trading | ✅ | `ui/TradeScreen.tsx` + `trades` table — propose a swap of individuals to another trainer (give and/or request, picked from both collections), who accepts/declines; the proposer can cancel. Ownership is validated on both sides at propose and again at accept, and the swap runs in one transaction so nothing duplicates. Verified end-to-end over HTTP. |

## Presentation & onboarding

| Area | State | Notes |
|---|---|---|
| Board, pieces, type colours, role legibility | ✅ | `ui/` — the king/pawn identity problem is solved. |
| Capture-outcome animations | ✅ | five distinct motions, reduced-motion path. |
| HP bars, forecast preview, refusal affordance | ✅ | on the board. |
| Effect animations for moves/abilities/items | ○ | depend on effects executing in the Clash first. |
| **Tutorial** (DIRECTION directive 7) | ✅ | `src/tutor/` + `ui/TutorScreen.tsx` — a lesson is a real game on a hand-built position, not a script (§18.1). Twelve lessons across the two branch tracks (movement, type chart) and the shared spine: the four capture outcomes each caused by the player, the untouchable-piece refusal, the miss and crit reveals, a status lesson, and king capture. `lessons.test.ts` proves every goal reachable and every beat producible against the live engine — a rotted lesson fails CI. |
| Sandbox / batch simulator | ✅ | `src/sim/batch.ts` + `ui/SandboxScreen.tsx` — runs many seeded AI-vs-AI games and reports win/draw shares, White score and average length; deterministic and rot-proofed (a deeper AI must outscore a shallower one). Measured over 40 self-play games per tier: White score 0.40 (Rookie) → 0.54 (Trainer) → ~0.68 (Ace) — a moderate, skill-scaling first-move edge in the normal range for a chess-like game, not an imbalance needing a rule change. |

## Suggested order from here

1. ~~Client account/profile UI~~ — **done.** Sign-up, login, profile, and the trainer customizer ship.
2. **Execute compiled effects in the Clash** — ◑ **status slice done** (riders, Checkup, movement lock,
   burn penalty, board markers). Remaining: abilities, items, hazards, weather, and the wider ISA op set.
3. ~~The tutorial~~ — **done.** Twelve lessons, rot-proofed against the engine (§18.1).
4. ~~The ladder & Gym Leader matches~~ — **done** (single-player). Eight gyms, Elo + badges, persisted.
5. ~~Multiplayer~~ — **core + server-authoritative ranked shipped.** Matchmaking (ranked) and private
   games (friendly); the server validates every move and settles ratings. Remaining: friends graph, chat, timers.
6. ◑ **Sandbox, collection loop, trading, and evolution-through-play done.** Remaining: the deeper
   ISA-op execution (abilities/items/hazards/weather firing in the Clash), and social polish
   (friends graph, chat, turn timers).
