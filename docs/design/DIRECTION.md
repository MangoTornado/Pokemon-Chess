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
