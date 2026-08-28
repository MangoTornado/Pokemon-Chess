/**
 * Standard chess: position state, legal move generation, and game-end detection.
 *
 * This is the invariant substrate under Pokémon Chess. No design variation removes castling, en
 * passant, promotion, pins, or how a rook moves, so this module implements ordinary chess exactly and
 * knows nothing about types, abilities, or dice. The variant rules sit *above* it and reuse it:
 * everything they need is exposed — pseudo-legal generation, legal generation, and raw attack queries
 * — so that "a 0× matchup makes this capture illegal" can be layered on by filtering rather than by
 * forking move generation.
 *
 * Two things here exist specifically to make that layering possible:
 *
 * - **Persistent piece identity.** Every piece carries an `id` that survives moves, captures of other
 *   pieces, and promotion (a promoting pawn keeps its id and changes class, which is exactly what
 *   "this Pokémon evolved" wants to mean). The Pokémon layer keys its own per-piece tables off that
 *   id and this module stays ignorant of them.
 * - **An extensible position key.** Zobrist hashing lives in `zobrist.ts`, which documents how the
 *   rules layer mixes its own per-piece state into the repetition key.
 *
 * ## Performance shape
 *
 * Move generation runs inside AI search, so the hot path is allocation-free: moves are packed into
 * 32-bit integers written into a caller-supplied `Int32Array`, `makeMove`/`unmakeMove` mutate in
 * place against a preallocated undo stack, and legality is decided from precomputed check and pin
 * information rather than by making every candidate move and testing the king. The object-shaped
 * `Move` and the immutable `clone`/`withMove` exist for the UI, which values convenience over
 * throughput.
 *
 * Internally a piece is one byte, `side * 8 + classIndex + 1`, with `0` for an empty square. The gap
 * at bit 3 makes the side a shift and the class a mask, with no branch and no modulo.
 */

import {
  BETWEEN,
  KING_MOVES,
  KNIGHT_MOVES,
  PAWN_ATTACKS,
  PIECE_CLASSES,
  RAYS,
  SLIDING_DIRECTIONS,
  SQUARE_COUNT,
  STARTING_SQUARES,
  fileOf,
  parseSquare,
  rankOf,
  squareColor,
  squareName,
  type PieceClass,
  type Side,
  type Square,
} from './board.ts';
import {
  CASTLING_WORDS,
  EP_FILE_WORDS,
  PIECE_WORDS,
  SIDE_WORDS,
  pieceWordIndex,
  zobristKey,
} from './zobrist.ts';

// ---------------------------------------------------------------------------
// Numeric encodings
//
// The public API speaks in the string unions from board.ts; everything inside speaks in small
// integers, because array indices are what make the inner loops fast.
// ---------------------------------------------------------------------------

const WHITE = 0;
const BLACK = 1;

const SIDES: readonly Side[] = ['white', 'black'];
const SIDE_INDEX: Record<Side, number> = { white: WHITE, black: BLACK };

const PAWN = 0;
const KNIGHT = 1;
const BISHOP = 2;
const ROOK = 3;
const QUEEN = 4;
const KING = 5;

/** Sentinel for "no captured piece" and "no promotion" inside a packed move. */
const NO_CLASS = 7;

const CLASS_INDEX: Record<PieceClass, number> = {
  pawn: PAWN,
  knight: KNIGHT,
  bishop: BISHOP,
  rook: ROOK,
  queen: QUEEN,
  king: KING,
};

const code = (side: number, cls: number): number => side * 8 + cls + 1;

const CASTLE_WHITE_KING = 1;
const CASTLE_WHITE_QUEEN = 2;
const CASTLE_BLACK_KING = 4;
const CASTLE_BLACK_QUEEN = 8;

/** The most legal moves any position can offer is 218; 256 leaves headroom and keeps the size a power of two. */
export const MAX_MOVES = 256;

export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

// ---------------------------------------------------------------------------
// Packed moves
//
// A move fits in 25 bits, so it can live in an Int32Array and be compared, sorted, or stored in a
// transposition table without touching the heap.
// ---------------------------------------------------------------------------

/** A move packed into a 32-bit integer. Decode with the `move*` helpers or {@link Position.describeMove}. */
export type EncodedMove = number;

export const MOVE_DOUBLE_PUSH = 1 << 21;
export const MOVE_EN_PASSANT = 1 << 22;
export const MOVE_CASTLE_KING = 1 << 23;
export const MOVE_CASTLE_QUEEN = 1 << 24;

export const moveFrom = (move: EncodedMove): Square => move & 63;
export const moveTo = (move: EncodedMove): Square => (move >>> 6) & 63;

export const movePieceClass = (move: EncodedMove): PieceClass => PIECE_CLASSES[(move >>> 12) & 7]!;

export const moveCapturedClass = (move: EncodedMove): PieceClass | null => {
  const cls = (move >>> 15) & 7;
  return cls === NO_CLASS ? null : PIECE_CLASSES[cls]!;
};

export const movePromotion = (move: EncodedMove): PieceClass | null => {
  const cls = (move >>> 18) & 7;
  return cls === NO_CLASS ? null : PIECE_CLASSES[cls]!;
};

const PROMOTION_LETTER: Record<PieceClass, string> = {
  pawn: 'p',
  knight: 'n',
  bishop: 'b',
  rook: 'r',
  queen: 'q',
  king: 'k',
};

/** A piece as the rest of the game sees it. Pokémon state is keyed off `id` by the layer above. */
export interface Piece {
  readonly id: number;
  readonly side: Side;
  readonly cls: PieceClass;
}

/**
 * A move in object form, carrying everything needed to render it and to undo it.
 *
 * `capturedSquare` is not always `to`: an en passant capture removes a pawn from the square the
 * capturing pawn passes over, and the Pokémon layer needs to know which piece is actually being
 * fought before it can price the capture.
 */
export interface Move {
  readonly from: Square;
  readonly to: Square;
  readonly cls: PieceClass;
  readonly captured: Piece | null;
  readonly capturedSquare: Square | null;
  readonly promotion: PieceClass | null;
  readonly isCapture: boolean;
  readonly isEnPassant: boolean;
  readonly isDoublePush: boolean;
  readonly castle: 'kingside' | 'queenside' | null;
  /** The same move packed for the search path, so `makeMove` never has to re-encode it. */
  readonly encoded: EncodedMove;
}

