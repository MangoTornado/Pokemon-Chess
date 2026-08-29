import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import type { BattleType } from '../data/schema.ts';
import { parseSquare, squareName } from './board.ts';
import { Position } from './position.ts';
import { PokemonChess } from './variant.ts';
import type { Loadout, PokemonLoadout } from './variant.ts';
import type { MoveSlot } from '../game/moveset.ts';
import { stageMultiplier } from '../rules/stats.ts';
import {
  MAX_STAGE, MIN_STAGE, applyBoosts, boostsWouldApply, describeStages, hasAnyStage, stageOf,
} from './stages.ts';

const dex = await Dex.load();

describe('stat stage arithmetic', () => {
  it('accumulates and clamps to the games bounds', () => {
    let s = applyBoosts({}, { spe: -1 });
    expect(stageOf(s, 'spe')).toBe(-1);
    s = applyBoosts(s, { spe: -2 });
    expect(stageOf(s, 'spe')).toBe(-3);
    for (let i = 0; i < 10; i++) s = applyBoosts(s, { spe: -1 });
    expect(stageOf(s, 'spe')).toBe(MIN_STAGE);

    let up = applyBoosts({}, { atk: 2 });
    for (let i = 0; i < 10; i++) up = applyBoosts(up, { atk: 2 });
    expect(stageOf(up, 'atk')).toBe(MAX_STAGE);
  });

  it('cancels back to nothing stored', () => {
    const s = applyBoosts(applyBoosts({}, { atk: 1 }), { atk: -1 });
    expect(hasAnyStage(s)).toBe(false);
    expect(stageOf(s, 'atk')).toBe(0);
  });

  it('ignores stats it does not model, rather than storing them', () => {
    const s = applyBoosts({}, { accuracy: -1, evasion: 2 });
    expect(hasAnyStage(s)).toBe(false);
  });

  it('knows when a boost would do nothing because a bound is reached', () => {
    const floored = { spe: MIN_STAGE };
    expect(boostsWouldApply(floored, { spe: -1 })).toBe(false);
    expect(boostsWouldApply(floored, { spe: 1 })).toBe(true);
    expect(boostsWouldApply({}, { accuracy: -1 })).toBe(false);
  });

  it('reads out in a human way', () => {
    expect(describeStages({ spe: -2, atk: 1 })).toBe('Atk +1, Spe −2');
    expect(describeStages({})).toBe('');
    expect(describeStages(undefined)).toBe('');
  });
});

// ---------------------------------------------------------------------------

/** A four-slot moveset of one type, optionally carrying a target debuff or a self cost. */
function movesetWith(type: BattleType, extra: Partial<MoveSlot> = {}) {
  const slot = {
    id: `t-${type}`, name: `${type} Strike`, type, category: 'Physical' as const, basePower: 80, ...extra,
  } as MoveSlot;
  return [slot, slot, slot, slot] as const;
}

interface Spec { species: string; type: BattleType; moves?: readonly MoveSlot[] }

function gameFrom(fen: string, spec: Record<string, Spec>): PokemonChess {
  const position = Position.fromFen(fen);
  const loadout = new Map<number, PokemonLoadout>();
  for (const { square, piece } of position.allPieces()) {
    const e = spec[squareName(square)] ?? { species: 'pikachu', type: 'Normal' as BattleType };
    loadout.set(piece.id, {
      species: e.species,
      type: e.type,
      moves: (e.moves ?? movesetWith(e.type)) as NonNullable<PokemonLoadout['moves']>,
    });
  }
  return PokemonChess.create({
    dex, position, loadout: loadout as Loadout, seed: 'stage-test', rules: { guarded: false, critCoins: 0 },
  });
}

// A rook on d4 attacking a bishop on d6, kings tucked away.
const FEN = '7k/8/3b4/8/3R4/8/8/K7 w - - 0 1';
const idAt = (g: PokemonChess, sq: string) => g.position.pieceAt(parseSquare(sq))!.id;

