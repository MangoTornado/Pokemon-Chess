/**
 * Tests for the standard-chess substrate.
 *
 * The suite leans on two external oracles rather than on hand-derived expectations, because a move
 * generator is exactly the kind of code where a plausible-looking bug survives any number of
 * hand-written cases:
 *
 * - **Perft** against the six positions whose node counts are published and independently verified.
 *   A single wrong or missing move anywhere in the tree changes the total, so matching to depth four
 *   or five is a far stronger statement than any set of targeted assertions.
 * - **A differential against `chess.js`**, playing seeded pseudo-random games and comparing the whole
 *   legal-move list and every status flag after every move. Perft proves the counts; the differential
 *   proves the moves are the *same* moves, and it covers the draw and check predicates that perft
 *   never touches.
 *
 * The targeted tests below exist for the rules that are easy to get subtly wrong and that a random
 * walk reaches only rarely, so a failure names the rule instead of just a node count.
 *
 * Nothing is gated on the perft side: every published depth of all six positions runs by default,
 * because counting leaf nodes by move count at the last ply makes even depth five cheap. The
 * differential is the part that scales with time, so it plays a moderate number of games by default
 * and many more under `POKECHESS_SLOW_TESTS=1`; `POKECHESS_DIFF_GAMES` overrides the count outright.
 */

import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';

import { parseSquare, squareName } from './board.ts';
import { MAX_MOVES, Position, STARTING_FEN, moveToUci } from './position.ts';
import { Rng } from './rng.ts';

const RUN_SLOW = process.env.POKECHESS_SLOW_TESTS === '1';

const KIWIPETE = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1';
const POSITION_3 = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1';
const POSITION_4 = 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1';
const POSITION_5 = 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8';
const POSITION_6 = 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10';

const ALL_POSITIONS = [STARTING_FEN, KIWIPETE, POSITION_3, POSITION_4, POSITION_5, POSITION_6];

/** One buffer per depth, so a child's generation cannot overwrite the list its parent is walking. */
const perftBuffers = Array.from({ length: 16 }, () => new Int32Array(MAX_MOVES));

function perft(position: Position, depth: number): number {
  if (depth === 0) return 1;
  const buffer = perftBuffers[depth]!;
  const end = position.generateMovesInto(buffer, 0);
  if (depth === 1) return end;
  let nodes = 0;
  for (let i = 0; i < end; i++) {
    position.makeMove(buffer[i]!);
    nodes += perft(position, depth - 1);
    position.unmakeMove();
  }
  return nodes;
}

const uciList = (position: Position): string[] => position.generateMoves().map(moveToUci).sort();

describe('perft', () => {
  const cases = [
    { name: 'initial position', fen: STARTING_FEN, counts: [20, 400, 8902, 197281, 4865609] },
    { name: 'kiwipete', fen: KIWIPETE, counts: [48, 2039, 97862, 4085603] },
    { name: 'position 3', fen: POSITION_3, counts: [14, 191, 2812, 43238, 674624] },
    { name: 'position 4', fen: POSITION_4, counts: [6, 264, 9467, 422333] },
    { name: 'position 5', fen: POSITION_5, counts: [44, 1486, 62379, 2103487] },
    { name: 'position 6', fen: POSITION_6, counts: [46, 2079, 89890, 3894594] },
  ];

  for (const { name, fen, counts } of cases) {
    it(`${name} to depth ${counts.length}`, () => {
      for (let depth = 1; depth <= counts.length; depth++) {
        expect(perft(Position.fromFen(fen), depth), `${name} depth ${depth}`).toBe(
          counts[depth - 1],
        );
      }
    }, 300_000);
  }
});

