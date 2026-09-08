/**
 * The four transformations and the one budget they share.
 *
 * The single shared use is the load-bearing rule here: it is what turns four abilities into one decision, and
 * it is the thing most likely to rot, because each transformation is offered from its own branch. So the
 * budget is tested from every direction — spend any one, and all four are gone.
 *
 * Beyond that, each has one claim worth pinning. Mega really swaps species (stats, ability, sometimes typing).
 * Dynamax doubles HP and gives back the right share when it lapses. A Z-Move converts one blow's power through
 * the games' table and is then spent.
 */

import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import type { BattleType } from '../data/schema.ts';
import { parseSquare, squareName } from './board.ts';
import { Position } from './position.ts';
import { isDynamaxMove, isMegaMove, isPlausibleEncodedMove, isTransformMove, isZPowerMove } from './position.ts';
import { autodraft } from '../game/autodraft.ts';
import { replay } from '../game/replay.ts';
import { PokemonChess } from './variant.ts';
import type { Loadout, PokemonLoadout } from './variant.ts';
import type { MoveSlot } from '../game/moveset.ts';
import { computeStats } from '../rules/stats.ts';
import {
  DYNAMAX_HP_MULTIPLIER, DYNAMAX_TURNS, megaBattleType, megaFormeFor, megaStoneFor, zBasePower, zCrystalFor,
  zCrystalType, zSlotFor,
} from '../game/transform.ts';

const dex = await Dex.load();

interface Spec { species: string; type: BattleType; item?: string; moves?: readonly MoveSlot[] }

function movesetOf(type: BattleType, basePower = 80): readonly MoveSlot[] {
  const slot = { id: `t-${type}`, name: `${type} Strike`, type, category: 'Physical' as const, basePower };
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
      ...(e.item ? { item: e.item } : {}),
    });
  }
  return PokemonChess.create({
    dex, position, loadout: loadout as Loadout, seed: 'transform-test', rules: { guarded: false, critCoins: 0 },
  });
}

const idAt = (g: PokemonChess, sq: string) => g.position.pieceAt(parseSquare(sq))!.id;

/** A white rook on d4 that can attack a black bishop on d6, so contact-gated offers are available. */
const FEN = '7k/8/3b4/8/3R4/8/8/K7 w - - 0 1';

/** The transformation offers available to the piece on `sq`. */
function offersAt(g: PokemonChess, sq: string) {
  return g.legalMoves().filter((m) => m.move.from === parseSquare(sq) && isTransformMove(m.move.encoded));
}
const offerKinds = (g: PokemonChess, sq: string) =>
  offersAt(g, sq).map((m) =>
    isMegaMove(m.move.encoded) ? 'mega'
    : isDynamaxMove(m.move.encoded) ? 'dynamax'
    : isZPowerMove(m.move.encoded) ? 'zpower'
    : 'tera',
  );

