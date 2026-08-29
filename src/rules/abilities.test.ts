import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import type { BattleType } from '../data/schema.ts';
import { parseSquare, squareName } from '../engine/board.ts';
import { Position } from '../engine/position.ts';
import { PokemonChess } from '../engine/variant.ts';
import type { Loadout, PokemonLoadout } from '../engine/variant.ts';
import { autodraft } from '../game/autodraft.ts';
import { ABILITY_IMMUNE_TYPE, WONDER_GUARD, abilityGrantsImmunity } from './abilities.ts';

const dex = await Dex.load();

interface Spec {
  species: string;
  type: BattleType;
  ability?: string;
}

/** A single-type four-slot moveset, so a matchup is exactly the declared-type matchup (no coverage escape). */
function monoMoveset(type: BattleType) {
  const slot = { id: `t-${type}`, name: `${type} Strike`, type, category: 'Physical' as const, basePower: 80 };
  return [slot, slot, slot, slot] as const;
}

function gameFrom(fen: string, spec: Record<string, Spec>): PokemonChess {
  const position = Position.fromFen(fen);
  const loadout = new Map<number, PokemonLoadout>();
  for (const { square, piece } of position.allPieces()) {
    const entry = spec[squareName(square)] ?? { species: 'pikachu', type: 'Normal' as BattleType };
    loadout.set(piece.id, {
      species: entry.species,
      type: entry.type,
      moves: monoMoveset(entry.type),
      ...(entry.ability ? { ability: entry.ability } : {}),
    });
  }
  return PokemonChess.create({
    dex, position, loadout: loadout as Loadout, seed: 'ability-test', rules: { guarded: false },
  });
}

/** Whether the attacker on `from` is offered a capture of the piece on `to`. */
function offersCapture(game: PokemonChess, from: string, to: string): boolean {
  return game.legalMoves().some((m) => m.move.from === parseSquare(from) && m.move.to === parseSquare(to) && m.move.captured);
}

function idAt(game: PokemonChess, square: string): number {
  return game.position.pieceAt(parseSquare(square))!.id;
}

// A Ground rook on d4 and a defender on d6, both sides' kings tucked away.
const FEN = '7k/8/3b4/8/3R4/8/8/K7 w - - 0 1';

describe('ability-granted type immunities', () => {
  it('the table maps each ability to a single attacking type', () => {
    for (const [ability, type] of Object.entries(ABILITY_IMMUNE_TYPE)) {
      expect(abilityGrantsImmunity(ability, type)).toBe(true);
      // It does not blanket-block a different type.
      expect(abilityGrantsImmunity(ability, type === 'Ground' ? 'Water' : 'Ground')).toBe(false);
    }
    expect(abilityGrantsImmunity(undefined, 'Ground')).toBe(false);
  });

  it('Levitate makes a defender untouchable by Ground', () => {
    const withAbility = gameFrom(FEN, {
      d4: { species: 'golem', type: 'Ground' },
      d6: { species: 'bronzong', type: 'Steel', ability: 'levitate' },
    });
    // Ground → Steel is 2×, so without Levitate this is a juicy capture.
    const without = gameFrom(FEN, {
      d4: { species: 'golem', type: 'Ground' },
      d6: { species: 'bronzong', type: 'Steel' },
    });
    expect(offersCapture(without, 'd4', 'd6')).toBe(true);
    expect(offersCapture(withAbility, 'd4', 'd6')).toBe(false);
    expect(withAbility.bestSlotAgainst(idAt(withAbility, 'd4'), idAt(withAbility, 'd6'))).toBeNull();
  });

  it('names the ability in the refusal reason', () => {
    const game = gameFrom(FEN, {
      d4: { species: 'golem', type: 'Ground' },
      d6: { species: 'bronzong', type: 'Steel', ability: 'levitate' },
    });
    const reason = game.blockedReason(idAt(game, 'd4'), idAt(game, 'd6'));
    expect(reason).toContain('Levitate');
    expect(reason).toContain('Ground');
  });

  it('Volt Absorb blocks Electric but not other types', () => {
    const vsElectric = gameFrom(FEN, {
      d4: { species: 'zapdos', type: 'Electric' },
      d6: { species: 'jolteon', type: 'Electric', ability: 'voltabsorb' },
    });
    expect(offersCapture(vsElectric, 'd4', 'd6')).toBe(false);

    const vsGround = gameFrom(FEN, {
      d4: { species: 'golem', type: 'Ground' },
      d6: { species: 'jolteon', type: 'Electric', ability: 'voltabsorb' },
    });
    // Ground → Electric is 2× and Volt Absorb does not stop it.
    expect(offersCapture(vsGround, 'd4', 'd6')).toBe(true);
  });

  it('Wonder Guard admits only super-effective hits', () => {
    // Shedinja is Bug/Ghost; declared Ghost here. Normal → Ghost is already 0, so use Water (neutral vs
    // Ghost) for the blocked case and Dark (2× vs Ghost) for the allowed one.
    const neutral = gameFrom(FEN, {
      d4: { species: 'vaporeon', type: 'Water' },
      d6: { species: 'shedinja', type: 'Ghost', ability: WONDER_GUARD },
    });
    expect(offersCapture(neutral, 'd4', 'd6')).toBe(false);
    expect(neutral.blockedReason(idAt(neutral, 'd4'), idAt(neutral, 'd6'))).toContain('Wonder Guard');

    const superEffective = gameFrom(FEN, {
      d4: { species: 'umbreon', type: 'Dark' },
      d6: { species: 'shedinja', type: 'Ghost', ability: WONDER_GUARD },
    });
    expect(offersCapture(superEffective, 'd4', 'd6')).toBe(true);
  });

  it('a king is never immune, even with an immunity ability (R6)', () => {
    // Black king on d6 with Levitate, attacked by a Ground rook.
    const game = gameFrom('8/8/3k4/8/3R4/8/8/K7 w - - 0 1', {
      d4: { species: 'golem', type: 'Ground' },
      d6: { species: 'bronzong', type: 'Steel', ability: 'levitate' },
    });
    expect(offersCapture(game, 'd4', 'd6')).toBe(true);
    expect(game.blockedReason(idAt(game, 'd4'), idAt(game, 'd6'))).toBeNull();
  });

  it('an attacker\'s own ability does not shield it while attacking', () => {
    // The Ground attacker itself has Levitate; that must not stop it hitting a Steel defender.
    const game = gameFrom(FEN, {
      d4: { species: 'flygon', type: 'Ground', ability: 'levitate' },
      d6: { species: 'skarmory', type: 'Steel' },
    });
    expect(offersCapture(game, 'd4', 'd6')).toBe(true);
  });

  it('blockedReason returns null when the capture is legal', () => {
    const game = gameFrom(FEN, {
      d4: { species: 'golem', type: 'Ground' },
      d6: { species: 'skarmory', type: 'Steel' },
    });
    expect(game.blockedReason(idAt(game, 'd4'), idAt(game, 'd6'))).toBeNull();
  });

  it('drafted armies carry a real ability from their species', () => {
    // The autodraft assigns each piece its species' first ability; spot-check the shape holds.
    const drafted = autodraft(dex, 'ability-draft');
    let withAbility = 0;
    for (const [, entry] of drafted.loadout) {
      if (entry.ability) {
        withAbility += 1;
        const species = dex.requireSpecies(entry.species);
        expect(species.abilities).toContain(entry.ability);
      }
    }
    expect(withAbility).toBeGreaterThan(24); // nearly every species has at least one ability
  });
});
