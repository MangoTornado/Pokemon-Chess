/**
 * The AI search, off the main thread.
 *
 * Negamax at Champion depth on a full board is tens of thousands of nodes, and on the main thread that
 * freezes the board mid-animation — the one place a game must never stutter. The search is pure, so it moves
 * to a worker with no locking and no shared state: this receives a {@link GameDescriptor}, rebuilds the
 * identical game from it, searches, and posts back the chosen move's encoding.
 *
 * The dex is loaded once per worker and cached for its lifetime, because loading it is the expensive part and
 * a worker outlives many searches.
 */

import { Dex } from '../data/dex.ts';
import { chooseMove } from './search.ts';
import type { Difficulty } from './search.ts';
import { rebuildGame } from './gameDescriptor.ts';
import type { GameDescriptor } from './gameDescriptor.ts';

export interface SearchRequest {
  /** Echoed back, so a client can ignore the answer to a search it has since abandoned. */
  readonly id: number;
  readonly game: GameDescriptor;
  readonly difficulty: Difficulty;
  readonly seed: number;
}

export interface SearchResponse {
  readonly id: number;
  /** The chosen move's encoding, or null if the position offers nothing. */
  readonly encoded: number | null;
  readonly nodes: number;
  /** Set when the search failed, so the caller can fall back rather than hang. */
  readonly error?: string;
}

let dexPromise: Promise<Dex> | null = null;
const loadDex = (): Promise<Dex> => (dexPromise ??= Dex.load());

self.onmessage = async (event: MessageEvent<SearchRequest>) => {
  const { id, game, difficulty, seed } = event.data;
  try {
    const dex = await loadDex();
    const rebuilt = rebuildGame(dex, game);
    const choice = chooseMove(rebuilt, difficulty, seed);
    const response: SearchResponse = {
      id,
      encoded: choice?.move.encoded ?? null,
      nodes: choice?.nodes ?? 0,
    };
    (self as unknown as Worker).postMessage(response);
  } catch (cause) {
    const response: SearchResponse = { id, encoded: null, nodes: 0, error: String(cause) };
    (self as unknown as Worker).postMessage(response);
  }
};