/** Long algebraic notation, e.g. `e2e4` or `e7e8q`. Castling is written as the king's own move. */
export function moveToUci(move: Move | EncodedMove): string {
  const encoded = typeof move === 'number' ? move : move.encoded;
  const promotion = movePromotion(encoded);
  return (
    squareName(moveFrom(encoded)) +
    squareName(moveTo(encoded)) +
    (promotion === null ? '' : PROMOTION_LETTER[promotion])
  );
}

// ---------------------------------------------------------------------------
// Derived geometry tables
//
// These index board.ts's tables rather than recomputing any geometry; they exist because legality
// checking asks "are these two squares on a line, and which line" once per candidate move.
// ---------------------------------------------------------------------------

/** `RAY_DIR[a * 64 + b]` — the direction index from `a` to `b`, or `-1` when they share no line. */
const RAY_DIR = new Int8Array(SQUARE_COUNT * SQUARE_COUNT).fill(-1);

for (let from = 0; from < SQUARE_COUNT; from++) {
  const rays = RAYS[from]!;
  for (let dir = 0; dir < 8; dir++) {
    const ray = rays[dir]!;
    for (let i = 0; i < ray.length; i++) RAY_DIR[from * SQUARE_COUNT + ray[i]!] = dir;
  }
}

/** `BETWEEN` as bitboards, so "does this move block the check" is two shifts instead of a scan. */
const BETWEEN_LO = new Int32Array(SQUARE_COUNT * SQUARE_COUNT);
const BETWEEN_HI = new Int32Array(SQUARE_COUNT * SQUARE_COUNT);

for (let a = 0; a < SQUARE_COUNT; a++) {
  for (let b = 0; b < SQUARE_COUNT; b++) {
    const squares = BETWEEN[a]![b]!;
    let lo = 0;
    let hi = 0;
    for (let i = 0; i < squares.length; i++) {
      const sq = squares[i]!;
      if (sq < 32) lo |= 1 << sq;
      else hi |= 1 << (sq - 32);
    }
    BETWEEN_LO[a * SQUARE_COUNT + b] = lo;
    BETWEEN_HI[a * SQUARE_COUNT + b] = hi;
  }
}

/** `SLIDES_ALONG[dir * 6 + cls]` — whether a piece of that class attacks along that ray direction. */
const SLIDES_ALONG = new Uint8Array(8 * PIECE_CLASSES.length);

for (const cls of ['rook', 'bishop', 'queen'] as const) {
  for (const dir of SLIDING_DIRECTIONS[cls]) SLIDES_ALONG[dir * PIECE_CLASSES.length + CLASS_INDEX[cls]] = 1;
}

/** Slider ray directions by class index, as plain number arrays for indexed iteration. */
const SLIDER_DIRS: readonly (readonly number[])[] = (() => {
  const out: number[][] = PIECE_CLASSES.map(() => []);
  for (const cls of ['rook', 'bishop', 'queen'] as const) {
    out[CLASS_INDEX[cls]] = [...SLIDING_DIRECTIONS[cls]];
  }
  return out;
})();

/** Pawn attack tables indexed by numeric side. */
const PAWN_ATTACK_TABLE: readonly (readonly (readonly Square[])[])[] = [
  PAWN_ATTACKS.white,
  PAWN_ATTACKS.black,
];

/**
 * Castling rights destroyed by any move touching a square.
 *
 * Indexing by square covers both ways rights are lost — the rook moving off its corner and an enemy
 * capturing it there — without either case needing its own test.
 */
const RIGHTS_LOST_AT = new Uint8Array(SQUARE_COUNT);
RIGHTS_LOST_AT[0] = CASTLE_WHITE_QUEEN;
RIGHTS_LOST_AT[7] = CASTLE_WHITE_KING;
RIGHTS_LOST_AT[56] = CASTLE_BLACK_QUEEN;
RIGHTS_LOST_AT[63] = CASTLE_BLACK_KING;

const PROMOTION_CHOICES = [QUEEN, ROOK, BISHOP, KNIGHT] as const;

const UNDO_STRIDE = 8;
const UNDO_MOVE = 0;
const UNDO_CAPTURED_ID = 1;
const UNDO_EP = 2;
const UNDO_RIGHTS = 3;
const UNDO_HALFMOVE = 4;
const UNDO_HASH_HI = 5;
const UNDO_HASH_LO = 6;
const UNDO_FULLMOVE = 7;

const FEN_LETTERS: Record<string, readonly [number, number]> = {
  P: [WHITE, PAWN],
  N: [WHITE, KNIGHT],
  B: [WHITE, BISHOP],
  R: [WHITE, ROOK],
  Q: [WHITE, QUEEN],
  K: [WHITE, KING],
  p: [BLACK, PAWN],
  n: [BLACK, KNIGHT],
  b: [BLACK, BISHOP],
  r: [BLACK, ROOK],
  q: [BLACK, QUEEN],
  k: [BLACK, KING],
};

const CLASS_LETTER = ['p', 'n', 'b', 'r', 'q', 'k'] as const;

// ---------------------------------------------------------------------------
// Position
// ---------------------------------------------------------------------------

/**
 * A chess position plus the history needed to unmake moves and detect repetition.
 *
 * Construct with {@link Position.fromStartingPosition} or {@link Position.fromFen}. Search should use
 * {@link Position.generateMovesInto} with its own buffer and the mutating
 * {@link Position.makeMove}/{@link Position.unmakeMove} pair; UI code should prefer
 * {@link Position.generateMoves} and {@link Position.withMove}, which never mutate what they are given.
 */
export class Position {
  /** Piece codes by square: `0` empty, otherwise `side * 8 + classIndex + 1`. */
  private readonly board = new Int8Array(SQUARE_COUNT);

  /** Persistent piece ids by square, `-1` where empty. */
  private readonly pieceIds = new Int32Array(SQUARE_COUNT).fill(-1);

  /** King squares by side, tracked incrementally because legality asks for them constantly. */
  private readonly kings = new Int32Array(2).fill(-1);

  private stm = WHITE;
  private rights = 0;
  private ep = -1;
  private halfmove = 0;
  private fullmove = 1;
  private hashHi = 0;
  private hashLo = 0;
  private nextId = 0;

  private undo = new Int32Array(UNDO_STRIDE * 512);
  private ply = 0;

