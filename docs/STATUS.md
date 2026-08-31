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

## Redirection

| Area | State | Notes |
|---|---|---|
| Move redirection | ✅ | `src/rules/redirect.ts` — the last mechanic with no home in the Clash, and the reason was structural: a Clash is an exchange between exactly two pieces, so redirection needs a *third* to step into it. Resolved before a Clash begins by choosing who the defender actually is; the Clash never learns a substitution happened. Two sources, both read off real data: **a drawn type** (Lightning Rod, Storm Drain — the only two abilities whose own text says they *draw* a type, and they already grant immunity to it, so an intercepted attack is absorbed outright for +1 Sp. Atk and a wasted enemy turn), and **a cast guard** (Follow Me, Rage Powder, Spotlight, recognised by their `volatileStatus` and surfaced as a new kind of art) which answers for its neighbours until the opponent has replied. On a board it is a bodyguard, and it trades material for position: a guard can rout an attacker it never fought, but neither side gains ground, because the square attacked was never contested. The forecast previews the exchange that will *actually* be fought, and `blockedReason` names the neighbour that drew the attack rather than blaming the target's typing. |

## Transformations & progression mechanics

| Area | State | Notes |
|---|---|---|
| Promotion (pawn → back-rank class) | ✅ | via the chess core; "evolution" reskin not yet surfaced. |
| Evolution as progression | ✅ | **Evolution through play (§17.8).** Each owned individual trains as your team wins (a win grants team XP, gym or ranked online); once trained (`EVOLVE_XP`) the Collection screen offers its evolution(s) — a branching line like Eevee lets you choose. Server-validated against the species' real `evos`. |
| Terastallisation | ✅ | `src/game/tera.ts` + the `MOVE_TERA` action — one per side per game, changing the type a piece **fights and defends as**, which is the most consequential transformation available because type is what everything else is priced against. The Tera type is drafted to turn the piece's best coverage move into STAB (or, failing that, into a dual-typed species' other type). Ground 2× becomes 0× on a Charizard that Teras to Flying — a genuine escape. Board shows the new ring colour plus a crystal. |
| Draft-time control over the kit | ✅ | `resolveKit` in `game/draft.ts` + the kit panel in `ui/DraftScreen.tsx` — a slot records only what the player actually decided, and everything they left alone resolves to the auto-draft's choice, so a hand-built army is never quietly weaker than a generated one. The panel then lets them override all four layers per piece: ability (the species' real ones), held item (every item the rules implement, with its effect shown), **art** (each field move the species can cast — a Ferrothorn laying Spikes, setting Stealth Rock or raising a screen is three different pieces), and Tera type (never the type it already fights as). Team-building depth without a mandatory step: a player who never opens the panel still fields a coherent army. |
| Mega / Z-Move / Dynamax | ✅ | `src/game/transform.ts` + `MOVE_MEGA`/`MOVE_DYNAMAX`/`MOVE_ZPOWER`. **All four transformations share one per-side use**, which is the rule the games actually have (they are generation-exclusive), so four buttons become one decision a side makes once. `transformAvailable` reads the history, so a piece that transformed and then fell cannot refund it. **Mega** genuinely swaps species — `statsOf`, `abilityOf` and `battleTypeOf` read through the forme, so a Gyarados that Megas fights as Mold Breaker with the forme's stats; ten of the 47 formes change typing, and a declared type the forme lost falls to the forme's first. No mega forme changes the HP base stat (a real fact of the games, asserted), which is why max HP needed no plumbing. **Dynamax** doubles current and max HP for 3 turns and returns the same share on lapse; it is offered only to a piece in contact, because sixteen identical "Dynamax this piece" options were a quarter of the opening's move list and cost the search real depth. **Z-Power** converts one blow through the gen-7 table (which compresses at the top, so it is worth most on a weak move), fires only on the crystal's type, and is spent when it lands. Each side's auto-draft gets exactly **one** stone or crystal: more would replace real items with dead weight, which measurably drained the game's damage. |

## The opponent

| Area | State | Notes |
|---|---|---|
| AI search + evaluation | ✅ | `ai/search.ts`, `ai/evaluate.ts` — type-aware negamax, four difficulties, beginner misjudges types. |
| Playable vs AI in the app | ✅ | title-screen opponent/difficulty picker; AI plays its turn automatically. |
| Web Worker / off-thread search | ✅ | `ai/searchWorker.ts` + `useAsyncSearch` — the game crosses `postMessage` as a seed + action list (no new format), so Champion depth no longer stutters the board. Measured 145 frames in 1200 ms during a search. Falls back to the main thread if a worker cannot be created. |

## The meta-game

