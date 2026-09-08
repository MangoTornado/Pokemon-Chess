/**
 * A Gym Leader's search, on its own thread.
 *
 * The server is the leader now, and at the deepest gyms one reply costs seconds of solid CPU — measured at 14–19
 * for Giovanni. Node runs one thread, so doing that inline would stall every other request on the site for the
 * duration: a single player fighting Giovanni would freeze everyone else's sign-in. The search is pure, so it
 * moves to a worker with no locking and nothing shared.
 *
 * Moving it changes nothing about the result. `chooseMove` depends only on (game, difficulty, ply seed) — no
 * clock, no ambient randomness, no node or time budget — so the thread it runs on is not an input. That is what
 * makes this a pure performance change rather than a change to how the leader plays.
 *
 * The dex is loaded once per worker and kept for its lifetime: loading it is the expensive part and a worker
 * serves many searches. Mirrors `src/ai/searchWorker.ts`, which does the same job in the browser, except the dex
 * comes off disk rather than from bundled imports.
 */

import { parentPort } from 'node:worker_threads';

import { chooseMove } from '../src/ai/search.ts';
import type { Difficulty } from '../src/ai/search.ts';
import { buildGymMatch } from '../src/game/gymArmy.ts';
import { replay } from '../src/game/replay.ts';
import { GYM_BY_ID } from '../src/ladder/badges.ts';
import { loadDexFromDisk } from './gameDex.ts';
import type { Dex } from '../src/data/dex.ts';

export interface GymSearchRequest {
  /** Echoed back so the pool can match an answer to its request. */
  readonly id: number;
  readonly gymId: string;
  readonly seed: string;
  readonly actions: readonly number[];
  readonly difficulty: Difficulty;
  readonly plySeed: number;
}

export interface GymSearchResponse {
  readonly id: number;
  readonly encoded: number | null;
  readonly error?: string;
}

// Loaded once per worker and kept: the load is the expensive part and a worker serves many searches.
let dexCache: Dex | null = null;
const loadDex = (): Dex => (dexCache ??= loadDexFromDisk());

parentPort?.on('message', async (request: GymSearchRequest) => {
  const { id, gymId, seed, actions, difficulty, plySeed } = request;
  try {
    const gym = GYM_BY_ID.get(gymId);
    if (!gym) throw new Error(`unknown gym ${gymId}`);
    const dex = loadDex();
    const { game, applied } = replay(dex, buildGymMatch(dex, gym.type, seed), seed, actions);
    if (applied !== actions.length) throw new Error('action list does not replay');
    const choice = chooseMove(game, difficulty, plySeed);
    const response: GymSearchResponse = { id, encoded: choice?.move.encoded ?? null };
    parentPort?.postMessage(response);
  } catch (cause) {
    const response: GymSearchResponse = { id, encoded: null, error: String(cause) };
    parentPort?.postMessage(response);
  }
});
