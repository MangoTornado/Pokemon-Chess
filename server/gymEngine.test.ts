/**
 * The gym engine, and the two exploits it exists to close.
 *
 * Both are tested by *attempting* them, because the previous design would have passed a test that only checked
 * the honest path: a legality-only verifier accepts a fabricated win, and a client-minted seed lets a player
 * shop for a favourable draw without ever making an illegal move.
 */

import { describe, expect, it } from 'vitest';

import { loadDexFromDisk } from './gameDex.ts';
import { createGymEngine, difficultyFor, localSearch, LEADER_SIDE, PLAYER_SIDE } from './gymEngine.ts';
import { buildGymMatch } from '../src/game/gymArmy.ts';
import { replay } from '../src/game/replay.ts';
import { GYM_BY_ID } from '../src/ladder/badges.ts';

const dex = await loadDexFromDisk();
// Brock: depth 2, so a whole battle is affordable in a test. The mechanism is depth-independent.
const BROCK = GYM_BY_ID.get('boulder')!;
const engine = createGymEngine(dex);

/** The player's legal moves in a battle at this point. */
function playerMoves(seed: string, actions: readonly number[]) {
  const { game } = replay(dex, buildGymMatch(dex, BROCK.type, seed), seed, actions);
  return { game, moves: game.legalMoves() };
}

describe('the server plays the leader', () => {
  it('answers the player’s move with a leader move of its own', async () => {
    const seed = 'srv-1';
    const { moves } = playerMoves(seed, []);
    const r = await engine.step(BROCK.id, seed, [], moves[0]!.move.encoded);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The player's move plus at least one leader reply, and it is the player's turn again.
    expect(r.value.actions.length).toBeGreaterThanOrEqual(2);
    expect(r.value.actions[0]).toBe(moves[0]!.move.encoded);
    expect(r.value.turn).toBe(PLAYER_SIDE);
  });

  it('opens with the player to move and no leader ply owed', () => {
    const r = engine.opening(BROCK.id, 'srv-open');
    expect(r.ok && r.value.turn).toBe(PLAYER_SIDE);
    expect(r.ok && r.value.actions).toEqual([]);
  });

  it('refuses an illegal player move', async () => {
    const r = await engine.step(BROCK.id, 'srv-2', [], 999_999);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(409);
  });

  it('refuses a move when it is not the player’s turn', async () => {
    // Feed it an action list that ends with the player still owing nothing — i.e. mid-leader-turn is impossible
    // to reach through step(), so construct the case directly: replay to a leader turn and try to move as White.
    const seed = 'srv-3';
    const { moves } = playerMoves(seed, []);
    const afterPlayer = [moves[0]!.move.encoded];
    const { game } = replay(dex, buildGymMatch(dex, BROCK.type, seed), seed, afterPlayer);
    expect(game.turn).toBe(LEADER_SIDE); // the leader owes a reply
    const r = await engine.step(BROCK.id, seed, afterPlayer, moves[1]!.move.encoded);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('not your turn');
  });

  it('refuses an unknown gym', async () => {
    const r = await engine.step('not-a-gym', 'srv-4', [], 0);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.status).toBe(404);
  });
});