describe('differential against chess.js', () => {
  /**
   * chess.js prints an en passant target only when the capture is playable, and re-derives that with a
   * full legality test rather than the adjacency test used when the move was made, so the field is
   * masked out before comparing whole FENs. Whether the capture actually exists is already covered by
   * comparing the move lists.
   */
  const withoutEpField = (fen: string): string => {
    const fields = fen.split(' ');
    fields[3] = '-';
    return fields.join(' ');
  };

  /**
   * chess.js's move list, in the same from-to-promotion form this engine produces.
   *
   * `moves({ verbose: true })` is the documented way to ask, but building its `Move` objects costs
   * roughly thirty times as much as the generation itself — enough to turn a few seconds of coverage
   * into half a minute — so the bulk of the games read the same generator through `_moves`. The test
   * below pins that shortcut to the public API so a change in either cannot go unnoticed.
   */
  interface ReferenceGenerator {
    _moves(options: { legal: boolean }): { from: number; to: number; promotion?: string }[];
  }

  /** chess.js indexes squares sixteen to a rank from `a8 = 0`, so `h1` is 119. */
  const referenceSquareName = (square: number): string =>
    `${'abcdefgh'[square & 15]!}${8 - (square >> 4)}`;

  const referenceMoves = (reference: Chess): string[] =>
    (reference as unknown as ReferenceGenerator)
      ._moves({ legal: true })
      .map(
        (move) =>
          referenceSquareName(move.from) + referenceSquareName(move.to) + (move.promotion ?? ''),
      )
      .sort();

  it('reads the same move list through the reference implementation and its public API', () => {
    const rng = new Rng('reference-accessor');
    for (const fen of ALL_POSITIONS) {
      const reference = new Chess(fen);
      for (let ply = 0; ply < 30; ply++) {
        const publicList = reference.moves({ verbose: true }).map((move) => move.lan).sort();
        expect(referenceMoves(reference), fen).toEqual(publicList);
        if (publicList.length === 0) break;
        reference.move(rng.pick(publicList));
      }
    }
  }, 60_000);

  type Outcome =
    | 'checkmate'
    | 'stalemate'
    | 'insufficient material'
    | 'fifty-move'
    | 'threefold'
    | 'unfinished';

  const outcomeOf = (position: Position): Outcome => {
    if (position.isCheckmate()) return 'checkmate';
    if (position.isStalemate()) return 'stalemate';
    if (position.isInsufficientMaterial()) return 'insufficient material';
    if (position.isFiftyMoveDraw()) return 'fifty-move';
    if (position.isThreefoldRepetition()) return 'threefold';
    return 'unfinished';
  };

  /** Plays one seeded game, comparing everything after every move. */
  function playAndCompare(
    seed: string,
    startFen: string,
    maxPlies: number,
  ): { plies: number; outcome: Outcome } {
    const position = Position.fromFen(startFen);
    const reference = new Chess(startFen);
    const rng = new Rng(seed);
    const played: string[] = [];

    /**
     * Hundreds of games make hundreds of thousands of comparisons, at which point `expect`'s own
     * bookkeeping outweighs the work being tested — and a thrown error names the disagreement, the
     * seed, and the moves that led to it just as precisely.
     */
    const agree = (what: string, mineValue: unknown, theirsValue: unknown, trail: string): void => {
      if (mineValue !== theirsValue) {
        throw new Error(
          `${what}: mine=${String(mineValue)} chess.js=${String(theirsValue)} — ${trail}`,
        );
      }
    };

    for (let ply = 0; ply < maxPlies; ply++) {
      const trail = `seed=${seed} start=${startFen} moves=[${played.join(' ')}]`;
      const mine = uciList(position);
      const theirs = referenceMoves(reference);
      const referenceFen = reference.fen();

      // Checkmate, stalemate and draw are restated here from chess.js's own definitions rather than
      // called, because each of its predicates regenerates the move list and that dominates the
      // runtime of the whole suite. The comparison is unchanged; only the redundant work is gone.
      const referenceCheck = reference.isCheck();
      const referenceStalemate = !referenceCheck && theirs.length === 0;
      const referenceInsufficient = reference.isInsufficientMaterial();
      const referenceThreefold = reference.isThreefoldRepetition();
      const referenceDraw =
        Number(referenceFen.split(' ')[4]) >= 100 ||
        referenceStalemate ||
        referenceInsufficient ||
        referenceThreefold;

      agree('move list', mine.join(' '), theirs.join(' '), trail);
      agree('fen', withoutEpField(position.toFen()), withoutEpField(referenceFen), trail);
      agree('check', position.isInCheck(), referenceCheck, trail);
      agree('checkmate', position.isCheckmate(), referenceCheck && theirs.length === 0, trail);
      agree('stalemate', position.isStalemate(), referenceStalemate, trail);
      agree('insufficient material', position.isInsufficientMaterial(), referenceInsufficient, trail);
      agree('threefold repetition', position.isThreefoldRepetition(), referenceThreefold, trail);
      agree('draw', position.isDraw(), referenceDraw, trail);

      if (mine.length === 0 || referenceDraw) return { plies: ply, outcome: outcomeOf(position) };

      const uci = rng.pick(mine);
      played.push(uci);
      const move = position.moveFromUci(uci);
      if (move === null) throw new Error(`cannot replay own move ${uci} — ${trail}`);
      position.makeMove(move);
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      reference.move(uci.length === 5 ? { from, to, promotion: uci[4]! } : { from, to });
    }
    return { plies: maxPlies, outcome: 'unfinished' };
  }

  const gamesPerPosition = Number(process.env.POKECHESS_DIFF_GAMES ?? (RUN_SLOW ? '200' : '30'));

  it(
    `agrees on every legal move over ${gamesPerPosition * ALL_POSITIONS.length} games`,
    () => {
      let plies = 0;
      for (const fen of ALL_POSITIONS) {
        for (let game = 0; game < gamesPerPosition; game++) {
          plies += playAndCompare(`differential/${fen}/${game}`, fen, 120).plies;
        }
      }
      // A run that agreed on nothing because every game ended immediately would be worthless.
      expect(plies).toBeGreaterThan(gamesPerPosition * ALL_POSITIONS.length * 10);
    },
    600_000,
  );

  /**
   * Random middlegames almost never end, so they never reach the rules that decide a game.
   *
   * These sparse endings do: with few pieces the fifty-move counter runs out, positions repeat, mating
   * material gets traded off, and stalemate is a real risk, which is the only way to put the draw
   * predicates under the same differential as move generation.
   */
  const ENDGAMES = [
    '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
    '8/8/8/4k3/8/8/8/2Q1K3 w - - 0 1',
    '4k3/8/8/8/8/8/4P3/4K3 w - - 0 1',
    '8/2k5/8/8/8/8/1P6/K7 w - - 0 1',
    '8/8/8/3k4/8/8/2PP4/3K4 w - - 0 1',
    '8/8/8/8/8/2k5/1p6/1K6 w - - 0 1',
    '8/8/8/8/2b5/8/2N5/K1k5 w - - 0 1',
    '8/6p1/8/8/8/8/1P6/K1k5 w - - 0 1',
    // Random play almost never stumbles into mate from a bare ending, so two positions where mate is
    // already on the board are included to keep checkmate inside the differential rather than only in
    // the hand-written tests.
    '7k/5K2/8/8/8/8/8/6Q1 w - - 0 1',
    '6k1/5ppp/8/8/8/8/8/R6K w - - 0 1',
  ];

  it(
    `agrees about how ${gamesPerPosition * ENDGAMES.length} endgames finish`,
    () => {
      const tally = new Map<Outcome, number>();
      for (const fen of ENDGAMES) {
        for (let game = 0; game < gamesPerPosition; game++) {
          const { outcome } = playAndCompare(`endgame/${fen}/${game}`, fen, 300);
          tally.set(outcome, (tally.get(outcome) ?? 0) + 1);
        }
      }

      const summary = [...tally].map(([outcome, count]) => `${outcome}=${count}`).join(' ');
      for (const outcome of [
        'checkmate',
        'stalemate',
        'insufficient material',
        'fifty-move',
        'threefold',
      ] as const) {
        expect(tally.get(outcome) ?? 0, `no game ended in ${outcome}; saw ${summary}`).toBeGreaterThan(0);
      }
    },
    600_000,
  );

  it('agrees about insufficient material on constructed endings', () => {
    const endings = [
      '8/8/8/4k3/8/8/8/4K3 w - - 0 1',
      '8/8/8/4k3/8/8/8/2B1K3 w - - 0 1',
      '8/8/8/4k3/8/8/8/2N1K3 w - - 0 1',
      '8/8/8/4k3/8/8/8/1NN1K3 w - - 0 1',
      '8/8/8/4k3/8/8/8/2B1K1B1 w - - 0 1',
      '8/8/8/2b1k3/8/8/8/2B1K3 w - - 0 1',
      '8/8/8/3bk3/8/8/8/2B1K3 w - - 0 1',
      '8/8/8/4k3/8/8/4P3/4K3 w - - 0 1',
      '8/8/8/4k3/8/8/8/R3K3 w - - 0 1',
    ];
    for (const fen of endings) {
      expect(Position.fromFen(fen).isInsufficientMaterial(), fen).toBe(
        new Chess(fen).isInsufficientMaterial(),
      );
    }
  });
});

