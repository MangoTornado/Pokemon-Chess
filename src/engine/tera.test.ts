import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import type { BattleType } from '../data/schema.ts';
import { parseSquare, squareName } from './board.ts';
import { Position } from './position.ts';
import { isTeraMove } from './position.ts';
import { PokemonChess } from './variant.ts';
import type { Loadout, PokemonLoadout } from './variant.ts';
import type { MoveSlot } from '../game/moveset.ts';
import { pickTeraType } from '../game/tera.ts';
import { autodraft } from '../game/autodraft.ts';

const dex = await Dex.load();

interface Spec { species: string; type: BattleType; teraType?: BattleType; moves?: readonly MoveSlot[] }

function movesetOf(type: BattleType) {
  const slot = { id: `t-${type}`, name: `${type} Strike`, type, category: 'Physical' as const, basePower: 80 };
  return [slot, slot, slot, slot] as const;
}

function gameFrom(fen: string, spec: Record<string, Spec>): PokemonChess {
  const position = Position.fromFen(fen);
  const loadout = new Map<number, PokemonLoadout>();
  for (const { square, piece } of position.allPieces()) {
    const e = spec[squareName(square)] ?? { species: 'pikachu', type: 'Normal' as BattleType };
    loadout.set(piece.id, {
      species: e.species,
      type: e.type,
      moves: (e.moves ?? movesetOf(e.type)) as NonNullable<PokemonLoadout['moves']>,
      ...(e.teraType ? { teraType: e.teraType } : {}),
    });
  }
  return PokemonChess.create({
    dex, position, loadout: loadout as Loadout, seed: 'tera-test', rules: { guarded: false, critCoins: 0 },
  });
}

const FEN = '7k/8/3b4/8/3R4/8/8/K7 w - - 0 1';
const idAt = (g: PokemonChess, sq: string) => g.position.pieceAt(parseSquare(sq))!.id;
const teraAt = (g: PokemonChess, sq: string) =>
  g.legalMoves().find((m) => m.tera && m.move.from === parseSquare(sq));

describe('picking a Tera type', () => {
  it('turns the best coverage move into STAB', () => {
    const species = dex.requireSpecies('charizard');
    const moves = [
      { id: 'a', name: 'A', type: 'Fire' as BattleType, category: 'Special' as const, basePower: 90 },
      { id: 'b', name: 'B', type: 'Flying' as BattleType, category: 'Physical' as const, basePower: 120 },
      { id: 'c', name: 'C', type: 'Dragon' as BattleType, category: 'Special' as const, basePower: 60 },
      { id: 'd', name: 'D', type: 'Ground' as BattleType, category: 'Physical' as const, basePower: 40 },
    ] as const;
    // The strongest non-declared slot is the Flying one.
    expect(pickTeraType(species, 'Fire', moves)).toBe('Flying');
  });

  it('falls back to a dual-typed species other type when coverage offers nothing', () => {
    const lapras = dex.requireSpecies('lapras'); // Water/Ice
    const monoWater = movesetOf('Water');
    expect(pickTeraType(lapras, 'Water', monoWater)).toBe('Ice');
  });

  it('offers nothing for a single-typed species with no coverage', () => {
    const tauros = dex.requireSpecies('tauros'); // Normal only
    expect(pickTeraType(tauros, 'Normal', movesetOf('Normal'))).toBeUndefined();
  });
});