  /** Pin direction per square, or `-1`. Valid only for the side to move, refreshed per generation. */
  private readonly pinDir = new Int8Array(SQUARE_COUNT).fill(-1);

  /** Which squares {@link pinDir} was written to, so the table is cleared in eight steps at most. */
  private readonly pinnedSquares = new Int32Array(8);
  private pinnedCount = 0;

  private checkerCount = 0;
  private checkerSquare = -1;

  /** Scratch buffer for the convenience paths, so they cost no allocation beyond the results. */
  private readonly scratch = new Int32Array(MAX_MOVES);

  private constructor() {}

  // -------------------------------------------------------------------------
  // Construction
  // -------------------------------------------------------------------------

  /** The standard opening array, taken from `board.ts` so the two cannot drift apart. */
  static fromStartingPosition(): Position {
    const position = new Position();
    for (const side of SIDES) {
      for (const cls of PIECE_CLASSES) {
        for (const square of STARTING_SQUARES[side][cls]) {
          position.board[square] = code(SIDE_INDEX[side], CLASS_INDEX[cls]);
        }
      }
    }
    position.rights =
      CASTLE_WHITE_KING | CASTLE_WHITE_QUEEN | CASTLE_BLACK_KING | CASTLE_BLACK_QUEEN;
    position.finalize();
    return position;
  }

  /**
   * Parses a FEN string. The en passant field is kept exactly as given rather than normalised, so
   * `fromFen(fen).toFen()` reproduces its input character for character.
   */
  static fromFen(fen: string): Position {
    const fields = fen.trim().split(/\s+/);
    if (fields.length < 4) throw new SyntaxError(`FEN needs at least four fields: ${fen}`);
    const [placement, turn, castling, epField] = fields as [string, string, string, string, ...string[]];

    const position = new Position();
    const ranks = placement.split('/');
    if (ranks.length !== 8) throw new SyntaxError(`FEN placement needs eight ranks: ${placement}`);

    for (let i = 0; i < 8; i++) {
      const rank = 7 - i;
      let file = 0;
      for (const ch of ranks[i]!) {
        if (ch >= '1' && ch <= '8') {
          file += ch.charCodeAt(0) - 48;
          continue;
        }
        const entry = FEN_LETTERS[ch];
        if (entry === undefined) throw new SyntaxError(`unknown FEN piece ${JSON.stringify(ch)}`);
        if (file > 7) throw new SyntaxError(`FEN rank overflows: ${ranks[i]!}`);
        position.board[rank * 8 + file] = code(entry[0], entry[1]);
        file++;
      }
      if (file !== 8) throw new SyntaxError(`FEN rank does not fill eight files: ${ranks[i]!}`);
    }

    if (turn !== 'w' && turn !== 'b') throw new SyntaxError(`FEN turn must be w or b: ${turn}`);
    position.stm = turn === 'w' ? WHITE : BLACK;

    if (castling !== '-') {
      for (const ch of castling) {
        if (ch === 'K') position.rights |= CASTLE_WHITE_KING;
        else if (ch === 'Q') position.rights |= CASTLE_WHITE_QUEEN;
        else if (ch === 'k') position.rights |= CASTLE_BLACK_KING;
        else if (ch === 'q') position.rights |= CASTLE_BLACK_QUEEN;
        else throw new SyntaxError(`unknown FEN castling flag ${JSON.stringify(ch)}`);
      }
    }

    position.ep = epField === '-' ? -1 : parseSquare(epField);
    position.halfmove = fields.length > 4 ? Number(fields[4]) : 0;
    position.fullmove = fields.length > 5 ? Number(fields[5]) : 1;
    if (!Number.isInteger(position.halfmove) || position.halfmove < 0) {
      throw new SyntaxError(`FEN halfmove clock must be a non-negative integer: ${fields[4]}`);
    }
    if (!Number.isInteger(position.fullmove) || position.fullmove < 1) {
      throw new SyntaxError(`FEN move number must be a positive integer: ${fields[5]}`);
    }

    position.finalize();
    return position;
  }

  /**
   * Assigns piece ids and computes the initial hash.
   *
   * Ids run in square order, `a1` upward, so the same FEN always produces the same ids and a Pokémon
   * roster can be attached to a position deterministically.
   */
  private finalize(): void {
    for (let square = 0; square < SQUARE_COUNT; square++) {
      const piece = this.board[square]!;
      if (piece === 0) continue;
      this.pieceIds[square] = this.nextId++;
      if ((piece & 7) - 1 === KING) this.kings[piece >> 3] = square;
    }
    this.recomputeHash();
  }

  private recomputeHash(): void {
    this.hashHi = 0;
    this.hashLo = 0;
    for (let square = 0; square < SQUARE_COUNT; square++) {
      const piece = this.board[square]!;
      if (piece === 0) continue;
      this.xorPiece(piece >> 3, (piece & 7) - 1, square);
    }
    this.xorRights(this.rights);
    if (this.ep >= 0) this.xorEp(this.ep);
    if (this.stm === BLACK) this.xorSide();
  }

  /** A deep copy, history included, so repetition detection survives the copy. */
  clone(): Position {
    const copy = new Position();
    copy.board.set(this.board);
    copy.pieceIds.set(this.pieceIds);
    copy.kings.set(this.kings);
    copy.stm = this.stm;
    copy.rights = this.rights;
    copy.ep = this.ep;
    copy.halfmove = this.halfmove;
    copy.fullmove = this.fullmove;
    copy.hashHi = this.hashHi;
    copy.hashLo = this.hashLo;
    copy.nextId = this.nextId;
    copy.undo = this.undo.slice();
    copy.ply = this.ply;
    return copy;
  }

  /** The position after `move`, leaving this one untouched — the shape UI state wants. */
  withMove(move: Move | EncodedMove): Position {
    const next = this.clone();
    next.makeMove(move);
    return next;
  }

  // -------------------------------------------------------------------------
  // Inspection
  // -------------------------------------------------------------------------

  get turn(): Side {
    return SIDES[this.stm]!;
  }

  get halfmoveClock(): number {
    return this.halfmove;
  }

  get fullmoveNumber(): number {
    return this.fullmove;
  }

  /** The en passant target square — the square a capturing pawn moves *to* — or `null`. */
  get epSquare(): Square | null {
    return this.ep < 0 ? null : this.ep;
  }