describe('makeMove and unmakeMove round-trip', () => {
  /**
   * Walks the tree making and unmaking, asserting the position is bit-identical afterwards.
   *
   * A `make`/`unmake` pair that loses a castling right, a piece id, or a Zobrist word corrupts AI
   * search silently — the search explores a position that never existed and returns a move for it —
   * so this is checked on every node rather than only at the root. The hash is also compared against
   * one computed from scratch out of the position's own FEN, which catches an incremental update that
   * is self-consistent but wrong.
   */
  function walk(position: Position, depth: number, rng: Rng): void {
    const fen = position.toFen();
    const hash = position.hash;
    const pieces = JSON.stringify(position.allPieces());

    expect(hash, `incremental hash disagrees with a fresh one for ${fen}`).toBe(
      Position.fromFen(fen).hash,
    );

    if (depth === 0) return;

    const moves = position.generateMoves();
    const sample = moves.length <= 3 ? moves : rng.shuffled(moves).slice(0, 3);
    for (const move of sample) {
      position.makeMove(move);
      walk(position, depth - 1, rng);
      position.unmakeMove();

      expect(position.toFen(), `fen changed after unmaking ${moveToUci(move)}`).toBe(fen);
      expect(position.hash, `hash changed after unmaking ${moveToUci(move)}`).toBe(hash);
      expect(JSON.stringify(position.allPieces()), `pieces changed after unmaking ${moveToUci(move)}`).toBe(
        pieces,
      );
    }
  }

  for (const fen of ALL_POSITIONS) {
    it(`is invariant over a deep random walk from ${fen.split(' ')[0]!.slice(0, 24)}`, () => {
      walk(Position.fromFen(fen), 6, new Rng(`walk/${fen}`));
    }, 120_000);
  }

  it('restores a hash word mixed in by an outer layer', () => {
    const position = Position.fromStartingPosition();
    const before = position.hash;
    const move = position.moveFromUci('e2e4')!;

    position.makeMove(move);
    position.xorHash(0x1234_5678 | 0, 0x0bad_c0de | 0);
    expect(position.hash).not.toBe(before);

    position.unmakeMove();
    expect(position.hash).toBe(before);
  });
});

