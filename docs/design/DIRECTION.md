# Direction — explicit product steering

**Status: authoritative. This document outranks the design proposals and the judges' scoring.**

It records what the project owner actually asked for, in their own words, so that a design debate cannot
quietly resolve against it.

## Verbatim asks

1. > "I want to create a fully fledged game that looks good and performs well that works similar to
   > that, but with all of the pokemon and make it make sense with all pokemon moves, items, abilities,
   > along with the chess mechanics"

2. > "I want everything to be fully fleshed out and very functional with cool and interesting mechanics
   > tied to how pokemon function with typing and moves etc"

3. > "make sure that all of the interactions are proper and make sense to how it works in pokemon
   > (games/tcg), as well as make sure the visuals look pleasing, maybe have animations or something for
   > captures or different moves, etc, I want it to look like a good and fully fleshed out game, with
   > nice visuals"

4. > "What I also want is a sandbox environment to do playtests and trial runs, and also a way to have
   > accounts and to actually collect / catch new pokemon somehow, whether you get to choose your starting
   > set and then every win you get a choice between a few random pokemon, or some sort of evolution
   > method, or trading with other people, want to have a way to increase your pokedex and collection
   > making it a challenge but not too difficult"

5. > "In accordance with that new layer, this is what i mean by a fully fledged and fleshed out game, it
   > should be very well designed and thought out with many cool mechanics"

6. > "You should also be able to add friends and queue into battles with random people not just the bot, as
   > well as do friendly battles, there should also be a ranking system tied to a ranked mode, with ranks
   > maybe related to typical badges earned in a pokemon game, I think that is a good addition"

## What "fully fledged" means, definitively

Directive 5 is the interpretive key to all the others. The target is **a complete game**, not a clever
chess variant with a Pokémon theme and not a tech demo of the type chart.

Concretely, the finished thing has all of these, each designed rather than bolted on:

| Layer | What it means |
|---|---|
| **The match** | Deep, faithful rules where typing, moves, abilities and items all matter and interact. |
| **The meta-game** | Accounts, a collection you grow, evolution, trading, a Pokédex worth completing. |
| **The sandbox** | Free play and playtesting, plus batch simulation that *tests* the balance claims. |
| **The presentation** | Distinct animations per outcome, coherent art direction, effects with real identity. |
| **The opponent** | An AI that plays the variant properly and misjudges *types* at lower difficulties. |
| **The onboarding** | A chess player and a Pokémon player can each learn this without a manual. |
| **Multiplayer** | Friends, matchmaking against strangers, friendly games, and a ranked ladder. |

"Many cool mechanics" is an explicit instruction to be generous with depth. When in doubt, add the
mechanic and make it legible — do not trim it for tidiness. The bar to clear is not "is this defensible?"
but "is this a game someone would choose to keep playing?"

## What this settles

### Maximalism is the brief, not a risk to be managed

The design phase ran four rival philosophies, one of which argues for minimal deviation from chess and
for making Pokémon content *passive* to keep the rules on one page. That is a legitimate design
position and it will score well on pacing and legibility — **but it is not what was asked for.**

Where a choice exists between a thinner, safer ruleset and a richer one that genuinely engages Pokémon
systems, **the richer one wins**, subject only to the two hard constraints below. "Cool and interesting
mechanics" and "fully fleshed out" are the acceptance criteria. A game that is merely chess with Pokémon
sprites on the pieces is a failure of this brief even if it is a better chess variant.

### Mechanics must be *derived from* authentic Pokémon behaviour

The phrase "tied to how pokemon function with typing and moves etc" is the load-bearing one. A mechanic
qualifies when a Pokémon player would recognise it as that thing behaving the way it behaves in the real
games. It does not qualify when it is a generic board-game effect wearing a Pokémon name.

Concretely:

- **Good:** Levitate makes a piece uncapturable by Ground, because that is exactly what Levitate does.
  Sticky Web on a square slows whatever lands there. U-turn returns the piece to the square it came from
  after capturing. Rough Skin damages whatever captures it. Trick Room inverts move order. Choice Band
  locks a piece into repeating its committed action.
- **Bad:** "Fire pieces move one extra square" — invented, arbitrary, unmoored from anything Fire does.

Faithfulness is a first-class quality bar. A mapping that is systematic but thematically wrong is a
defect, and should be reported as one.

### The TCG is a legitimate source, not just the video games

"how it works in pokemon (games/tcg)" names **both** canons. The mainline games are the primary
reference for typing, moves, abilities and items. But the TCG has already solved several problems this
project runs into, and it solved them for a *board game with a small action budget per turn* — which is
much closer to our situation than a real-time battle sim is. Where the TCG has a cleaner answer, take it,
and say which canon a mechanic came from.

