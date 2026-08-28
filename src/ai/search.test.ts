import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import { Position } from '../engine/position.ts';
import { Rng } from '../engine/rng.ts';
import { PokemonChess } from '../engine/variant.ts';
import type { Loadout, PokemonLoadout } from '../engine/variant.ts';
import { DIFFICULTIES, chooseMove } from './search.ts';
import { evaluate } from './evaluate.ts';

const dex = await Dex.load();

const TYPES = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
] as const;
const SPECIES = ['pikachu', 'garchomp', 'gengar', 'blissey', 'charizard', 'skarmory', 'lapras', 'snorlax'];

function randomGame(seed: string): PokemonChess {
  const rng = new Rng(`ai:${seed}`);
  const position = Position.fromStartingPosition();
  const loadout = new Map<number, PokemonLoadout>();
  for (const { piece } of position.allPieces()) {
    loadout.set(piece.id, { species: rng.pick(SPECIES), type: rng.pick(TYPES) });
  }
  return PokemonChess.create({ dex, position, loadout: loadout as Loadout, seed });
}

describe('the evaluator', () => {
  it('scores the starting position roughly even', () => {
    const game = randomGame('even');
    const score = evaluate(game, 'white');
    // Two random armies of equal class composition should be within a piece or two of level.
    expect(Math.abs(score)).toBeLessThan(3000);
  });

  it('scores a side up a queen as clearly ahead', () => {
    // Remove black's queen by giving white an extra-favourable position: hard to construct cleanly, so
    // assert the sign of a material edge via piece values directly through a lopsided board.
    const position = Position.fromFen('4k3/8/8/8/8/8/8/3QK3 w - - 0 1');
    const loadout = new Map<number, PokemonLoadout>();
    for (const { piece } of position.allPieces()) {
      loadout.set(piece.id, { species: 'garchomp', type: 'Normal' });
    }
    const game = PokemonChess.create({ dex, position, loadout: loadout as Loadout, seed: 'q' });
    // White has a queen and king, black only a king — white is hugely ahead.
    expect(evaluate(game, 'white')).toBeGreaterThan(500);
    expect(evaluate(game, 'black')).toBeLessThan(-500);
  });
});

describe('move choice', () => {
  it('returns a legal move for the side to move', () => {
    const game = randomGame('choose');
    const result = chooseMove(game, DIFFICULTIES.ace!, 7);
    expect(result).not.toBeNull();
    const legal = new Set(game.legalMoves().map((m) => m.move.encoded));
    expect(legal.has(result!.move.encoded)).toBe(true);
  });

  it('is deterministic for a fixed game, difficulty and seed', () => {
    const game = randomGame('determinism');
    const a = chooseMove(game, DIFFICULTIES.trainer!, 42);
    const b = chooseMove(game, DIFFICULTIES.trainer!, 42);
    expect(b!.move.encoded).toBe(a!.move.encoded);
    expect(b!.score).toBe(a!.score);
  });

  it('takes a free winning capture when one is on offer', () => {
    // White rook on a1 can capture a lone black pawn on a7 super-effectively; the king is safe.
    const position = Position.fromFen('4k3/p7/8/8/8/8/8/R3K3 w - - 0 1');
    const loadout = new Map<number, PokemonLoadout>();
    for (const { square, piece } of position.allPieces()) {
      const isTarget = square === 48; // a7
      loadout.set(piece.id, { species: isTarget ? 'gastly' : 'garchomp', type: isTarget ? 'Steel' : 'Fire' });
    }
    const game = PokemonChess.create({ dex, position, loadout: loadout as Loadout, seed: 'grab', rules: { guarded: false, critCoins: 0, maxExtraMovesPerTurn: 2 } });
    const result = chooseMove(game, DIFFICULTIES.ace!, 1);
    // The best move takes the free pawn (a7 = square 48).
    expect(result!.move.to).toBe(48);
  });

  it('searches more nodes at higher difficulty', () => {
    const game = randomGame('nodes');
    const rookie = chooseMove(game, DIFFICULTIES.rookie!, 1)!;
    const champion = chooseMove(game, DIFFICULTIES.champion!, 1)!;
    expect(champion.nodes).toBeGreaterThan(rookie.nodes);
  });
});

describe('difficulty', () => {
  // A depth-2 searcher against a random mover, over short games. Kept deliberately cheap: a full-board
  // negamax in a play loop is expensive, so this proves the search does real work without a long run.
  it('outscores a random mover on average as a Trainer', { timeout: 30_000 }, () => {
    let netMaterial = 0;
    for (let seed = 0; seed < 4; seed++) {
      let game = randomGame(`vs-random-${seed}`);
      const rng = new Rng(`rand-${seed}`);
      for (let ply = 0; ply < 24 && !game.isOver(); ply++) {
        if (game.turn === 'white') {
          const choice = chooseMove(game, DIFFICULTIES.trainer!, ply);
          if (!choice) break;
          game = game.play(choice.move).game;
        } else {
          const moves = game.legalMoves();
          if (moves.length === 0) break;
          game = game.play(rng.pick(moves).move).game;
        }
      }
      // The AI (white) should end ahead on the evaluation more often than not — a robust signal that
      // does not depend on forcing a full checkmate inside 24 plies.
      netMaterial += evaluate(game, 'white');
    }
    expect(netMaterial).toBeGreaterThan(0);
  });

  it('prefers a stronger move than a purely random pick in a tactical spot', () => {
    // With a free super-effective capture available, the Ace must not pick a random quiet move.
    const position = Position.fromFen('4k3/p7/8/8/8/8/8/R3K3 w - - 0 1');
    const loadout = new Map<number, PokemonLoadout>();
    for (const { square, piece } of position.allPieces()) {
      loadout.set(piece.id, { species: square === 48 ? 'gastly' : 'garchomp', type: square === 48 ? 'Steel' : 'Fire' });
    }
    const game = PokemonChess.create({ dex, position, loadout: loadout as Loadout, seed: 'tac', rules: { guarded: false, critCoins: 0, maxExtraMovesPerTurn: 2 } });
    expect(chooseMove(game, DIFFICULTIES.ace!, 1)!.move.to).toBe(48);
  });
});