describe('en passant', () => {
  // Black has just played c7-c5. Capturing bxc6 would empty both b5 and c5, and the rook on h5 would
  // then see all the way to the white king on a5, so the capture is illegal despite being generated.
  const DISCOVERED_CHECK = '7k/8/8/KPp4r/8/8/8/8 w - c6 0 1';

  it('generates the capture but rejects it when it uncovers the king', () => {
    const position = Position.fromFen(DISCOVERED_CHECK);
    expect(position.generatePseudoLegalMoves().map(moveToUci)).toContain('b5c6');
    expect(uciList(position)).not.toContain('b5c6');
  });

  it('allows the same capture once the discovering rook is gone', () => {
    const position = Position.fromFen('7k/8/8/KPp5/8/8/8/8 w - c6 0 1');
    expect(uciList(position)).toContain('b5c6');
  });

  it('removes the passed pawn and restores it on unmake', () => {
    const ep = Position.fromFen('4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1');
    const before = ep.toFen();
    const move = ep.moveFromUci('d4e3')!;
    expect(move.isEnPassant).toBe(true);
    expect(move.capturedSquare).toBe(parseSquare('e4'));
    expect(move.captured?.cls).toBe('pawn');

    ep.makeMove(move);
    expect(ep.pieceAt(parseSquare('e4'))).toBeNull();
    expect(ep.pieceAt(parseSquare('e3'))?.cls).toBe('pawn');
    ep.unmakeMove();
    expect(ep.toFen()).toBe(before);
  });

  it('records a target only for a double push that an enemy pawn stands beside', () => {
    const position = Position.fromStartingPosition();
    position.makeMove(position.moveFromUci('e2e4')!);
    // Nothing can answer the push, so recording a target would make two identical positions hash
    // differently without changing anyone's legal moves.
    expect(position.epSquare).toBeNull();

    position.makeMove(position.moveFromUci('d7d5')!);
    position.makeMove(position.moveFromUci('e4e5')!);
    expect(position.epSquare).toBeNull();
    position.makeMove(position.moveFromUci('f7f5')!);
    expect(position.epSquare).toBe(parseSquare('f6'));
    expect(uciList(position)).toContain('e5f6');
  });

  it('clears the target after any other move', () => {
    const position = Position.fromFen('4k3/8/8/8/3pP3/8/8/4K3 b - e3 0 1');
    position.makeMove(position.moveFromUci('e8d8')!);
    expect(position.epSquare).toBeNull();
  });
});