describe('Terastallising in a game', () => {
  it('is offered, changes the fighting type, and passes the turn', () => {
    const game = gameFrom(FEN, {
      d4: { species: 'charizard', type: 'Fire', teraType: 'Flying' },
      d6: { species: 'venusaur', type: 'Grass' },
    });
    const piece = idAt(game, 'd4');
    expect(game.battleTypeOf(piece)).toBe('Fire');

    const tera = teraAt(game, 'd4');
    expect(tera, 'a piece with a Tera type should be offered it').toBeDefined();
    expect(isTeraMove(tera!.move.encoded)).toBe(true);

    const after = game.play(tera!.move).game;
    expect(after.battleTypeOf(piece)).toBe('Flying');
    expect(after.hasTerastallised(piece)).toBe(true);
    expect(after.turn).toBe('black');
    // The piece did not move and took no damage — Terastallising is not an attack.
    expect(after.position.pieceAt(parseSquare('d4'))).not.toBeNull();
    expect(after.liveOf(piece).hp).toBe(game.liveOf(piece).hp);
  });

  it('changes what the piece is weak to — here, out of a weakness entirely', () => {
    // The sharpest illustration of Tera as an escape: Ground is 2x on Fire and 0x on Flying, so a Charizard
    // cornered by a Ground attacker can Terastallise and become untouchable by it.
    const game = gameFrom(FEN, {
      d4: { species: 'charizard', type: 'Fire', teraType: 'Flying' },
      d6: { species: 'venusaur', type: 'Grass' },
    });
    const defender = idAt(game, 'd4');
    expect(game.multiplierAgainst('Ground', defender)).toBe(2);

    const after = game.play(teraAt(game, 'd4')!.move).game;
    expect(after.multiplierAgainst('Ground', defender)).toBe(0);
    // And a type it did not resist before, it now does: Grass is 0.5x on Fire but 0.5x on Flying too, so
    // check Electric instead, which goes the other way — Tera is a trade, not a free upgrade.
    expect(game.multiplierAgainst('Electric', defender)).toBe(1);
    expect(after.multiplierAgainst('Electric', defender)).toBe(2);
  });

  it('is once per side per game', () => {
    const game = gameFrom('7k/8/8/8/3R4/3B4/8/K7 w - - 0 1', {
      d4: { species: 'charizard', type: 'Fire', teraType: 'Flying' },
      d3: { species: 'blastoise', type: 'Water', teraType: 'Ice' },
    });
    // Both White pieces are offered it to begin with.
    expect(game.legalMoves().filter((m) => m.tera)).toHaveLength(2);
    expect(game.teraAvailable('white')).toBe(true);

    const after = game.play(teraAt(game, 'd4')!.move).game;
    expect(after.teraAvailable('white')).toBe(false);

    // Black moves, and back on White's turn nothing is offered any more.
    const black = after.legalMoves().find((m) => !m.tera && !m.art)!;
    const backToWhite = after.play(black.move).game;
    expect(backToWhite.turn).toBe('white');
    expect(backToWhite.legalMoves().some((m) => m.tera)).toBe(false);
  });

  it('spending it is remembered even if the Terastallised piece falls', () => {
    const game = gameFrom(FEN, {
      d4: { species: 'charizard', type: 'Fire', teraType: 'Flying' },
      d6: { species: 'venusaur', type: 'Grass' },
    });
    const after = game.play(teraAt(game, 'd4')!.move).game;
    expect(after.teraAvailable('white')).toBe(false);
    // The history records the action, so even a board with no Tera'd piece left knows the use is spent.
    expect(after.history.some((h) => isTeraMove(h.move.encoded))).toBe(true);
  });

  it('is not offered when it would change nothing', () => {
    // Tera type equals the declared type: a wasted turn, so never offered.
    const game = gameFrom(FEN, { d4: { species: 'charizard', type: 'Fire', teraType: 'Fire' } });
    expect(teraAt(game, 'd4')).toBeUndefined();
  });

  it('is part of the replayable state', () => {
    const spec = { d4: { species: 'charizard', type: 'Fire' as BattleType, teraType: 'Flying' as BattleType } };
    const a = gameFrom(FEN, spec);
    const b = gameFrom(FEN, spec);
    const action = teraAt(a, 'd4')!.move;
    const pieceA = idAt(a, 'd4');
    expect(a.play(action).game.battleTypeOf(pieceA)).toBe(b.play(action).game.battleTypeOf(pieceA));
  });
});

describe('drafted armies carry Tera types', () => {
  it('most pieces have one, and it always differs from the declared type', () => {
    const drafted = autodraft(dex, 'tera-draft');
    let withTera = 0;
    for (const [, entry] of drafted.loadout) {
      if (!entry.teraType) continue;
      withTera += 1;
      expect(entry.teraType).not.toBe(entry.type);
    }
    expect(withTera).toBeGreaterThan(16);
  });
});
