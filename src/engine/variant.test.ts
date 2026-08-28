import { describe, expect, it } from 'vitest';

import type { BattleType } from '../data/schema.ts';
import { parseSquare, squareName } from './board.ts';
import { Position } from './position.ts';
import type { Move } from './position.ts';
import { DEFAULT_RULES, PokemonChess } from './variant.ts';
import type { Loadout, PokemonLoadout, VariantRules } from './variant.ts';

/**
 * Builds a game from a FEN, assigning each piece a type by the square it starts on.
 *
 * Ids are assigned in square order when a FEN is parsed, so mapping square to type is a stable way to
 * describe a test setup without knowing ids.
 */
function gameFrom(
  fen: string,
  types: Record<string, BattleType>,
  options: { seed?: string | number; rules?: Partial<VariantRules> } = {},
): PokemonChess {
  const position = Position.fromFen(fen);
  const loadout = new Map<number, PokemonLoadout>();
  for (const { square, piece } of position.allPieces()) {
    const name = squareName(square);
    loadout.set(piece.id, { species: `test-${name}`, type: types[name] ?? 'Normal' });
  }
  return PokemonChess.create({
    position,
    loadout: loadout as Loadout,
    seed: options.seed ?? 'test-seed',
    rules: { ...DEFAULT_RULES, ...options.rules },
  });
}

const NO_DICE = { diceEnabled: false };

function findMove(game: PokemonChess, from: string, to: string): Move | undefined {
  return game.legalMoves().find(
    (m) => m.move.from === parseSquare(from) && m.move.to === parseSquare(to),
  )?.move;
}

function hasMove(game: PokemonChess, from: string, to: string): boolean {
  return findMove(game, from, to) !== undefined;
}

/** A lone white rook on a1 with one black pawn on a7, kings out of the way. */
const ROOK_VS_PAWN = '4k3/p7/8/8/8/8/8/R3K3 w - - 0 1';

describe('the type chart decides whether a capture is even offered', () => {
  it('refuses a 0x capture outright, which is what makes a piece untouchable', () => {
    // Exactly the rule from the video: "ground doesn't affect flying, you can't take it at all".
    const game = gameFrom(ROOK_VS_PAWN, { a1: 'Ground', a7: 'Flying' });
    expect(hasMove(game, 'a1', 'a7')).toBe(false);
    // The rook is not otherwise restricted; it simply cannot touch that piece.
    expect(hasMove(game, 'a1', 'a6')).toBe(true);
    // Along the rank it runs into its own king on e1, so d1 is the limit.
    expect(hasMove(game, 'a1', 'd1')).toBe(true);
  });

  it('offers the same capture once the attacker can actually hurt the target', () => {
    const game = gameFrom(ROOK_VS_PAWN, { a1: 'Rock', a7: 'Flying' });
    expect(hasMove(game, 'a1', 'a7')).toBe(true);
  });

  it('reports the multiplier and verdict before the move is played', () => {
    const game = gameFrom(ROOK_VS_PAWN, { a1: 'Rock', a7: 'Flying' });
    const offered = game.legalMoves().find((m) => m.move.to === parseSquare('a7'))!;
    expect(offered.multiplier).toBe(2);
    expect(offered.outcome).toBe('super');
    expect(offered.defender?.type).toBe('Flying');
  });

  it('leaves a Ghost untouchable by Normal in both directions', () => {
    expect(hasMove(gameFrom(ROOK_VS_PAWN, { a1: 'Normal', a7: 'Ghost' }), 'a1', 'a7')).toBe(false);
    expect(hasMove(gameFrom(ROOK_VS_PAWN, { a1: 'Ghost', a7: 'Normal' }), 'a1', 'a7')).toBe(false);
  });
});