describe('the exploits it closes', () => {
  it('will not accept a fabricated action list in which the leader played badly', async () => {
    // The old shape: submit a whole game and have the server check legality. Every move here is legal, and the
    // leader's are chosen to be as unhelpful as possible — a legality-only verifier reports a White win.
    const seed = 'forge-1';
    let actions: number[] = [];
    let handedToLeader = 0;
    for (let i = 0; i < 24; i++) {
      const { game, moves } = playerMoves(seed, actions);
      if (game.result().kind !== 'playing' || moves.length === 0) break;
      if (game.turn === LEADER_SIDE) {
        // A deliberately terrible but *legal* leader move.
        actions.push(moves[moves.length - 1]!.move.encoded);
        handedToLeader++;
      } else {
        actions.push(moves[0]!.move.encoded);
      }
    }
    expect(handedToLeader, 'the forged list must contain leader plies to be a meaningful test').toBeGreaterThan(0);

    // Now replay that list through the engine one player move at a time. The engine substitutes its OWN leader
    // move, so the forged leader plies never survive: the lists diverge.
    const first = actions[0]!;
    const stepped = await engine.step(BROCK.id, seed, [], first);
    expect(stepped.ok).toBe(true);
    if (!stepped.ok) return;
    const serverLeaderPly = stepped.value.actions[1];
    const forgedLeaderPly = actions[1];
    expect(serverLeaderPly).toBeDefined();
    // The engine's leader move is the searched one, not whatever the forged list claimed.
    const gym = GYM_BY_ID.get(BROCK.id)!;
    // The ply seed is the history length after the player's move — the same value GameBoard passes its own AI,
    // so a client can predict the reply. Deriving it here rather than hardcoding it keeps the two in step.
    const { game: afterPlayerMove } = replay(dex, buildGymMatch(dex, BROCK.type, seed), seed, [first]);
    const expected = await localSearch(dex)(
      gym.id, seed, [first], difficultyFor(gym), afterPlayerMove.history.length + 1,
    );
    expect(serverLeaderPly).toBe(expected);
    expect(serverLeaderPly).not.toBe(forgedLeaderPly);
  });

  it('never lets the client choose which leader move is played', async () => {
    // Whatever the client sends, only its own move is honoured; the reply is the server's.
    const seed = 'forge-2';
    const { moves } = playerMoves(seed, []);
    const a = await engine.step(BROCK.id, seed, [], moves[0]!.move.encoded);
    const b = await engine.step(BROCK.id, seed, [], moves[0]!.move.encoded);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Deterministic: the same player move against the same seed always draws the same reply.
    expect(a.value.actions).toEqual(b.value.actions);
  });

  it('produces a different battle per seed, which is why the server must issue it', async () => {
    // The seed picks BOTH armies, so a client that chooses it can shop for a favourable draw. This test only
    // establishes the sensitivity that makes server-issued seeds necessary; the issuing is gymBattles' job.
    const armies = new Set<string>();
    for (const seed of ['shop-1', 'shop-2', 'shop-3', 'shop-4']) {
      const setup = buildGymMatch(dex, BROCK.type, seed);
      const key = [...setup.loadout.values()].map((l) => `${l.species}/${l.type}`).join(',');
      armies.add(key);
    }
    expect(armies.size).toBe(4);
  });
});

describe('turn ownership', () => {
  it('is read from the game, not from ply parity', async () => {
    // A super-effective knockout grants a bonus move, so the same side can move twice. Anything keyed on
    // alternating plies would reject honest games. Play a real battle and assert the engine always hands back
    // control to the player, however many plies the leader took.
    const seed = 'parity-1';
    let actions: readonly number[] = [];
    let playerMovesMade = 0;
    for (let i = 0; i < 30; i++) {
      const { game, moves } = playerMoves(seed, actions);
      if (game.result().kind !== 'playing' || moves.length === 0) break;
      expect(game.turn, `ply ${actions.length} should be the player's`).toBe(PLAYER_SIDE);
      const r = await engine.step(BROCK.id, seed, actions, moves[0]!.move.encoded);
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      playerMovesMade++;
      actions = r.value.actions;
      if (r.value.ended) break;
      expect(r.value.turn).toBe(PLAYER_SIDE);
    }
    expect(playerMovesMade).toBeGreaterThan(5);
  }, 120_000);

  it('reports the terminal result itself, so no client has to be asked', async () => {
    // Drive a battle to its end and confirm the engine names the winner.
    const seed = 'finish-1';
    let actions: readonly number[] = [];
    let ended = false;
    let winner: string | null = null;
    for (let i = 0; i < 400; i++) {
      const { game, moves } = playerMoves(seed, actions);
      if (game.result().kind !== 'playing' || moves.length === 0) break;
      // Prefer a capture so the game actually resolves rather than shuffling for 400 plies.
      const pick = moves.find((m) => m.move.captured) ?? moves[0]!;
      const r = await engine.step(BROCK.id, seed, actions, pick.move.encoded);
      if (!r.ok) break;
      actions = r.value.actions;
      if (r.value.ended) { ended = true; winner = r.value.winner; break; }
    }
    expect(ended, 'the battle should reach a terminal result').toBe(true);
    expect(['white', 'black', 'draw']).toContain(winner);
  }, 300_000);
});
