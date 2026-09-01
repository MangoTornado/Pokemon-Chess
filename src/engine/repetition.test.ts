/**
 * A repetition is only a repetition if the *game* repeated, not just the board.
 *
 * `Position.repetitionCount()` compares a pure chess Zobrist key, and the Pokémon layer never folded its own state
 * in — `Position.xorHash` was documented at length in `zobrist.ts` as exactly this seam and had zero production
 * callers. So a board returning to a previous arrangement counted as a repetition even when the game was materially
 * different, and `result()` declared a draw. Proven four separate ways during design: a king's HP falling
 * 362 → 318 → 274 as a burn ticked; a Dynamax lapse halving a rook's pool mid-"repetition"; weather and Reflect
 * timers running down with HP frozen; and Sticky Web stacking a Speed drop to −2, which decides who swings first.
 *
 * Note this only matters inside a window with no capture and no pawn move, because `repetitionCount()` scans back
 * only to `ply - halfmove`. That is also why the companion progress rule had to land first: making board positions
 * match *less* often weakens termination, and chess's own backstops cannot fire in this variant at all.
 */

import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import type { BattleType } from '../data/schema.ts';
import { squareName } from './board.ts';
import { Position } from './position.ts';
import { PokemonChess } from './variant.ts';
import type { Loadout, PokemonLoadout } from './variant.ts';

const dex = await Dex.load();

/**
 * One knight each and nothing that could capture or push a pawn.
 *
 * Driven around a deliberate cycle rather than by picking "the first quiet move": knights left to themselves
 * *wander* (a1b3, a8c7, g1h3, c7e8 …) and never return the same board, so the repetition counter stays at 1 and
 * such a fixture proves nothing either way.
 */
const SHUFFLE = 'n6k/8/8/8/8/8/8/N6K w - - 0 1';

/** The four-ply cycle that returns the board exactly as it was. */
const CYCLE: readonly [string, string][] = [['a1', 'b3'], ['a8', 'b6'], ['b3', 'a1'], ['b6', 'a8']];

function gameFrom(weather?: 'sand', type: BattleType = 'Normal') {
  const position = Position.fromFen(SHUFFLE);
  const loadout = new Map<number, PokemonLoadout>();
  for (const { piece } of position.allPieces()) {
    const slot = { id: 's', name: 'S', type, category: 'Physical' as const, basePower: 60 };
    loadout.set(piece.id, {
      species: 'machamp', type, moves: [slot, slot, slot, slot] as NonNullable<PokemonLoadout['moves']>,
    });
  }
  return PokemonChess.create({
    dex, position, loadout: loadout as Loadout, seed: 'rep', rules: { critCoins: 0, guarded: false },
    ...(weather ? { weather } : {}),
  });
}

/** Walks the cycle `laps` times, so the identical board recurs `laps` times. */
function shuffle(game: PokemonChess, laps: number) {
  let g = game;
  for (let lap = 0; lap < laps; lap++) {
    for (const [from, to] of CYCLE) {
      const move = g.legalMoves().find(
        (m) => squareName(m.move.from) === from && squareName(m.move.to) === to && !m.move.captured,
      );
      if (!move) return g;
      g = g.play(move.move).game;
    }
  }
  return g;
}

describe('a board that repeats while the game changes', () => {
  it('is not a draw when HP is still moving', () => {
    // Sandstorm chips every Checkup, so HP falls on every one of these plies even though the board returns.
    const g = shuffle(gameFrom('sand'), 3);
    const hp = [...g.pieces()].map((p) => p.live.hp);
    const full = [...g.pieces()].map((p) => p.live.maxHp);

    expect(hp.some((v, i) => v < full[i]!), 'the sandstorm should have damaged somebody').toBe(true);
    // The bug: this returned { kind: 'draw', reason: 'repetition' }.
    const r = g.result();
    expect(r.kind === 'draw' ? r.reason : null).not.toBe('repetition');
  });

  it('still draws when the game really did repeat', () => {
    // The same shuffle with nothing else going on. If the fingerprint were over-eager — folding in something that
    // changes every ply, like the RNG — this would never draw and the rule would be dead.
    const g = shuffle(gameFrom(), 3);
    expect(g.position.repetitionCount()).toBeGreaterThanOrEqual(3);
    expect(g.result()).toMatchObject({ kind: 'draw', reason: 'repetition' });
  });

  it('keeps the position key consistent with the board it describes', () => {
    // The invariant that catches a path forgetting to fold, or folding at the wrong moment: strip the fingerprint
    // and what is left must be exactly the key of the same board parsed fresh.
    // With weather running, the same board must NOT match itself, because the game is not the same.
    const chipped = shuffle(gameFrom('sand'), 3);
    expect(chipped.position.repetitionCount(), 'the fingerprint should keep these apart').toBeLessThan(3);
    // Without it, the identical board does match — so the fingerprint is discriminating, not just noisy.
    expect(shuffle(gameFrom(), 3).position.repetitionCount()).toBeGreaterThanOrEqual(3);
  });
});