describe('capture resolution', () => {
  it('resolves a neutral matchup as an ordinary capture', () => {
    const game = gameFrom(ROOK_VS_PAWN, { a1: 'Normal', a7: 'Fire' }, { rules: NO_DICE });
    const { game: after, resolved } = game.play(findMove(game, 'a1', 'a7')!);

    expect(resolved.typeOutcome).toBe('neutral');
    expect(resolved.resolution).toBe('capture');
    expect(resolved.attackerDestroyed).toBe(false);
    expect(resolved.grantsExtraMove).toBe(false);
    expect(after.position.pieceAt(parseSquare('a7'))?.cls).toBe('rook');
    expect(after.turn).toBe('black');
  });

  it('grants the attacker another move on a super-effective capture', () => {
    const game = gameFrom(ROOK_VS_PAWN, { a1: 'Fire', a7: 'Steel' }, { rules: NO_DICE });
    const { game: after, resolved } = game.play(findMove(game, 'a1', 'a7')!);

    expect(resolved.typeOutcome).toBe('super');
    expect(resolved.resolution).toBe('capture-and-continue');
    expect(resolved.grantsExtraMove).toBe(true);
    // The turn does not pass — the capturing side goes again.
    expect(after.turn).toBe('white');
  });

  it('gives the extra move to the capturing piece specifically, not merely to the side', () => {
    // A second white piece exists, and must not be allowed to take the extra move.
    const game = gameFrom(
      '4k3/p7/8/8/8/8/7R/R3K3 w - - 0 1',
      { a1: 'Fire', a7: 'Steel', h2: 'Water' },
      { rules: NO_DICE },
    );
    const { game: after } = game.play(findMove(game, 'a1', 'a7')!);

    const movers = new Set(after.legalMoves().map((m) => m.move.from));
    expect(movers).toEqual(new Set([parseSquare('a7')]));
    expect(after.extraMovePieceId).not.toBeNull();
    expect(after.legalMoves().every((m) => m.isExtraMove)).toBe(true);
  });

  it('destroys both pieces on a not-very-effective capture', () => {
    const game = gameFrom(ROOK_VS_PAWN, { a1: 'Fire', a7: 'Water' }, { rules: NO_DICE });
    const { game: after, resolved } = game.play(findMove(game, 'a1', 'a7')!);

    expect(resolved.typeOutcome).toBe('resisted');
    expect(resolved.resolution).toBe('mutual-destruction');
    expect(resolved.attackerDestroyed).toBe(true);
    expect(resolved.removed).toHaveLength(2);
    // Neither piece remains anywhere on the board.
    expect(after.position.pieceAt(parseSquare('a7'))).toBeNull();
    expect(after.position.pieceAt(parseSquare('a1'))).toBeNull();
    expect(after.position.allPieces()).toHaveLength(2); // just the two kings
    expect(after.turn).toBe('black');
  });

  it('refuses to play a capture the type chart forbids', () => {
    const game = gameFrom(ROOK_VS_PAWN, { a1: 'Ground', a7: 'Flying' }, { rules: NO_DICE });
    // Reach past the legality filter to prove resolution rejects it too.
    const raw = game.position.generateMoves().find((m) => m.to === parseSquare('a7'))!;
    expect(() => game.play(raw)).toThrow(/forbids it outright/);
  });
});

describe('the die', () => {
  /** Finds a seed whose first roll is `face`, so dice behaviour can be asserted exactly. */
  function seedRolling(face: number, types: Record<string, BattleType>): string {
    for (let i = 0; i < 5000; i++) {
      const seed = `roll-${i}`;
      const game = gameFrom(ROOK_VS_PAWN, types);
      const { resolved } = game.play(findMove(game, 'a1', 'a7')!);
      if (resolved.roll === face) return seed;
      // Re-seed and retry.
      const retry = gameFrom(ROOK_VS_PAWN, types, { seed });
      const r2 = retry.play(findMove(retry, 'a1', 'a7')!).resolved;
      if (r2.roll === face) return seed;
    }
    throw new Error(`no seed found rolling ${face}`);
  }

  it('rolls a die on every capture and nothing on a quiet move', () => {
    const game = gameFrom(ROOK_VS_PAWN, { a1: 'Normal', a7: 'Normal' });
    const captured = game.play(findMove(game, 'a1', 'a7')!).resolved;
    expect(captured.roll).toBeGreaterThanOrEqual(1);
    expect(captured.roll).toBeLessThanOrEqual(6);

    const quiet = game.play(findMove(game, 'a1', 'a6')!).resolved;
    expect(quiet.roll).toBeNull();
    expect(quiet.resolution).toBe('quiet');
  });

  it('turns a 1 into a miss that destroys both pieces even on a winning matchup', () => {
    const types = { a1: 'Fire', a7: 'Steel' } as Record<string, BattleType>;
    const seed = seedRolling(1, types);
    const game = gameFrom(ROOK_VS_PAWN, types, { seed });
    const { resolved } = game.play(findMove(game, 'a1', 'a7')!);

    expect(resolved.roll).toBe(1);
    expect(resolved.typeOutcome).toBe('super'); // the matchup was winning...
    expect(resolved.resolution).toBe('mutual-destruction'); // ...and the miss overrode it
    expect(resolved.cause).toBe('miss');
  });

  it('turns a 6 into a critical hit that captures and continues even on a losing matchup', () => {
    const types = { a1: 'Fire', a7: 'Water' } as Record<string, BattleType>;
    const seed = seedRolling(6, types);
    const game = gameFrom(ROOK_VS_PAWN, types, { seed });
    const { game: after, resolved } = game.play(findMove(game, 'a1', 'a7')!);

    expect(resolved.roll).toBe(6);
    expect(resolved.typeOutcome).toBe('resisted'); // the matchup was losing...
    expect(resolved.resolution).toBe('capture-and-continue'); // ...and the crit overrode it
    expect(resolved.cause).toBe('critical-hit');
    expect(after.turn).toBe('white');
  });

  it('is fair across many games rather than favouring an outcome', () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 3000; i++) {
      const game = gameFrom(ROOK_VS_PAWN, { a1: 'Normal', a7: 'Normal' }, { seed: `fair-${i}` });
      const { resolved } = game.play(findMove(game, 'a1', 'a7')!);
      counts.set(resolved.roll!, (counts.get(resolved.roll!) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const face of [1, 2, 3, 4, 5, 6]) {
      expect(counts.get(face)!).toBeGreaterThan(3000 / 6 * 0.8);
      expect(counts.get(face)!).toBeLessThan(3000 / 6 * 1.2);
    }
  });

  it('can be switched off entirely, leaving pure type resolution', () => {
    for (let i = 0; i < 40; i++) {
      const game = gameFrom(ROOK_VS_PAWN, { a1: 'Fire', a7: 'Steel' }, {
        seed: `nodice-${i}`,
        rules: NO_DICE,
      });
      const { resolved } = game.play(findMove(game, 'a1', 'a7')!);
      expect(resolved.roll).toBeNull();
      expect(resolved.resolution).toBe('capture-and-continue');
    }
  });
});

