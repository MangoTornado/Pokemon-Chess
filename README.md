# Pokémon Chess

Chess where every piece is a Pokémon with a single type, and the **type matchup decides what a capture
means**.

Concept inspired by Little Z's video: <https://www.youtube.com/watch?v=dcy4hBWAGHQ>

## The idea

In ordinary chess a capture has exactly one meaning. Here the type chart splits it into four, and that
one change reprices every square on the board:

| Matchup | Multiplier | What happens |
|---|---|---|
| **Super effective** | `2×` | The capture succeeds and your piece **immediately moves again**. |
| **Neutral** | `1×` | An ordinary chess capture. |
| **Not very effective** | `0.5×` | **Both pieces are destroyed.** |
| **No effect** | `0×` | The capture is **illegal**. Ground cannot take Flying. Normal cannot take Ghost. |

So a Flying piece simply cannot be touched by your Ground pieces — ever. A badly matched attack trades
your piece away as well as theirs. And a well-chosen one gives you a free tempo, which in chess terms is
enormous.

Before the game you **draft your army**: a Pokémon for each of the sixteen chess slots. A dual-typed
species is a real decision, because a piece fights as only one of its types — Lapras drafted as Water is
a different piece from Lapras drafted as Ice, and that choice determines what it can and cannot capture.

The premise of the whole thing is that knowing Pokémon type matchups is an edge that can beat a stronger
chess player.

## Status

Early but real. Working today:

- **The full dex, baked and queryable** — all **1025 Pokémon** across 1367 formes, **950 moves**,
  **311 abilities**, **536 items**, and the type chart, compiled to **271 KB gzipped**.
- **The type-matchup capture rule**, verified against the canonical chart (exactly 8 immunities, 51
  super-effective, 61 resisted).
- **Board geometry** for every piece class, validated against the known move-count totals for an empty
  board.
- **A deterministic seeded RNG**, because the d6 that decides critical hits is part of game state, not an
  ambient service.
- **A playable demonstration** — drafts two armies from the live dex and resolves capture outcomes.

Not built yet: the full ruleset, moves/abilities/items as board effects, the AI opponent, and the real
draft and match interface. The ruleset is being specified in [`docs/design/`](./docs/design/).

## Running it

Requires Node 20+ (developed on 24).

```sh
npm install
npm run dev        # dev server
npm test           # test suite
npm run typecheck  # tsc --noEmit
npm run build      # production build
npm run gen:data   # regenerate the dex bundles (needs network)
```

The generated dex bundles under `src/data/generated/` are **committed on purpose**, so a clean checkout
builds and tests offline without hitting the network. Regenerate them only when bumping the dex version.

## How it is put together

```
scripts/gen-data.ts      Build-time dex extraction. Reads @pkmn/dex + @pkmn/sim, emits the JSON bundles.
src/data/
  schema.ts              Shapes of the baked bundles.
  dex.ts                 Typed, lazily-loaded, indexed access to them.
  generated/*.json       The baked dex. Committed. Regenerate with `npm run gen:data`.
src/engine/
  board.ts               Squares, coordinates, and the raw movement pattern of each piece class.
  typechart.ts           Type effectiveness and the four capture outcomes.
  rng.ts                 Seeded, serialisable PRNG.
src/ui/                  React interface.
docs/design/             The ruleset design record. Start with DIRECTION.md, then SPEC.md.
```

Two rules keep this maintainable:

**The engine is pure.** No DOM, no React, no I/O, no `Math.random`. The same seed replayed against the
same action list reproduces a game exactly. That is what makes replays, network play, and AI search
possible at all, and it is why the RNG state is threaded through game state rather than kept on the side.

**Pokémon data is baked, never fetched at runtime.** `@pkmn/dex` and `@pkmn/sim` are build-time
devDependencies weighing tens of megabytes; the browser only ever sees the compact generated JSON.

### One thing to know before touching the data pipeline

`@pkmn/dex` silently strips every behaviour callback, and leaves no marker that it did.
`Dex.moves.get('rest').status` is `undefined` — Rest appears to be a move that does nothing, and Belly
Drum appears to boost nothing. Roughly a third of moves and nearly all ability and item behaviour lives
in code, not data.

The generator therefore also reads `@pkmn/sim`, which retains the real handler functions, and records a
`signalClass` on every entry stating *how* that entry's behaviour is knowable
(`fields`, `handlers`, `plain-damage`, `inert`). This turns "all content is handled" into something a
test can verify rather than something the docs assert.

Full measurements, including the forme-inheritance trap that leaves Charizard-Mega-X with no learnset,
are in [`docs/design/recon-data-substrate.md`](./docs/design/recon-data-substrate.md).

## Credits and licensing

Code is Apache-2.0 (see [LICENSE](./LICENSE)).

Pokémon data comes from the [Pokémon Showdown](https://pokemonshowdown.com/) dataset via the
[`@pkmn`](https://github.com/pkmn/ps) packages. Sprites are loaded from Showdown's CDN and are not
redistributed here.

Pokémon and Pokémon character names are trademarks of Nintendo, Creatures Inc. and GAME FREAK Inc. This
is an unaffiliated fan project, not endorsed by or associated with any of them.
