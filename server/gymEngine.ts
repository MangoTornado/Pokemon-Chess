/**
 * Server-side gym battles: the server *is* the Gym Leader.
 *
 * Every other progression path is server-derived — PvP ratings come from the server's own match state,
 * encounters are issued when a real game ends and claimed by index — but a gym result used to be whatever the
 * browser said it was. Two things made that worth closing, and only one of them is the obvious one:
 *
 * 1. **The action list proves nothing on its own.** A gym battle's action list interleaves both sides, so
 *    checking that every action is *legal* accepts a game in which the leader played deliberately terribly. A
 *    fabricated thirteen-move "win" over Giovanni passes a legality-only check and reports `winner: white`.
 * 2. **The seed was the bigger hole.** `buildGymMatch` derives *both* armies from `(leaderType, seed)`, and the
 *    browser minted the seed. So a modified client could grid-search seeds offline for one where its own
 *    autodrafted army happens to stomp the mono-type leader — no illegal move anywhere, just a rigged draw.
 *    Measured across ten seeds at equal depth, the winner flipped repeatedly.
 *
 * Both close the same way: the server issues the seed and plays the leader. It validates the player's move, then
 * makes the leader's reply itself, so at no point does it need to believe anything about how the game went.
 *
 * This is affordable only because it is not *extra* work. The leader's search is exactly the search the client's
 * Web Worker performs today; it has moved, not appeared. Verifying a finished game afterwards would have been the
 * expensive shape — the same searches, but all owed inside one request (minutes, for a depth-4 leader).
 *
 * Turn ownership always comes from `game.turn`, never from ply parity: a super-effective knockout grants a bonus
 * move, so the same side legitimately moves twice in a row (14 of 92 transitions in one measured game). Anything
 * keyed on alternating plies would reject a large fraction of honest play.
 */

import type { Dex } from '../src/data/dex.ts';
import type { Side } from '../src/engine/variant.ts';
import { buildGymMatch } from '../src/game/gymArmy.ts';
import { replay } from '../src/game/replay.ts';
import { chooseMove } from '../src/ai/search.ts';
import type { Difficulty } from '../src/ai/search.ts';
import { GYM_BY_ID } from '../src/ladder/badges.ts';
import type { GymLeader } from '../src/ladder/badges.ts';

/** The player is always White in a gym battle, and the leader always Black. */
export const PLAYER_SIDE: Side = 'white';
export const LEADER_SIDE: Side = 'black';

/**
 * How the leader's move is computed.
 *
 * Injected so the expensive path can be moved off the event loop (see `server/aiPool.ts`) without this module
 * knowing, and so tests can drive a cheap stand-in. The contract is the one `chooseMove` already satisfies:
 * a pure function of (game state, difficulty, ply seed).
 */
export type SearchFn = (
  gymId: string,
  seed: string,
  actions: readonly number[],
  difficulty: Difficulty,
  plySeed: number,
) => Promise<number | null>;

export interface StepOutcome {
  /** The full action list after the player's move and the leader's reply (or replies). */
  readonly actions: readonly number[];
  readonly ended: boolean;
  /** Set once `ended`: who won, or a draw. */
  readonly winner: Side | 'draw' | null;
  /** Whose move it is now. */
  readonly turn: Side;
}

export type StepResult = { ok: true; value: StepOutcome } | { ok: false; error: string; status: number };

/** The AI budget a leader fights with — depth and type-blindness are the whole of it. */
export function difficultyFor(gym: GymLeader): Difficulty {
  return { name: gym.leader, depth: gym.depth, typeBlindness: gym.typeBlindness };
}

/**
 * The leader's move for a position, computed in-process.
 *
 * The default {@link SearchFn}. Deliberately re-derives the game from the action list rather than taking a live
 * object, so it has the same signature as the worker-thread version — a `PokemonChess` cannot cross a thread
 * boundary, but a seed and a list of numbers can.
 */
