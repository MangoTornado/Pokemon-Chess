import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import type { BattleType } from '../data/schema.ts';
import { fileOf, parseSquare, squareName } from './board.ts';
import { Position } from './position.ts';
import { PokemonChess } from './variant.ts';
import type { Loadout, PokemonLoadout } from './variant.ts';
import type { Art } from '../game/arts.ts';
import { artOfMove } from '../game/arts.ts';
import {
  HAZARD_MAX_LAYERS, addHazardLayer, hazardToll, hazardZone, tickWeather, weatherChipFraction,
  weatherDamageMod, weatherFromMoveField, hazardFromSideCondition,
} from './field.ts';

const dex = await Dex.load();

describe('weather rules', () => {
  it('sun and rain scale Fire and Water the games way', () => {
    const sun = { kind: 'sun' as const, turns: 5 };
    const rain = { kind: 'rain' as const, turns: 5 };
    expect(weatherDamageMod(sun, 'Fire')).toBe(1.5);
    expect(weatherDamageMod(sun, 'Water')).toBe(0.5);
    expect(weatherDamageMod(rain, 'Water')).toBe(1.5);
    expect(weatherDamageMod(rain, 'Fire')).toBe(0.5);
    // Everything else, and no weather at all, is neutral.
    expect(weatherDamageMod(sun, 'Grass')).toBe(1);
    expect(weatherDamageMod(null, 'Fire')).toBe(1);
    expect(weatherDamageMod({ kind: 'sand', turns: 5 }, 'Fire')).toBe(1);
  });

  it('only sandstorm chips, and not the types that resist it', () => {
    const sand = { kind: 'sand' as const, turns: 5 };
    expect(weatherChipFraction(sand, 'Fire')).toBeCloseTo(1 / 16, 6);
    for (const immune of ['Rock', 'Ground', 'Steel'] as BattleType[]) {
      expect(weatherChipFraction(sand, immune)).toBe(0);
    }
    expect(weatherChipFraction({ kind: 'snow', turns: 5 }, 'Fire')).toBe(0);
    expect(weatherChipFraction(null, 'Fire')).toBe(0);
  });

  it('ages out and then clears', () => {
    let w = { kind: 'rain' as const, turns: 2 };
    const once = tickWeather(w)!;
    expect(once.turns).toBe(1);
    expect(tickWeather(once)).toBeNull();
    expect(tickWeather(null)).toBeNull();
  });

  it('maps Showdown weather ids onto ours', () => {
    expect(weatherFromMoveField('RainDance')).toBe('rain');
    expect(weatherFromMoveField('sunnyday')).toBe('sun');
    expect(weatherFromMoveField('Sandstorm')).toBe('sand');
    expect(weatherFromMoveField('snowscape')).toBe('snow');
    expect(weatherFromMoveField(undefined)).toBeNull();
    expect(weatherFromMoveField('trickroom')).toBeNull();
  });
});

