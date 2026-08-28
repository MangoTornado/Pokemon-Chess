/**
 * Server-authoritative move validation for online play.
 *
 * Now that the engine builds under Node's strip-only runtime (its constructors declare fields explicitly),
 * the server can do what a relay could not: rebuild the game from the shared seed and the authoritative
 * action list and check that a submitted move is (a) the right side's to make and (b) actually legal — and
 * report whether it ends the game. That closes the trust gap that kept online play unranked.
 *
 * A game is a seed plus an action list, and both clients draft the identical armies from the seed, so the
 * server reconstructs the exact same game they see. Validation is therefore total, not heuristic.
 */

import type { Dex } from '../src/data/dex.ts';
import type { Side } from '../src/engine/variant.ts';
import { autodraft } from '../src/game/autodraft.ts';
import { replay } from '../src/game/replay.ts';

export type ValidateResult =
  | { ok: true; ended: boolean; winner: Side | 'draw' | null }
  | { ok: false; error: string };

/** A validator bound to a dex: replays the game and checks a candidate move. */
export type MoveValidator = (
  seed: string,
  actions: readonly number[],
  encoded: number,
  moverSide: Side,
) => ValidateResult;

/** Builds a validator over the given dex. Online rooms seed their armies with `autodraft(seed)`. */
export function createValidator(dex: Dex): MoveValidator {
  return (seed, actions, encoded, moverSide) => {
    const setup = autodraft(dex, seed);
    const { game, applied } = replay(dex, setup, seed, actions);
    // The server's own action list must always replay cleanly; a mismatch means corrupted state.
    if (applied !== actions.length) return { ok: false, error: 'Game state is inconsistent.' };
    if (game.isOver()) return { ok: false, error: 'This game is already over.' };
    if (game.turn !== moverSide) return { ok: false, error: 'It is not your turn.' };
    const legal = game.legalMoves().find((m) => m.move.encoded === encoded);
    if (!legal) return { ok: false, error: 'Illegal move.' };
    const next = game.play(legal.move).game;
    const result = next.result();
    if (result.kind === 'win') return { ok: true, ended: true, winner: result.winner };
    if (result.kind === 'draw') return { ok: true, ended: true, winner: 'draw' };
    return { ok: true, ended: false, winner: null };
  };
}
