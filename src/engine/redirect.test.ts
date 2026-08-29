/**
 * Redirection — a third piece answering an attack aimed at its neighbour.
 *
 * The two things worth proving are the two halves of the mechanic, and they behave differently on purpose: a
 * drawn attack is absorbed and costs the attacker its turn for nothing, while a guarded one is a real Clash
 * against a piece the attacker never chose to fight. The board consequence is the same in both cases and is
 * the point of the whole mechanic — the attacker gains no ground, because the square it went for was never
 * actually contested.
 */

import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import type { BattleType } from '../data/schema.ts';
import { parseSquare, squareName } from './board.ts';
import { Position } from './position.ts';
import { isArtMove } from './position.ts';
import { PokemonChess } from './variant.ts';
import type { Loadout, PokemonLoadout } from './variant.ts';
import type { MoveSlot } from '../game/moveset.ts';
import { artOfMove } from '../game/arts.ts';
import { ABILITY_DRAWS_TYPE, GUARD_VOLATILES, abilityDraws, guardFromVolatile } from '../rules/redirect.ts';

const dex = await Dex.load();

interface Spec {
  species: string;
  type: BattleType;
  ability?: string;
  moves?: readonly MoveSlot[];
  art?: PokemonLoadout['art'];
}

/** A four-slot moveset that is entirely one type, so the attacker's move type is never in doubt. */
function movesetOf(type: BattleType, basePower = 80): readonly MoveSlot[] {
  const slot = { id: `r-${type}`, name: `${type} Strike`, type, category: 'Physical' as const, basePower };
  return [slot, slot, slot, slot];
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
      ...(e.ability ? { ability: e.ability } : {}),
      ...(e.art ? { art: e.art } : {}),
    });
  }
  return PokemonChess.create({
    dex, position, loadout: loadout as Loadout, seed: 'redirect-test', rules: { guarded: false, critCoins: 0 },
  });
}

const idAt = (g: PokemonChess, sq: string) => g.position.pieceAt(parseSquare(sq))!.id;
const at = (g: PokemonChess, sq: string) => g.position.pieceAt(parseSquare(sq));

/** Plays the (only) capture of d6 by the rook on d4. */
function attackD6(g: PokemonChess) {
  const move = g.legalMoves().find((m) => m.move.from === parseSquare('d4') && m.move.to === parseSquare('d6'));
  expect(move, 'the rook should be able to attack d6').toBeDefined();
  return g.play(move!.move);
}

// A white rook on d4 attacking a black bishop on d6, with a black knight on e6 — one of the squares a black
// neighbour can intercept from. Kings are tucked away so nothing else is legal or in the line of fire.
const NEIGHBOUR_FEN = '7k/8/3bn3/8/3R4/8/8/K7 w - - 0 1';

describe('the data behind redirection', () => {
  it('reads the drawing abilities off their own text, and only those two', () => {
    for (const [id, type] of Object.entries(ABILITY_DRAWS_TYPE)) {
      const ability = dex.getAbility(id);
      expect(ability, `${id} should be a real ability`).toBeDefined();
      // The games' own wording is "draws <Type> moves to itself".
      expect(ability!.shortDesc).toContain('draws');
      expect(ability!.shortDesc).toContain(type);
    }
    // Immunity is not drawing: eleven abilities grant a type immunity, only these two pull a neighbour's hit.
    expect(abilityDraws('levitate')).toBeNull();
    expect(abilityDraws('voltabsorb')).toBeNull();
    expect(abilityDraws(undefined)).toBeNull();
    expect(abilityDraws('lightningrod')).toBe('Electric');
  });

  it('recognises the guard moves as arts off their real volatiles', () => {
    for (const id of GUARD_VOLATILES) {
      const move = dex.getMove(id);
      expect(move, `${id} should be a real move`).toBeDefined();
      expect(move!.category).toBe('Status');
      expect(guardFromVolatile(move!.volatileStatus)).toBe(true);
      expect(artOfMove(move!)).toMatchObject({ effect: { kind: 'guard' } });
    }
    expect(guardFromVolatile('substitute')).toBe(false);
    expect(guardFromVolatile(undefined)).toBe(false);
  });
});

