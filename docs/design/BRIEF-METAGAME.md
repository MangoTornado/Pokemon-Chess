# Meta-game Design Brief — collection, accounts, multiplayer, ranked

Companion to [`BRIEF.md`](./BRIEF.md), which covers the **match**. This one covers everything **around** the
match: what you own, who you play, and what you are climbing.

[`DIRECTION.md`](./DIRECTION.md) is authoritative and outranks this document. Read it first.

## 1. Why this is a separate brief

The match ruleset and the meta-game are separable, and keeping them separable is a design goal rather than
an accident. The match asks "what does a capture mean?". The meta-game asks "which Pokémon may I bring, who
am I playing, and what do I get for winning?". They meet at exactly one seam:

> **The draft is parameterised by a pool source.** `full-dex` for sandbox and casual, `collection` for
> progression and ranked. The match rules must never know which is in play, and collection state must never
> leak into capture resolution.

Everything else in the meta-game can be designed without reopening the match rules.

## 2. What is already settled (do not relitigate)

From `DIRECTION.md`:

- All 1025 Pokémon exist in the data. The collection controls *access*, not existence.
- **Own individuals, not species** (recommended): three separate Pikachu, each fieldable. This clears the
  16-piece floor and makes duplicate rewards useful in one decision, and matches how Pokémon works.
- **A legal army is 16 pieces**, so a new account must be able to field 16 immediately.
- **Local-first for solo play**; the game must be playable seconds after loading with no account. But a
  **real backend is required** for friends, matchmaking, ranked and trading.
- **Authoritative server.** The server owns the RNG seed and resolves captures. A client-owned d6 is
  trivially cheatable and would make ranked play meaningless.
- **Glicko-2 internally, gym badges as the displayed identity.** Kanto's eight badges in canon order
  (Boulder, Cascade, Thunder, Rainbow, Soul, Marsh, Volcano, Earth), Elite Four above them, Champion as a
  top-N leaderboard rather than a rating threshold.
- **Gym Leader promotion matches** against mono-type AI armies are strongly recommended as the gate between
  badge tiers.
- **Rarity derives from data already in `species.json`** — `tags` (80 Sub-Legendary, 49 Restricted
  Legendary, 55 Mythical, 11 Ultra Beast, 16 Paradox), `bst` (175–1125), `tier`, `nfe` — not from invented
  tiers.
- Evolution data is fully available: `prevo`, `evos`, `evoType`, `evoLevel`, `evoItem`, `evoMove`,
  `evoCondition`, and branching lines are traversable via `Dex.evolutionLineOf`.

## 3. Why the engine's purity is now load-bearing

The engine is pure, deterministic and seeded. That was a testability decision; multiplayer turns it into
the foundation of the whole networking model.

Because the same TypeScript module runs in Node and the browser:

- the **server validates every move with the identical code the client runs**, so there is one source of
  truth and no reimplementation drift;
- a **complete game serialises to a seed plus an ordered action list**, so network messages are tiny,
  replays are free, spectating is free, and reconnect is just replay;
- **desync is detectable** by comparing state hashes.

Any impurity introduced into the engine — an ambient `Math.random`, a clock read, a DOM touch — forfeits all
of this simultaneously. Treat it as an invariant, not a preference.

## 4. The hard problems

A proposal that ducks these is incomplete.

### Collection and economy

1. **The acquisition curve, in numbers.** What does a new account start with? What does a win grant, and
   what does a loss grant? "A challenge but not too difficult" must become a target curve that can be tuned
   against the batch simulator, not an adjective. State expected collection size after 1, 10, 50 and 500
   matches.
2. **Rarity and pity.** Derive tiers from real data. How are Legendaries and Mythicals gated so they feel
   special without being a grind wall? What prevents a long unlucky streak from feeling punitive?
3. **Duplicates.** With individual ownership, duplicates are useful — but is there a ceiling past which
   another Bidoof is worthless? Is there conversion, a candy-like currency, or release-for-value?