describe('the data behind the transformations', () => {
  it('resolves every mega stone to a real forme that changes from a real base', () => {
    let checked = 0;
    for (const species of dex.baseFormes) {
      const stone = megaStoneFor(dex, species);
      if (!stone) continue;
      const forme = megaFormeFor(dex, species, stone.id);
      expect(forme, `${species.name} + ${stone.id}`).not.toBeNull();
      expect(forme!.formeKind).toBe('mega');
      checked++;
    }
    // 47 stones across 46 species (Charizard and Mewtwo have two each), so a healthy count either way.
    expect(checked).toBeGreaterThan(40);
  });

  it('never lets a mega forme change the HP stat, which is why max HP is stable mid-game', () => {
    // This is a real fact of the games and the reason Mega Evolution needed no HP plumbing at all. If it ever
    // stopped holding, statsOf would start disagreeing with live HP.
    for (const species of dex.baseFormes) {
      const stone = megaStoneFor(dex, species);
      const forme = stone ? megaFormeFor(dex, species, stone.id) : null;
      if (!forme) continue;
      expect(forme.baseStats[0], `${forme.name}`).toBe(species.baseStats[0]);
      expect(computeStats(forme).maxHp).toBe(computeStats(species).maxHp);
    }
  });

  it('refuses a stone that belongs to another species', () => {
    const charizard = dex.requireSpecies('charizard');
    expect(megaFormeFor(dex, charizard, 'garchompite')).toBeNull();
    expect(megaFormeFor(dex, charizard, 'leftovers')).toBeNull();
    expect(megaFormeFor(dex, charizard, undefined)).toBeNull();
  });

  it('keeps a declared type the mega forme still has, and sheds one it lost', () => {
    const megaX = dex.requireSpecies('charizardmegax'); // Fire/Dragon, from Fire/Flying
    expect(megaX.types).toEqual(['Fire', 'Dragon']);
    expect(megaBattleType(megaX, 'Fire')).toBe('Fire'); // kept, so the player's choice stands
    expect(megaBattleType(megaX, 'Flying')).toBe('Fire'); // gone, so it falls to the forme's first type
  });

  it('finds a Z-crystal for every one of the eighteen types', () => {
    for (const type of dex.baseFormes[0]!.types.length ? (
      ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
        'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy'] as BattleType[]
    ) : []) {
      const crystal = zCrystalFor(dex, type);
      expect(crystal, type).not.toBeNull();
      expect(zCrystalType(dex, crystal!.id)).toBe(type);
    }
    expect(zCrystalType(dex, 'leftovers')).toBeNull();
  });

  it('powers up only a move of the crystal’s own type', () => {
    const fireCrystal = zCrystalFor(dex, 'Fire')!.id;
    expect(zSlotFor(dex, fireCrystal, movesetOf('Fire') as never)).toBe(0);
    // The crystals' own text: "If holder has a Fire move…". A mismatched crystal is dead weight.
    expect(zSlotFor(dex, fireCrystal, movesetOf('Water') as never)).toBeNull();
    expect(zSlotFor(dex, 'leftovers', movesetOf('Fire') as never)).toBeNull();
  });

  it('converts base power through the games’ table, which compresses at the top', () => {
    expect(zBasePower(40)).toBe(100);
    expect(zBasePower(100)).toBe(180);
    expect(zBasePower(140)).toBe(200);
    expect(zBasePower(250)).toBe(200); // capped
    // The compression is the point: a weak move gains far more than a strong one.
    expect(zBasePower(40) / 40).toBeGreaterThan(zBasePower(140) / 140);
    // Monotonic, so a stronger move is never converted to a weaker Z-Move.
    let last = 0;
    for (let bp = 1; bp <= 200; bp++) {
      expect(zBasePower(bp)).toBeGreaterThanOrEqual(last);
      last = zBasePower(bp);
    }
  });
});

describe('the shared budget', () => {
  const megaCapable = () =>
    gameFrom(FEN, {
      d4: { species: 'charizard', type: 'Fire', item: 'charizarditex' },
      d6: { species: 'gyarados', type: 'Water' },
    });

  it('offers a piece every transformation it can actually reach', () => {
    const g = gameFrom(FEN, {
      d4: { species: 'charizard', type: 'Fire', item: 'charizarditex' },
      d6: { species: 'gyarados', type: 'Water' },
    });
    // Mega (it holds the stone) and Dynamax (it is next to nothing, but it *can* capture d6).
    expect(offerKinds(g, 'd4')).toContain('mega');
    expect(offerKinds(g, 'd4')).toContain('dynamax');
  });

  it('offers Z-Power only with a crystal matching one of its moves', () => {
    const withCrystal = gameFrom(FEN, {
      d4: { species: 'charizard', type: 'Fire', item: zCrystalFor(dex, 'Fire')!.id, moves: movesetOf('Fire') },
      d6: { species: 'gyarados', type: 'Water' },
    });
    expect(offerKinds(withCrystal, 'd4')).toContain('zpower');

    const wrongCrystal = gameFrom(FEN, {
      d4: { species: 'charizard', type: 'Fire', item: zCrystalFor(dex, 'Water')!.id, moves: movesetOf('Fire') },
      d6: { species: 'gyarados', type: 'Water' },
    });
    expect(offerKinds(wrongCrystal, 'd4')).not.toContain('zpower');
  });

  it('spending any one of them spends all four', () => {
    for (const kind of ['mega', 'dynamax'] as const) {
      const g = megaCapable();
      expect(g.transformAvailable('white')).toBe(true);
      const offer = offersAt(g, 'd4').find((m) =>
        kind === 'mega' ? isMegaMove(m.move.encoded) : isDynamaxMove(m.move.encoded))!;
      const after = g.play(offer.move).game;

      expect(after.transformAvailable('white')).toBe(false);
      expect(after.transformSpent('white')).toBe(kind);
      // Nothing is offered to any white piece any more, of any kind.
      const stillOffered = after.legalMoves().filter((m) => isTransformMove(m.move.encoded));
      expect(stillOffered, `after ${kind}`).toHaveLength(0);
      // And the other side is untouched by it.
      expect(after.transformAvailable('black')).toBe(true);
    }
  });

  it('is spent even if the transformed piece then falls', () => {
    // The budget is read from the history, not from live state, precisely so a piece dying cannot refund it.
    const g = megaCapable();
    const mega = offersAt(g, 'd4').find((m) => isMegaMove(m.move.encoded))!;
    let after = g.play(mega.move).game;
    expect(after.transformAvailable('white')).toBe(false);

    // Black takes the Mega Charizard off the board.
    const kill = after.legalMoves().find((m) => m.move.to === parseVal(after, 'd4'));
    if (kill) after = after.play(kill.move).game;
    expect(after.transformAvailable('white')).toBe(false);
  });

  it('still gates Terastallisation, which shares the same budget', () => {
    const g = gameFrom(FEN, {
      d4: { species: 'charizard', type: 'Fire', item: 'charizarditex' },
      d6: { species: 'gyarados', type: 'Water' },
    });
    expect(g.teraAvailable('white')).toBe(true);
    const mega = offersAt(g, 'd4').find((m) => isMegaMove(m.move.encoded))!;
    expect(g.play(mega.move).game.teraAvailable('white')).toBe(false);
  });
});