  /** How many moves have been made on this object, i.e. how many times `unmakeMove` may be called. */
  get movesMade(): number {
    return this.ply;
  }

  /** Castling rights as flags, for rendering and for FEN. */
  get castlingRights(): { whiteKing: boolean; whiteQueen: boolean; blackKing: boolean; blackQueen: boolean } {
    return {
      whiteKing: (this.rights & CASTLE_WHITE_KING) !== 0,
      whiteQueen: (this.rights & CASTLE_WHITE_QUEEN) !== 0,
      blackKing: (this.rights & CASTLE_BLACK_KING) !== 0,
      blackQueen: (this.rights & CASTLE_BLACK_QUEEN) !== 0,
    };
  }

  /** The full position key. `bigint` for comparison and map keys; search should use {@link hashWords}. */
  get hash(): bigint {
    return zobristKey(this.hashHi, this.hashLo);
  }

  /** The key's two halves, which is the form the hot path maintains. */
  get hashWords(): readonly [number, number] {
    return [this.hashHi, this.hashLo];
  }

  /**
   * Folds an extra word pair into the position key.
   *
   * This is the seam for Pokémon state that changes what a position *is* — see `zobrist.ts` for the
   * contract, including why `unmakeMove` reverses these mixes for free.
   */
  xorHash(hi: number, lo: number): void {
    this.hashHi ^= hi;
    this.hashLo ^= lo;
  }

  pieceAt(square: Square): Piece | null {
    const piece = this.board[square];
    if (piece === undefined || piece === 0) return null;
    return {
      id: this.pieceIds[square]!,
      side: SIDES[piece >> 3]!,
      cls: PIECE_CLASSES[(piece & 7) - 1]!,
    };
  }

  /** Every piece on the board with its square, in square order. */
  allPieces(): { square: Square; piece: Piece }[] {
    const out: { square: Square; piece: Piece }[] = [];
    for (let square = 0; square < SQUARE_COUNT; square++) {
      const piece = this.pieceAt(square);
      if (piece !== null) out.push({ square, piece });
    }
    return out;
  }

  kingSquare(side: Side): Square {
    const square = this.kings[SIDE_INDEX[side]]!;
    if (square < 0) throw new Error(`position has no ${side} king`);
    return square;
  }

  toFen(): string {
    const ranks: string[] = [];
    for (let rank = 7; rank >= 0; rank--) {
      let row = '';
      let empty = 0;
      for (let file = 0; file < 8; file++) {
        const piece = this.board[rank * 8 + file]!;
        if (piece === 0) {
          empty++;
          continue;
        }
        if (empty > 0) {
          row += String(empty);
          empty = 0;
        }
        const letter = CLASS_LETTER[(piece & 7) - 1]!;
        row += piece >> 3 === WHITE ? letter.toUpperCase() : letter;
      }
      if (empty > 0) row += String(empty);
      ranks.push(row);
    }

    let castling = '';
    if (this.rights & CASTLE_WHITE_KING) castling += 'K';
    if (this.rights & CASTLE_WHITE_QUEEN) castling += 'Q';
    if (this.rights & CASTLE_BLACK_KING) castling += 'k';
    if (this.rights & CASTLE_BLACK_QUEEN) castling += 'q';

    return [
      ranks.join('/'),
      this.stm === WHITE ? 'w' : 'b',
      castling === '' ? '-' : castling,
      this.ep < 0 ? '-' : squareName(this.ep),
      String(this.halfmove),
      String(this.fullmove),
    ].join(' ');
  }

  // -------------------------------------------------------------------------
  // Attack queries
  //
  // Exposed because the Pokémon layer needs them for its own capture legality, and because a UI wants
  // to shade threatened squares.
  // -------------------------------------------------------------------------

  /** Whether `bySide` attacks `square`, counting attacks through nothing and blocked by everything. */
  isAttacked(square: Square, bySide: Side): boolean {
    return this.attackedBy(square, SIDE_INDEX[bySide], -1);
  }

  /** Every square holding a piece of `bySide` that attacks `square`. */
  attackersOf(square: Square, bySide: Side): Square[] {
    const side = SIDE_INDEX[bySide];
    const board = this.board;
    const out: Square[] = [];

    const pawnSquares = PAWN_ATTACK_TABLE[1 - side]![square]!;
    const pawn = code(side, PAWN);
    for (let i = 0; i < pawnSquares.length; i++) {
      if (board[pawnSquares[i]!] === pawn) out.push(pawnSquares[i]!);
    }

    const knightSquares = KNIGHT_MOVES[square]!;
    const knight = code(side, KNIGHT);
    for (let i = 0; i < knightSquares.length; i++) {
      if (board[knightSquares[i]!] === knight) out.push(knightSquares[i]!);
    }

    const kingSquares = KING_MOVES[square]!;
    const king = code(side, KING);
    for (let i = 0; i < kingSquares.length; i++) {
      if (board[kingSquares[i]!] === king) out.push(kingSquares[i]!);
    }

    const rays = RAYS[square]!;
    for (let dir = 0; dir < 8; dir++) {
      const ray = rays[dir]!;
      for (let i = 0; i < ray.length; i++) {
        const piece = board[ray[i]!]!;
        if (piece === 0) continue;
        if (piece >> 3 === side && SLIDES_ALONG[dir * PIECE_CLASSES.length + ((piece & 7) - 1)] === 1) {
          out.push(ray[i]!);
        }
        break;
      }
    }

    return out;
  }

  /**
   * Whether `side` attacks `square`, optionally pretending `ignore` is empty.
   *
   * The `ignore` hole is what makes king moves correct: a king stepping along a rook's line is still
   * in check on the new square, and it would look safe if the king's own body were left blocking the
   * ray it is moving along.
   */
  private attackedBy(square: Square, side: number, ignore: Square): boolean {
    const board = this.board;

    const pawnSquares = PAWN_ATTACK_TABLE[1 - side]![square]!;
    const pawn = code(side, PAWN);
    for (let i = 0; i < pawnSquares.length; i++) {
      if (board[pawnSquares[i]!] === pawn) return true;
    }

    const knightSquares = KNIGHT_MOVES[square]!;
    const knight = code(side, KNIGHT);
    for (let i = 0; i < knightSquares.length; i++) {
      if (board[knightSquares[i]!] === knight) return true;
    }

    const kingSquares = KING_MOVES[square]!;
    const king = code(side, KING);
    for (let i = 0; i < kingSquares.length; i++) {
      if (board[kingSquares[i]!] === king) return true;
    }

    const rays = RAYS[square]!;
    for (let dir = 0; dir < 8; dir++) {
      const ray = rays[dir]!;
      for (let i = 0; i < ray.length; i++) {
        const target = ray[i]!;
        if (target === ignore) continue;
        const piece = board[target]!;
        if (piece === 0) continue;
        if (piece >> 3 === side && SLIDES_ALONG[dir * PIECE_CLASSES.length + ((piece & 7) - 1)] === 1) {
          return true;
        }
        break;
      }
    }

    return false;
  }

