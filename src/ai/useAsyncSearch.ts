/**
 * Asking the AI for a move without blocking the board.
 *
 * Wraps {@link searchWorker} in a promise-per-request, keyed by an incrementing id so a stale answer (from a
 * search the caller has since abandoned) is discarded rather than played. If a worker cannot be created — an
 * old browser, a strict sandbox, a test environment — it falls back to searching on the main thread, so the
 * game always works and only the smoothness is lost.
 */

import { useCallback, useEffect, useRef } from 'react';

import type { Dex } from '../data/dex.ts';
import type { PokemonChess } from '../engine/variant.ts';
import { chooseMove } from './search.ts';
import type { Difficulty } from './search.ts';
import type { GameDescriptor } from './gameDescriptor.ts';
import type { SearchRequest, SearchResponse } from './searchWorker.ts';

export interface AsyncSearch {
  /**
   * Searches for a move. Resolves with the chosen move's encoding, or null if the position offers nothing.
   *
   * `fallbackGame` is searched directly if no worker is available, which is why the caller passes both the
   * descriptor and the live game.
   */
  search: (game: GameDescriptor, difficulty: Difficulty, seed: number, fallbackGame: PokemonChess) => Promise<number | null>;
  /** True while a search is outstanding, for a "thinking…" affordance. */
  readonly busy: () => boolean;
}

export function useAsyncSearch(_dex: Dex): AsyncSearch {
  const workerRef = useRef<Worker | null>(null);
  const nextId = useRef(1);
  const pending = useRef(new Map<number, (r: SearchResponse) => void>());
  const outstanding = useRef(0);

  useEffect(() => {
    // A module worker, created lazily and torn down with the component. If construction throws (no worker
    // support, or a bundler that cannot resolve it), we simply stay on the main thread.
    try {
      const worker = new Worker(new URL('./searchWorker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<SearchResponse>) => {
        const resolve = pending.current.get(event.data.id);
        if (resolve) {
          pending.current.delete(event.data.id);
          resolve(event.data);
        }
      };
      // Construction succeeding is not the same as the worker *working*: it can still fail while loading its own
      // module, or die later. No `message` then arrives, so every pending search stayed unresolved forever and the
      // board sat on the AI's turn with no way forward. Fail the outstanding requests and drop back to the main
      // thread, which computes the identical move — the worker is a performance choice, never a correctness one.
      const abandon = () => {
        workerRef.current = null;
        // Resolved *with an error*, not merely with a null move: `search` below already falls back to the main
        // thread when it sees one, so this routes a dead worker into the path that still produces the right move.
        for (const [id, resolve] of pending.current) {
          resolve({ id, encoded: null, nodes: 0, error: 'the search worker stopped' });
        }
        pending.current.clear();
      };
      worker.onerror = abandon;
      worker.onmessageerror = abandon;
      workerRef.current = worker;
    } catch {
      workerRef.current = null;
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      pending.current.clear();
    };
  }, []);

  const search = useCallback<AsyncSearch['search']>(async (game, difficulty, seed, fallbackGame) => {
    const worker = workerRef.current;
    if (!worker) {
      // Main-thread fallback: correct, just not smooth.
      return chooseMove(fallbackGame, difficulty, seed)?.move.encoded ?? null;
    }

    const id = nextId.current++;
    outstanding.current += 1;
    const request: SearchRequest = { id, game, difficulty, seed };

    const answer = await new Promise<SearchResponse>((resolve) => {
      pending.current.set(id, resolve);
      worker.postMessage(request);
    });
    outstanding.current -= 1;

    // A worker that failed is not a reason to stall the game — search here instead.
    if (answer.error) return chooseMove(fallbackGame, difficulty, seed)?.move.encoded ?? null;
    return answer.encoded;
  }, []);

  const busy = useCallback(() => outstanding.current > 0, []);

  return { search, busy };
}
