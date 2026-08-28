/**
 * Board geometry: squares, coordinates, and the raw movement patterns of the chess piece classes.
 *
 * This module is deliberately ignorant of Pokémon. It answers only "which squares could a rook
 * standing here reach, given these blockers" — the geometry that no rule variation changes. What a
 * capture *means* when it lands is decided elsewhere (see `typechart.ts` and the rules layer), which
 * is what keeps that layer free to evolve without disturbing move generation.
 *
 * Representation: a 64-entry mailbox indexed `square = rank * 8 + file`, so `a1 = 0`, `h1 = 7`,
 * `a8 = 56`, `h8 = 63`. Sliding uses file/rank arithmetic rather than raw index offsets, which makes
 * board-edge wraparound structurally impossible rather than something to remember to guard.
 */

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
export const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

export const BOARD_SIZE = 8;
export const SQUARE_COUNT = 64;

/** A square index in `0..63`. */
export type Square = number;

/** Algebraic square name, e.g. `e4`. */
export type SquareName = `${(typeof FILES)[number]}${(typeof RANKS)[number]}`;

export const fileOf = (square: Square): number => square & 7;
export const rankOf = (square: Square): number => square >> 3;

export const squareAt = (file: number, rank: number): Square => rank * 8 + file;

export const isOnBoard = (square: number): boolean =>
  Number.isInteger(square) && square >= 0 && square < SQUARE_COUNT;

const inBounds = (file: number, rank: number): boolean =>
  file >= 0 && file < BOARD_SIZE && rank >= 0 && rank < BOARD_SIZE;

export function squareName(square: Square): SquareName {
  if (!isOnBoard(square)) throw new RangeError(`square out of range: ${square}`);
  return `${FILES[fileOf(square)]}${RANKS[rankOf(square)]}` as SquareName;
}

export function parseSquare(name: string): Square {
  const file = FILES.indexOf(name[0] as (typeof FILES)[number]);
  const rank = RANKS.indexOf(name[1] as (typeof RANKS)[number]);
  if (name.length !== 2 || file < 0 || rank < 0) {
    throw new RangeError(`not an algebraic square: ${JSON.stringify(name)}`);
  }
  return squareAt(file, rank);
}

/** All 64 squares in index order. */
export const ALL_SQUARES: readonly Square[] = Array.from({ length: SQUARE_COUNT }, (_, i) => i);

/** Chebyshev distance — the number of king moves between two squares. */
export function kingDistance(a: Square, b: Square): number {
  return Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
}

/** Manhattan distance, useful as an AI evaluation term. */
export function taxicabDistance(a: Square, b: Square): number {
  return Math.abs(fileOf(a) - fileOf(b)) + Math.abs(rankOf(a) - rankOf(b));
}

/** `true` when both squares lie on the same diagonal. */
export function sameDiagonal(a: Square, b: Square): boolean {
  return Math.abs(fileOf(a) - fileOf(b)) === Math.abs(rankOf(a) - rankOf(b));
}

/** Light or dark square — matters because a bishop is confined to one colour for the whole game. */
export function squareColor(square: Square): 'light' | 'dark' {
  return (fileOf(square) + rankOf(square)) % 2 === 0 ? 'dark' : 'light';
}

// ---------------------------------------------------------------------------
// Direction vectors
// ---------------------------------------------------------------------------

/** `[fileStep, rankStep]` */
export type Direction = readonly [number, number];

export const ORTHOGONAL: readonly Direction[] = [
  [0, 1], [0, -1], [1, 0], [-1, 0],
];

