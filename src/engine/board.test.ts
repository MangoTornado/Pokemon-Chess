import { describe, expect, it } from 'vitest';

import {
  ALL_SQUARES,
  BETWEEN,
  KING_MOVES,
  KNIGHT_MOVES,
  PAWN_ATTACKS,
  PIECE_CLASSES,
  RAYS,
  STANDARD_ARMY,
  STARTING_SQUARES,
  isAligned,
  isPromotionSquare,
  isSlider,
  kingDistance,
  pawnDoublePush,
  pawnPush,
  parseSquare,
  reachableSquares,
  sameDiagonal,
  squareAt,
  squareColor,
  squareName,
  taxicabDistance,
} from './board.ts';

const never = () => false;

describe('coordinates', () => {
  it('round-trips every square through algebraic notation', () => {
    for (const sq of ALL_SQUARES) {
      expect(parseSquare(squareName(sq))).toBe(sq);
    }
  });

  it('anchors the corners where chess players expect them', () => {
    expect(squareName(0)).toBe('a1');
    expect(squareName(7)).toBe('h1');
    expect(squareName(56)).toBe('a8');
    expect(squareName(63)).toBe('h8');
    expect(parseSquare('e4')).toBe(squareAt(4, 3));
  });

  it('rejects malformed square names instead of guessing', () => {
    expect(() => parseSquare('i9')).toThrow();
    expect(() => parseSquare('e')).toThrow();
    expect(() => parseSquare('e44')).toThrow();
    expect(() => squareName(64)).toThrow();
    expect(() => squareName(-1)).toThrow();
  });

  it('colours the board like a real one, with a1 dark and h1 light', () => {
    expect(squareColor(parseSquare('a1'))).toBe('dark');
    expect(squareColor(parseSquare('h1'))).toBe('light');
    expect(squareColor(parseSquare('a8'))).toBe('light');
    const dark = ALL_SQUARES.filter((s) => squareColor(s) === 'dark').length;
    expect(dark).toBe(32);
  });

  it('measures distances', () => {
    expect(kingDistance(parseSquare('a1'), parseSquare('h8'))).toBe(7);
    expect(kingDistance(parseSquare('d4'), parseSquare('e5'))).toBe(1);
    expect(taxicabDistance(parseSquare('a1'), parseSquare('h8'))).toBe(14);
    expect(sameDiagonal(parseSquare('a1'), parseSquare('h8'))).toBe(true);
    expect(sameDiagonal(parseSquare('a1'), parseSquare('h7'))).toBe(false);
  });
});

