/**
 * The lifecycle of a server-refereed gym battle: who may start one, what it costs to keep alive, and how its
 * result reaches the ladder exactly once.
 *
 * The rules of play live in `gymEngine.ts`; this owns the state around them. The split matters for testing — the
 * engine takes an injectable search, so everything here can be exercised against a cheap stand-in instead of a
 * real depth-4 search that costs seconds per move.
 *
 * Why any of this exists: a gym result used to be whatever the browser said it was, and that word was worth a
 * badge, a rating change, team XP and an encounter roll. Two demonstrated attacks, neither needing more than a
 * modified client:
 *
 * - **Seed shopping.** `buildGymMatch` derives *both* armies from `(leaderType, seed)`, and the browser minted
 *   the seed — so a client could grid-search seeds offline until it found one whose own autodrafted army stomps
 *   the mono-type leader. No illegal move anywhere, just a rigged draw. Hence the seed is issued here, from
 *   `randomBytes`: a recoverable PRNG would let someone predict and pre-scout their next match.
 * - **A fabricated action list.** Checking only that each action is legal accepts a game in which the leader
 *   played deliberately terribly, because the list interleaves both sides. So the server does not check the
 *   leader's moves — it *makes* them.
 *
 * In memory, like {@link Matches}: a battle is ephemeral, a restart abandons any in flight (costing at most one
 * unfinished gym game), and the single-VM deploy keeps them in one process.
 */

import { randomBytes } from 'node:crypto';

import type { Dex } from '../src/data/dex.ts';
import { GYM_BY_ID, isGymUnlocked } from '../src/ladder/badges.ts';
import { isPlausibleEncodedMove } from '../src/engine/position.ts';
import type { Side } from '../src/engine/variant.ts';
import { PLAYER_SIDE, createGymEngine } from './gymEngine.ts';
import type { GymEngine } from './gymEngine.ts';

/** How long an idle gym battle survives before it is reclaimed. */
const GYM_TTL_MS = 60 * 60 * 1000;

/**
 * The most actions one gym battle may accumulate.
 *
 * A bound is needed because the server pays a search for every leader move, so without one a client could keep a
 * battle alive and bill the server indefinitely. Well clear of any real game — measured self-play averages ~400
 * actions with the current mechanics — and a battle that somehow reaches it is scored as the draw it has become.
 */
export const GYM_MAX_ACTIONS = 1200;

export type GymStatus = 'playing' | 'over';

interface GymBattle {
  id: string;
  accountId: number;
  gymId: string;
  seed: string;
  actions: number[];
  status: GymStatus;
  outcome: Side | 'draw' | null;
  /** Guards the one-time settlement, so a result reaches the ladder exactly once. */
  settled: boolean;
  /** Whether the ladder actually accepted the result — surfaced so a refusal is never silent. */
  recorded: boolean;
  /**
   * Whose move it is, as the engine last reported it.
   *
   * Stored rather than re-derived, and never inferred from ply parity: a super-effective knockout grants a bonus
   * move, so the same side legitimately moves twice in a row — measured at 14 of 92 transitions in one game.
   */
  turn: Side;
  lastActivity: number;
}

/** What a client is told. The seed is included so the client can build the same board and render it. */
export interface GymView {
  readonly id: string;
  readonly gymId: string;
  readonly seed: string;
  readonly status: GymStatus;
  readonly actions: readonly number[];
  readonly outcome: Side | 'draw' | null;
  /** Whose move it is, so the client knows whether to wait for the leader. */
  readonly turn: Side;
  /** The player's own side. */
  readonly you: Side;
  /** Once over: whether the ladder recorded the result. False means the outcome stood but nothing was written. */
  readonly recorded: boolean;
}

export type GymResult<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

const ok = <T>(value: T): GymResult<T> => ({ ok: true, value });
const fail = (error: string, status = 400): GymResult<never> => ({ ok: false, error, status });

/** What this needs from the account service, kept narrow so a test can fake it in three lines. */
export interface GymAccountOps {
  /** Rating and earned badges, for the unlock gate. Null when there is no such profile. */
  standing: (accountId: number) => { rating: number; badges: readonly string[] } | null;
  /**
   * Records a finished battle. Reached only from here, only for a game the server refereed.
   *
   * Returns whether the write happened, so a refused record is visible in the battle's view rather than costing a
   * player their badge in silence.
   */
  /**
   * Records a finished battle. Reached only from here, only for a game the server refereed.
   *
   * Returns whether the write happened, so a battle can report the difference between "you won" and "you won and
   * it counted" rather than silently swallowing a rejected write.
   */
  record: (accountId: number, gymId: string, score: 0 | 0.5 | 1) => { ok: boolean };
}

export class GymMatches {
  private readonly battles = new Map<string, GymBattle>();
  /** One active battle per account: starting a second abandons the first. */
  private readonly byAccount = new Map<number, string>();
  private readonly engine: GymEngine;
  private readonly accounts: GymAccountOps;
  private readonly now: () => number;
  private readonly makeId: () => string;
  private readonly makeSeed: () => string;

  constructor(
    dex: Dex,
    accounts: GymAccountOps,
    options: {
      readonly engine?: GymEngine;
      readonly clock?: () => number;
      readonly makeId?: () => string;
      /** Overridden in tests to avoid a real search; production uses the in-process one. */
      readonly makeSeed?: () => string;
    } = {},
  ) {
    this.engine = options.engine ?? createGymEngine(dex);
    this.accounts = accounts;
    this.now = options.clock ?? (() => Date.now());
    this.makeId = options.makeId ?? (() => randomBytes(9).toString('base64url'));
    this.makeSeed = options.makeSeed ?? (() => randomBytes(12).toString('base64url'));
  }