export const DIAGONAL: readonly Direction[] = [
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

export const ALL_DIRECTIONS: readonly Direction[] = [...ORTHOGONAL, ...DIAGONAL];

const KNIGHT_STEPS: readonly Direction[] = [
  [1, 2], [2, 1], [2, -1], [1, -2],
  [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];

// ---------------------------------------------------------------------------
// Precomputed tables
//
// Built once at module load. Move generation runs inside AI search, so the hot path should be table
// lookups rather than repeated bounds arithmetic.
// ---------------------------------------------------------------------------

function stepsFrom(square: Square, steps: readonly Direction[]): Square[] {
  const file = fileOf(square);
  const rank = rankOf(square);
  const out: Square[] = [];
  for (const [df, dr] of steps) {
    const f = file + df;
    const r = rank + dr;
    if (inBounds(f, r)) out.push(squareAt(f, r));
  }
  return out;
}

/** Squares a knight on `square` can reach, ignoring occupancy. */
export const KNIGHT_MOVES: readonly (readonly Square[])[] = ALL_SQUARES.map((sq) =>
  stepsFrom(sq, KNIGHT_STEPS),
);

/** Squares a king on `square` can reach, ignoring occupancy and castling. */
export const KING_MOVES: readonly (readonly Square[])[] = ALL_SQUARES.map((sq) =>
  stepsFrom(sq, ALL_DIRECTIONS),
);

/**
 * `RAYS[square][directionIndex]` — squares walking outward from `square` until the board edge,
 * ordered nearest-first so a scan can stop at the first blocker.
 *
 * Direction indices match {@link ALL_DIRECTIONS}: `0..3` orthogonal, `4..7` diagonal.
 */
export const RAYS: readonly (readonly (readonly Square[])[])[] = ALL_SQUARES.map((sq) =>
  ALL_DIRECTIONS.map(([df, dr]) => {
    const out: Square[] = [];
    let f = fileOf(sq) + df;
    let r = rankOf(sq) + dr;
    while (inBounds(f, r)) {
      out.push(squareAt(f, r));
      f += df;
      r += dr;
    }
    return out;
  }),
);

const ORTHOGONAL_INDICES = [0, 1, 2, 3] as const;
const DIAGONAL_INDICES = [4, 5, 6, 7] as const;

/** Which ray-direction indices a sliding piece class may use. */
export const SLIDING_DIRECTIONS = {
  rook: ORTHOGONAL_INDICES,
  bishop: DIAGONAL_INDICES,
  queen: [...ORTHOGONAL_INDICES, ...DIAGONAL_INDICES],
} as const;

/**
 * `BETWEEN[a][b]` — the squares strictly between `a` and `b` when they share a rank, file or
 * diagonal; otherwise empty.
 *
 * Used for the two questions that dominate legality checking: is this sliding path clear, and can a
 * check be blocked by interposing on one of these squares.
 */
export const BETWEEN: readonly (readonly (readonly Square[])[])[] = ALL_SQUARES.map((a) => {
  const row: Square[][] = ALL_SQUARES.map(() => []);
  for (const dirIndex of [0, 1, 2, 3, 4, 5, 6, 7] as const) {
    const ray = RAYS[a]![dirIndex]!;
    for (let i = 0; i < ray.length; i++) {
      row[ray[i]!] = ray.slice(0, i);
    }
  }
  return row;
});

/** `true` when `a`, `b` and `c` are collinear along a rank, file or diagonal. */
export function isAligned(a: Square, b: Square, c: Square): boolean {
  const df1 = fileOf(b) - fileOf(a);
  const dr1 = rankOf(b) - rankOf(a);
  const df2 = fileOf(c) - fileOf(a);
  const dr2 = rankOf(c) - rankOf(a);
  return df1 * dr2 - dr1 * df2 === 0;
}

// ---------------------------------------------------------------------------
// Pawn geometry
// ---------------------------------------------------------------------------

/** Which direction a side's pawns advance. White moves up the board, toward rank 8. */
export type Side = 'white' | 'black';

export const forwardStep = (side: Side): number => (side === 'white' ? 1 : -1);

/** The rank a side's pawns start on. */
export const pawnStartRank = (side: Side): number => (side === 'white' ? 1 : 6);

/** The rank on which reaching it promotes — the "evolution" rank. */
export const promotionRank = (side: Side): number => (side === 'white' ? 7 : 0);

/** Square directly ahead of `square`, or `null` off the board. */
export function pawnPush(square: Square, side: Side): Square | null {
  const r = rankOf(square) + forwardStep(side);
  return inBounds(fileOf(square), r) ? squareAt(fileOf(square), r) : null;
}

/** Two squares ahead, available only from the starting rank. */
export function pawnDoublePush(square: Square, side: Side): Square | null {
  if (rankOf(square) !== pawnStartRank(side)) return null;
  const r = rankOf(square) + 2 * forwardStep(side);
  return inBounds(fileOf(square), r) ? squareAt(fileOf(square), r) : null;
}

/** The one or two squares a pawn attacks diagonally. */
export function pawnAttacks(square: Square, side: Side): Square[] {
  const dr = forwardStep(side);
  return stepsFrom(square, [
    [1, dr],
    [-1, dr],
  ]);
}

/** Precomputed pawn attack tables, indexed by square. */
export const PAWN_ATTACKS: Record<Side, readonly (readonly Square[])[]> = {
  white: ALL_SQUARES.map((sq) => pawnAttacks(sq, 'white')),
  black: ALL_SQUARES.map((sq) => pawnAttacks(sq, 'black')),
};

/** `true` when a piece of `side` arriving on `square` has reached the promotion rank. */
export const isPromotionSquare = (square: Square, side: Side): boolean =>
  rankOf(square) === promotionRank(side);

// ---------------------------------------------------------------------------
// Piece classes
// ---------------------------------------------------------------------------

/** The six chess piece classes. Pokémon are drafted into these roles. */
export const PIECE_CLASSES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'] as const;

export type PieceClass = (typeof PIECE_CLASSES)[number];

/** How many of each class a standard army fields. */
export const STANDARD_ARMY: Record<PieceClass, number> = {
  pawn: 8,
  knight: 2,
  bishop: 2,
  rook: 2,
  queen: 1,
  king: 1,
};

/**
 * Standard starting squares, by side and class, in file order.
 *
 * The draft assigns a Pokémon to each of these slots; the geometry of where they stand is ordinary
 * chess so that a chess player's opening intuition still transfers.
 */
export const STARTING_SQUARES: Record<Side, Record<PieceClass, readonly Square[]>> = {
  white: {
    pawn: [8, 9, 10, 11, 12, 13, 14, 15],
    rook: [0, 7],
    knight: [1, 6],
    bishop: [2, 5],
    queen: [3],
    king: [4],
  },
  black: {
    pawn: [48, 49, 50, 51, 52, 53, 54, 55],
    rook: [56, 63],
    knight: [57, 62],
    bishop: [58, 61],
    queen: [59],
    king: [60],
  },
};

/** `true` if the class slides along rays (and so can be blocked). */
export const isSlider = (cls: PieceClass): cls is 'rook' | 'bishop' | 'queen' =>
  cls === 'rook' || cls === 'bishop' || cls === 'queen';

/**
 * Squares a piece of `cls` on `from` could move to or capture on, given an occupancy predicate.
 *
 * `occupied` reports whether a square holds any piece of either side. Sliding stops *on* the first
 * occupied square and includes it, because whether that square is a legal target depends on rules
 * this module deliberately does not know — for a Pokémon Chess capture, occupancy by an enemy is
 * necessary but not sufficient (a 0× type matchup forbids it outright).
 *
 * Pawns are excluded: their pushes and captures differ, so they have dedicated helpers above.
 */
export function reachableSquares(
  cls: Exclude<PieceClass, 'pawn'>,
  from: Square,
  occupied: (square: Square) => boolean,
): Square[] {
  if (cls === 'knight') return KNIGHT_MOVES[from]!.slice();
  if (cls === 'king') return KING_MOVES[from]!.slice();

  const out: Square[] = [];
  for (const dirIndex of SLIDING_DIRECTIONS[cls]) {
    for (const target of RAYS[from]![dirIndex]!) {
      out.push(target);
      if (occupied(target)) break;
    }
  }
  return out;
}