Specific places the TCG is the better precedent:

- **Coin flips.** The TCG resolves an enormous amount through coin flips: Paralysis, Confusion, Sleep
  recovery, and dozens of attack effects. This directly legitimises the video's d6. Randomness on an
  attack is not a hack bolted onto Pokémon — it is *how the Pokémon board game already works*. Prefer
  framing our RNG in those terms, and prefer TCG-style "flip to see if the effect lands" over invented
  probability curves.
- **Weakness and Resistance.** The TCG expresses the type chart as an explicit, printed-on-the-card
  modifier: Weakness increases damage, Resistance reduces it. That is the closest existing precedent for
  our capture rule, and its vocabulary ("Weakness", "Resistance") is worth reusing in the interface
  because players already read it as a number that changes an outcome.
- **Status conditions.** The TCG's Asleep / Paralyzed / Confused are turn-scoped, board-visible, and
  cleared by a defined event — a far better fit for a chess turn than the games' HP-tick model.
  Poisoned and Burned as end-of-turn damage carry over cleanly too.
- **Retreat cost.** A concrete precedent for making *movement itself* cost something, which is a lever a
  chess variant can use where the mainline games have no equivalent.
- **Evolution.** In the TCG evolution is a deliberate action played onto a Pokémon in play, which maps
  onto pawn promotion far more directly than the games' level-up model.
- **Tool and Stadium cards.** Precedent for held items on a piece and for global board-wide effects,
  respectively — including that both are *visible to both players*, which matters for legibility.

Do not invent a third canon. Every mechanic should be traceable to the games or the TCG, and the
implementation should record which.

### Visuals and animation are a requirement, not polish

"nice visuals", "look like a good and fully fleshed out game", and animations for captures and moves are
**acceptance criteria**, ranked alongside correctness. A mechanically perfect game that looks like a
prototype has failed this brief.

What this commits us to:

1. **Every capture outcome has a distinct, readable animation.** The four outcomes — super effective,
   neutral, not very effective, no effect — must be instantly distinguishable *without reading text*.
   These are the moments the game is built around; they should feel good and land hard. Mutual
   destruction should visibly destroy both pieces. An illegal capture should read as a rejection, not
   as nothing happening.
2. **The free extra move after a super-effective capture must be dramatised.** It is the single most
   important consequence in the game, and a player must never miss that they have it.
3. **Moves, abilities and items get visual identity.** Type-coloured effects at minimum, with recognisable
   treatments for the marquee cases — hazards visibly sitting on squares, status visibly afflicting a
   piece, weather and terrain visibly changing the board, a trapped piece visibly held.
4. **Animation must never gate play.** Provide a speed control and a skip, honour
   `prefers-reduced-motion`, and keep the game fully playable with animation off. Nothing may block input
   waiting on a flourish.
5. **Performance is part of looking good.** Hold 60fps during effects. Judder reads as cheapness more
   than a missing effect does.
6. **Art direction is a deliberate decision, not an accident of defaults.** Pick a coherent look — board,
   pieces, typography, colour, type identity, HUD — and write it down so contributions stay consistent.
   The 18 type colours are already fixed in `src/ui/typeColors.ts`; treat them as the palette's spine.

Note the constraint discovered while measuring assets: animated sprites exist for only part of the dex
(Miraidon and Pecharunt have none and fall back to stills). Animation quality must therefore come from
*effects we draw*, not from assuming animated source art. See
[`recon-data-substrate.md`](./recon-data-substrate.md) §6.

### "Very functional" means shipped, not sketched

Every system named in the spec must actually work end to end in the running game: draft, board, capture
resolution, moves, abilities, items, status, hazards, evolution/promotion, win conditions, AI opponent,
and the UI that makes all of it legible. Stubs, "v2" placeholders, and mechanics that exist only in the
spec do not count. Where scope must be staged, each stage must be *complete and playable*, never a
half-wired system.

### Coverage is total, and it is testable

All 1025 Pokémon. All 950 moves, 311 abilities, 536 items resolve to something coherent — verified by a
test that walks the entire content set, not by assertion in prose. See
[`recon-data-substrate.md`](./recon-data-substrate.md) §7 for the `signalClass` mechanism that makes
this auditable, and note that the same document measures the real curation floor: roughly a third of
moves have code-implemented behaviour that no field-derivation can recover.

### There is a meta-game: sandbox, accounts, and a collection you grow

Directive 4 adds a whole layer above the match. It is in scope.

#### The load-bearing architectural consequence — read this even if you skip the rest