describe('castling', () => {
  const bare = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';

  it('offers both castles when nothing interferes', () => {
    expect(uciList(Position.fromFen(bare))).toEqual(expect.arrayContaining(['e1g1', 'e1c1']));
  });

  it('forbids castling out of check', () => {
    const moves = uciList(Position.fromFen('r3k2r/8/8/4r3/8/8/8/R3K2R w KQkq - 0 1'));
    expect(moves).not.toContain('e1g1');
    expect(moves).not.toContain('e1c1');
  });

  it('forbids castling through an attacked square', () => {
    const kingside = uciList(Position.fromFen('r3k2r/8/8/5r2/8/8/8/R3K2R w KQkq - 0 1'));
    expect(kingside).not.toContain('e1g1');
    expect(kingside).toContain('e1c1');

    const queenside = uciList(Position.fromFen('r3k2r/8/8/3r4/8/8/8/R3K2R w KQkq - 0 1'));
    expect(queenside).toContain('e1g1');
    expect(queenside).not.toContain('e1c1');
  });

  it('forbids castling into check', () => {
    const moves = uciList(Position.fromFen('r3k2r/8/8/6r1/8/8/8/R3K2R w KQkq - 0 1'));
    expect(moves).not.toContain('e1g1');
    expect(moves).toContain('e1c1');
  });

  // The king never stands on b1, so an attack there does not touch the rule even though the rook
  // passes over it.
  it('allows queenside castling when only b1 is attacked', () => {
    expect(uciList(Position.fromFen('r3k2r/8/8/1r6/8/8/8/R3K2R w KQkq - 0 1'))).toContain('e1c1');
  });

  it('requires every square between king and rook to be empty', () => {
    expect(uciList(Position.fromFen('r3k2r/8/8/8/8/8/8/RN2K2R w KQkq - 0 1'))).not.toContain('e1c1');
    expect(uciList(Position.fromFen('r3k2r/8/8/8/8/8/8/R3KN1R w KQkq - 0 1'))).not.toContain('e1g1');
  });

  it('moves the rook too, and puts it back on unmake', () => {
    const position = Position.fromFen(bare);
    const before = position.toFen();
    const move = position.moveFromUci('e1c1')!;
    expect(move.castle).toBe('queenside');

    const rookId = position.pieceAt(parseSquare('a1'))!.id;
    position.makeMove(move);
    expect(position.pieceAt(parseSquare('c1'))?.cls).toBe('king');
    expect(position.pieceAt(parseSquare('d1'))?.cls).toBe('rook');
    expect(position.pieceAt(parseSquare('d1'))?.id).toBe(rookId);
    expect(position.pieceAt(parseSquare('a1'))).toBeNull();
    expect(position.toFen().split(' ')[2]).toBe('kq');

    position.unmakeMove();
    expect(position.toFen()).toBe(before);
    expect(position.pieceAt(parseSquare('a1'))?.id).toBe(rookId);
  });

  it('loses rights when the king moves and regains them on unmake', () => {
    const position = Position.fromFen(bare);
    position.makeMove(position.moveFromUci('e1e2')!);
    expect(position.castlingRights).toMatchObject({ whiteKing: false, whiteQueen: false });
    position.unmakeMove();
    expect(position.castlingRights).toMatchObject({ whiteKing: true, whiteQueen: true });
  });

  it('loses rights when a rook moves off its corner', () => {
    const position = Position.fromFen(bare);
    position.makeMove(position.moveFromUci('h1h2')!);
    expect(position.toFen().split(' ')[2]).toBe('Qkq');
  });

  it('loses rights when the rook is captured on its corner', () => {
    const position = Position.fromFen('r3k2r/8/8/8/8/8/6b1/R3K2R b KQkq - 0 1');
    const move = position.moveFromUci('g2h1')!;
    expect(move.captured?.cls).toBe('rook');
    position.makeMove(move);
    expect(position.toFen().split(' ')[2]).toBe('Qkq');
    position.unmakeMove();
    expect(position.toFen().split(' ')[2]).toBe('KQkq');
  });
});