describe('stat stages in a live game', () => {
  it('a Speed drop lands on a surviving defender and lowers its effective Speed', () => {
    // Normal into Steel is 0.5×, so the defender survives to carry the debuff.
    const game = gameFrom(FEN, {
      d4: { species: 'tauros', type: 'Normal', moves: movesetWith('Normal', { targetBoosts: { boosts: { spe: -1 }, chance: 100 } }) },
      d6: { species: 'skarmory', type: 'Steel' },
    });
    const defender = idAt(game, 'd6');
    const speedBefore = game.effectiveSpeed(defender);

    const attack = game.legalMoves().find((m) => m.move.from === parseSquare('d4') && m.move.captured)!;
    const { game: after, resolved } = game.play(attack.move);

    expect(resolved.defenderHpAfter).toBeGreaterThan(0);
    expect(resolved.boostsInflicted).toEqual({ spe: -1 });
    expect(after.stagesOf(defender)).toEqual({ spe: -1 });
    expect(after.effectiveSpeed(defender)).toBeLessThan(speedBefore);
    // And it matches the canonical stage table rather than an invented number.
    expect(after.effectiveSpeed(defender)).toBe(
      Math.max(1, Math.round(after.statsOf(defender).spe * stageMultiplier(-1))),
    );
  });

  it('a Speed drop can flip who swings first', () => {
    // Two pieces of near-identical Speed; the attacker is slightly slower, so it swings second — until it
    // has dropped the defender's Speed below its own.
    const build = () => gameFrom(FEN, {
      d4: { species: 'tauros', type: 'Normal', moves: movesetWith('Normal', { targetBoosts: { boosts: { spe: -6 }, chance: 100 } }) },
      d6: { species: 'skarmory', type: 'Steel' },
    });
    const fresh = build();
    const atk = idAt(fresh, 'd4');
    const def = idAt(fresh, 'd6');

    const attack = fresh.legalMoves().find((m) => m.move.from === parseSquare('d4') && m.move.captured)!;
    const after = fresh.play(attack.move).game;

    // The debuff is severe enough that the defender is now decisively slower than the attacker.
    expect(after.effectiveSpeed(def)).toBeLessThan(after.effectiveSpeed(atk));
    expect(fresh.effectiveSpeed(def)).toBeGreaterThan(after.effectiveSpeed(def));
  });

  it("a move's self-cost applies to the surviving attacker", () => {
    const game = gameFrom(FEN, {
      d4: { species: 'machamp', type: 'Fighting', moves: movesetWith('Fighting', { selfBoosts: { def: -1, spd: -1 } }) },
      d6: { species: 'skarmory', type: 'Steel' },
    });
    const attacker = idAt(game, 'd4');
    const attack = game.legalMoves().find((m) => m.move.from === parseSquare('d4') && m.move.captured)!;
    const after = game.play(attack.move).game;
    expect(after.stagesOf(attacker)).toEqual({ def: -1, spd: -1 });
  });

  it('a debuff does not stick to a defender that fell', () => {
    // Fighting into Rock is 2× against a frail defender, so it dies — nothing to debuff.
    const game = gameFrom(FEN, {
      d4: { species: 'machamp', type: 'Fighting', moves: movesetWith('Fighting', { targetBoosts: { boosts: { spe: -1 }, chance: 100 } }) },
      d6: { species: 'geodude', type: 'Rock' },
    });
    const attack = game.legalMoves().find((m) => m.move.from === parseSquare('d4') && m.move.captured)!;
    const { game: after, resolved } = game.play(attack.move);
    expect(resolved.defenderHpAfter).toBe(0);
    expect(resolved.boostsInflicted).toBeNull();
    // The fallen piece's stages are cleared with it.
    expect(after.stagesOf(idAt(game, 'd6'))).toEqual({});
  });

  it('a lowered Defence means more damage taken next time', () => {
    const spec = {
      d4: { species: 'tauros', type: 'Normal' as BattleType, moves: movesetWith('Normal', { targetBoosts: { boosts: { def: -2 }, chance: 100 } }) },
      d6: { species: 'skarmory', type: 'Steel' as BattleType },
    };
    const game = gameFrom(FEN, spec);
    const first = game.legalMoves().find((m) => m.move.from === parseSquare('d4') && m.move.captured)!;
    const damageFirst = game.play(first.move).resolved.blows.find((b) => b.by === 'attacker')!.damage;
    const after = game.play(first.move).game;

    // Same attacker, same target, now at −2 Defence: the identical blow must hurt more.
    expect(after.stagesOf(idAt(game, 'd6'))).toEqual({ def: -2 });
    const second = after.legalMoves().find((m) => m.move.captured && m.move.to === parseSquare('d6'));
    if (second) {
      const damageSecond = after.play(second.move).resolved.blows.find((b) => b.by === 'attacker')!.damage;
      expect(damageSecond).toBeGreaterThan(damageFirst);
    }
  });

  it('stages are part of the replayable state, so a game is still seed + actions', () => {
    const spec = {
      d4: { species: 'tauros', type: 'Normal' as BattleType, moves: movesetWith('Normal', { targetBoosts: { boosts: { spe: -1 }, chance: 100 } }) },
      d6: { species: 'skarmory', type: 'Steel' as BattleType },
    };
    const a = gameFrom(FEN, spec);
    const b = gameFrom(FEN, spec);
    const move = a.legalMoves().find((m) => m.move.captured)!;
    expect(a.play(move.move).game.stagesOf(idAt(a, 'd6')))
      .toEqual(b.play(move.move).game.stagesOf(idAt(b, 'd6')));
  });
});