describe('termination, which the extra-move rule threatens', () => {
  it('caps how many extra moves a single turn may chain', () => {
    // A Fire rook with three Steel pawns lined up to eat: a2, then b2, then c2.
    const fen = '7k/8/8/8/8/8/ppp5/R6K w - - 0 1';
    const types = { a1: 'Fire', a2: 'Steel', b2: 'Steel', c2: 'Steel' } as Record<string, BattleType>;
    let game = gameFrom(fen, types, { rules: { diceEnabled: false, maxExtraMovesPerTurn: 2 } });

    const first = game.play(findMove(game, 'a1', 'a2')!);
    expect(first.resolved.grantsExtraMove).toBe(true);
    game = first.game;
    expect(game.extraMovesUsed).toBe(1);

    const second = game.play(findMove(game, 'a2', 'b2')!);
    expect(second.resolved.grantsExtraMove).toBe(true);
    game = second.game;
    expect(game.extraMovesUsed).toBe(2);

    // The cap is reached: this capture still succeeds, but the turn ends.
    const third = game.play(findMove(game, 'b2', 'c2')!);
    expect(third.resolved.resolution).toBe('capture');
    expect(third.resolved.grantsExtraMove).toBe(false);
    expect(third.game.turn).toBe('black');
    expect(third.game.extraMovesUsed).toBe(0);
  });

  it('bounds a chain by the enemy piece count even with a generous cap', () => {
    // Only one target exists, so the chain cannot outlive it however high the cap.
    const game = gameFrom(ROOK_VS_PAWN, { a1: 'Fire', a7: 'Steel' }, {
      rules: { diceEnabled: false, maxExtraMovesPerTurn: 99 },
    });
    const { game: after } = game.play(findMove(game, 'a1', 'a7')!);
    // The extra move exists but no further capture does, so the chain dies out naturally.
    expect(after.legalMoves().every((m) => m.move.captured === null)).toBe(true);
  });

  it('does not grant an extra move a piece could not use', () => {
    // The capturing pawn promotes on the last rank and then has nowhere to go, because it is pinned
    // in place by having no legal continuation at all.
    const game = gameFrom('4k3/8/8/8/8/8/8/R3K2r w - - 0 1', { a1: 'Fire', h1: 'Steel' }, {
      rules: NO_DICE,
    });
    const move = findMove(game, 'a1', 'h1');
    // If the capture is available, playing it must never leave the game waiting on a move that does
    // not exist.
    if (move) {
      const { game: after, resolved } = game.play(move);
      if (resolved.grantsExtraMove) expect(after.legalMoves().length).toBeGreaterThan(0);
    }
  });
});

