/**
 * A full online game played through the server, move by move.
 *
 * This is the integration test that protects the property online play depends on and nothing else checks:
 * the client and the server must draft *identical* armies from a shared seed. Any change to the draft
 * (adding abilities, adding held items, reordering an RNG draw) could silently desync them, at which point
 * the server would reject the client's legal moves. Playing real moves end-to-end catches that.
 */

import { describe, expect, it } from 'vitest';

import { PokemonChess } from '../src/engine/variant.ts';
import { autodraft } from '../src/game/autodraft.ts';
import { replay } from '../src/game/replay.ts';
import { loadDexFromDisk } from './gameDex.ts';
import { createEngineOps } from './gameValidator.ts';
import { Matches } from './matches.ts';
import type { EndInfo } from './matches.ts';

const dex = loadDexFromDisk();
const engine = createEngineOps(dex);

describe('a real online game', () => {
  it('accepts twenty consecutive client-chosen moves', () => {
    const ends: EndInfo[] = [];
    const m = new Matches(undefined, undefined, engine, (i) => ends.push(i));
    const a = m.enqueue({ accountId: 1, name: 'A' });
    m.enqueue({ accountId: 2, name: 'B' });
    const id = a.ok ? a.value.id : '';
    const seed = a.ok ? a.value.seed : '';

    // The client's own view of the game, built exactly as the browser does.
    const setup = autodraft(dex, seed);
    let actions: number[] = [];

    for (let ply = 0; ply < 20; ply++) {
      const { game, applied } = replay(dex, setup, seed, actions);
      // The client's replay of the shared list must be total — this is the desync canary.
      expect(applied, `client desynced at ply ${ply}`).toBe(actions.length);
      if (game.isOver()) break;

      const choice = game.legalMoves()[0];
      expect(choice, `no legal move at ply ${ply}`).toBeDefined();
      const mover = game.turn === 'white' ? 1 : 2;

      const res = m.move(id, mover, actions.length, choice!.move.encoded);
      expect(res.ok, `server rejected a legal client move at ply ${ply}: ${res.ok ? '' : res.error}`).toBe(true);
      actions = res.ok ? [...res.value.actions] : actions;
      expect(actions.length).toBe(ply + 1);
    }

    expect(actions.length).toBeGreaterThan(10);
  });

  it('the client and the server derive the same board from one seed', () => {
    const seed = 'sync-check';
    const setup = autodraft(dex, seed);
    const clientGame = PokemonChess.create({ dex, position: setup.position, loadout: setup.loadout, seed });

    // The server's own rebuild of the same seed, via the validator's path.
    const serverTurn = engine.turnOf(seed, []);
    expect(serverTurn).toBe(clientGame.turn);

    // Every legal move the client sees must be accepted by the server.
    for (const option of clientGame.legalMoves().slice(0, 8)) {
      const verdict = engine.validate(seed, [], option.move.encoded, clientGame.turn);
      expect(verdict.ok, `server rejected ${option.move.encoded}`).toBe(true);
    }
  });

  it('armies carry abilities and items identically on both sides of the wire', () => {
    const seed = 'kit-sync';
    const first = autodraft(dex, seed).loadout;
    const second = autodraft(dex, seed).loadout;
    expect([...second.entries()]).toEqual([...first.entries()]);
    // And they are actually populated, so the sync being tested is not vacuous.
    const entries = [...first.values()];
    expect(entries.every((e) => e.item !== undefined)).toBe(true);
    expect(entries.filter((e) => e.ability !== undefined).length).toBeGreaterThan(24);
  });
});