  /**
   * Opens a battle, enforcing the unlock gate *before* any play happens.
   *
   * Order matters: the old endpoint checked the gate when recording the result, which stopped a locked gym being
   * *credited* but not being played. Checking here means a locked gym is never begun.
   */
  start(accountId: number, gymId: unknown): GymResult<GymView> {
    this.prune();
    if (typeof gymId !== 'string' || !GYM_BY_ID.has(gymId)) return fail('Unknown gym.', 404);
    const gym = GYM_BY_ID.get(gymId)!;

    const standing = this.accounts.standing(accountId);
    if (!standing) return fail('No such profile.', 404);
    if (!isGymUnlocked(gym, new Set(standing.badges), standing.rating)) {
      return fail('That gym will not accept your challenge yet.', 403);
    }

    // Starting a new battle abandons any previous one, which is exactly what walking away from the old
    // client-side gym battle did. See the note at the bottom of this file on what that does and does not fix.
    const previous = this.byAccount.get(accountId);
    if (previous) this.battles.delete(previous);

    const seed = `gym-${gymId}-${this.makeSeed()}`;
    const opening = this.engine.opening(gymId, seed);
    if (!opening.ok) return fail(opening.error, opening.status);

    const battle: GymBattle = {
      id: this.makeId(),
      accountId,
      gymId,
      seed,
      actions: [...opening.value.actions],
      status: 'playing',
      outcome: null,
      settled: false,
      recorded: false,
      turn: opening.value.turn,
      lastActivity: this.now(),
    };
    this.battles.set(battle.id, battle);
    this.byAccount.set(accountId, battle.id);
    return ok(this.view(battle));
  }

  /** The caller's own battle. */
  state(accountId: number, id: string): GymResult<GymView> {
    const battle = this.own(accountId, id);
    if (!battle.ok) return battle;
    return ok(this.view(battle.value));
  }

  /**
   * Plays the player's move, then the leader's reply.
   *
   * `ply` is the expected action count before the move — the same optimistic-concurrency guard `Matches.move`
   * uses, so a double-submit or a stale retry is refused rather than played twice. That guard is load-bearing
   * here in a way it is not for PvP: a replayed request would otherwise buy a second leader search.
   */
  async move(accountId: number, id: string, ply: unknown, encoded: unknown): Promise<GymResult<GymView>> {
    const owned = this.own(accountId, id);
    if (!owned.ok) return owned;
    const battle = owned.value;

    if (battle.status !== 'playing') return fail('This gym battle is over.', 409);
    if (!Number.isInteger(ply) || ply !== battle.actions.length) {
      return fail('Out-of-date move; refresh and retry.', 409);
    }
    if (!isPlausibleEncodedMove(encoded as number)) return fail('Malformed move.', 400);
    if (battle.actions.length >= GYM_MAX_ACTIONS) {
      this.settle(battle, 'draw');
      return ok(this.view(battle));
    }

    const stepped = await this.engine.step(battle.gymId, battle.seed, battle.actions, encoded as number);
    if (!stepped.ok) return fail(stepped.error, stepped.status);

    battle.actions = [...stepped.value.actions];
    battle.turn = stepped.value.turn;
    battle.lastActivity = this.now();
    if (stepped.value.ended) this.settle(battle, stepped.value.winner ?? 'draw');
    return ok(this.view(battle));
  }

  /** Abandons the caller's battle, recording nothing. This is what the Forfeit button does. */
  abandon(accountId: number, id: string): boolean {
    const battle = this.battles.get(id);
    if (!battle || battle.accountId !== accountId) return false;
    this.battles.delete(id);
    if (this.byAccount.get(accountId) === id) this.byAccount.delete(accountId);
    return true;
  }

  /** Battles in memory, for a health check. */
  count(): number {
    return this.battles.size;
  }

  // --- internals -----------------------------------------------------------

  private own(accountId: number, id: string): GymResult<GymBattle> {
    const battle = this.battles.get(id);
    if (!battle) return fail('No such gym battle.', 404);
    // 403 rather than 404 would leak that the id exists; both answers are the same shape on purpose.
    if (battle.accountId !== accountId) return fail('No such gym battle.', 404);
    return ok(battle);
  }

  /** Closes a battle and records it exactly once, from the engine's verdict rather than anyone's claim. */
  private settle(battle: GymBattle, winner: Side | 'draw'): void {
    battle.status = 'over';
    battle.outcome = winner;
    battle.lastActivity = this.now();
    if (battle.settled) return;
    battle.settled = true;
    const score: 0 | 0.5 | 1 = winner === 'draw' ? 0.5 : winner === PLAYER_SIDE ? 1 : 0;
    battle.recorded = this.accounts.record(battle.accountId, battle.gymId, score).ok;
  }

  private view(battle: GymBattle): GymView {
    return {
      id: battle.id,
      gymId: battle.gymId,
      seed: battle.seed,
      status: battle.status,
      actions: [...battle.actions],
      outcome: battle.outcome,
      turn: battle.turn,
      you: PLAYER_SIDE,
      recorded: battle.recorded,
    };
  }

  private prune(): void {
    const t = this.now();
    for (const [id, battle] of this.battles) {
      if (t - battle.lastActivity <= GYM_TTL_MS) continue;
      this.battles.delete(id);
      if (this.byAccount.get(battle.accountId) === id) this.byAccount.delete(battle.accountId);
    }
  }
}

// What this does not fix: abandoning a losing battle still costs nothing, because nothing is recorded until the
// game ends. That is unchanged from the client-side version rather than newly introduced — walking away from the
// old gym screen recorded nothing either — and it is bounded, since a gym win can only ever be banked once and
// climbing past the eight badges needs real PvP. Making a forfeit count as a loss is a product decision with a
// real cost (a dropped connection would take a badge), so it is deliberately not made here.