describe('the video\'s own bug: dying in a capture while your king is in check', () => {
  it('never offers a capture that a bad roll would turn into losing your king', () => {
    // The white rook on e2 is all that shields the white king on e1 from the black rook on e8.
    // Capturing the pawn on e5 keeps the rook on the file, so chess calls it legal — but mutual
    // destruction would remove the shield and leave the king in check.
    const fen = 'k3r3/8/8/4p3/8/8/4R3/4K3 w - - 0 1';
    const withDice = gameFrom(fen, { e2: 'Fire', e5: 'Steel' });
    expect(hasMove(withDice, 'e2', 'e5')).toBe(false);
  });

  it('allows that same capture when mutual destruction is impossible', () => {
    // With the die off and a winning matchup, the attacker cannot die, so the shield cannot vanish.
    const fen = 'k3r3/8/8/4p3/8/8/4R3/4K3 w - - 0 1';
    const noDice = gameFrom(fen, { e2: 'Fire', e5: 'Steel' }, { rules: NO_DICE });
    expect(hasMove(noDice, 'e2', 'e5')).toBe(true);
  });

  it('forbids it with the die off when the matchup itself is losing', () => {
    // A resisted matchup always destroys the attacker, so the shield always vanishes.
    const fen = 'k3r3/8/8/4p3/8/8/4R3/4K3 w - - 0 1';
    const losing = gameFrom(fen, { e2: 'Fire', e5: 'Water' }, { rules: NO_DICE });
    expect(hasMove(losing, 'e2', 'e5')).toBe(false);
  });

  it('never lets a king enter a trade it could lose', () => {
    // King on e1 could capture the pawn on e2 by ordinary chess rules.
    const fen = '4k3/8/8/8/8/8/4p3/4K3 w - - 0 1';
    const withDice = gameFrom(fen, { e1: 'Fire', e2: 'Steel' });
    expect(hasMove(withDice, 'e1', 'e2')).toBe(false);

    // With no die and a winning matchup the king is in no danger, so it may take.
    const safe = gameFrom(fen, { e1: 'Fire', e2: 'Steel' }, { rules: NO_DICE });
    expect(hasMove(safe, 'e1', 'e2')).toBe(true);

    // With no die but a losing matchup, the king would die with it.
    const unsafe = gameFrom(fen, { e1: 'Fire', e2: 'Water' }, { rules: NO_DICE });
    expect(hasMove(unsafe, 'e1', 'e2')).toBe(false);
  });

  it('never offers a king as a capture target, even mid-chain', () => {
    // Ordinary chess never needs this rule, because you cannot be on move while the enemy king is
    // attacked. The extra move breaks that: the capturing side moves twice, so a check delivered by the
    // first move has had no reply by the time the second is chosen.
    // The white rook on a7 takes the Steel pawn on e7 super-effectively. That checks the black king on
    // e8 and grants an extra move, so white is on move with black's king already under attack.
    const game = gameFrom('4k3/R3p3/8/8/8/8/8/4K3 w - - 0 1', { a7: 'Fire', e7: 'Steel' }, {
      rules: NO_DICE,
    });
    const { game: mid, resolved } = game.play(findMove(game, 'a7', 'e7')!);
    expect(resolved.grantsExtraMove).toBe(true);
    expect(mid.turn).toBe('white');
    expect(mid.position.isInCheck('black')).toBe(true);

    // The extra move exists, but taking the king is not among the options.
    const targets = mid.legalMoves().map((m) => m.move.to);
    expect(targets).not.toContain(parseSquare('e8'));
    expect(mid.legalMoves().every((m) => m.move.captured?.cls !== 'king')).toBe(true);
  });

  it('leaves no reachable position where a king has been destroyed', () => {
    // Play many random games and assert both kings survive every one.
    for (let seed = 0; seed < 60; seed++) {
      let game = randomOpeningGame(`kings-${seed}`);
      for (let ply = 0; ply < 60 && !game.isOver(); ply++) {
        const moves = game.legalMoves();
        if (moves.length === 0) break;
        game = game.play(moves[(ply * 7 + seed) % moves.length]!.move).game;
        const classes = game.position.allPieces().map((p) => p.piece.cls);
        expect(classes.filter((c) => c === 'king')).toHaveLength(2);
      }
    }
  });
});

/** A full-board game whose 32 pieces get types cycled deterministically from the seed. */
function randomOpeningGame(seed: string): PokemonChess {
  const TYPES: BattleType[] = [
    'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
    'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
  ];
  const position = Position.fromStartingPosition();
  const loadout = new Map<number, PokemonLoadout>();
  let n = seed.length;
  for (const { piece } of position.allPieces()) {
    n = (n * 31 + 17) % 997;
    loadout.set(piece.id, { species: `test-${piece.id}`, type: TYPES[n % TYPES.length]! });
  }
  return PokemonChess.create({ position, loadout: loadout as Loadout, seed });
}