export function localSearch(dex: Dex): SearchFn {
  return async (gymId, seed, actions, difficulty, plySeed) => {
    const gym = GYM_BY_ID.get(gymId);
    if (!gym) return null;
    const { game, applied } = replay(dex, buildGymMatch(dex, gym.type, seed), seed, actions);
    if (applied !== actions.length) return null;
    const choice = chooseMove(game, difficulty, plySeed);
    return choice ? choice.move.encoded : null;
  };
}

export interface GymEngine {
  /** The action list a fresh battle starts from, and who moves first. */
  opening: (gymId: string, seed: string) => StepResult;
  /** Applies the player's move, then plays the leader's reply until it is the player's turn or the game is over. */
  step: (gymId: string, seed: string, actions: readonly number[], encoded: number) => Promise<StepResult>;
}

const fail = (error: string, status = 400): StepResult => ({ ok: false, error, status });

/**
 * Builds the gym operations over a dex.
 *
 * The only difference from `createEngineOps` (which serves PvP) is where the setup comes from: `buildGymMatch`
 * rather than `autodraft`. Everything below that is already setup-agnostic, which is why this reuses `replay`
 * rather than reimplementing it.
 */
export function createGymEngine(dex: Dex, search: SearchFn = localSearch(dex)): GymEngine {
  const rebuild = (gym: GymLeader, seed: string, actions: readonly number[]) =>
    replay(dex, buildGymMatch(dex, gym.type, seed), seed, actions);

  /** Plays leader replies until the player is on the move again, or the game is decided. */
  const runLeader = async (
    gym: GymLeader,
    seed: string,
    startingActions: readonly number[],
  ): Promise<StepResult> => {
    const actions = [...startingActions];
    // A bounded loop, because a bonus move lets the leader move again: DEFAULT_RULES allows two extra moves, so
    // three leader plies in one turn is the ceiling. The bound is a guard against a rules change turning this
    // into a hang, not an expectation.
    for (let guard = 0; guard < 8; guard++) {
      const { game, applied } = rebuild(gym, seed, actions);
      if (applied !== actions.length) return fail('Game state is inconsistent.', 500);
      const result = game.result();
      if (result.kind !== 'playing') {
        return {
          ok: true,
          value: {
            actions,
            ended: true,
            winner: result.kind === 'win' ? result.winner : 'draw',
            turn: game.turn,
          },
        };
      }
      if (game.turn !== LEADER_SIDE) {
        return { ok: true, value: { actions, ended: false, winner: null, turn: game.turn } };
      }

      // The ply seed matches what the client's own AI uses, so a client may optimistically predict the reply and
      // reconcile against ours. A mismatch is only ever a re-render — the server's list is what counts.
      const encoded = await search(gym.id, seed, actions, difficultyFor(gym), game.history.length + 1);
      if (encoded === null) return fail('The Gym Leader could not move.', 500);
      const legal = game.legalMoves().find((m) => m.move.encoded === encoded);
      if (!legal) return fail('The Gym Leader chose an impossible move.', 500);
      actions.push(encoded);
    }
    return fail('The Gym Leader will not stop moving.', 500);
  };

  return {
    opening: (gymId, seed) => {
      const gym = GYM_BY_ID.get(gymId);
      if (!gym) return fail('Unknown gym.', 404);
      const { game } = rebuild(gym, seed, []);
      // White opens in the starting position, so no leader ply is owed yet; asserting it keeps the assumption
      // visible rather than implied.
      return { ok: true, value: { actions: [], ended: false, winner: null, turn: game.turn } };
    },

    step: async (gymId, seed, actions, encoded) => {
      const gym = GYM_BY_ID.get(gymId);
      if (!gym) return fail('Unknown gym.', 404);
      const { game, applied } = rebuild(gym, seed, actions);
      if (applied !== actions.length) return fail('Game state is inconsistent.', 500);
      if (game.result().kind !== 'playing') return fail('This battle is already over.', 409);
      if (game.turn !== PLAYER_SIDE) return fail('It is not your turn.', 409);

      const legal = game.legalMoves().find((m) => m.move.encoded === encoded);
      if (!legal) return fail('Illegal move.', 409);

      return runLeader(gym, seed, [...actions, encoded]);
    },
  };
}