// These totals are standard, independently known values for an 8x8 board, which makes them a real
// oracle for the geometry rather than a restatement of the implementation.
describe('movement patterns match known move-count totals on an empty board', () => {
  it('knight: 336', () => {
    expect(KNIGHT_MOVES.reduce((n, m) => n + m.length, 0)).toBe(336);
  });

  it('king: 420', () => {
    expect(KING_MOVES.reduce((n, m) => n + m.length, 0)).toBe(420);
  });

  it('rook: 896 (14 from every square)', () => {
    let total = 0;
    for (const sq of ALL_SQUARES) {
      const moves = reachableSquares('rook', sq, never);
      expect(moves).toHaveLength(14);
      total += moves.length;
    }
    expect(total).toBe(896);
  });

  it('bishop: 560', () => {
    const total = ALL_SQUARES.reduce((n, sq) => n + reachableSquares('bishop', sq, never).length, 0);
    expect(total).toBe(560);
  });

  it('queen: 1456, exactly rook plus bishop', () => {
    const total = ALL_SQUARES.reduce((n, sq) => n + reachableSquares('queen', sq, never).length, 0);
    expect(total).toBe(1456);
    expect(total).toBe(896 + 560);
  });

  it('gives a corner knight 2 moves and a central knight 8', () => {
    expect(KNIGHT_MOVES[parseSquare('a1')]).toHaveLength(2);
    expect(KNIGHT_MOVES[parseSquare('d4')]).toHaveLength(8);
  });

  it('never lets a move wrap around a board edge', () => {
    for (const sq of ALL_SQUARES) {
      for (const target of [...KNIGHT_MOVES[sq]!, ...KING_MOVES[sq]!]) {
        // A wrapped move shows up as an implausible jump in file distance.
        expect(Math.abs((target & 7) - (sq & 7))).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('sliding stops at blockers', () => {
  it('includes the blocking square but goes no further', () => {
    const from = parseSquare('a1');
    const blocker = parseSquare('a4');
    const moves = reachableSquares('rook', from, (sq) => sq === blocker);
    expect(moves).toContain(parseSquare('a2'));
    expect(moves).toContain(parseSquare('a3'));
    // The blocker is included: whether it is a legal target depends on Pokémon type rules, which
    // this layer deliberately does not decide.
    expect(moves).toContain(blocker);
    expect(moves).not.toContain(parseSquare('a5'));
    // The rank is unobstructed.
    expect(moves).toContain(parseSquare('h1'));
  });

  it('boxes a queen in completely when every neighbour is occupied', () => {
    const from = parseSquare('d4');
    const neighbours = new Set(KING_MOVES[from]!);
    const moves = reachableSquares('queen', from, (sq) => neighbours.has(sq));
    expect(moves).toHaveLength(8);
    expect(new Set(moves)).toEqual(neighbours);
  });

  it('leaves knights unaffected by blockers, since they jump', () => {
    const from = parseSquare('d4');
    expect(reachableSquares('knight', from, () => true)).toEqual(
      reachableSquares('knight', from, never),
    );
  });

  it('confines a bishop to its starting square colour forever', () => {
    for (const sq of ALL_SQUARES) {
      const colour = squareColor(sq);
      for (const target of reachableSquares('bishop', sq, never)) {
        expect(squareColor(target)).toBe(colour);
      }
    }
  });
});

describe('rays and the squares between', () => {
  it('walks outward nearest-first, so a scan can stop at the first blocker', () => {
    const from = parseSquare('a1');
    const up = RAYS[from]!.find((r) => r[0] === parseSquare('a2'))!;
    expect(up.map(squareName)).toEqual(['a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8']);
  });

  it('reports the squares strictly between two aligned squares', () => {
    expect(BETWEEN[parseSquare('a1')]![parseSquare('a4')]!.map(squareName)).toEqual(['a2', 'a3']);
    expect(BETWEEN[parseSquare('a1')]![parseSquare('d4')]!.map(squareName)).toEqual(['b2', 'c3']);
    expect(BETWEEN[parseSquare('a1')]![parseSquare('a2')]).toEqual([]);
  });

  it('reports nothing between unaligned squares', () => {
    expect(BETWEEN[parseSquare('a1')]![parseSquare('b4')]).toEqual([]);
  });

  it('is symmetric as a set, even though ray order differs', () => {
    for (const a of ALL_SQUARES) {
      for (const b of ALL_SQUARES) {
        expect(new Set(BETWEEN[a]![b]!)).toEqual(new Set(BETWEEN[b]![a]!));
      }
    }
  });

  it('agrees with collinearity', () => {
    const a = parseSquare('c1');
    const b = parseSquare('f4');
    expect(isAligned(a, b, parseSquare('d2'))).toBe(true);
    expect(isAligned(a, b, parseSquare('d3'))).toBe(false);
  });
});

describe('pawns', () => {
  it('advances toward the far rank for each side', () => {
    expect(squareName(pawnPush(parseSquare('e2'), 'white')!)).toBe('e3');
    expect(squareName(pawnPush(parseSquare('e7'), 'black')!)).toBe('e6');
  });

  it('offers the double push only from the starting rank', () => {
    expect(squareName(pawnDoublePush(parseSquare('e2'), 'white')!)).toBe('e4');
    expect(pawnDoublePush(parseSquare('e3'), 'white')).toBeNull();
    expect(squareName(pawnDoublePush(parseSquare('e7'), 'black')!)).toBe('e5');
    expect(pawnDoublePush(parseSquare('e6'), 'black')).toBeNull();
  });

  it('attacks diagonally forward, with edge pawns attacking one square', () => {
    expect(PAWN_ATTACKS.white[parseSquare('e2')]!.map(squareName).sort()).toEqual(['d3', 'f3']);
    expect(PAWN_ATTACKS.white[parseSquare('a2')]!.map(squareName)).toEqual(['b3']);
    expect(PAWN_ATTACKS.black[parseSquare('h7')]!.map(squareName)).toEqual(['g6']);
  });

  it('runs out of board at the far rank', () => {
    expect(pawnPush(parseSquare('e8'), 'white')).toBeNull();
    expect(pawnPush(parseSquare('e1'), 'black')).toBeNull();
  });

  it('identifies the promotion rank, where a pawn evolves', () => {
    expect(isPromotionSquare(parseSquare('e8'), 'white')).toBe(true);
    expect(isPromotionSquare(parseSquare('e7'), 'white')).toBe(false);
    expect(isPromotionSquare(parseSquare('e1'), 'black')).toBe(true);
  });
});

describe('army layout', () => {
  it('fields the standard 16 pieces per side', () => {
    const total = Object.values(STANDARD_ARMY).reduce((a, b) => a + b, 0);
    expect(total).toBe(16);
  });

  it('places both armies on the correct squares without overlap', () => {
    for (const side of ['white', 'black'] as const) {
      const squares = PIECE_CLASSES.flatMap((cls) => STARTING_SQUARES[side][cls]);
      expect(squares).toHaveLength(16);
      expect(new Set(squares).size).toBe(16);
      for (const cls of PIECE_CLASSES) {
        expect(STARTING_SQUARES[side][cls]).toHaveLength(STANDARD_ARMY[cls]);
      }
    }
    const white = new Set(PIECE_CLASSES.flatMap((c) => STARTING_SQUARES.white[c]));
    const black = PIECE_CLASSES.flatMap((c) => STARTING_SQUARES.black[c]);
    expect(black.some((sq) => white.has(sq))).toBe(false);
  });

  it('sets up the back rank in the traditional order', () => {
    expect(STARTING_SQUARES.white.king.map(squareName)).toEqual(['e1']);
    expect(STARTING_SQUARES.white.queen.map(squareName)).toEqual(['d1']);
    expect(STARTING_SQUARES.white.rook.map(squareName)).toEqual(['a1', 'h1']);
    expect(STARTING_SQUARES.black.king.map(squareName)).toEqual(['e8']);
    expect(STARTING_SQUARES.black.queen.map(squareName)).toEqual(['d8']);
    // Queens start on their own colour.
    expect(squareColor(STARTING_SQUARES.white.queen[0]!)).toBe('light');
  });

  it('knows which classes slide', () => {
    expect(PIECE_CLASSES.filter(isSlider)).toEqual(['bishop', 'rook', 'queen']);
  });
});