4. **Evolution as progression.** What triggers an evolution — matches played, captures made, an item, a
   level analogue? Does evolving consume the pre-evolution or add to the collection? How are branching
   lines (Eevee's nine) and trade evolutions (Machoke → Machamp) handled? This is the richest progression
   axis; treat it as a headline mechanic, not a footnote.
5. **The fairness problem, which is the one most likely to kill the game.** If a deeper collection simply
   wins, the game is pay-to-win by grinding. State concretely how a 20-Pokémon account stays competitive
   with an 800-Pokémon one. Candidate answers: point-buy budgets, format-scoped legality, mirror-pool
   modes, tiering by rarity, drafting from a shared pool in ranked. Pick and defend.
6. **What an owned individual actually carries.** Species, chosen type, ability, item, moveset, cosmetic
   variation, nickname, a record of games played? More per-individual state means deeper progression and
   worse legibility. Decide, and note this is the one place the match rules constrain you.

### Accounts and persistence

7. **Local-first to server-bound.** How does an offline profile bind to an account later without data loss
   or duplication? What happens if the same account plays on two devices? What is authoritative?
8. **Data safety.** Export/import, what clearing means, and what a player is owed if the server loses data.

### Multiplayer

9. **Netcode.** Message protocol, who owns the seed, turn timers, reconnect grace, abandonment and forfeit
   policy, spectating, and desync detection. Concrete enough to implement.
10. **Matchmaking.** Rating-based pairing with a widening window, a stated target queue time, and a
    published behaviour at low population — the hardest real problem for a new game, so do not assume a
    healthy queue. How does it pair on *collection depth* as well as rating?
11. **New-player protection.** Provisional rating, restricted early pairing, and how smurfing and
    deliberate deranking are handled.
12. **Anti-cheat beyond move validation.** Win-trading on the ladder, collusion, botting, and multi-account
    reward farming. Server-authoritative resolution solves move legality only.

### Ranked and progression feel

13. **Ladder design.** Glicko-2 parameters, mapping rating to badge tiers, subdivisions, seasons, decay,
    and how promotion and demotion *feel*. Keep "highest badge earned" separate from "current tier" so the
    ladder can be brutal without the profile feeling punitive.
14. **Gym Leader matches.** The roster and their types, how a mono-type AI army is constructed to be a fair
    but real puzzle, difficulty tuning, rematch policy, and how the gate avoids becoming a wall that ends a
    player's climb. Note that mono-type armies are a *legible, solvable* puzzle precisely because type is
    the core mechanic — lean into that.
15. **Champion scarcity.** A top-N rank needs a defined population, reset policy and tie-breaking.

### Social and safety

16. **Friends and presence.** Add, accept, block, presence, invite-to-game, and friendly matches with
    agreed settings and no rating effect.
17. **Communication safety.** Pokémon's audience includes children. Free-text chat between strangers is a
    moderation liability and a safety risk. Strongly consider canned phrases, emotes, or a fixed
    quick-chat vocabulary for public matchmaking, reserving free text for mutual friends if at all. State a
    position, including reporting and blocking.
18. **Trading safety.** Scam resistance (confirmation, both-sides-lock, cooldowns), duplication-bug
    resistance (server-authoritative atomic transfer), and whether trading should be rating-gated or
    friend-gated to limit reward farming. Also: is trading net-positive for balance at all? Argue it.

### Sandbox

19. **Sandbox and batch simulation.** Free choice of both armies, full dex, AI-vs-AI, adjustable strength,
    deterministic shareable seeds, and a **headless batch simulator** reporting outcome distributions, game
    length, capture-outcome frequencies, per-type win rates and first-player advantage. This is the
    instrument that turns balance claims into measurements; specify its output.

### Architecture

20. **Backend.** Stack, hosting, data model, migrations, and cost at small scale. Be honest about
    operational burden — a design requiring a team to run is the wrong design here. Say what runs where,
    and what degrades gracefully when the server is unreachable.

## 5. Output contract

Be concrete: numbers, formulas, schemas, protocol messages, tier tables, target queue times. Where you make
a judgement call, say what you traded away. Where a mechanic is authentic to the games or the TCG, say
which and why a player would recognise it.