**The draft must be parameterised by a *pool source*, and the match rules must not know which one is in
play.** Two sources exist:

- `full-dex` — all 1025 Pokémon. Used by the sandbox, playtesting, and casual play.
- `collection` — only the Pokémon this account actually owns. Used by progression and ranked play.

This is a hard architectural seam. Get it wrong and the ruleset and the meta-game become impossible to
evolve independently. Any design that hard-codes "draft from the full dex" is incomplete, and any design
that lets collection state leak into capture resolution is wrong.

#### A constraint that is easy to miss

**A legal army is 16 pieces.** So a player must be able to field 16 from their collection on day one, or
they cannot play at all. This bounds the early progression curve hard, and it forces an explicit decision
about what ownership means:

- Own **species** (one Pikachu entry, fieldable in one slot) ⇒ you need 16+ distinct species before your
  first game, and duplicate rewards are worthless.
- Own **individuals** (three separate Pikachu, each fieldable) ⇒ duplicates are immediately useful, the
  16-piece floor is easy to clear, and it matches how Pokémon actually works, where you catch many of the
  same species.

**Recommendation: own individuals.** It solves duplicate-handling and the 16-piece floor with one decision
and is the more faithful model. Not mandated — but a design choosing species-ownership must say how it
clears the 16-piece floor and what a duplicate reward does.

#### Sandbox

A first-class environment for playtests and trial runs, not a debug menu.

- Full dex, no progression, **no account required**. This is the default entry point: the game must be
  playable within seconds of loading, before any sign-up.
- Deterministic seeds, so a surprising game can be reproduced and shared. The engine is already seeded and
  serialisable for exactly this.
- Free choice of both armies, AI-versus-AI, and adjustable AI strength.
- **Headless batch simulation.** Run thousands of AI-versus-AI games and report outcome distributions, game
  length, capture-outcome frequencies, per-type win rates, and first-player advantage. This is how the
  balance claims in the spec get *tested* rather than asserted, and it is the single most valuable tool for
  tuning the RNG and the extra-move rules. It doubles as a player-facing curiosity.
- Ideally a position editor for constructing a specific situation.

#### Accounts

- **Local-first for solo play.** A profile persists on-device, and sandbox, single-player and collection all
  work offline with no server. Never gate core play behind an account — the game must be playable within
  seconds of loading.
- **A real backend is required**, not optional, because directive 6 adds friends, matchmaking, friendly
  games and a ranked ladder, and directive 4 adds trading. Design the local profile so it can later bind to
  a server account without a migration nightmare, but do not pretend the server is avoidable.
- Treat a collection as data worth not losing: export/import, and be explicit about what happens on clear.

### Multiplayer, and the badge ladder

Directive 6 requires: friends, queueing against strangers, friendly games, and ranked play.

#### This is where the pure engine pays off

The engine was already required to be pure, deterministic and seeded. That decision now becomes
load-bearing rather than merely tidy: because the same TypeScript engine module runs in Node and in the
browser, **the server can authoritatively validate every move with the identical code the client runs**, and
a whole game serialises to a seed plus an action list. That gives cheat resistance, tiny network messages,
free spectating, and reconnect-by-replay almost for nothing. Protect this property — any impurity that
creeps into the engine costs all of it at once.

Required, in dependency order:

1. **Authoritative server.** The client never decides outcomes. The server owns the RNG seed and resolves
   every capture, or the d6 becomes trivially cheatable, which would destroy ranked play specifically.
2. **Friends.** Add, accept, block, presence, and invite-to-game.
3. **Friendly games.** Direct challenge with agreed settings, no rating effect. Also the natural home for
   playing a specific format or a shared seed.
4. **Matchmaking.** Queue against strangers with rating-based pairing, a widening search, and a stated
   target queue time. Must handle the collection problem: pair players on comparable pools, or use a
   format that neutralises collection depth, so a new player is not fed to someone with 800 Pokémon.
5. **Ranked mode** with a real rating system underneath and badges on top.
6. **Reconnection and abandonment.** Turn timers, a grace period, and a stated forfeit policy. Non-negotiable
   for a ranked ladder to mean anything.

#### Ranks as gym badges

The owner's suggestion, and it is a good one — it is instantly legible to any Pokémon player and it makes
climbing feel like a journey rather than a number going up.

Recommended shape:

