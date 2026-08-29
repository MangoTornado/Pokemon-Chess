import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import type { Difficulty } from '../ai/search.ts';
import { runBatch } from './batch.ts';

const dex = await Dex.load();

const SIGHTED: Difficulty = { name: 'Sighted', depth: 1, typeBlindness: 0 };
const BLIND: Difficulty = { name: 'Blind', depth: 1, typeBlindness: 0.85 };
// A one-ply-deeper searcher genuinely sees recaptures the shallow one misses — a clean strength gap.
const DEEP: Difficulty = { name: 'Deep', depth: 2, typeBlindness: 0 };
const SHALLOW: Difficulty = { name: 'Shallow', depth: 1, typeBlindness: 0 };

describe('batch simulator', () => {
  it('aggregates outcomes that sum to the game count', () => {
    const report = runBatch(dex, { games: 6, white: SIGHTED, black: SIGHTED, seed: 'sum', maxPlies: 200 });
    expect(report.whiteWins + report.blackWins + report.draws).toBe(6);
    expect(report.games).toBe(6);
    expect(report.avgPlies).toBeGreaterThan(0);
    expect(report.whiteScore).toBeGreaterThanOrEqual(0);
    expect(report.whiteScore).toBeLessThanOrEqual(1);
  });

  it('is perfectly reproducible for a given config and seed', () => {
    const cfg = { games: 5, white: SIGHTED, black: BLIND, seed: 'repro', maxPlies: 200 } as const;
    const a = runBatch(dex, cfg);
    const b = runBatch(dex, cfg);
    expect(a).toEqual(b);
  });

  it('reports progress once per game', () => {
    let calls = 0;
    let lastDone = 0;
    runBatch(dex, { games: 4, white: SIGHTED, black: SIGHTED, seed: 'prog', maxPlies: 120 }, (done, total) => {
      calls += 1;
      lastDone = done;
      expect(total).toBe(4);
    });
    expect(calls).toBe(4);
    expect(lastDone).toBe(4);
  });

  /**
   * The load-bearing balance assertion: extra search depth must actually win games, or the evaluation is
   * not measuring anything.
   *
   * Run in both colours, because White carries a real first-move edge here (~0.54–0.68 in self-play), so a
   * one-sided result could be colour rather than skill. Thirty games per side is the smallest sample where
   * the effect is comfortably clear — at 14 it once landed exactly on 0.5 and proved nothing.
   */
  it('a deeper-searching AI outscores a shallower one, in either colour', { timeout: 180000 }, () => {
    const asWhite = runBatch(dex, { games: 30, white: DEEP, black: SHALLOW, seed: 'strength', maxPlies: 200, draft: 'fresh' });
    expect(asWhite.whiteScore).toBeGreaterThan(0.55);

    // Reversed: the deep searcher now plays Black and gives up the first move, so its score is 1 − White's.
    const asBlack = runBatch(dex, { games: 30, white: SHALLOW, black: DEEP, seed: 'strength-rev', maxPlies: 200, draft: 'fresh' });
    expect(1 - asBlack.whiteScore).toBeGreaterThan(0.5);
  });
});
