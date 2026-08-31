/**
 * A pool of threads that compute Gym Leader moves.
 *
 * The server plays the leader, and at the deepest gyms one reply is seconds of solid CPU. Node has one thread,
 * so running that inline would make a single Giovanni challenger freeze every other request on the site. This
 * hands the search to a worker and awaits it, which keeps the event loop free to serve everyone else.
 *
 * Two deliberate limits, because the alternative to a limit here is the site falling over:
 *
 * - **Pool size** is one per core minus one, so searching cannot starve the thread that accepts requests.
 * - **The queue is bounded.** Past it, a challenger is told the Gym is busy rather than being made to wait an
 *   unbounded time. Refusing service is safe; awarding a badge for unverified play is not, so the queue is never
 *   allowed to become a reason to skip the server's own move.
 *
 * Moving the search off-thread cannot change its answer: `chooseMove` is a pure function of (game, difficulty,
 * ply seed) with no clock, no ambient randomness and no time or node budget, so the thread is not an input.
 */

import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';

import type { SearchFn } from './gymEngine.ts';
import type { GymSearchRequest, GymSearchResponse } from './gymSearchWorker.ts';

/** Leave a core for the event loop, and never claim fewer than one. */
export const DEFAULT_POOL_SIZE = Math.max(1, availableParallelism() - 1);

/**
 * How many searches may wait beyond those running.
 *
 * Two per worker: enough to absorb a burst of players arriving mid-turn, small enough that a waiting request is
 * measured in one or two searches rather than a queue of them.
 */
export const QUEUE_PER_WORKER = 2;

interface Pending {
  readonly request: Omit<GymSearchRequest, 'id'>;
  readonly resolve: (encoded: number | null) => void;
  readonly reject: (cause: Error) => void;
}

/** Thrown when the pool is saturated, so the caller can answer 503 rather than hang. */
export class PoolBusyError extends Error {
  constructor() {
    super('The Gym is busy — try again in a moment.');
    this.name = 'PoolBusyError';
  }
}

export class AiPool {
  private readonly workers: { worker: Worker; busy: boolean }[] = [];
  private readonly queue: Pending[] = [];
  /** In-flight requests by id, so a reply finds its promise. */
  private readonly inFlight = new Map<number, Pending & { workerIndex: number }>();
  private nextId = 1;
  private readonly size: number;
  private readonly maxQueue: number;
  private closed = false;

  constructor(size: number = DEFAULT_POOL_SIZE, maxQueue: number = size * QUEUE_PER_WORKER) {
    this.size = size;
    this.maxQueue = maxQueue;
  }

  /** How many searches are running and waiting, for a health check. */
  stats(): { workers: number; running: number; queued: number } {
    return {
      workers: this.workers.length,
      running: this.inFlight.size,
      queued: this.queue.length,
    };
  }

  /** The {@link SearchFn} the gym engine calls. Rejects with {@link PoolBusyError} when saturated. */
  search: SearchFn = (gymId, seed, actions, difficulty, plySeed) =>
    new Promise<number | null>((resolve, reject) => {
      if (this.closed) {
        reject(new Error('pool is closed'));
        return;
      }
      const pending: Pending = {
        request: { gymId, seed, actions: [...actions], difficulty, plySeed },
        resolve,
        reject,
      };
      const free = this.freeWorker();
      if (free !== null) {
        this.dispatch(free, pending);
        return;
      }
      if (this.queue.length >= this.maxQueue) {
        reject(new PoolBusyError());
        return;
      }
      this.queue.push(pending);
    });

  /** Shuts every worker down. Called on server close; safe to call twice. */
  async close(): Promise<void> {
    this.closed = true;
    for (const p of [...this.queue]) p.reject(new Error('pool is closing'));
    this.queue.length = 0;
    await Promise.all(this.workers.map(({ worker }) => worker.terminate()));
    this.workers.length = 0;
  }

  // --- internals -----------------------------------------------------------

  /** The index of an idle worker, spawning one if the pool is not yet full. Null when all are busy. */
  private freeWorker(): number | null {
    for (let i = 0; i < this.workers.length; i++) {
      if (!this.workers[i]!.busy) return i;
    }
    if (this.workers.length < this.size) {
      // Spawned lazily: a deploy that never serves a gym battle never pays for the threads or their dex copies,
      // and each worker holds a full dex in memory.
      this.workers.push({ worker: this.spawn(this.workers.length), busy: false });
      return this.workers.length - 1;
    }
    return null;
  }

  private spawn(index: number): Worker {
    const worker = new Worker(new URL('./gymSearchWorker.ts', import.meta.url));
    worker.on('message', (response: GymSearchResponse) => {
      const pending = this.inFlight.get(response.id);
      this.inFlight.delete(response.id);
      const slot = this.workers[index];
      if (slot) slot.busy = false;
      if (pending) {
        if (response.error) pending.reject(new Error(response.error));
        else pending.resolve(response.encoded);
      }
      this.drain();
    });
    // A worker that dies takes its in-flight search with it. Fail that search rather than leaving the caller
    // hanging, and replace the worker so the pool does not shrink to nothing over a long uptime.
    const die = (cause: unknown) => {
      for (const [id, pending] of [...this.inFlight]) {
        if (pending.workerIndex !== index) continue;
        this.inFlight.delete(id);
        pending.reject(new Error(`gym search worker failed: ${String(cause)}`));
      }
      const slot = this.workers[index];
      if (slot && !this.closed) {
        slot.worker = this.spawn(index);
        slot.busy = false;
        this.drain();
      }
    };
    worker.on('error', die);
    worker.on('exit', (code) => {
      if (code !== 0 && !this.closed) die(`exited with code ${code}`);
    });
    return worker;
  }

  private dispatch(workerIndex: number, pending: Pending): void {
    const slot = this.workers[workerIndex];
    if (!slot) {
      pending.reject(new Error('no worker'));
      return;
    }
    const id = this.nextId++;
    slot.busy = true;
    this.inFlight.set(id, { ...pending, workerIndex });
    const request: GymSearchRequest = { id, ...pending.request };
    slot.worker.postMessage(request);
  }

  /** Hands queued work to any worker that has come free. */
  private drain(): void {
    while (this.queue.length > 0) {
      const free = this.freeWorker();
      if (free === null) return;
      this.dispatch(free, this.queue.shift()!);
    }
  }
}