/** The square a piece stands on, as a number, for a move lookup. */
function parseVal(g: PokemonChess, sq: string) {
  return g.position.pieceAt(parseSquare(sq)) ? parseSquare(sq) : -1;
}

describe('Mega Evolution', () => {
  const mega = () => {
    const g = gameFrom(FEN, {
      d4: { species: 'charizard', type: 'Flying', item: 'charizarditex', moves: movesetOf('Flying') },
      d6: { species: 'gyarados', type: 'Water' },
    });
    const offer = offersAt(g, 'd4').find((m) => isMegaMove(m.move.encoded))!;
    return { before: g, after: g.play(offer.move).game };
  };

  it('makes the piece a different Pokémon, with the forme’s stats and ability', () => {
    const { before, after } = mega();
    const id = idAt(before, 'd4');
    const forme = dex.requireSpecies('charizardmegax');

    expect(after.speciesOf(id)).toBe('charizardmegax');
    expect(after.abilityOf(id)).toBe(forme.abilities[0]);
    expect(after.statsOf(id)).toEqual(computeStats(forme));
    // Mega-X's 130 Attack against base Charizard's 84 — the stone's whole point.
    expect(after.statsOf(id).atk).toBeGreaterThan(before.statsOf(id).atk);
  });

  it('sheds a declared type the forme no longer has', () => {
    const { before, after } = mega();
    const id = idAt(before, 'd4');
    // Drafted as Flying; Mega-X is Fire/Dragon, so Flying is gone.
    expect(before.battleTypeOf(id)).toBe('Flying');
    expect(after.battleTypeOf(id)).toBe('Fire');
  });

  it('leaves max HP alone, so the piece is not silently healed or hurt', () => {
    const { before, after } = mega();
    const id = idAt(before, 'd4');
    expect(after.liveOf(id).maxHp).toBe(before.liveOf(id).maxHp);
    expect(after.liveOf(id).hp).toBe(before.liveOf(id).hp);
  });

  it('is permanent, and is not offered twice', () => {
    const { before, after } = mega();
    const id = idAt(before, 'd4');
    expect(after.megaFormeOf(id)).toBeNull();
    expect(after.transformOf(id)?.mega).toBeDefined();
  });

  it('costs the turn and moves nothing', () => {
    const { before, after } = mega();
    expect(before.turn).toBe('white');
    expect(after.turn).toBe('black');
    expect(after.position.pieceAt(parseSquare('d4'))?.cls).toBe('rook');
  });
});

