import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import { PokemonChess } from '../engine/variant.ts';
import { buildGymMatch } from '../game/gymArmy.ts';
import {
  BASE_RATING, RATING_FLOOR, expectedScore, kFactorFor, tierFor, tierProgress, updateRating,
} from './rating.ts';
import { GYM_LEADERS, gymGate, highestBadge, isGymUnlocked, nextGym } from './badges.ts';

const dex = await Dex.load();

describe('rating', () => {
  it('expected score is 0.5 for equal ratings and symmetric', () => {
    expect(expectedScore(1500, 1500)).toBeCloseTo(0.5, 6);
    expect(expectedScore(1600, 1400) + expectedScore(1400, 1600)).toBeCloseTo(1, 6);
  });

  it('a win raises and a loss lowers the rating', () => {
    expect(updateRating(1500, 1500, 1)).toBeGreaterThan(1500);
    expect(updateRating(1500, 1500, 0)).toBeLessThan(1500);
    expect(updateRating(1500, 1500, 0.5)).toBe(1500);
  });

  it('beating a stronger opponent gains more than beating a weaker one', () => {
    const vsStronger = updateRating(1500, 1900, 1) - 1500;
    const vsWeaker = updateRating(1500, 1100, 1) - 1500;
    expect(vsStronger).toBeGreaterThan(vsWeaker);
  });

  it('never falls below the floor', () => {
    let r = 200;
    for (let i = 0; i < 50; i++) r = updateRating(r, 3000, 0);
    expect(r).toBeGreaterThanOrEqual(RATING_FLOOR);
  });

  it('K-factor is steeper while provisional', () => {
    expect(kFactorFor(0)).toBeGreaterThan(kFactorFor(20));
  });

  it('tiers ascend with rating and progress is bounded', () => {
    expect(tierFor(0).id).toBe('rookie');
    expect(tierFor(9999).id).toBe('champion');
    expect(tierFor(BASE_RATING).id).toBe('great');
    const p = tierProgress(1450);
    expect(p.fraction).toBeGreaterThanOrEqual(0);
    expect(p.fraction).toBeLessThanOrEqual(1);
    expect(tierProgress(9999).next).toBeNull();
  });
});

describe('badges', () => {
  it('the eight Kanto gyms are in canon order', () => {
    expect(GYM_LEADERS.map((g) => g.id)).toEqual([
      'boulder', 'cascade', 'thunder', 'rainbow', 'soul', 'marsh', 'volcano', 'earth',
    ]);
    expect(GYM_LEADERS.map((g) => g.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('difficulty ramps up down the list', () => {
    for (let i = 1; i < GYM_LEADERS.length; i++) {
      expect(GYM_LEADERS[i]!.rating).toBeGreaterThan(GYM_LEADERS[i - 1]!.rating);
    }
    expect(GYM_LEADERS[GYM_LEADERS.length - 1]!.typeBlindness).toBe(0);
  });

  it('gyms unlock strictly in order', () => {
    const earned = new Set<string>();
    const high = 3000; // rating high enough that only the ordering gate can bind
    expect(nextGym(earned)?.id).toBe('boulder');
    expect(isGymUnlocked(GYM_LEADERS[0]!, earned, high)).toBe(true);
    expect(isGymUnlocked(GYM_LEADERS[1]!, earned, high)).toBe(false); // Misty locked until Brock falls
    earned.add('boulder');
    expect(nextGym(earned)?.id).toBe('cascade');
    expect(isGymUnlocked(GYM_LEADERS[0]!, earned, high)).toBe(true); // earned gyms allow a rematch
    expect(isGymUnlocked(GYM_LEADERS[1]!, earned, high)).toBe(true);
  });

  it('a gym also requires the rating to have been climbed', () => {
    const earned = new Set<string>(['boulder']);
    const misty = GYM_LEADERS[1]!;
    // In order, but not yet strong enough.
    expect(isGymUnlocked(misty, earned, misty.ratingRequired - 1)).toBe(false);
    expect(isGymUnlocked(misty, earned, misty.ratingRequired)).toBe(true);
  });

  it('the first gym is reachable at the starting rating, and the last at Champion League', () => {
    // A new account must be able to earn its first badge without a climb.
    expect(isGymUnlocked(GYM_LEADERS[0]!, new Set(), BASE_RATING)).toBe(true);
    // The gates rise monotonically, so each badge is a further rung.
    for (let i = 1; i < GYM_LEADERS.length; i++) {
      expect(GYM_LEADERS[i]!.ratingRequired).toBeGreaterThan(GYM_LEADERS[i - 1]!.ratingRequired);
    }
    // Giovanni sits at the top league's floor, so the last badge means Champion League.
    expect(GYM_LEADERS[GYM_LEADERS.length - 1]!.ratingRequired).toBe(tierFor(1950).floor);
  });

  it('reports how much rating the next badge still needs', () => {
    const earned = new Set<string>(['boulder']);
    const misty = GYM_LEADERS[1]!;
    const gate = gymGate(earned, misty.ratingRequired - 30);
    expect(gate).toMatchObject({ needed: 30 });
    expect(gate!.gym.id).toBe('cascade');
    // No gate once the rating is there, and none once every badge is won.
    expect(gymGate(earned, misty.ratingRequired)).toBeNull();
    expect(gymGate(new Set(GYM_LEADERS.map((g) => g.id)), 9999)).toBeNull();
  });

  it('highest badge is the greatest-order earned', () => {
    expect(highestBadge(new Set())).toBeNull();
    expect(highestBadge(new Set(['boulder', 'thunder']))?.id).toBe('thunder');
  });
});

describe('gym army', () => {
  for (const gym of GYM_LEADERS) {
    it(`${gym.leader} fields a legal mono-${gym.type} army`, () => {
      const { position, loadout } = buildGymMatch(dex, gym.type, 'seed-1');
      const game = PokemonChess.create({ dex, position, loadout, seed: 'seed-1' });

      let blackPieces = 0;
      let whiteTypes = new Set<string>();
      let blackKings = 0;
      let whiteKings = 0;
      for (const { piece, pokemon } of game.pieces()) {
        if (piece.side === 'black') {
          blackPieces++;
          expect(pokemon.type, `${pokemon.species} should be declared ${gym.type}`).toBe(gym.type);
          if (piece.cls === 'king') blackKings++;
        } else {
          whiteTypes.add(pokemon.type);
          if (piece.cls === 'king') whiteKings++;
        }
      }
      expect(blackPieces).toBe(16);
      expect(blackKings).toBe(1);
      expect(whiteKings).toBe(1);
      // The player's side is a varied draft, not mono-type.
      expect(whiteTypes.size).toBeGreaterThan(1);
      // A well-formed game with legal moves for White to open.
      expect(game.legalMoves().length).toBeGreaterThan(0);
    });
  }

  it('is deterministic for a given seed', () => {
    const a = buildGymMatch(dex, 'Fire', 'x');
    const b = buildGymMatch(dex, 'Fire', 'x');
    expect([...a.loadout.entries()]).toEqual([...b.loadout.entries()]);
  });
});
