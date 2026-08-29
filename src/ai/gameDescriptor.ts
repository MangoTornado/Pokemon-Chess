/**
 * A game as plain, structured-cloneable data — what you can post to a worker.
 *
 * The engine's `PokemonChess` is a class holding a `Position` (typed arrays) and several Maps, so it cannot
 * cross a `postMessage` boundary intact. But a game is already defined as a seed plus an ordered action
 * list, so it does not need to: send the starting board, the roster, the seed and the actions, and the other
 * side rebuilds the identical game with the same `replay` the online client uses.
 *
 * That is the whole trick behind off-thread search — the same purity that makes replay and server-side
 * validation possible makes a worker possible too, with no separate serialisation format to keep in sync.
 */

import type { Dex } from '../data/dex.ts';
import { Position } from '../engine/position.ts';
import type { PokemonChess } from '../engine/variant.ts';
import type { Loadout, PokemonLoadout } from '../engine/variant.ts';
import type { WeatherKind } from '../engine/field.ts';
import { replay } from '../game/replay.ts';

/** Everything needed to rebuild a game, using only structured-cloneable values. */
export interface GameDescriptor {
  /** The board the game started from. */
  readonly fen: string;
  /** The roster, as entries — piece ids are assigned by `Position.fromFen` in square order, so they match. */
  readonly loadout: readonly [number, PokemonLoadout][];
  readonly seed: string;
  /** Every action played so far, encoded. */
  readonly actions: readonly number[];
  readonly weather?: WeatherKind;
}

/** Describes a live game, given the setup it started from. */
export function describeGame(
  setup: { position: Position; loadout: Loadout },
  seed: string,
  game: PokemonChess,
  weather?: WeatherKind,
): GameDescriptor {
  return {
    fen: setup.position.toFen(),
    loadout: [...setup.loadout.entries()],
    seed,
    actions: game.history.map((h) => h.move.encoded),
    ...(weather ? { weather } : {}),
  };
}

/** Rebuilds the game a descriptor names. Throws only if the descriptor itself is malformed. */
export function rebuildGame(dex: Dex, d: GameDescriptor): PokemonChess {
  const position = Position.fromFen(d.fen);
  const loadout: Loadout = new Map(d.loadout);
  const setup = { position, loadout };
  return replay(dex, setup, d.seed, d.actions, d.weather).game;
}