- **Glicko-2 rating internally** (Elo's uncertainty handling is too weak for a new ladder), never shown as
  the primary identity. The badge is the identity; the number is the machinery.
- **The eight Kanto badges as the ladder tiers**, in canon order — **Boulder, Cascade, Thunder, Rainbow,
  Soul, Marsh, Volcano, Earth** — each subdividable (I/II/III) if more granularity is wanted.
- **Elite Four** as the tiers above the eighth badge, then **Champion** as a top-N leaderboard rank rather
  than a rating threshold, so it stays genuinely scarce.
- Badges are **displayed as earned**, cumulatively, exactly as a Pokémon game shows a badge case. Losing
  rating should not visibly strip a badge you earned; separate "highest badge earned" from "current tier"
  so the ladder can be brutal without the profile feeling punitive.
- Later regions (Johto, Hoenn, …) are the natural way to extend the ladder for a second season rather than
  inflating Kanto into 64 tiers.

#### A mechanic worth adding: Gym Leader promotion matches

Strongly recommended, because it is nearly free and it is *exactly* the right idea for this game.

To promote past a badge tier, the player must defeat that **Gym Leader** — a named AI opponent fielding a
**mono-type army**. Brock brings Rock. Misty brings Water. Lt. Surge brings Electric. Erika brings Grass.
Koga brings Poison. Sabrina brings Psychic. Blaine brings Fire. Giovanni brings Ground.

Why this is a better fit here than in any other chess variant: **type is the core mechanic**, so a mono-type
army is not a cosmetic gimmick — it is a genuine, readable, solvable puzzle. A pure Rock army has exactly
known weaknesses, and the player's task is to bring a team that exploits them. It teaches the type chart by
making the player *use* it, which is precisely the skill the whole game is premised on. It also gives the
single-player, collection and ranked layers a shared spine: you draft from your collection, against a
themed opponent, to earn a ladder badge.

This should be designed alongside the ranked ladder, not bolted on afterwards.

#### Growing the collection

The owner named four candidate mechanisms. They are complementary rather than alternatives, and a good
design uses several:

1. **Starter selection.** Choose a starting set. Authentic — you pick a starter — and it must be large
   enough to field a legal army immediately.
2. **Post-match rewards.** Choose one of a few offered Pokémon. Authentic to encounters. A **win** should
   offer more and rarer choices; a **loss** should still offer something modest, because "challenging but
   not too difficult" means losing must not stall progress.
3. **Evolution.** The richest axis and the most faithful: you acquire base-stage Pokémon and evolve them
   *through play* rather than catching the final stage. Your Charmander becomes a Charizard because you
   used it. The dataset fully supports this — `prevo`, `evos`, `evoType`, `evoLevel`, `evoItem`, `evoMove`,
   `evoCondition` are all baked into `species.json`, and branching lines like Eevee's nine evolutions are
   already traversable via `Dex.evolutionLineOf`.
4. **Trading.** Player-to-player. Note that **trade evolutions are real** — Machoke becomes Machamp only by
   being traded — so trading has an authentic mechanical role beyond swapping duplicates, and it is a
   genuinely lovely thing to implement faithfully.

**Rarity should be grounded in real data, not invented.** `species.json` already carries the signals:
`tags` (80 Sub-Legendary, 49 Restricted Legendary, 55 Mythical, 11 Ultra Beast, 16 Paradox), `bst`
(175–1125), `tier`, and `nfe`. Derive rarity tiers from these so that a Mythical genuinely feels
unobtainable and a Bidoof genuinely does not.

#### Calibrating "a challenge but not too difficult"

State a target curve in numbers so it can be tuned against the batch simulator rather than argued about:

- A brand-new player fields a legal, viable army **immediately**.
- Progress is visible **every match**, win or lose.
- Meaningful collection growth within the first handful of matches.
- The long tail — completing the Pokédex, acquiring Legendaries and Mythicals — stays a long-term pursuit.
- **Collection size must not become the dominant source of competitive advantage.** If a large collection
  simply wins, the game is pay-to-win by grinding. Say explicitly how a small collection stays competitive;
  format restrictions, point-buy budgets, and mirror-pool modes are the usual answers.

## The two hard constraints that still bind

Richness does not license incoherence. Two things are non-negotiable regardless of how cool a mechanic is:

1. **Termination.** No rule may permit an unbounded turn. Extra-move chains, crit chains, and any
   move/ability/item interaction must carry a proven bound. This is the one place where a mechanic gets
   cut rather than tuned.
2. **Legibility under load.** A player must be able to see *why* something happened, immediately. Depth
   is the goal; confusion is not. The answer to complexity is better feedback and progressive
   disclosure — not fewer mechanics.

If a mechanic is cool but unbounded, bound it. If it is cool but opaque, surface it better. Cut only
when neither is possible.

## Process preference

Work in **incremental checkpoints** (commits) as the build progresses, rather than one large drop at the
end.