  isInCheck(side: Side = this.turn): boolean {
    const index = SIDE_INDEX[side];
    return this.attackedBy(this.kings[index]!, 1 - index, -1);
  }

  // -------------------------------------------------------------------------
  // Move generation
  // -------------------------------------------------------------------------

  /**
   * Writes the legal moves for the side to move into `out`, returning the index one past the last.
   *
   * The allocation-free entry point for search. `out` must have room for {@link MAX_MOVES} moves past
   * `offset`; a recursive search wants one buffer per depth so a child's generation cannot overwrite
   * the parent's list.
   */
  generateMovesInto(out: Int32Array, offset = 0): number {
    const end = this.generatePseudoLegalMovesInto(out, offset);
    this.computeCheckInfo();

    let write = offset;
    for (let read = offset; read < end; read++) {
      const move = out[read]!;
      if (this.isLegal(move)) out[write++] = move;
    }
    return write;
  }

  /**
   * Writes the pseudo-legal moves into `out`, returning the index one past the last.
   *
   * "Pseudo-legal" here means every rule of movement is honoured but the mover's own king may be left
   * attacked. Castling is the exception: not castling out of, through, or into check is part of what
   * castling *is*, so those moves are already fully legal when generated.
   */
  generatePseudoLegalMovesInto(out: Int32Array, offset = 0): number {
    const us = this.stm;
    const them = 1 - us;
    const board = this.board;
    let n = offset;

    for (let from = 0; from < SQUARE_COUNT; from++) {
      const piece = board[from]!;
      if (piece === 0 || piece >> 3 !== us) continue;
      const cls = (piece & 7) - 1;
      const base = from | (cls << 12);

      if (cls === PAWN) {
        const step = us === WHITE ? 8 : -8;
        const ahead = from + step;
        if (board[ahead] === 0) {
          if (rankOf(ahead) === (us === WHITE ? 7 : 0)) {
            for (const promotion of PROMOTION_CHOICES) {
              out[n++] = base | (ahead << 6) | (NO_CLASS << 15) | (promotion << 18);
            }
          } else {
            out[n++] = base | (ahead << 6) | (NO_CLASS << 15) | (NO_CLASS << 18);
            const twoAhead = ahead + step;
            if (rankOf(from) === (us === WHITE ? 1 : 6) && board[twoAhead] === 0) {
              out[n++] = base | (twoAhead << 6) | (NO_CLASS << 15) | (NO_CLASS << 18) | MOVE_DOUBLE_PUSH;
            }
          }
        }

        const targets = PAWN_ATTACK_TABLE[us]![from]!;
        for (let i = 0; i < targets.length; i++) {
          const to = targets[i]!;
          const victim = board[to]!;
          if (victim !== 0) {
            if (victim >> 3 !== them) continue;
            const captured = (victim & 7) - 1;
            if (rankOf(to) === (us === WHITE ? 7 : 0)) {
              for (const promotion of PROMOTION_CHOICES) {
                out[n++] = base | (to << 6) | (captured << 15) | (promotion << 18);
              }
            } else {
              out[n++] = base | (to << 6) | (captured << 15) | (NO_CLASS << 18);
            }
          } else if (to === this.ep) {
            out[n++] = base | (to << 6) | (PAWN << 15) | (NO_CLASS << 18) | MOVE_EN_PASSANT;
          }
        }
        continue;
      }

      if (cls === KNIGHT || cls === KING) {
        const targets = cls === KNIGHT ? KNIGHT_MOVES[from]! : KING_MOVES[from]!;
        for (let i = 0; i < targets.length; i++) {
          const to = targets[i]!;
          const victim = board[to]!;
          if (victim === 0) {
            out[n++] = base | (to << 6) | (NO_CLASS << 15) | (NO_CLASS << 18);
          } else if (victim >> 3 === them) {
            out[n++] = base | (to << 6) | (((victim & 7) - 1) << 15) | (NO_CLASS << 18);
          }
        }
        if (cls === KING) n = this.generateCastling(out, n);
        continue;
      }

      const dirs = SLIDER_DIRS[cls]!;
      const rays = RAYS[from]!;
      for (let d = 0; d < dirs.length; d++) {
        const ray = rays[dirs[d]!]!;
        for (let i = 0; i < ray.length; i++) {
          const to = ray[i]!;
          const victim = board[to]!;
          if (victim === 0) {
            out[n++] = base | (to << 6) | (NO_CLASS << 15) | (NO_CLASS << 18);
            continue;
          }
          if (victim >> 3 === them) {
            out[n++] = base | (to << 6) | (((victim & 7) - 1) << 15) | (NO_CLASS << 18);
          }
          break;
        }
      }
    }

    return n;
  }

