/**
 * Zobrist hashing: a 64-bit fingerprint of a position, maintained incrementally.
 *
 * Threefold repetition has to be answered from inside AI search, so the position key must be
 * updatable in a handful of XORs rather than re-derived by serialising the board. The key is carried
 * as two 32-bit halves because JavaScript's bitwise operators truncate to 32 bits and `BigInt` is far
 * too slow for a hot path that runs millions of times per second; the halves are joined into a single
 * comparable `bigint` only when a caller asks for one.
 *
 * The words are drawn from the project's seeded RNG rather than `Math.random`, so a key printed in a
 * failing test means the same thing on the next run and in a saved replay.
 *
 * ## Extending this for the Pokémon layer
 *
 * The words below cover exactly what *standard chess* treats as position identity: placement by side
 * and class, castling rights, the en passant file, and the side to move. Pokémon Chess adds state
 * that also distinguishes positions — a piece's type, ability, item, status, or a pending free move
 * after a super-effective capture — and two positions that differ in any of those are not repetitions
 * of each other. The rules layer above therefore owns those words:
 *
 * 1. Derive a stable pair per fact with {@link zobristWords}, e.g. `zobristWords('status/burn/12')`
 *    for "the piece with id 12 is burned". Labels are hashed, so the layer never has to allocate a
 *    table sized to the cross product of ids and states.
 * 2. Fold them in with `Position.xorHash(hi, lo)` when the fact becomes true, and again when it
 *    stops being true — XOR is its own inverse.
 * 3. Nothing else is required for search: `makeMove` snapshots the whole key and `unmakeMove`
 *    restores that snapshot, so words mixed in after a `makeMove` are undone by the matching
 *    `unmakeMove` without the extension tracking them.
 *
 * Note that per-piece state must be keyed by piece *id*, not by square, which is why `Position`
 * gives every piece an identity that survives moves and promotion.
 */

import { PIECE_CLASSES, SQUARE_COUNT } from './board.ts';
import { Rng } from './rng.ts';

const CLASS_COUNT = PIECE_CLASSES.length;
const SIDE_COUNT = 2;

/** A fixed seed keeps keys stable across runs, which is what makes a logged hash reproducible. */
const source = new Rng('pokemon-chess/zobrist/v1');

function randomWords(pairs: number): Int32Array {
  const out = new Int32Array(pairs * 2);
  for (let i = 0; i < out.length; i++) out[i] = source.uint32() | 0;
  return out;
}

/** One word pair per `(side, class, square)`, laid out flat so lookups are a single index. */
export const PIECE_WORDS = randomWords(SIDE_COUNT * CLASS_COUNT * SQUARE_COUNT);

/** One pair per castling-rights bitmask, so a rights change costs an XOR out and an XOR in. */
export const CASTLING_WORDS = randomWords(16);

/** Keyed by file rather than square: the rank is implied by whose turn it is. */
export const EP_FILE_WORDS = randomWords(8);

/** Mixed in when it is Black to move, so the same placement with either side to move differs. */
export const SIDE_WORDS = randomWords(1);

/** Index of the `(side, class, square)` pair inside {@link PIECE_WORDS}. */
export const pieceWordIndex = (side: number, cls: number, square: number): number =>
  ((side * CLASS_COUNT + cls) * SQUARE_COUNT + square) * 2;

/**
 * A stable word pair for an arbitrary label, for state this module does not know about.
 *
 * Deterministic in the label alone, so two runs — or a client and a server — agree without shipping
 * a table.
 */
export function zobristWords(label: string): readonly [number, number] {
  const rng = new Rng(`pokemon-chess/zobrist/v1/${label}`);
  return [rng.uint32() | 0, rng.uint32() | 0];
}

/** Joins the two halves into one comparable value, for use as a `Map` key or in assertions. */
export function zobristKey(hi: number, lo: number): bigint {
  return (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
}