| Area | State | Notes |
|---|---|---|
| Accounts, passwords, sessions | ✅ | `server/` — scrypt, secure cookies, zero native deps. |
| Profiles (display name, bio, status) | ✅ | server-side; validated and moderated-by-shape. |
| Character customization (avatar) | ✅ | `profile/avatar.ts` — games-faithful, shared client/server model. |
| Collection / Pokédex (individuals) | ◑ | `ui/CollectionScreen.tsx` — the owned grid (duplicates counted) and a Pokédex figure of distinct species / 1025. **Acquisition loop shipped:** a Gym win offers three Pokémon to catch (`RewardChooser`), claimed via `POST /api/collection/claim`, and each individual trains toward evolution. Remaining: richer filters/sort and per-individual detail. |
| Client UI for accounts/profile | ✅ | `ui/AccountScreen.tsx`, `ui/AvatarCustomizer.tsx`, `ui/useSession.ts`, `net/api.ts` — sign-up, login, profile fields, and the region-grouped trainer customizer, wired to the backend and routed from `App.tsx`. |
| Ranked ladder + gym badges | ✅ | **One loop, not two tracks.** Rating comes from beating real players online; each Gym Leader has a `ratingRequired` and accepts your challenge only once you reach it, so the eight badges chart a competitive career: climb → take the badge → climb again. Gyms still open in canon order (a fair difficulty step), a rematch of an earned badge is **unrated** so an easy leader cannot be farmed, and the badge case is never stripped by a losing streak (§17.8). Brock's gate is the base rating so a new account can earn its first badge at once; Giovanni's is the Champion League floor. `src/ladder/` + `ui/LadderScreen.tsx`, local-first with server-authoritative sync. **Gym battles are refereed by the server** (`server/gymMatches.ts` + `gymEngine.ts` + `aiPool.ts`). The server issues the seed, validates the player's move, plays the Gym Leader itself on a bounded worker pool, and records the outcome from its own engine — so there is no endpoint for a client to report a result to, and `/api/ladder/result` is deleted rather than hardened. Two attacks made that necessary: the browser used to mint the seed, and because `buildGymMatch` draws the *player's own* army from it, a client could seed-shop offline for a favourable draw; and verifying a submitted action list for legality alone accepts a game where the leader played deliberately terribly (a fabricated 13-move "win" over Giovanni passed). Batch verification was measured and rejected — a depth-4 leader is seconds per search, so re-running a game would take minutes in one request; playing it move by move is the same work the browser's Worker already did, relocated. The pool exists because Node is single-threaded: an inline search would freeze every other request. Signed-out players keep a purely local battle and a purely local ladder.|
| Multiplayer (matchmaking, friendly games, live games) | ✅ | **Online play shipped and now server-authoritative.** `server/matches.ts` + `ui/OnlineScreen.tsx` — in-memory rooms, matchmaking (random pairing, **ranked**) and private games by shareable code (friendly). Since a game is a seed + action list, both clients draft the same armies from the shared seed; the server runs the engine (`server/gameValidator.ts`, dex read from disk) to validate every move — illegal or out-of-turn moves are rejected, king capture ends the game, and ranked games settle both ratings (`Accounts.recordHeadToHead`). **Turn clocks**: 8 min per side, debited server-side on every read/write; a flag-fall loses on time (`endedBy: 'timeout'`). Board plays via GameBoard controlled mode; client polls. **Quick chat** is an index into a fixed ten-phrase vocabulary (`QUICK_CHAT`), rate-limited per side and capped at 20 lines — the social warmth with nothing to moderate, since nothing arbitrary can be said. Presence (online/offline) is tracked via `Accounts.touchPresence`. **Ratings settle only on what the server can prove**: a flag-fall (its own clock) and a king capture (its own replay) rate freely, so abandonment is still punished; a resignation and a relay-mode client report cannot be proved at all, so they need `RANKED_MIN_ACTIONS` real moves behind them. A client-reported outcome is *ignored* whenever an engine is configured, because `move()` already ends terminal positions itself — before that it was accepted, and one request with an empty action list moved real Elo. Join codes and room ids come from `crypto.randomInt`, since a code is the only credential on a private room. |
| Friends | ✅ | `ui/FriendsScreen.tsx` + `friendships` table — add by username, accept/decline, remove/withdraw; requesting someone who already asked you accepts instead. A friend row's primary action is Challenge, which opens a private game and hands you the code to send them. No free-text chat by design (§17.10 treats stranger chat as a moderation liability for this audience). |
| Trading | ✅ | `ui/TradeScreen.tsx` + `trades` table — propose a swap of individuals to another trainer (give and/or request, picked from both collections), who accepts/declines; the proposer can cancel. Ownership is validated on both sides at propose and again at accept, and the swap runs in one transaction so nothing duplicates. Verified end-to-end over HTTP. |

## Presentation & onboarding

