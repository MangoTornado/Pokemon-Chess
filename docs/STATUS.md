# Implementation status — what's complete, partial, and missing

An honest map of the codebase against `docs/design/SPEC.md` and `docs/design/DIRECTION.md`, so it is
clear what "a complete game" still needs. Updated 2026-08-29 (server-authoritative online, friends,
trading, evolution, ability immunities).

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

## The content system — compiled in full; execution in the Clash is progressive

| Area | State | Notes |
|---|---|---|
| The ISA (20 ops, 14 triggers, 16 regions) | ✅ | `content/isa.ts`, with its invariants type-enforced. |
| Move compiler | ✅ | `content/compileMoves.ts` — all 950, 74% field-derived, 0 accidental fallbacks. |
| Ability & item compilers | ✅ | `content/compile{Abilities,Items}.ts` — all 311 + 536, faithfulness-reviewed. |
| Coverage & faithfulness audit | ✅ | tested; an adversarial workflow caught and fixed 13 unfaithful mappings. |
| **Executing effects inside a live Clash** | ✅ | **Closed.** Firing today: status riders; coverage-slot choice; **ability type-immunities** (Levitate, Volt Absorb, Wonder Guard…, named in the refusal caption); **held items** (Life Orb, Choice, Expert Belt, type items, Assault Vest, Eviolite, Focus Sash's clamp, Leftovers); **stat stages** (`engine/stages.ts` — a Speed drop flips who swings first, the sharpest effect in the variant); **weather and hazards** (`engine/field.ts`, cast via the ART action); and **recoil / contact punishment**. Remaining unexecuted ISA ops are the long tail (screens, redirection, multi-hit), not a structural gap. |
| Status conditions (applied + rendered) | ✅ | `engine/status.ts` model is now applied during play: move riders inflict status on a surviving defender, a deterministic end-of-turn **Checkup** ages burn/sleep/paralysis and runs the poison death-clock (R7 clamps a king to 1 HP instead of removing it), a sleeping/paralyzed piece offers no moves, and burn taxes physical damage. Rendered on the board — sprite tilt for rotation-class, counter pips for poison/burn. |
| Move slots / movesets per piece | ✅ | `game/moveset.ts` — 4-slot auto-picker (§8.2): slot 0 the declared-type STAB melee, 1–3 type-diverse coverage from the real learnset; `bestSlotAgainst` picks the most effective slot per capture. |

## Transformations & progression mechanics

| Area | State | Notes |
|---|---|---|
| Promotion (pawn → back-rank class) | ✅ | via the chess core; "evolution" reskin not yet surfaced. |
| Evolution as progression | ✅ | **Evolution through play (§17.8).** Each owned individual trains as your team wins (a win grants team XP, gym or ranked online); once trained (`EVOLVE_XP`) the Collection screen offers its evolution(s) — a branching line like Eevee lets you choose. Server-validated against the species' real `evos`. |
| Terastallisation | ✅ | `src/game/tera.ts` + the `MOVE_TERA` action — one per side per game, changing the type a piece **fights and defends as**, which is the most consequential transformation available because type is what everything else is priced against. The Tera type is drafted to turn the piece's best coverage move into STAB (or, failing that, into a dual-typed species' other type). Ground 2× becomes 0× on a Charizard that Teras to Flying — a genuine escape. Board shows the new ring colour plus a crystal. |
| Mega / Z-Move / Dynamax | ○ | data is present (mega stones, etc.). These are forme/stat swaps rather than type changes, so they need forme-swap plumbing (a piece changing species mid-game) that nothing else needs yet. |

## The opponent

| Area | State | Notes |
|---|---|---|
| AI search + evaluation | ✅ | `ai/search.ts`, `ai/evaluate.ts` — type-aware negamax, four difficulties, beginner misjudges types. |
| Playable vs AI in the app | ✅ | title-screen opponent/difficulty picker; AI plays its turn automatically. |
| Web Worker / off-thread search | ○ | runs on the main thread; fine at low depth, would stutter at Champion on a full board. |