  /**
   * Appends whichever castling moves are available.
   *
   * The rook's presence is verified rather than inferred from the rights bits, because a hand-written
   * FEN can claim rights the board does not support and move generation must not corrupt itself over
   * bad input.
   */
  private generateCastling(out: Int32Array, offset: number): number {
    const us = this.stm;
    const them = 1 - us;
    const rights = this.rights;
    if (rights === 0) return offset;

    const kingHome = us === WHITE ? 4 : 60;
    const kingCode = code(us, KING);
    const rookCode = code(us, ROOK);
    const board = this.board;
    if (board[kingHome] !== kingCode) return offset;

    const kingSide = us === WHITE ? CASTLE_WHITE_KING : CASTLE_BLACK_KING;
    const queenSide = us === WHITE ? CASTLE_WHITE_QUEEN : CASTLE_BLACK_QUEEN;
    let n = offset;
    let kingSafe = -1;

    if (rights & kingSide && board[kingHome + 3] === rookCode) {
      if (board[kingHome + 1] === 0 && board[kingHome + 2] === 0) {
        kingSafe = this.attackedBy(kingHome, them, -1) ? 0 : 1;
        if (
          kingSafe === 1 &&
          !this.attackedBy(kingHome + 1, them, -1) &&
          !this.attackedBy(kingHome + 2, them, -1)
        ) {
          out[n++] =
            kingHome |
            ((kingHome + 2) << 6) |
            (KING << 12) |
            (NO_CLASS << 15) |
            (NO_CLASS << 18) |
            MOVE_CASTLE_KING;
        }
      }
    }

    if (rights & queenSide && board[kingHome - 4] === rookCode) {
      // b1/b8 must be empty for the rook to pass, though the king never stands on it.
      if (board[kingHome - 1] === 0 && board[kingHome - 2] === 0 && board[kingHome - 3] === 0) {
        if (kingSafe === -1) kingSafe = this.attackedBy(kingHome, them, -1) ? 0 : 1;
        if (
          kingSafe === 1 &&
          !this.attackedBy(kingHome - 1, them, -1) &&
          !this.attackedBy(kingHome - 2, them, -1)
        ) {
          out[n++] =
            kingHome |
            ((kingHome - 2) << 6) |
            (KING << 12) |
            (NO_CLASS << 15) |
            (NO_CLASS << 18) |
            MOVE_CASTLE_QUEEN;
        }
      }
    }

    return n;
  }

  /**
   * Finds who is checking the side to move and which of its pieces are pinned.
   *
   * Doing this once per position turns legality into a comparison per move instead of a make, an
   * attack scan, and an unmake per move — the difference between a toy and something an AI can search
   * with. A walk outward from the king finds both facts in the same pass: the first enemy slider on a
   * line is a checker if nothing intervenes, and pins the single friendly piece that does.
   */
  private computeCheckInfo(): void {
    for (let i = 0; i < this.pinnedCount; i++) this.pinDir[this.pinnedSquares[i]!] = -1;
    this.pinnedCount = 0;
    this.checkerCount = 0;
    this.checkerSquare = -1;

    const us = this.stm;
    const them = 1 - us;
    const kingSquare = this.kings[us]!;
    const board = this.board;

    const pawnSquares = PAWN_ATTACK_TABLE[us]![kingSquare]!;
    const pawn = code(them, PAWN);
    for (let i = 0; i < pawnSquares.length; i++) {
      if (board[pawnSquares[i]!] === pawn) {
        this.checkerCount++;
        this.checkerSquare = pawnSquares[i]!;
      }
    }

    const knightSquares = KNIGHT_MOVES[kingSquare]!;
    const knight = code(them, KNIGHT);
    for (let i = 0; i < knightSquares.length; i++) {
      if (board[knightSquares[i]!] === knight) {
        this.checkerCount++;
        this.checkerSquare = knightSquares[i]!;
      }
    }

    const rays = RAYS[kingSquare]!;
    for (let dir = 0; dir < 8; dir++) {
      const ray = rays[dir]!;
      let firstOwn = -1;
      for (let i = 0; i < ray.length; i++) {
        const square = ray[i]!;
        const piece = board[square]!;
        if (piece === 0) continue;
        if (piece >> 3 === us) {
          if (firstOwn >= 0) break;
          firstOwn = square;
          continue;
        }
        if (SLIDES_ALONG[dir * PIECE_CLASSES.length + ((piece & 7) - 1)] === 1) {
          if (firstOwn < 0) {
            this.checkerCount++;
            this.checkerSquare = square;
          } else {
            this.pinDir[firstOwn] = dir;
            this.pinnedSquares[this.pinnedCount++] = firstOwn;
          }
        }
        break;
      }
    }
  }

  /** Whether a pseudo-legal move leaves the mover's own king safe. Requires {@link computeCheckInfo}. */
  private isLegal(move: EncodedMove): boolean {
    const from = move & 63;
    const to = (move >>> 6) & 63;

    // En passant is the one move that vacates a square it neither leaves nor lands on, so the general
    // pin and check reasoning below does not describe it. It is rare enough to test directly.
    if (move & MOVE_EN_PASSANT) return this.epCaptureIsSafe(from, to);

    const us = this.stm;
    if (((move >>> 12) & 7) === KING) {
      if (move & (MOVE_CASTLE_KING | MOVE_CASTLE_QUEEN)) return true;
      return !this.attackedBy(to, 1 - us, from);
    }

    // Only the king can escape a double check; no other piece can address two threats at once.
    if (this.checkerCount > 1) return false;

    const kingSquare = this.kings[us]!;
    const pin = this.pinDir[from]!;
    if (pin >= 0 && RAY_DIR[kingSquare * SQUARE_COUNT + to] !== pin) return false;

    if (this.checkerCount === 1 && to !== this.checkerSquare) {
      const index = kingSquare * SQUARE_COUNT + this.checkerSquare;
      const blocks = to < 32 ? (BETWEEN_LO[index]! >>> to) & 1 : (BETWEEN_HI[index]! >>> (to - 32)) & 1;
      if (blocks === 0) return false;
    }

    return true;
  }

  /**
   * Tests an en passant capture by briefly applying it to the board and asking about the king.
   *
   * Two pieces leave the same rank at once, which can open a discovered check along it — the classic
   * position where both pawns vanish and a rook on the far side of the board turns out to be aiming
   * at the king. Only the piece codes are touched, since attack detection does not read ids.
   */
  private epCaptureIsSafe(from: Square, to: Square): boolean {
    const us = this.stm;
    const capturedSquare = us === WHITE ? to - 8 : to + 8;
    const board = this.board;
    const mover = board[from]!;
    const victim = board[capturedSquare]!;

    board[from] = 0;
    board[capturedSquare] = 0;
    board[to] = mover;
    const safe = !this.attackedBy(this.kings[us]!, 1 - us, -1);
    board[from] = mover;
    board[capturedSquare] = victim;
    board[to] = 0;

    return safe;
  }

  /** Every legal move in object form. The convenient path, for UI and for tests. */
  generateMoves(): Move[] {
    const end = this.generateMovesInto(this.scratch, 0);
    const out: Move[] = new Array(end);
    for (let i = 0; i < end; i++) out[i] = this.describeMove(this.scratch[i]!);
    return out;
  }