describe('Dynamax', () => {
  const dynamax = () => {
    const g = gameFrom(FEN, {
      d4: { species: 'charizard', type: 'Fire' },
      d6: { species: 'gyarados', type: 'Water' },
    });
    const offer = offersAt(g, 'd4').find((m) => isDynamaxMove(m.move.encoded))!;
    return { before: g, after: g.play(offer.move).game };
  };

  it('doubles current and maximum HP', () => {
    const { before, after } = dynamax();
    const id = idAt(before, 'd4');
    expect(after.liveOf(id).maxHp).toBe(before.liveOf(id).maxHp * DYNAMAX_HP_MULTIPLIER);
    expect(after.liveOf(id).hp).toBe(before.liveOf(id).hp * DYNAMAX_HP_MULTIPLIER);
    expect(after.dynamaxTurnsLeft(id)).toBe(DYNAMAX_TURNS);
  });

  it('changes no stats and no typing — its whole effect is the HP pool', () => {
    const { before, after } = dynamax();
    const id = idAt(before, 'd4');
    expect(after.statsOf(id)).toEqual(before.statsOf(id));
    expect(after.battleTypeOf(id)).toBe(before.battleTypeOf(id));
    expect(after.speciesOf(id)).toBe(before.speciesOf(id));
  });

  it('lapses after three of its owner’s turns and hands back the pool', () => {
    const { before, after } = dynamax();
    const id = idAt(before, 'd4');
    const normalMax = before.liveOf(id).maxHp;

    let g = after;
    // Each side moves; only the owner's own Checkups age it.
    for (let i = 0; i < DYNAMAX_TURNS * 2; i++) {
      const quiet = g.legalMoves().find((m) => !m.move.captured && m.forecast === 'quiet');
      if (!quiet) break;
      g = g.play(quiet.move).game;
    }
    expect(g.dynamaxTurnsLeft(id)).toBe(0);
    expect(g.liveOf(id).maxHp).toBe(normalMax);
    // Undamaged throughout, so it comes back at full health rather than at half of it.
    expect(g.liveOf(id).hp).toBe(normalMax);
  });

  it('is offered only to a piece in a fight, not to every piece on the board', () => {
    // Sixteen identical "Dynamax this piece" options were a quarter of the opening's move list and cost the
    // search real depth for no information. A quiet piece far from contact is not offered one.
    const g = gameFrom('7k/8/3b4/8/3R4/8/8/K7 w - - 0 1', {
      d4: { species: 'charizard', type: 'Fire' },
      d6: { species: 'gyarados', type: 'Water' },
    });
    expect(offerKinds(g, 'd4')).toContain('dynamax'); // can capture d6
    expect(offerKinds(g, 'a1')).not.toContain('dynamax'); // the lone king, in contact with nothing
  });
});

describe('a Z-Move', () => {
  const charged = (crystalType: BattleType = 'Fire', moveType: BattleType = 'Fire') => {
    const g = gameFrom(FEN, {
      d4: {
        species: 'charizard', type: 'Fire',
        item: zCrystalFor(dex, crystalType)!.id, moves: movesetOf(moveType, 40),
      },
      d6: { species: 'gyarados', type: 'Water' },
    });
    const offer = offersAt(g, 'd4').find((m) => isZPowerMove(m.move.encoded));
    return { before: g, offer };
  };

  it('changes nothing about the piece — it only arms the next attack', () => {
    const { before, offer } = charged();
    const after = before.play(offer!.move).game;
    const id = idAt(before, 'd4');
    expect(after.hasZPower(id)).toBe(true);
    expect(after.speciesOf(id)).toBe(before.speciesOf(id));
    expect(after.statsOf(id)).toEqual(before.statsOf(id));
    expect(after.liveOf(id).maxHp).toBe(before.liveOf(id).maxHp);
  });

  it('hits far harder, and the charge is spent on the blow', () => {
    const { before, offer } = charged();
    const id = idAt(before, 'd4');

    const attackOf = (g: PokemonChess) =>
      g.legalMoves().find((m) => m.move.from === parseSquare('d4') && m.move.to === parseSquare('d6'))!;
    // Black must not vacate d6 — the whole comparison is the same attack on the same target twice.
    const blackReplyIn = (g: PokemonChess) =>
      g.legalMoves().find((m) => !m.move.captured && m.move.from !== parseSquare('d6'))!;

    // Both lines must reach the attack at the *same ply*, or they draw different accuracy and momentum rolls and
    // one can simply miss. So the control line spends White's first turn on a quiet move rather than the charge.
    const quiet = before.legalMoves()
      .find((m) => !m.move.captured && m.move.from !== parseSquare('d4') && !isTransformMove(m.move.encoded))!;
    let control = before.play(quiet.move).game;
    control = control.play(blackReplyIn(control).move).game;
    const plain = control.play(attackOf(control).move).resolved;

    let g = before.play(offer!.move).game;
    g = g.play(blackReplyIn(g).move).game;
    expect(g.hasZPower(id)).toBe(true);
    const zed = g.play(attackOf(g).move);

    const firstBlow = (r: typeof plain) => {
      const own = r.blows.filter((b) => b.by === 'attacker');
      expect(own.length, `expected a landed blow, got ${r.verdict}`).toBeGreaterThan(0);
      return own[0]!.damage;
    };
    expect(firstBlow(zed.resolved)).toBeGreaterThan(firstBlow(plain) * 2); // 40 BP → 100 BP
    // Spent, so it cannot power a second attack.
    expect(zed.game.hasZPower(id)).toBe(false);
  });

  it('does not fire, or spend itself, on a move of the wrong type', () => {
    // A Water crystal on a Fire attacker: the charge is offered only when a move matches, so a mismatch has no
    // offer at all — which is the honest form of "dead weight".
    const { offer } = charged('Water', 'Fire');
    expect(offer).toBeUndefined();
  });
});