describe('promotion', () => {
  it('offers all four choices, with and without a capture', () => {
    const position = Position.fromFen('1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    const moves = uciList(position);
    expect(moves).toEqual(expect.arrayContaining(['a7a8q', 'a7a8r', 'a7a8b', 'a7a8n']));
    expect(moves).toEqual(expect.arrayContaining(['a7b8q', 'a7b8r', 'a7b8b', 'a7b8n']));
  });

  it('keeps the pawn identity through the promotion and restores the class on unmake', () => {
    const position = Position.fromFen('1n2k3/P7/8/8/8/8/8/4K3 w - - 0 1');
    const pawnId = position.pieceAt(parseSquare('a7'))!.id;
    const knightId = position.pieceAt(parseSquare('b8'))!.id;
    const before = position.toFen();

    const move = position.moveFromUci('a7b8n')!;
    expect(move.promotion).toBe('knight');
    expect(move.captured?.cls).toBe('knight');
    position.makeMove(move);

    const promoted = position.pieceAt(parseSquare('b8'))!;
    expect(promoted.cls).toBe('knight');
    expect(promoted.side).toBe('white');
    // The same individual evolved; the Pokémon layer keys its state off this id.
    expect(promoted.id).toBe(pawnId);

    position.unmakeMove();
    expect(position.toFen()).toBe(before);
    expect(position.pieceAt(parseSquare('a7'))!.cls).toBe('pawn');
    expect(position.pieceAt(parseSquare('a7'))!.id).toBe(pawnId);
    expect(position.pieceAt(parseSquare('b8'))!.id).toBe(knightId);
  });

  it('cannot promote off the line it is pinned to', () => {
    // The bishop on c8 pins the pawn on b7 against the king on a6, so the pawn may promote by taking
    // the pinner but neither by pushing nor by taking the knight on a8.
    const position = Position.fromFen('n1b4k/1P6/K7/8/8/8/8/8 w - - 0 1');
    const moves = uciList(position);
    expect(moves).toContain('b7c8q');
    expect(moves).not.toContain('b7a8q');
    expect(moves).not.toContain('b7b8q');
  });
});

describe('legality', () => {
  it('does not let a pinned knight move at all', () => {
    const position = Position.fromFen('k3r3/8/8/8/8/8/4N3/4K3 w - - 0 1');
    expect(uciList(position).filter((uci) => uci.startsWith('e2'))).toEqual([]);
  });

  it('lets a pinned rook move along the pin, but not off it', () => {
    const position = Position.fromFen('k3r3/8/8/8/8/8/4R3/4K3 w - - 0 1');
    const moves = uciList(position).filter((uci) => uci.startsWith('e2'));
    expect(moves).toEqual(['e2e3', 'e2e4', 'e2e5', 'e2e6', 'e2e7', 'e2e8']);
  });

  it('forces a king move out of double check', () => {
    // The rook on e1 and the knight on f6 both hit e8, and no single move can answer both.
    const position = Position.fromFen('4k3/8/5N2/8/8/8/8/K3R3 b - - 0 1');
    expect(position.isInCheck()).toBe(true);
    const moves = position.generateMoves();
    expect(moves.every((move) => move.cls === 'king')).toBe(true);
    expect(moves.map(moveToUci).sort()).toEqual(['e8d8', 'e8f7', 'e8f8']);
  });

  it('reports attackers of a square for either side', () => {
    const position = Position.fromFen('4k3/8/8/8/4n3/8/3PKP2/8 w - - 0 1');
    expect(position.isAttacked(parseSquare('d2'), 'black')).toBe(true);
    expect(position.attackersOf(parseSquare('d2'), 'black').map(squareName)).toEqual(['e4']);
    expect(position.attackersOf(parseSquare('e3'), 'white').map(squareName).sort()).toEqual([
      'd2',
      'e2',
      'f2',
    ]);
  });

  it('separates checkmate from stalemate', () => {
    const stalemate = Position.fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(stalemate.isInCheck()).toBe(false);
    expect(stalemate.isStalemate()).toBe(true);
    expect(stalemate.isCheckmate()).toBe(false);
    expect(stalemate.isDraw()).toBe(true);

    const checkmate = Position.fromFen('7k/6Q1/6K1/8/8/8/8/8 b - - 0 1');
    expect(checkmate.isInCheck()).toBe(true);
    expect(checkmate.isCheckmate()).toBe(true);
    expect(checkmate.isStalemate()).toBe(false);
    expect(checkmate.isDraw()).toBe(false);
  });

  it('recognises the material that cannot mate', () => {
    expect(Position.fromFen('8/8/8/4k3/8/8/8/4K3 w - - 0 1').isInsufficientMaterial()).toBe(true);
    expect(Position.fromFen('8/8/8/4k3/8/8/8/2B1K3 w - - 0 1').isInsufficientMaterial()).toBe(true);
    expect(Position.fromFen('8/8/8/4k3/8/8/8/2N1K3 w - - 0 1').isInsufficientMaterial()).toBe(true);
    // Two knights can mate with help, so it is not a dead position.
    expect(Position.fromFen('8/8/8/4k3/8/8/8/1NN1K3 w - - 0 1').isInsufficientMaterial()).toBe(false);
    expect(Position.fromFen('8/8/8/4k3/8/8/4P3/4K3 w - - 0 1').isInsufficientMaterial()).toBe(false);
  });
});

describe('draw counters', () => {
  it('claims the fifty-move draw on the hundredth quiet half-move', () => {
    const position = Position.fromFen('8/8/8/4k3/8/8/8/R3K3 w - - 99 1');
    expect(position.isFiftyMoveDraw()).toBe(false);
    position.makeMove(position.moveFromUci('a1a2')!);
    expect(position.halfmoveClock).toBe(100);
    expect(position.isFiftyMoveDraw()).toBe(true);
    expect(position.isDraw()).toBe(true);
    position.unmakeMove();
    expect(position.halfmoveClock).toBe(99);
    expect(position.isFiftyMoveDraw()).toBe(false);
  });

  it('resets the clock on a pawn move and on a capture', () => {
    const pawn = Position.fromFen('4k3/8/8/8/8/8/4P3/4K3 w - - 42 1');
    pawn.makeMove(pawn.moveFromUci('e2e3')!);
    expect(pawn.halfmoveClock).toBe(0);

    const capture = Position.fromFen('4k3/8/8/8/8/8/6r1/K5R1 w - - 42 1');
    capture.makeMove(capture.moveFromUci('g1f1')!);
    expect(capture.halfmoveClock).toBe(43);
    capture.unmakeMove();
    capture.makeMove(capture.moveFromUci('g1g2')!);
    expect(capture.halfmoveClock).toBe(0);
  });

  it('counts a threefold repetition of the opening position', () => {
    const position = Position.fromStartingPosition();
    expect(position.repetitionCount()).toBe(1);
    for (const round of [1, 2]) {
      for (const uci of ['g1f3', 'g8f6', 'f3g1', 'f6g8']) {
        position.makeMove(position.moveFromUci(uci)!);
      }
      expect(position.repetitionCount(), `after round ${round}`).toBe(round + 1);
    }
    expect(position.isThreefoldRepetition()).toBe(true);
    expect(position.isDraw()).toBe(true);
  });

  it('does not count positions separated by an irreversible move', () => {
    const position = Position.fromStartingPosition();
    for (const uci of ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'e2e4']) {
      position.makeMove(position.moveFromUci(uci)!);
    }
    expect(position.repetitionCount()).toBe(1);
  });
});