  /** Every pseudo-legal move in object form, for callers that want to apply their own legality rules. */
  generatePseudoLegalMoves(): Move[] {
    const end = this.generatePseudoLegalMovesInto(this.scratch, 0);
    const out: Move[] = new Array(end);
    for (let i = 0; i < end; i++) out[i] = this.describeMove(this.scratch[i]!);
    return out;
  }

  /** How many legal moves exist, without building objects for them. */
  legalMoveCount(): number {
    return this.generateMovesInto(this.scratch, 0);
  }

  /**
   * Expands a packed move against this position.
   *
   * Must be called before the move is made, because the captured piece's identity is read from the
   * board.
   */
  describeMove(move: EncodedMove): Move {
    const from = move & 63;
    const to = (move >>> 6) & 63;
    const capturedCls = (move >>> 15) & 7;
    const promotion = (move >>> 18) & 7;
    const isEnPassant = (move & MOVE_EN_PASSANT) !== 0;

    let capturedSquare: Square | null = null;
    if (isEnPassant) capturedSquare = this.stm === WHITE ? to - 8 : to + 8;
    else if (capturedCls !== NO_CLASS) capturedSquare = to;

    return {
      from,
      to,
      cls: PIECE_CLASSES[(move >>> 12) & 7]!,
      captured:
        capturedSquare === null
          ? null
          : {
              id: this.pieceIds[capturedSquare]!,
              side: SIDES[1 - this.stm]!,
              cls: PIECE_CLASSES[capturedCls]!,
            },
      capturedSquare,
      promotion: promotion === NO_CLASS ? null : PIECE_CLASSES[promotion]!,
      isCapture: capturedSquare !== null,
      isEnPassant,
      isDoublePush: (move & MOVE_DOUBLE_PUSH) !== 0,
      castle:
        move & MOVE_CASTLE_KING ? 'kingside' : move & MOVE_CASTLE_QUEEN ? 'queenside' : null,
      encoded: move,
    };
  }

