/**
 * The AI opponent — a bounded negamax search over the variant, with type-aware evaluation.
 *
 * Off-the-shelf chess engines cannot play this game: a super-effective capture lets the same side move
 * again (so a "ply" is not a fixed alternation), captures resolve through a Clash rather than a boolean,
 * and some captures are type-illegal. This search is written for the variant directly. It evaluates
 * lines at the representative roll (`simulate`), which makes it deterministic and fast; expectimax over
 * the crit coin is a later refinement the evaluation's ±HP terms already partly absorb.
 *
 * Difficulty is not merely search depth. A beginner AI **misjudges types** — it evaluates with a
 * corrupted view of the type chart — which is exactly the thematic mistake a new player makes and is
 * far more fun to play against than a simply shallower engine. See SPEC §19.
 */

import type { Move } from '../engine/position.ts';
import type { PokemonChess, Side, VariantMove } from '../engine/variant.ts';
import { evaluate } from './evaluate.ts';

export interface Difficulty {
  readonly name: string;
  /** Search depth in sub-moves. */
  readonly depth: number;
  /**
   * How often the AI misreads a type matchup, 0–1. A beginner (high value) will walk into resisted
   * captures and miss super-effective ones, because it does not yet know the chart — the authentic
   * new-player mistake.
   */
  readonly typeBlindness: number;
}

export const DIFFICULTIES: Record<string, Difficulty> = {
  rookie: { name: 'Rookie', depth: 1, typeBlindness: 0.6 },
  trainer: { name: 'Trainer', depth: 2, typeBlindness: 0.25 },
  ace: { name: 'Ace', depth: 3, typeBlindness: 0.05 },
  champion: { name: 'Champion', depth: 4, typeBlindness: 0 },
};

/** A seeded PRNG local to one search, so a difficulty's mistakes are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const INF = 2_000_000;

/**
 * Orders moves so alpha-beta prunes well: captures first, super-effective captures ahead of the rest.
 *
 * A `typeBlindness`-corrupted AI shuffles this ordering — it does not reliably see which captures are
 * good — which both weakens its search and makes it misvalue type matchups, the intended mistake.
 */
function orderMoves(moves: VariantMove[], blindness: number, rng: () => number): VariantMove[] {
  const scored = moves.map((m) => {
    let priority = m.move.captured ? 1 : 0;
    if (m.forecast === 'advantage') priority += 2;
    else if (m.forecast === 'capture') priority += 1;
    else if (m.forecast === 'rout' || m.forecast === 'mutual') priority -= 2;
    // Type blindness scrambles the priority, so the AI sometimes prefers a losing capture.
    if (rng() < blindness) priority = rng() * 3 - 1;
    return { m, priority };
  });
  scored.sort((a, b) => b.priority - a.priority);
  return scored.map((s) => s.m);
}

interface SearchState {
  readonly root: Side;
  readonly blindness: number;
  readonly rng: () => number;
  nodes: number;
}

/**
 * Negamax with alpha-beta.
 *
 * The subtlety the variant forces: after a super-effective capture the *same* side moves again, so the
 * turn does not always alternate. We detect that by comparing whose turn it is in the child; when it is
 * still the mover's turn we recurse without negating, because it is the same player maximising.
 */
function negamax(
  game: PokemonChess,
  side: Side,
  depth: number,
  alpha: number,
  beta: number,
  state: SearchState,
): number {
  state.nodes += 1;
  if (depth === 0 || game.isOver()) {
    // Evaluate from the perspective of the side to move, which negamax expects.
    return evaluate(game, side);
  }

  const moves = orderMoves(game.legalMoves(), state.blindness, state.rng);
  if (moves.length === 0) return evaluate(game, side);

  let best = -INF;
  for (const vm of moves) {
    const child = game.simulate(vm.move);
    let value: number;
    if (child.turn === side) {
      // A granted extra move: the same side keeps searching, same window, no sign flip.
      value = negamax(child, side, depth - 1, alpha, beta, state);
    } else {
      value = -negamax(child, child.turn, depth - 1, -beta, -alpha, state);
    }
    if (value > best) best = value;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export interface SearchResult {
  readonly move: Move;
  readonly score: number;
  readonly nodes: number;
}

/**
 * Chooses a move for the side to move.
 *
 * Deterministic given `(game, difficulty, seed)`, so a replay reproduces the AI's play exactly. Returns
 * null only when there are no legal moves.
 */
export function chooseMove(game: PokemonChess, difficulty: Difficulty, seed = 1): SearchResult | null {
  const side = game.turn;
  const rng = mulberry32(seed ^ (difficulty.depth * 2654435761));
  const state: SearchState = { root: side, blindness: difficulty.typeBlindness, rng, nodes: 0 };

  const moves = orderMoves(game.legalMoves(), difficulty.typeBlindness, rng);
  if (moves.length === 0) return null;

  let bestMove = moves[0]!.move;
  let bestScore = -INF;
  let alpha = -INF;
  for (const vm of moves) {
    const child = game.simulate(vm.move);
    const value =
      child.turn === side
        ? negamax(child, side, difficulty.depth - 1, alpha, INF, state)
        : -negamax(child, child.turn, difficulty.depth - 1, -INF, -alpha, state);
    if (value > bestScore) {
      bestScore = value;
      bestMove = vm.move;
    }
    if (value > alpha) alpha = value;
  }
  return { move: bestMove, score: bestScore, nodes: state.nodes };
}