describe('FEN', () => {
  it('round-trips all six perft positions exactly', () => {
    for (const fen of ALL_POSITIONS) {
      expect(Position.fromFen(fen).toFen()).toBe(fen);
    }
  });

  it('round-trips an en passant target verbatim rather than normalising it', () => {
    const fen = 'rnbqkbnr/pp1ppppp/8/2p5/8/8/PPPPPPPP/RNBQKBNR w KQkq c6 0 2';
    expect(Position.fromFen(fen).toFen()).toBe(fen);
  });

  it('builds the opening array identically from the starting position and from its FEN', () => {
    expect(Position.fromStartingPosition().toFen()).toBe(STARTING_FEN);
    expect(Position.fromStartingPosition().hash).toBe(Position.fromFen(STARTING_FEN).hash);
  });

  it('rejects malformed input instead of guessing', () => {
    expect(() => Position.fromFen('8/8/8 w - -')).toThrow();
    expect(() => Position.fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNX w KQkq - 0 1')).toThrow();
    expect(() => Position.fromFen('8/8/8/8/8/8/8/8 x - - 0 1')).toThrow();
  });
});

describe('piece identity', () => {
  it('keeps an id across a sequence of moves', () => {
    const position = Position.fromStartingPosition();
    const knightId = position.pieceAt(parseSquare('g1'))!.id;
    for (const uci of ['g1f3', 'g8f6', 'f3e5', 'f6e4']) {
      position.makeMove(position.moveFromUci(uci)!);
    }
    expect(position.pieceAt(parseSquare('e5'))!.id).toBe(knightId);
  });

  it('gives every piece on the board a distinct id', () => {
    const position = Position.fromFen(KIWIPETE);
    const ids = position.allPieces().map(({ piece }) => piece.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('immutable helpers', () => {
  it('withMove leaves the original untouched', () => {
    const position = Position.fromStartingPosition();
    const before = position.toFen();
    const next = position.withMove(position.moveFromUci('e2e4')!);
    expect(position.toFen()).toBe(before);
    expect(next.toFen()).not.toBe(before);
    expect(next.turn).toBe('black');
  });

  it('clone carries the history so repetition still counts', () => {
    const position = Position.fromStartingPosition();
    for (const uci of ['g1f3', 'g8f6', 'f3g1', 'f6g8']) {
      position.makeMove(position.moveFromUci(uci)!);
    }
    expect(position.clone().repetitionCount()).toBe(2);
  });
});
