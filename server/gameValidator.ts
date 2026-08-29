/**
 * Server-authoritative game reasoning for online play.
 *
 * Now that the engine builds under Node's strip-only runtime (its constructors declare fields explicitly),
 * the server can do what a relay could not: rebuild the game from the shared seed and the authoritative
 * action list and check that a submitted move is (a) the right side's to make and (b) actually legal — and
 * report whether it ends the game. That closes the trust gap that kept online play unranked.
 *
 * It also answers "whose turn is it?", which the clock needs and cannot infer from the action count: a
 * super-effective knockout grants a bonus move, so the same side may move twice in a row.
 *
 * A game is a seed plus an action list, and both clients draft the identical armies from the seed, so the
 * server reconstructs the exact same game they see. Validation is therefore total, not heuristic.
 */

import type { Dex } from '../src/data/dex.ts';
import type { Side } from '../src/engine/variant.ts';
import { autodraft } from '../src/game/autodraft.ts';
import { replay } from '../src/game/replay.ts';

export type ValidateResult =
  | { ok: true; ended: boolean; winner: Side | 'draw' | null; turn: Side }
  | { ok: false; error: string };

export interface EngineOps {
  /** Validates a candidate move against the authoritative action list. */
  validate: (seed: string, actions: readonly number[], encoded: number, moverSide: Side) => ValidateResult;
  /** Whose turn it is after the given actions, or null if the game is already decided. */
  turnOf: (seed: string, actions: readonly number[]) => Side | null;
}

/** Builds the engine operations over a dex. Online rooms seed their armies with `autodraft(seed)`. */
export function createEngineOps(dex: Dex): EngineOps {
  const rebuild = (seed: string, actions: readonly number[]) => {
    const setup = autodraft(dex, seed);
    return replay(dex, setup, seed, actions);
  };

  return {
    validate: (seed, actions, encoded, moverSide) => {
      const { game, applied } = rebuild(seed, actions);
      // The server's own action list must always replay cleanly; a mismatch means corrupted state.
      if (applied !== actions.length) return { ok: false, error: 'Game state is inconsistent.' };
      if (game.isOver()) return { ok: false, error: 'This game is already over.' };
      if (game.turn !== moverSide) return { ok: false, error: 'It is not your turn.' };
      const legal = game.legalMoves().find((m) => m.move.encoded === encoded);
      if (!legal) return { ok: false, error: 'Illegal move.' };
      const next = game.play(legal.move).game;
      const result = next.result();
      if (result.kind === 'win') return { ok: true, ended: true, winner: result.winner, turn: next.turn };
      if (result.kind === 'draw') return { ok: true, ended: true, winner: 'draw', turn: next.turn };
      return { ok: true, ended: false, winner: null, turn: next.turn };
    },

    turnOf: (seed, actions) => {
      const { game, applied } = rebuild(seed, actions);
      if (applied !== actions.length || game.isOver()) return null;
      return game.turn;
    },
  };
}

/** Back-compatible alias: just the validate function, for callers that need nothing else. */
export type MoveValidator = EngineOps['validate'];