## The meta-game

| Area | State | Notes |
|---|---|---|
| Accounts, passwords, sessions | ✅ | `server/` — scrypt, secure cookies, zero native deps. |
| Profiles (display name, bio, status) | ✅ | server-side; validated and moderated-by-shape. |
| Character customization (avatar) | ✅ | `profile/avatar.ts` — games-faithful, shared client/server model. |
| Collection / Pokédex (individuals) | ◑ | `ui/CollectionScreen.tsx` — the owned grid (duplicates counted) and a Pokédex figure of distinct species / 1025. **Acquisition loop shipped:** a Gym win offers three Pokémon to catch (`RewardChooser`), claimed via `POST /api/collection/claim`, and each individual trains toward evolution. Remaining: richer filters/sort and per-individual detail. |
| Client UI for accounts/profile | ✅ | `ui/AccountScreen.tsx`, `ui/AvatarCustomizer.tsx`, `ui/useSession.ts`, `net/api.ts` — sign-up, login, profile fields, and the region-grouped trainer customizer, wired to the backend and routed from `App.tsx`. |
| Ranked ladder + gym badges | ✅ | **One loop, not two tracks.** Rating comes from beating real players online; each Gym Leader has a `ratingRequired` and accepts your challenge only once you reach it, so the eight badges chart a competitive career: climb → take the badge → climb again. Gyms still open in canon order (a fair difficulty step), a rematch of an earned badge is **unrated** so an easy leader cannot be farmed, and the badge case is never stripped by a losing streak (§17.8). Brock's gate is the base rating so a new account can earn its first badge at once; Giovanni's is the Champion League floor. `src/ladder/` + `ui/LadderScreen.tsx`, local-first with server-authoritative sync. |
| Multiplayer (matchmaking, friendly games, live games) | ◑ | **Online play shipped and now server-authoritative.** `server/matches.ts` + `ui/OnlineScreen.tsx` — in-memory rooms, matchmaking (random pairing, **ranked**) and private games by shareable code (friendly). Since a game is a seed + action list, both clients draft the same armies from the shared seed; the server runs the engine (`server/gameValidator.ts`, dex read from disk) to validate every move — illegal or out-of-turn moves are rejected, king capture ends the game, and ranked games settle both ratings (`Accounts.recordHeadToHead`). **Turn clocks**: 8 min per side, debited server-side on every read/write; a flag-fall loses on time (`endedBy: 'timeout'`). Board plays via GameBoard controlled mode; client polls. Pending: presence (online/offline) and chat. |
| Friends | ✅ | `ui/FriendsScreen.tsx` + `friendships` table — add by username, accept/decline, remove/withdraw; requesting someone who already asked you accepts instead. A friend row's primary action is Challenge, which opens a private game and hands you the code to send them. No free-text chat by design (§17.10 treats stranger chat as a moderation liability for this audience). |
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

Everything in the original six-tract plan has shipped. What remains, in value order:

1. **The rest of ISA-op execution in the Clash** — the one genuinely large tract left. Ability immunities
   and held items fire today; still to run: **stat stages** (Speed decides who swings first, so a Speed drop
   is the highest-leverage one), hazards, weather, and recoil/contact effects. Each is a slice of the same
   interpreter over the already-compiled descriptors, so this is incremental rather than a rewrite.
2. **Effect animations** — now unblocked for the effects that do fire (status marks land silently today).
3. **Presence and chat** — a friend list that shows who is online, and a fixed quick-chat vocabulary
   (§17.10 rules out free text between strangers for this audience).
4. **Mega / Z-Move / Tera / Dynamax** — the data is present; these are in-battle transformations on top of
   the ISA work in (1).
5. **Off-thread AI search** — a Web Worker, so Champion depth cannot stutter the board.
6. **Collection depth** — filters, sort, and per-individual detail (evolution line, record).

Known measurements worth revisiting: White scores ~0.54 (Trainer) to ~0.68 (Ace) in self-play — normal for
a chess-like game, but worth re-measuring if the bonus-move rule changes.