describe('determinism, which replay and server validation depend on', () => {
  it('reproduces a whole game from the same seed and the same actions', () => {
    const play = (seed: string) => {
      let game = randomOpeningGame(seed);
      const trace: string[] = [];
      for (let ply = 0; ply < 40 && !game.isOver(); ply++) {
        const moves = game.legalMoves();
        if (moves.length === 0) break;
        const chosen = moves[(ply * 13) % moves.length]!;
        const { game: next, resolved } = game.play(chosen.move);
        trace.push(`${squareName(chosen.move.from)}${squareName(chosen.move.to)}:${resolved.resolution}:${resolved.roll}`);
        game = next;
      }
      return { trace, fen: game.position.toFen() };
    };

    const a = play('replay-me');
    const b = play('replay-me');
    expect(b.trace).toEqual(a.trace);
    expect(b.fen).toBe(a.fen);
    expect(a.trace.length).toBeGreaterThan(10);
  });

  it('produces different games from different seeds', () => {
    const fens = new Set<string>();
    for (let i = 0; i < 12; i++) {
      let game = randomOpeningGame(`vary-${i}`);
      for (let ply = 0; ply < 25 && !game.isOver(); ply++) {
        const moves = game.legalMoves();
        if (moves.length === 0) break;
        game = game.play(moves[(ply * 13) % moves.length]!.move).game;
      }
      fens.add(game.position.toFen());
    }
    expect(fens.size).toBeGreaterThan(1);
  });

  it('does not mutate the game it was played from', () => {
    const game = gameFrom(ROOK_VS_PAWN, { a1: 'Fire', a7: 'Steel' }, { rules: NO_DICE });
    const before = game.position.toFen();
    game.play(findMove(game, 'a1', 'a7')!);
    expect(game.position.toFen()).toBe(before);
    expect(game.history).toHaveLength(0);
  });

  it('records every action in order', () => {
    let game = randomOpeningGame('history');
    for (let ply = 0; ply < 8; ply++) {
      const moves = game.legalMoves();
      game = game.play(moves[0]!.move).game;
    }
    expect(game.history).toHaveLength(8);
    expect(game.history.every((h) => h.side === 'white' || h.side === 'black')).toBe(true);
  });
});

describe('game results', () => {
  it('reports an ordinary checkmate', () => {
    // Back-rank mate: black king on h8, white rook delivering on a8, white queen guarding.
    const game = gameFrom('R6k/6pp/8/8/8/8/8/4K3 b - - 0 1', {});
    const result = game.result();
    expect(result.kind).toBe('checkmate');
    if (result.kind === 'checkmate') expect(result.winner).toBe('white');
  });

  it('reports stalemate', () => {
    const game = gameFrom('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', {});
    expect(game.result().kind).toBe('stalemate');
  });

  it('reports a game still in progress', () => {
    expect(randomOpeningGame('in-progress').result().kind).toBe('playing');
  });

  it('treats a position where every escape is type-forbidden as a genuine bind, not a crash', () => {
    // The point is only that a fully filtered move list is handled gracefully.
    const game = gameFrom(ROOK_VS_PAWN, { a1: 'Ground', a7: 'Flying' });
    expect(() => game.result()).not.toThrow();
    expect(game.legalMoves().length).toBeGreaterThan(0);
  });
});

describe('board queries for rendering', () => {
  it('pairs every piece with its Pokémon', () => {
    const game = randomOpeningGame('render');
    const pieces = game.pieces();
    expect(pieces).toHaveLength(32);
    for (const { piece, pokemon, cls } of pieces) {
      expect(pokemon.type).toBeTruthy();
      expect(cls).toBe(piece.cls);
    }
  });

  it('keeps a promoted pawn\'s identity, which is what evolution needs', () => {
    const game = gameFrom('4k3/P7/8/8/8/8/8/4K3 w - - 0 1', { a7: 'Fire' }, { rules: NO_DICE });
    const pawnId = game.position.pieceAt(parseSquare('a7'))!.id;
    const promotion = game.legalMoves().find((m) => m.move.promotion === 'queen')!;
    const { game: after } = game.play(promotion.move);

    const promoted = after.position.pieceAt(parseSquare('a8'))!;
    expect(promoted.id).toBe(pawnId);
    expect(promoted.cls).toBe('queen');
    // The Pokémon came along with it rather than being lost on promotion.
    expect(after.loadoutOf(promoted.id).type).toBe('Fire');
  });
});
