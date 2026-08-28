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

  it('a deeper-searching AI outscores a shallower one', { timeout: 90000 }, () => {
    // Fresh armies each game so neither side has a structural board advantage; the deeper searcher (White)
    // should convert its extra ply of sight into more than an even score. Deterministic given the seed.
    const report = runBatch(dex, { games: 14, white: DEEP, black: SHALLOW, seed: 'strength', maxPlies: 200, draft: 'fresh' });
    expect(report.whiteScore).toBeGreaterThan(0.5);
  });
});