  /** Finds the legal move matching a long-algebraic string, or `null`. */
  moveFromUci(uci: string): Move | null {
    for (const move of this.generateMoves()) {
      if (moveToUci(move) === uci) return move;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Making and unmaking
  // -------------------------------------------------------------------------

  /**
   * Applies a move in place, recording what is needed to reverse it.
   *
   * The move must be one this position generated; nothing here validates it, because search calls it
   * on every node and the check would be pure overhead.
   */
  makeMove(move: Move | EncodedMove): void {
    const encoded = typeof move === 'number' ? move : move.encoded;
    const us = this.stm;
    const them = 1 - us;
    const from = encoded & 63;
    const to = (encoded >>> 6) & 63;
    const cls = (encoded >>> 12) & 7;
    const capturedCls = (encoded >>> 15) & 7;
    const promotion = (encoded >>> 18) & 7;
    const board = this.board;
    const ids = this.pieceIds;

    const base = this.ply * UNDO_STRIDE;
    if (base + UNDO_STRIDE > this.undo.length) this.growUndo();
    const undo = this.undo;
    undo[base + UNDO_MOVE] = encoded;
    undo[base + UNDO_EP] = this.ep;
    undo[base + UNDO_RIGHTS] = this.rights;
    undo[base + UNDO_HALFMOVE] = this.halfmove;
    undo[base + UNDO_HASH_HI] = this.hashHi;
    undo[base + UNDO_HASH_LO] = this.hashLo;
    undo[base + UNDO_FULLMOVE] = this.fullmove;

    if (this.ep >= 0) this.xorEp(this.ep);

    let capturedSquare = -1;
    if (encoded & MOVE_EN_PASSANT) capturedSquare = us === WHITE ? to - 8 : to + 8;
    else if (capturedCls !== NO_CLASS) capturedSquare = to;

    if (capturedSquare >= 0) {
      undo[base + UNDO_CAPTURED_ID] = ids[capturedSquare]!;
      this.xorPiece(them, capturedCls, capturedSquare);
      board[capturedSquare] = 0;
      ids[capturedSquare] = -1;
    } else {
      undo[base + UNDO_CAPTURED_ID] = -1;
    }

    // Promotion keeps the piece's id and changes only its class, so the layer above can treat it as
    // the same individual evolving rather than as a death and a birth.
    const landed = promotion === NO_CLASS ? cls : promotion;
    this.xorPiece(us, cls, from);
    this.xorPiece(us, landed, to);
    board[from] = 0;
    board[to] = code(us, landed);
    ids[to] = ids[from]!;
    ids[from] = -1;
    if (cls === KING) this.kings[us] = to;

    if (encoded & MOVE_CASTLE_KING) this.slideRook(us, to + 1, to - 1);
    else if (encoded & MOVE_CASTLE_QUEEN) this.slideRook(us, to - 2, to + 1);

    let rights = this.rights;
    if (rights !== 0) {
      if (cls === KING) {
        rights &= us === WHITE ? ~(CASTLE_WHITE_KING | CASTLE_WHITE_QUEEN) : ~(CASTLE_BLACK_KING | CASTLE_BLACK_QUEEN);
      }
      rights &= ~RIGHTS_LOST_AT[from]!;
      rights &= ~RIGHTS_LOST_AT[to]!;
      if (rights !== this.rights) {
        this.xorRights(this.rights);
        this.xorRights(rights);
        this.rights = rights;
      }
    }

    // The en passant square is recorded only when an enemy pawn stands beside the pushed pawn. A
    // target no one can shoot at does not change the position, and letting it into the key would make
    // two identical positions look different to repetition detection.
    let nextEp = -1;
    if (encoded & MOVE_DOUBLE_PUSH) {
      const enemyPawn = code(them, PAWN);
      const file = fileOf(to);
      if ((file > 0 && board[to - 1] === enemyPawn) || (file < 7 && board[to + 1] === enemyPawn)) {
        nextEp = (from + to) >> 1;
      }
    }
    this.ep = nextEp;
    if (nextEp >= 0) this.xorEp(nextEp);

    this.halfmove = cls === PAWN || capturedSquare >= 0 ? 0 : this.halfmove + 1;
    if (us === BLACK) this.fullmove++;
    this.stm = them;
    this.xorSide();
    this.ply++;
  }

  /** Reverses the most recent {@link makeMove}, restoring hash, clocks, rights, and piece ids. */
  unmakeMove(): void {
    if (this.ply === 0) throw new Error('no move to unmake');
    this.ply--;

    const base = this.ply * UNDO_STRIDE;
    const undo = this.undo;
    const encoded = undo[base + UNDO_MOVE]!;
    const capturedId = undo[base + UNDO_CAPTURED_ID]!;
    this.ep = undo[base + UNDO_EP]!;
    this.rights = undo[base + UNDO_RIGHTS]!;
    this.halfmove = undo[base + UNDO_HALFMOVE]!;
    this.hashHi = undo[base + UNDO_HASH_HI]!;
    this.hashLo = undo[base + UNDO_HASH_LO]!;
    this.fullmove = undo[base + UNDO_FULLMOVE]!;

    const us = 1 - this.stm;
    this.stm = us;
    const them = 1 - us;

    const from = encoded & 63;
    const to = (encoded >>> 6) & 63;
    const cls = (encoded >>> 12) & 7;
    const capturedCls = (encoded >>> 15) & 7;
    const board = this.board;
    const ids = this.pieceIds;

    // The hash was restored wholesale above, so the board can be rewound without any XOR work.
    board[from] = code(us, cls);
    ids[from] = ids[to]!;
    board[to] = 0;
    ids[to] = -1;
    if (cls === KING) this.kings[us] = from;

    if (encoded & MOVE_CASTLE_KING) this.rewindRook(us, to + 1, to - 1);
    else if (encoded & MOVE_CASTLE_QUEEN) this.rewindRook(us, to - 2, to + 1);

    if (encoded & MOVE_EN_PASSANT) {
      const capturedSquare = us === WHITE ? to - 8 : to + 8;
      board[capturedSquare] = code(them, PAWN);
      ids[capturedSquare] = capturedId;
    } else if (capturedCls !== NO_CLASS) {
      board[to] = code(them, capturedCls);
      ids[to] = capturedId;
    }
  }

  private slideRook(side: number, from: Square, to: Square): void {
    this.xorPiece(side, ROOK, from);
    this.xorPiece(side, ROOK, to);
    this.board[from] = 0;
    this.board[to] = code(side, ROOK);
    this.pieceIds[to] = this.pieceIds[from]!;
    this.pieceIds[from] = -1;
  }

  private rewindRook(side: number, from: Square, to: Square): void {
    this.board[from] = code(side, ROOK);
    this.board[to] = 0;
    this.pieceIds[from] = this.pieceIds[to]!;
    this.pieceIds[to] = -1;
  }

  private growUndo(): void {
    const grown = new Int32Array(this.undo.length * 2);
    grown.set(this.undo);
    this.undo = grown;
  }

  // -------------------------------------------------------------------------
  // Hash maintenance
  // -------------------------------------------------------------------------

  private xorPiece(side: number, cls: number, square: Square): void {
    const index = pieceWordIndex(side, cls, square);
    this.hashHi ^= PIECE_WORDS[index]!;
    this.hashLo ^= PIECE_WORDS[index + 1]!;
  }

  private xorRights(rights: number): void {
    const index = rights * 2;
    this.hashHi ^= CASTLING_WORDS[index]!;
    this.hashLo ^= CASTLING_WORDS[index + 1]!;
  }

  private xorEp(square: Square): void {
    const index = fileOf(square) * 2;
    this.hashHi ^= EP_FILE_WORDS[index]!;
    this.hashLo ^= EP_FILE_WORDS[index + 1]!;
  }

  private xorSide(): void {
    this.hashHi ^= SIDE_WORDS[0]!;
    this.hashLo ^= SIDE_WORDS[1]!;
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  isCheckmate(): boolean {
    return this.isInCheck() && this.legalMoveCount() === 0;
  }

  isStalemate(): boolean {
    return !this.isInCheck() && this.legalMoveCount() === 0;
  }

  /** A hundred half-moves without a capture or a pawn move — the claimable fifty-move draw. */
  isFiftyMoveDraw(): boolean {
    return this.halfmove >= 100;
  }

  /**
   * Whether the material left on the board cannot force mate by any sequence of legal moves.
   *
   * Deliberately the narrow reading: king against king, king against a lone knight or bishop, and
   * bishops-only positions with every bishop on one colour. King and two knights is *not* included,
   * because mate there is possible with cooperation even though it cannot be forced.
   */
  isInsufficientMaterial(): boolean {
    let pieces = 0;
    let bishops = 0;
    let lightBishops = 0;
    let knights = 0;
    for (let square = 0; square < SQUARE_COUNT; square++) {
      const piece = this.board[square]!;
      if (piece === 0) continue;
      pieces++;
      const cls = (piece & 7) - 1;
      if (cls === BISHOP) {
        bishops++;
        if (squareColor(square) === 'light') lightBishops++;
      } else if (cls === KNIGHT) {
        knights++;
      } else if (cls !== KING) {
        return false;
      }
    }
    if (pieces === 2) return true;
    if (pieces === 3 && (bishops === 1 || knights === 1)) return true;
    if (pieces === bishops + 2) return lightBishops === 0 || lightBishops === bishops;
    return false;
  }

  /**
   * How many times the current position has occurred, this occurrence included.
   *
   * Only the moves since the last capture or pawn move are examined: an irreversible move makes every
   * earlier position unreachable, so nothing before it can be a repetition of this one. Positions two
   * plies apart are the only candidates, since a repetition must have the same side to move.
   */
  repetitionCount(): number {
    let count = 1;
    const floor = Math.max(0, this.ply - this.halfmove);
    for (let ply = this.ply - 2; ply >= floor; ply -= 2) {
      const base = ply * UNDO_STRIDE;
      if (
        this.undo[base + UNDO_HASH_HI] === this.hashHi &&
        this.undo[base + UNDO_HASH_LO] === this.hashLo
      ) {
        count++;
      }
    }
    return count;
  }

  isThreefoldRepetition(): boolean {
    return this.repetitionCount() >= 3;
  }

  isDraw(): boolean {
    return (
      this.isFiftyMoveDraw() ||
      this.isInsufficientMaterial() ||
      this.isThreefoldRepetition() ||
      this.isStalemate()
    );
  }

  isGameOver(): boolean {
    return this.isCheckmate() || this.isDraw();
  }
}

/** Convenience alias for {@link Position.fromFen}. */
export const fromFen = (fen: string): Position => Position.fromFen(fen);

/** Convenience alias for {@link Position.fromStartingPosition}. */
export const fromStartingPosition = (): Position => Position.fromStartingPosition();