| Area | State | Notes |
|---|---|---|
| Board, pieces, type colours, role legibility | ✅ | `ui/` — the king/pawn identity problem is solved. |
| Capture-outcome animations | ✅ | five distinct motions, reduced-motion path. |
| HP bars, forecast preview, refusal affordance | ✅ | on the board. |
| Effect animations | ✅ | `ui/BattleFx.tsx` — the exchange plays out blow by blow: the move called out in its type colour, the attacker lunging, a type-coloured impact and rising damage number per blow (crits bigger and gold), a recoil reading, hit reactions, and status/stage pops. Derived from the resolution, so it can never disagree with the outcome; skipped under `prefers-reduced-motion`. |
| **Tutorial** (DIRECTION directive 7) | ✅ | `src/tutor/` + `ui/TutorScreen.tsx` — a lesson is a real game on a hand-built position, not a script (§18.1). Twelve lessons across the two branch tracks (movement, type chart) and the shared spine: the four capture outcomes each caused by the player, the untouchable-piece refusal, the miss and crit reveals, a status lesson, and king capture. `lessons.test.ts` proves every goal reachable and every beat producible against the live engine — a rotted lesson fails CI. |
| Sandbox / batch simulator | ✅ | `src/sim/batch.ts` + `ui/SandboxScreen.tsx` — runs many seeded AI-vs-AI games and reports win/draw shares, White score and average length; deterministic and rot-proofed (a deeper AI must outscore a shallower one). Measured over 40 self-play games per tier: White score 0.40 (Rookie) → 0.54 (Trainer) → ~0.68 (Ace) — a moderate, skill-scaling first-move edge in the normal range for a chess-like game, not an imbalance needing a rule change. |

## What remains

Everything in the plan, and everything the owner has since asked for, has shipped, and the two items that were
deferred with a rationale are now done too — including the forme-swap plumbing that was the real blocker.

Every progression path is now server-derived: PvP ratings come from the server's own match state, gym results
from a battle the server refereed move by move, encounters are issued by the server when a real game ends and
claimed by index, and the marketplace and trades validate ownership on both sides inside a transaction.

Nothing is knowingly missing. What is worth knowing rather than doing:

0. **Two costs came with refereeing gym battles, both accepted deliberately.** The Gym Leader's search now runs on
   the server, so a deep gym costs it real CPU — roughly 210 s across a Giovanni battle, in bursts of a few
   seconds, bounded to one battle per account and served from a worker pool so it cannot block other requests.
   And a signed-in gym battle needs connectivity per move, where it used to run entirely in the browser. Signed-out
   play is unchanged and still works offline against a local AI.
1. **Abandoning a losing gym battle still costs nothing**, because nothing is recorded until a game ends. That is
   unchanged rather than newly introduced — walking away from the old client-side screen recorded nothing either —
   and it is bounded, since a gym win banks only once and climbing past the badges needs real PvP. Making a
   forfeit a loss is a product call with a real cost: a dropped connection would take a badge.

1. **Games are longer than they were.** Against the same seeds, a self-play batch that averaged 224 plies now
   averages around 411, and more games reach the length cap. The added depth is the cause — there are more ways
   to spend a turn that do not change the board (arts, four transformations), and the AI at a fixed depth uses
   them. The skill signal survives it (a deeper search still outscores a shallower one in both colours), but if
   games start feeling like they meander, the first thing to look at is how often the AI re-casts an art whose
   effect has just expired.
2. **The AI does not value a transformation.** It will spend one, because it is a legal action that its search
   sometimes likes, but the evaluation has no term for "this piece is now permanently stronger" or "this piece
   cannot be traded for three turns". A human will use them better, which is fine, but it means the sandbox
   under-measures how strong they are.

Balance, as measured by the sandbox: White scores ~0.54 (Trainer) to ~0.68 (Ace) in self-play — normal for a
chess-like game. Worth re-measuring if the bonus-move rule changes.

Two engine bugs were found while finishing this work, both pre-existing and both now fixed with regression
tests:

- **The server rejected castling, arts and Tera as malformed.** `server/matches.ts` bounded an encoded action
  at `0xffffff`, a ceiling written when the widest flag was `MOVE_CASTLE_KING`. Three flag bits had been added
  above it since, so online play refused every queen-side castle, every art cast and every Terastallisation
  before the engine was consulted. The bound is now folded out of the flags themselves (`MAX_ENCODED_MOVE`), so
  adding a flag widens it by construction. The test that was supposed to catch this had encoded the bug: it
  asserted `0xffffff + 1` must be rejected, which is exactly `MOVE_CASTLE_QUEEN`.
- **A phantom en passant capture.** Ordinary chess never needs the check, because the pawn that creates an en
  passant square cannot leave before the one turn it can be captured — but this game removes pieces *between*
  moves (Sandstorm chip, poison, a hazard on arrival), so a pawn can double-push and then die at the Checkup.
  The generator then offered an en passant capture of an empty square and crashed on the victim's identity.
  Found by fuzzing 400 seeded games; revalidation lives in `withPieceRemoved` so every route that kills a piece
  is covered.
