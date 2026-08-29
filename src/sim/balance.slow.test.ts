/**
 * The balance measurement — deliberately slow, and deliberately not in the fast test loop.
 *
 * Extra search depth must actually win games, or the evaluation is not measuring anything. Proving that
 * needs real sample size: at fourteen games it once landed on exactly 0.5 and proved nothing, and capping the
 * game length to speed it up makes most games end in a capped draw, which drowns the signal entirely. So the
 * honest version costs minutes, and it lives here rather than taxing every `npm test`.
 *
 * Run with `npm run test:balance`.
 */

import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import type { Difficulty } from '../ai/search.ts';
import { runBatch } from './batch.ts';

const dex = await Dex.load();

const DEEP: Difficulty = { name: 'Deep', depth: 2, typeBlindness: 0 };
const SHALLOW: Difficulty = { name: 'Shallow', depth: 1, typeBlindness: 0 };

describe('balance', () => {
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
