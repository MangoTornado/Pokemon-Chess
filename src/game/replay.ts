/**
 * Replaying a game from its action list — the client side of server-authoritative online play.
 *
 * Because the engine is pure and a game is a seed plus an ordered list of encoded moves (SPEC §20.6), an
 * online match is reconstructed by drafting from the shared seed and applying each move in turn. Both
 * players derive the identical game from the same list, so the server needs to relay only the list. The
 * last move's resolution is returned too, so the board can animate the move that just arrived.
 */

import type { Dex } from '../data/dex.ts';
import { PokemonChess } from '../engine/variant.ts';
import type { Loadout, ResolvedMove } from '../engine/variant.ts';
import type { Position } from '../engine/position.ts';

export interface ReplayResult {
  readonly game: PokemonChess;
  /** The resolution of the final applied move, for animating it — null if no moves have been played. */
  readonly last: ResolvedMove | null;
  /** How many of the given actions were applied. Fewer than `actions.length` signals a desync. */
  readonly applied: number;
}

/**
 * Rebuilds the game state from a seed, a starting setup and a list of encoded moves.
 *
 * Each encoded move is matched against the current legal moves; an action with no legal match stops the
 * replay (a desync, which the caller can surface) rather than throwing.
 */
export function replay(
  dex: Dex,
  setup: { position: Position; loadout: Loadout },
  seed: string,
  actions: readonly number[],
): ReplayResult {
  let game = PokemonChess.create({ dex, position: setup.position, loadout: setup.loadout, seed });
  let last: ResolvedMove | null = null;
  let applied = 0;

  for (const encoded of actions) {
    const legal = game.legalMoves().find((m) => m.move.encoded === encoded);
    if (!legal) break; // desync: an action that is not legal from here
    const { game: next, resolved } = game.play(legal.move);
    game = next;
    last = resolved;
    applied += 1;
  }

  return { game, last, applied };
}