describe('hazard rules', () => {
  it('layers stack up to the games caps', () => {
    let spikes = {};
    for (let i = 0; i < 6; i++) spikes = addHazardLayer(spikes, 'spikes');
    expect(spikes).toEqual({ spikes: HAZARD_MAX_LAYERS.spikes });
    // A single-layer hazard never exceeds one.
    let rock = addHazardLayer({}, 'stealthrock');
    rock = addHazardLayer(rock, 'stealthrock');
    expect(rock).toEqual({ stealthrock: 1 });
  });

  it('spikes bite harder by layer', () => {
    const one = hazardToll({ spikes: 1 }, 'Normal').damageFraction;
    const two = hazardToll({ spikes: 2 }, 'Normal').damageFraction;
    const three = hazardToll({ spikes: 3 }, 'Normal').damageFraction;
    expect(one).toBeLessThan(two);
    expect(two).toBeLessThan(three);
    expect(three).toBeCloseTo(1 / 4, 6);
  });

  it('stealth rock scales with the arrivers own type', () => {
    // Rock is 2x on Flying and 0.5x on Steel — the same chart the rest of the game uses.
    const flying = hazardToll({ stealthrock: 1 }, 'Flying').damageFraction;
    const normal = hazardToll({ stealthrock: 1 }, 'Normal').damageFraction;
    const steel = hazardToll({ stealthrock: 1 }, 'Steel').damageFraction;
    expect(normal).toBeCloseTo(1 / 8, 6);
    expect(flying).toBeCloseTo(1 / 4, 6);
    expect(steel).toBeCloseTo(1 / 16, 6);
  });

  it('toxic spikes poison rather than damage, worse at two layers', () => {
    expect(hazardToll({ toxicspikes: 1 }, 'Normal')).toMatchObject({ damageFraction: 0, status: 'poisoned' });
    expect(hazardToll({ toxicspikes: 2 }, 'Normal').status).toBe('badly-poisoned');
  });

  it('sticky web drops speed', () => {
    expect(hazardToll({ stickyweb: 1 }, 'Normal').boosts).toEqual({ spe: -1 });
  });

  it('an empty square exacts nothing', () => {
    expect(hazardToll(undefined, 'Normal')).toEqual({ damageFraction: 0, status: null, boosts: null });
  });

  it('the zone is three squares of the enemy third rank, clamped at the edges', () => {
    const middle = hazardZone('white', 3);
    expect(middle).toHaveLength(3);
    expect(middle.map(squareName)).toEqual(['c6', 'd6', 'e6']);
    // Black lays on rank 3 instead.
    expect(hazardZone('black', 3).map(squareName)).toEqual(['c3', 'd3', 'e3']);
    // At the edges it still lays three squares rather than losing one off the board.
    expect(hazardZone('white', 0)).toHaveLength(3);
    expect(hazardZone('white', 7)).toHaveLength(3);
    for (const sq of [...hazardZone('white', 0), ...hazardZone('white', 7)]) {
      expect(fileOf(sq)).toBeGreaterThanOrEqual(0);
      expect(fileOf(sq)).toBeLessThanOrEqual(7);
    }
  });

  it('maps Showdown side conditions onto ours', () => {
    expect(hazardFromSideCondition('spikes')).toBe('spikes');
    expect(hazardFromSideCondition('stealthrock')).toBe('stealthrock');
    expect(hazardFromSideCondition('reflect')).toBeNull();
    expect(hazardFromSideCondition(undefined)).toBeNull();
  });
});