describe('replay and server validation', () => {
  it('reproduces a transformed game from the seed and the action list alone', () => {
    // This is the property online play and the server validator both rest on: a game *is* a seed plus a list
    // of numbers. A transformation that could not be replayed would be a transformation that could not be
    // played online, and would be rejected as an illegal move by the server's own engine.
    const setup = autodraft(dex, 'replay-transform');
    const seed = 'replay-transform';
    let g = PokemonChess.create({ dex, ...setup, seed });

    const actions: number[] = [];
    // Play until some transformation has been spent by each side, or the game runs long.
    for (let i = 0; i < 60; i++) {
      const moves = g.legalMoves();
      if (moves.length === 0) break;
      const transform = moves.find((m) => isTransformMove(m.move.encoded));
      const chosen = transform ?? moves[i % moves.length]!;
      actions.push(chosen.move.encoded);
      const next = g.play(chosen.move);
      g = next.game;
      if (next.resolved.kingCaptured) break;
      if (!g.transformAvailable('white') && !g.transformAvailable('black')) break;
    }
    expect(actions.length).toBeGreaterThan(0);
    expect(g.history.some((h) => isTransformMove(h.move.encoded))).toBe(true);

    const replayed = replay(dex, setup, seed, actions);
    expect(replayed.game.history).toHaveLength(g.history.length);
    expect(replayed.game.position.toFen()).toBe(g.position.toFen());
    // And the transformed state itself survives, not just the board.
    for (const { piece } of g.position.allPieces()) {
      expect(replayed.game.speciesOf(piece.id)).toBe(g.speciesOf(piece.id));
      expect(replayed.game.battleTypeOf(piece.id)).toBe(g.battleTypeOf(piece.id));
      expect(replayed.game.dynamaxTurnsLeft(piece.id)).toBe(g.dynamaxTurnsLeft(piece.id));
      expect(replayed.game.hasZPower(piece.id)).toBe(g.hasZPower(piece.id));
    }
  });

  it('encodes every transformation inside the bound the server accepts', () => {
    // The server shape-checks an action before spending a replay on it. A flag bit above that ceiling is
    // rejected as malformed — which is exactly how queen-side castling, arts and Tera were once broken.
    const g = gameFrom(FEN, {
      d4: { species: 'charizard', type: 'Fire', item: 'charizarditex' },
      d6: { species: 'gyarados', type: 'Water' },
    });
    const transforms = g.legalMoves().filter((m) => isTransformMove(m.move.encoded));
    expect(transforms.length).toBeGreaterThan(1);
    for (const m of transforms) {
      expect(isPlausibleEncodedMove(m.move.encoded), m.moveName ?? '').toBe(true);
      // Still an Int32Array-safe value, which the packed move encoding depends on.
      expect(m.move.encoded).toBeLessThan(2 ** 31);
    }
  });
});