describe('a drawn attack', () => {
  /** Black keeps a Lightning Rod piece next to the bishop; White attacks with Electric. */
  const drawn = () =>
    gameFrom(NEIGHBOUR_FEN, {
      d4: { species: 'raichu', type: 'Electric' },
      d6: { species: 'gyarados', type: 'Water' },
      e6: { species: 'seaking', type: 'Water', ability: 'lightningrod' },
    });

  it('is absorbed: nobody is hurt and nobody moves', () => {
    const g = drawn();
    const bishopHp = g.liveOf(idAt(g, 'd6')).hp;
    const drawerHp = g.liveOf(idAt(g, 'e6')).hp;
    const rookHp = g.liveOf(idAt(g, 'd4')).hp;

    const { game, resolved } = attackD6(g);
    expect(resolved.verdict).toBe('blocked');
    expect(resolved.blows).toHaveLength(0);
    expect(resolved.removed).toEqual([]);

    // Every piece is where it was, at the HP it was.
    expect(at(game, 'd4')).not.toBeNull();
    expect(at(game, 'd6')).not.toBeNull();
    expect(game.liveOf(idAt(game, 'd6')).hp).toBe(bishopHp);
    expect(game.liveOf(idAt(game, 'e6')).hp).toBe(drawerHp);
    expect(game.liveOf(idAt(game, 'd4')).hp).toBe(rookHp);
  });

  it('names the piece that drew it, so the board can explain what happened', () => {
    const g = drawn();
    const drawerId = idAt(g, 'e6');
    const { resolved } = attackD6(g);
    expect(resolved.intercepted).toMatchObject({
      pieceId: drawerId, square: parseSquare('e6'), kind: 'draw', ability: 'lightningrod',
    });
    // The report carries what the hit was *meant* for; the defender fields describe who actually took it.
    expect(resolved.intercepted!.insteadOf.species).toBe('gyarados');
    expect(resolved.defender!.species).toBe('seaking');
  });

  it('raises the drawer’s Sp. Atk, which is the reward the ability actually gives', () => {
    const g = drawn();
    const { game } = attackD6(g);
    expect(game.stagesOf(idAt(game, 'e6')).spa).toBe(1);
  });

  it('costs the attacker its turn', () => {
    const g = drawn();
    expect(g.turn).toBe('white');
    const { game } = attackD6(g);
    expect(game.turn).toBe('black');
  });

  it('only draws the type it actually draws', () => {
    // The same Storm Drain neighbour against a Fire attacker draws nothing, and the bishop fights for itself.
    const g = gameFrom(NEIGHBOUR_FEN, {
      d4: { species: 'charizard', type: 'Fire' },
      d6: { species: 'gyarados', type: 'Water' },
      e6: { species: 'gastrodon', type: 'Water', ability: 'stormdrain' },
    });
    const { resolved } = attackD6(g);
    expect(resolved.verdict).not.toBe('blocked');
    expect(resolved.intercepted).toBeUndefined();
  });

  it('does not fire from a piece that is not adjacent to the target', () => {
    // The drawer sits on a8 — far from d6 — so nothing is intercepted.
    const g = gameFrom('n6k/8/3b4/8/3R4/8/8/K7 w - - 0 1', {
      d4: { species: 'raichu', type: 'Electric' },
      d6: { species: 'gyarados', type: 'Water' },
      a8: { species: 'seaking', type: 'Water', ability: 'lightningrod' },
    });
    const { resolved } = attackD6(g);
    expect(resolved.intercepted).toBeUndefined();
  });

  it('is never drawn by the attacker’s own side', () => {
    // A White Lightning Rod piece next to the Black bishop must not absorb White's own attack.
    const g = gameFrom('7k/8/3b4/4N3/3R4/8/8/K7 w - - 0 1', {
      d4: { species: 'raichu', type: 'Electric' },
      d6: { species: 'gyarados', type: 'Water' },
      e5: { species: 'seaking', type: 'Water', ability: 'lightningrod' },
    });
    const { resolved } = attackD6(g);
    expect(resolved.intercepted).toBeUndefined();
  });
});

