import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import { PokemonChess } from '../engine/variant.ts';
import { autodraft } from './autodraft.ts';
import { replay } from './replay.ts';

const dex = await Dex.load();

/** A fingerprint that captures both the board and the live HP, so a divergence anywhere is caught. */
function fingerprint(game: PokemonChess): string {
  const hp = game
    .pieces()
    .map((p) => `${p.square}:${p.live.hp}`)
    .sort()
    .join(',');
  return `${game.position.toFen()}|${hp}`;
}

describe('replay', () => {
  it('reconstructs the identical game from a recorded action list', () => {
    const setup = autodraft(dex, 'replay-seed');
    let game = PokemonChess.create({ dex, position: setup.position, loadout: setup.loadout, seed: 'replay-seed' });

    // Play a deterministic line: the first legal move each turn, for a handful of plies.
    const actions: number[] = [];
    for (let i = 0; i < 12 && !game.isOver(); i++) {
      const move = game.legalMoves()[0];
      if (!move) break;
      actions.push(move.move.encoded);
      game = game.play(move.move).game;
    }
    expect(actions.length).toBeGreaterThan(0);

    const result = replay(dex, { position: setup.position, loadout: setup.loadout }, 'replay-seed', actions);
    expect(result.applied).toBe(actions.length);
    expect(fingerprint(result.game)).toBe(fingerprint(game));
  });

  it('stops cleanly at the first action that is not legal (a desync)', () => {
    const setup = autodraft(dex, 'desync');
    const game = PokemonChess.create({ dex, position: setup.position, loadout: setup.loadout, seed: 'desync' });
    const first = game.legalMoves()[0]!.move.encoded;
    // A bogus second action (all bits set) has no legal match, so replay halts after the first.
    const result = replay(dex, { position: setup.position, loadout: setup.loadout }, 'desync', [first, 0xffffff]);
    expect(result.applied).toBe(1);
  });
});