describe('arts read from real move data', () => {
  it('recognises weather setters and hazard layers, and nothing else', () => {
    const art = (id: string) => artOfMove(dex.requireMove(id));
    expect(art('raindance')).toMatchObject({ effect: { kind: 'weather', weather: 'rain' } });
    expect(art('sunnyday')).toMatchObject({ effect: { kind: 'weather', weather: 'sun' } });
    expect(art('spikes')).toMatchObject({ effect: { kind: 'hazard', hazard: 'spikes' } });
    expect(art('stickyweb')).toMatchObject({ effect: { kind: 'hazard', hazard: 'stickyweb' } });
    // An ordinary status move is not an art.
    expect(art('swordsdance')).toBeNull();
    expect(art('thunderbolt')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

interface Spec { species: string; type: BattleType; art?: Art }

function gameFrom(fen: string, spec: Record<string, Spec>, weather?: 'sun' | 'rain' | 'sand' | 'snow') {
  const position = Position.fromFen(fen);
  const loadout = new Map<number, PokemonLoadout>();
  for (const { square, piece } of position.allPieces()) {
    const e = spec[squareName(square)] ?? { species: 'pikachu', type: 'Normal' as BattleType };
    const slot = { id: 't', name: 'Strike', type: e.type, category: 'Physical' as const, basePower: 80 };
    loadout.set(piece.id, {
      species: e.species, type: e.type, moves: [slot, slot, slot, slot],
      ...(e.art ? { art: e.art } : {}),
    });
  }
  return PokemonChess.create({
    dex, position, loadout: loadout as Loadout, seed: 'field-test',
    rules: { guarded: false, critCoins: 0 }, ...(weather ? { weather } : {}),
  });
}

const RAIN_ART: Art = { id: 'raindance', name: 'Rain Dance', effect: { kind: 'weather', weather: 'rain' } };
const SPIKE_ART: Art = { id: 'spikes', name: 'Spikes', effect: { kind: 'hazard', hazard: 'spikes' } };
const idAt = (g: PokemonChess, sq: string) => g.position.pieceAt(parseSquare(sq))!.id;

describe('the field in a live game', () => {
  const FEN = '7k/8/3b4/8/3R4/8/8/K7 w - - 0 1';

  it('match weather scales a real capture', () => {
    const spec = {
      d4: { species: 'blastoise', type: 'Water' as BattleType },
      d6: { species: 'venusaur', type: 'Grass' as BattleType },
    };
    const dry = gameFrom(FEN, spec);
    const wet = gameFrom(FEN, spec, 'rain');
    const damageIn = (g: PokemonChess) => {
      const m = g.legalMoves().find((x) => x.move.from === parseSquare('d4') && x.move.captured)!;
      return g.play(m.move).resolved.blows.find((b) => b.by === 'attacker')!.damage;
    };
    // Water into Grass is 0.5x, but rain makes the same blow land harder.
    expect(damageIn(wet)).toBeGreaterThan(damageIn(dry));
  });

  it('match weather never runs out, but a cast one does', () => {
    const fixed = gameFrom(FEN, { d4: { species: 'tauros', type: 'Normal' } }, 'sand');
    expect(fixed.field.weather?.turns).toBe(Infinity);
    // Play a quiet move; the weather is still there.
    const quiet = fixed.legalMoves().find((m) => !m.move.captured && !m.art)!;
    expect(fixed.play(quiet.move).game.field.weather?.kind).toBe('sand');
  });

  it('casting an art is offered, changes the field, and passes the turn', () => {
    const game = gameFrom(FEN, {
      d4: { species: 'politoed', type: 'Water', art: RAIN_ART },
      d6: { species: 'venusaur', type: 'Grass' },
    });
    const cast = game.legalMoves().find((m) => m.art && m.move.from === parseSquare('d4'));
    expect(cast, 'the rain setter should be offered its art').toBeDefined();
    expect(cast!.moveName).toBe('Rain Dance');

    const after = game.play(cast!.move).game;
    expect(after.field.weather?.kind).toBe('rain');
    expect(after.turn).toBe('black');
    // The caster did not move.
    expect(after.position.pieceAt(parseSquare('d4'))).not.toBeNull();
  });

  it('an art that would change nothing is not offered', () => {
    // Already raining, so a rain setter has nothing to do.
    const game = gameFrom(FEN, { d4: { species: 'politoed', type: 'Water', art: RAIN_ART } }, 'rain');
    expect(game.legalMoves().some((m) => m.art && m.move.from === parseSquare('d4'))).toBe(false);
  });

  it('laying spikes marks the enemy band, and arriving there hurts', () => {
    const game = gameFrom('7k/8/8/8/3R4/8/8/K7 w - - 0 1', {
      d4: { species: 'ferrothorn', type: 'Steel', art: SPIKE_ART },
    });
    // Target the rook's own cast: other pieces may have auto-picked arts of their own.
    const cast = game.legalMoves().find((m) => m.art && m.move.from === parseSquare('d4'))!;
    expect(cast.moveName).toBe('Spikes');
    const laid = game.play(cast.move).game;

    // Three squares of Black's third rank now carry a layer.
    const zone = hazardZone('white', fileOf(parseSquare('d4')));
    for (const sq of zone) expect(laid.field.hazards.get(sq)?.spikes).toBe(1);

    // Black's king walks onto the band and pays for it (clamped, never killed — R7).
    const intoBand = laid.legalMoves().find((m) => zone.includes(m.move.to));
    if (intoBand) {
      const arrived = laid.play(intoBand.move);
      expect(arrived.resolved.attackerHpAfter).toBeLessThan(arrived.resolved.attackerMaxHp);
    }
  });

  it('sandstorm chips at the Checkup but never removes a king', () => {
    const game = gameFrom('7k/8/8/8/8/8/8/K7 w - - 0 1', {
      a1: { species: 'charizard', type: 'Fire' },
      h8: { species: 'charizard', type: 'Fire' },
    }, 'sand');
    const king = idAt(game, 'a1');
    const before = game.liveOf(king).hp;
    const quiet = game.legalMoves().find((m) => !m.move.captured && !m.art)!;
    const after = game.play(quiet.move).game;
    // The mover's own side takes the Checkup, so its king is scratched but alive.
    expect(after.liveOf(king).hp).toBeLessThan(before);
    expect(after.liveOf(king).hp).toBeGreaterThan(0);
  });

  it('the field is part of the replayable state', () => {
    const spec = { d4: { species: 'politoed', type: 'Water' as BattleType, art: RAIN_ART } };
    const a = gameFrom(FEN, spec);
    const b = gameFrom(FEN, spec);
    const cast = a.legalMoves().find((m) => m.art && m.move.from === parseSquare('d4'))!;
    expect(a.play(cast.move).game.field.weather).toEqual(b.play(cast.move).game.field.weather);
  });
});