describe('a cast guard', () => {
  const FOLLOW_ME = artOfMove(dex.requireMove('followme'))!;

  /** Black's knight on e6 holds Follow Me; it casts, then White attacks the bishop on d6. */
  function guarding() {
    // Black moves first so the guard is already standing when White attacks.
    const g = gameFrom('7k/8/3bn3/8/3R4/8/8/K7 b - - 0 1', {
      d4: { species: 'raichu', type: 'Normal' },
      d6: { species: 'gyarados', type: 'Water' },
      e6: { species: 'togekiss', type: 'Fairy', art: FOLLOW_ME },
    });
    const cast = g.legalMoves().find((m) => m.art && m.move.from === parseSquare('e6'));
    expect(cast, 'the knight should be able to cast Follow Me').toBeDefined();
    expect(isArtMove(cast!.move.encoded)).toBe(true);
    return g.play(cast!.move).game;
  }

  it('makes the guard the one that fights, not the piece that was attacked', () => {
    const g = guarding();
    expect(g.guardTurnsLeft(idAt(g, 'e6'))).toBe(1);
    const bishopHp = g.liveOf(idAt(g, 'd6')).hp;

    const { game, resolved } = attackD6(g);
    expect(resolved.intercepted).toMatchObject({ kind: 'guard', square: parseSquare('e6') });
    expect(resolved.blows.length).toBeGreaterThan(0);
    // Every defender* number describes the guard, so the card cannot show one piece's name beside another's HP.
    expect(resolved.defender!.species).toBe('togekiss');
    expect(resolved.intercepted!.insteadOf.species).toBe('gyarados');
    // The piece actually attacked never takes a scratch.
    expect(game.liveOf(idAt(game, 'd6')).hp).toBe(bishopHp);
  });

  it('never lets the attacker take the square, however well the exchange goes', () => {
    const g = guarding();
    const { game, resolved } = attackD6(g);
    // Whatever the verdict, the rook is still on d4 and the bishop still on d6.
    expect(at(game, 'd4')?.cls, `verdict was ${resolved.verdict}`).toBe('rook');
    expect(at(game, 'd6')?.cls).toBe('bishop');
  });

  it('lapses after the enemy turn it was cast to cover', () => {
    const g = guarding();
    const guardId = idAt(g, 'e6');
    expect(g.guardTurnsLeft(guardId)).toBe(1);

    // White replies with something harmless; the guard has now done its job.
    const quiet = g.legalMoves().find((m) => !m.move.captured && !m.art && !m.tera)!;
    const after = g.play(quiet.move).game;
    expect(after.guardTurnsLeft(guardId)).toBe(0);
  });

  it('a guard is spent on the attack it answers, so the same cast cannot cover two turns', () => {
    const g = guarding();
    const guardId = idAt(g, 'e6');
    const { game } = attackD6(g);
    // White's turn ended, which is the turn the guard covered.
    expect(game.guardTurnsLeft(guardId)).toBe(0);
  });

  it('yields to a drawing ability, which is the more specific claim', () => {
    // Both a guard (e6) and a drawer (c6) neighbour the bishop; an Electric attack goes to the drawer, and is
    // absorbed rather than fought.
    const g = gameFrom('7k/8/2nbn3/8/3R4/8/8/K7 b - - 0 1', {
      d4: { species: 'raichu', type: 'Electric' },
      d6: { species: 'gyarados', type: 'Water' },
      e6: { species: 'togekiss', type: 'Fairy', art: FOLLOW_ME },
      c6: { species: 'seaking', type: 'Water', ability: 'lightningrod' },
    });
    const cast = g.legalMoves().find((m) => m.art && m.move.from === parseSquare('e6'))!;
    const standing = g.play(cast.move).game;

    const { resolved } = attackD6(standing);
    expect(resolved.verdict).toBe('blocked');
    expect(resolved.intercepted).toMatchObject({ kind: 'draw', square: parseSquare('c6') });
  });

  it('is forecast against the piece that will actually fight, not the one aimed at', () => {
    // The board's contract is that a square says beforehand what it does. A guarded square that previewed the
    // target's own matchup would promise an outcome the engine then refuses to deliver.
    const g = guarding();
    const attack = g.legalMoves()
      .find((m) => m.move.from === parseSquare('d4') && m.move.to === parseSquare('d6'))!;
    const { resolved } = attackD6(g);
    expect(attack.forecast).toBe(resolved.verdict);
  });

  it('a drawn attack is forecast as blocked, so it is never played by mistake', () => {
    const g = gameFrom(NEIGHBOUR_FEN, {
      d4: { species: 'raichu', type: 'Electric' },
      d6: { species: 'gyarados', type: 'Water' },
      e6: { species: 'seaking', type: 'Water', ability: 'lightningrod' },
    });
    const attack = g.legalMoves()
      .find((m) => m.move.from === parseSquare('d4') && m.move.to === parseSquare('d6'))!;
    expect(attack.forecast).toBe('blocked');
  });

  it('blames the drawer, not the target, when it refuses the attack', () => {
    // The refusal affordance sends a player looking for the reason. A drawn attack is refused by a neighbour,
    // so pointing at the target's own typing would send them to the wrong square.
    const g = gameFrom(NEIGHBOUR_FEN, {
      d4: { species: 'raichu', type: 'Electric' },
      d6: { species: 'gyarados', type: 'Water' },
      e6: { species: 'seaking', type: 'Water', ability: 'lightningrod' },
    });
    const reason = g.blockedReason(idAt(g, 'd4'), idAt(g, 'd6'));
    expect(reason).toContain('Seaking');
    expect(reason).toContain('e6');
    expect(reason).toContain('Lightning Rod');
  });

  it('can rout an attacker that never attacked it', () => {
    // A frail attacker into a heavy guard: the guard survives and the attacker falls, from an exchange the
    // attacker never chose. That is the risk redirection is meant to create.
    //
    // Shedinja is the attacker because its 1 HP is a real fact of the games and makes the outcome certain
    // whichever way the Speed order falls — a merely weak attacker survives one counter and repels instead.
    const g = gameFrom('7k/8/3bn3/8/3R4/8/8/K7 b - - 0 1', {
      d4: { species: 'shedinja', type: 'Bug', moves: movesetOf('Bug', 10) },
      d6: { species: 'gyarados', type: 'Water' },
      e6: { species: 'groudon', type: 'Ground', art: FOLLOW_ME, moves: movesetOf('Ground', 150) },
    });
    const cast = g.legalMoves().find((m) => m.art && m.move.from === parseSquare('e6'))!;
    const standing = g.play(cast.move).game;

    const { game, resolved } = attackD6(standing);
    expect(resolved.verdict).toBe('rout');
    expect(at(game, 'd4')).toBeNull(); // the attacker is gone
    expect(at(game, 'd6')?.cls).toBe('bishop'); // the piece it attacked is untouched
    expect(at(game, 'e6')).not.toBeNull(); // the guard held
  });
});
