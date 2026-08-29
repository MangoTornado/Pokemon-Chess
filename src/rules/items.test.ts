import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import { isTransformItem } from '../game/transform.ts';
import type { BattleType } from '../data/schema.ts';
import { parseSquare, squareName } from '../engine/board.ts';
import { Position } from '../engine/position.ts';
import { PokemonChess } from '../engine/variant.ts';
import type { Loadout, PokemonLoadout } from '../engine/variant.ts';
import { autodraft } from '../game/autodraft.ts';
import { computeDamage } from './damage.ts';
import { resolveClash } from './clash.ts';
import {
  CHECKUP_HEAL_ITEMS, IMPLEMENTED_ITEMS, SURVIVE_ONCE_ITEMS, TYPE_BOOST_ITEMS,
  attackCostFraction, checkupHealFraction, contactPunishFraction, defensiveItemMod, grantsSurviveOnce,
  offensiveItemMods,
} from './items.ts';

const dex = await Dex.load();

describe('item multiplier table', () => {
  it('every implemented item is a real dex item', () => {
    for (const id of IMPLEMENTED_ITEMS) {
      expect(dex.getItem(id), `${id} should exist in the dex`).toBeDefined();
    }
  });

  it('a type-boost item raises only its own type, by 1.2', () => {
    const mods = offensiveItemMods('charcoal', 'Fire', 'Special', false);
    expect(mods.basePowerMod).toBeCloseTo(1.2, 6);
    expect(offensiveItemMods('charcoal', 'Water', 'Special', false).basePowerMod).toBe(1);
    // Every entry in the table maps to a type it actually boosts.
    for (const [item, type] of Object.entries(TYPE_BOOST_ITEMS)) {
      expect(offensiveItemMods(item, type, 'Physical', false).basePowerMod).toBeCloseTo(1.2, 6);
    }
  });

  it('Life Orb is 1.3 regardless of category', () => {
    expect(offensiveItemMods('lifeorb', 'Normal', 'Physical', false).attackerFinalMod).toBeCloseTo(1.3, 6);
    expect(offensiveItemMods('lifeorb', 'Normal', 'Special', true).attackerFinalMod).toBeCloseTo(1.3, 6);
  });

  it('the Choice items and bands are split by category', () => {
    expect(offensiveItemMods('choiceband', 'Normal', 'Physical', false).attackerFinalMod).toBeCloseTo(1.5, 6);
    expect(offensiveItemMods('choiceband', 'Normal', 'Special', false).attackerFinalMod).toBe(1);
    expect(offensiveItemMods('choicespecs', 'Normal', 'Special', false).attackerFinalMod).toBeCloseTo(1.5, 6);
    expect(offensiveItemMods('choicespecs', 'Normal', 'Physical', false).attackerFinalMod).toBe(1);
    expect(offensiveItemMods('muscleband', 'Normal', 'Physical', false).basePowerMod).toBeCloseTo(1.1, 6);
    expect(offensiveItemMods('wiseglasses', 'Normal', 'Special', false).basePowerMod).toBeCloseTo(1.1, 6);
  });

  it('Expert Belt pays only on a super-effective hit', () => {
    expect(offensiveItemMods('expertbelt', 'Water', 'Special', true).attackerFinalMod).toBeCloseTo(1.2, 6);
    expect(offensiveItemMods('expertbelt', 'Water', 'Special', false).attackerFinalMod).toBe(1);
  });

  it('no item is offered that does nothing', () => {
    // Probe every combination an item could care about: its own boosted type (for the type items), both
    // categories (for the split ones), super-effective or not (Expert Belt), and both defender paths.
    const TYPES: BattleType[] = ['Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Fighting', 'Flying', 'Rock',
      'Ghost', 'Poison', 'Ground', 'Ice', 'Psychic', 'Bug', 'Dragon', 'Dark', 'Steel', 'Fairy'];
    for (const id of IMPLEMENTED_ITEMS) {
      let doesSomething = grantsSurviveOnce(id) || checkupHealFraction(id) > 0
        || attackCostFraction(id) > 0 || contactPunishFraction(id) > 0;
      for (const category of ['Physical', 'Special'] as const) {
        if (defensiveItemMod(id, category, true) !== 1) doesSomething = true;
        for (const type of TYPES) {
          for (const se of [true, false]) {
            const mods = offensiveItemMods(id, type, category, se);
            if (mods.basePowerMod !== 1 || mods.attackerFinalMod !== 1) doesSomething = true;
          }
        }
      }
      expect(doesSomething, `${id} should have a measurable effect somewhere`).toBe(true);
    }
  });

  it('Life Orb costs its holder HP to attack, and Rocky Helmet punishes contact', () => {
    expect(attackCostFraction('lifeorb')).toBeCloseTo(1 / 10, 6);
    expect(attackCostFraction('leftovers')).toBe(0);
    expect(attackCostFraction(undefined)).toBe(0);
    expect(contactPunishFraction('rockyhelmet')).toBeCloseTo(1 / 6, 6);
    expect(contactPunishFraction('lifeorb')).toBe(0);
  });

  it('defensive items only ever reduce damage, as the pipeline requires', () => {
    for (const id of IMPLEMENTED_ITEMS) {
      for (const category of ['Physical', 'Special'] as const) {
        for (const nfe of [true, false]) {
          expect(defensiveItemMod(id, category, nfe)).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('Assault Vest cuts special damage only; Eviolite needs an unevolved holder', () => {
    expect(defensiveItemMod('assaultvest', 'Special', false)).toBeCloseTo(2 / 3, 6);
    expect(defensiveItemMod('assaultvest', 'Physical', false)).toBe(1);
    expect(defensiveItemMod('eviolite', 'Physical', true)).toBeCloseTo(2 / 3, 6);
    expect(defensiveItemMod('eviolite', 'Physical', false)).toBe(1);
  });

  it('no item is both an unknown id and an effect', () => {
    expect(offensiveItemMods(undefined, 'Fire', 'Physical', true)).toEqual({ basePowerMod: 1, attackerFinalMod: 1 });
    expect(offensiveItemMods('nosuchitem', 'Fire', 'Physical', true)).toEqual({ basePowerMod: 1, attackerFinalMod: 1 });
    expect(checkupHealFraction('nosuchitem')).toBe(0);
    expect(grantsSurviveOnce('nosuchitem')).toBe(false);
  });
});

describe('items change real damage', () => {
  const base = {
    attackerType: 'Fire' as BattleType,
    defenderType: 'Grass' as BattleType,
    moveType: 'Fire' as BattleType,
    category: 'Special' as const,
    basePower: 90,
    offensiveStat: 200,
    defensiveStat: 150,
    momentum: 100,
  };

  it('Life Orb increases damage by about 30%', () => {
    const plain = computeDamage(base);
    const orb = computeDamage({ ...base, attackerFinalMod: 1.3 });
    expect(orb).toBeGreaterThan(plain);
    expect(orb / plain).toBeGreaterThan(1.25);
    expect(orb / plain).toBeLessThan(1.35);
  });

  it('a defender item reduces damage', () => {
    const plain = computeDamage(base);
    const vested = computeDamage({ ...base, defenderFinalMod: 2 / 3 });
    expect(vested).toBeLessThan(plain);
  });
});

describe('Focus Sash in the Clash', () => {
  function clashWith(surviveOnce: boolean, pristine: boolean) {
    const attacker = { hp: 200, maxHp: 200, speed: 200, pristine: true };
    const defender = { hp: 10, maxHp: 200, speed: 1, pristine, surviveOnce };
    return resolveClash(
      {
        attacker,
        defender,
        // A huge blow that would certainly kill a 10 HP defender.
        attackerBlow: { ...{
          attackerType: 'Fire' as BattleType, defenderType: 'Grass' as BattleType, moveType: 'Fire' as BattleType,
          category: 'Special' as const, basePower: 150, offensiveStat: 300, defensiveStat: 50,
        } },
        defenderBlow: {
          attackerType: 'Grass' as BattleType, defenderType: 'Fire' as BattleType, moveType: 'Grass' as BattleType,
          category: 'Physical' as const, basePower: 40, offensiveStat: 50, defensiveStat: 300,
        },
        attackerSuperEffective: true,
      },
      { hits: true, crit: false, momentum: 100 },
    );
  }

  it('saves an undamaged holder at 1 HP instead of removing it', () => {
    const saved = clashWith(true, true);
    expect(saved.defenderHpAfter).toBe(1);
    // Surviving means this is no longer a knockout, so no bonus move is granted.
    expect(saved.verdict).not.toBe('advantage');
  });

  it('does nothing for a holder that has already been damaged', () => {
    expect(clashWith(true, false).defenderHpAfter).toBe(0);
  });

  it('does nothing without the item', () => {
    expect(clashWith(false, true).defenderHpAfter).toBe(0);
  });
});

describe('items in a live game', () => {
  function monoMoveset(type: BattleType) {
    const slot = { id: `t-${type}`, name: `${type} Strike`, type, category: 'Physical' as const, basePower: 80 };
    return [slot, slot, slot, slot] as const;
  }

  function gameFrom(fen: string, spec: Record<string, { species: string; type: BattleType; item?: string }>) {
    const position = Position.fromFen(fen);
    const loadout = new Map<number, PokemonLoadout>();
    for (const { square, piece } of position.allPieces()) {
      const e = spec[squareName(square)] ?? { species: 'pikachu', type: 'Normal' as BattleType };
      loadout.set(piece.id, {
        species: e.species, type: e.type, moves: monoMoveset(e.type), ...(e.item ? { item: e.item } : {}),
      });
    }
    return PokemonChess.create({ dex, position, loadout: loadout as Loadout, seed: 'item-test', rules: { guarded: false, critCoins: 0 } });
  }

  const FEN = '7k/8/3b4/8/3R4/8/8/K7 w - - 0 1';

  it('a Life Orb attacker deals more damage than a bare one', () => {
    const spec = { d4: { species: 'tauros', type: 'Normal' as BattleType }, d6: { species: 'snorlax', type: 'Normal' as BattleType } };
    const bare = gameFrom(FEN, spec);
    const orbed = gameFrom(FEN, { ...spec, d4: { ...spec.d4, item: 'lifeorb' } });

    const play = (g: PokemonChess) => {
      const m = g.legalMoves().find((x) => x.move.from === parseSquare('d4') && x.move.to === parseSquare('d6'))!;
      return g.play(m.move).resolved.defenderHpAfter;
    };
    expect(play(orbed)).toBeLessThan(play(bare));
  });

  it('Leftovers heals its holder at the Checkup', () => {
    // A Normal attacker into Steel is 0.5×, so the holder survives the exchange wounded — then its next
    // end-of-turn Checkup should heal it.
    const spec = {
      d4: { species: 'snorlax', type: 'Normal' as BattleType, item: 'leftovers' },
      d6: { species: 'skarmory', type: 'Steel' as BattleType },
    };
    let game = gameFrom(FEN, spec);
    const holder = game.position.pieceAt(parseSquare('d4'))!.id;

    // Attack, taking counter-damage (this also ends White's turn, running one Checkup).
    const attack = game.legalMoves().find((x) => x.move.from === parseSquare('d4') && x.move.captured);
    expect(attack, 'Normal should be able to attack Steel at 0.5x').toBeDefined();
    game = game.play(attack!.move).game;

    const live = game.liveOf(holder);
    expect(live.hp, 'the holder should have survived, wounded').toBeGreaterThan(0);
    expect(live.hp).toBeLessThan(live.maxHp);

    // Black moves, then White makes a quiet move so White's Checkup runs again and heals.
    game = game.play(game.legalMoves()[0]!.move).game;
    const quiet = game.legalMoves().find((x) => !x.move.captured);
    expect(quiet).toBeDefined();
    const before = game.liveOf(holder).hp;
    game = game.play(quiet!.move).game;
    expect(game.liveOf(holder).hp).toBeGreaterThan(before);
  });

  it('drafted armies hold real, implemented items', () => {
    const drafted = autodraft(dex, 'item-draft');
    let held = 0;
    for (const [, entry] of drafted.loadout) {
      if (!entry.item) continue;
      held += 1;
      expect(dex.getItem(entry.item), `${entry.item} should be a real item`).toBeDefined();
      // A drafted item must do *something*: either a turn-to-turn combat effect this module implements, or a
      // transformation (a mega stone, a Z-crystal), which is implemented in game/transform.ts instead.
      const implemented = IMPLEMENTED_ITEMS.includes(entry.item!) || isTransformItem(dex, entry.item!);
      expect(implemented, `${entry.item} should be implemented`).toBe(true);
    }
    expect(held).toBe(32); // every piece holds something
  });

  it('an unevolved drafted piece holds Eviolite', () => {
    const drafted = autodraft(dex, 'eviolite-draft');
    for (const d of drafted.drafted) {
      const entry = [...drafted.loadout.values()].find((e) => e.species === d.species.id);
      if (d.species.nfe && entry) expect(entry.item).toBe('eviolite');
    }
  });

  it('the checkup-heal and survive-once tables are non-empty and disjoint', () => {
    expect(Object.keys(CHECKUP_HEAL_ITEMS).length).toBeGreaterThan(0);
    expect(SURVIVE_ONCE_ITEMS.size).toBeGreaterThan(0);
    for (const id of SURVIVE_ONCE_ITEMS) expect(CHECKUP_HEAL_ITEMS[id]).toBeUndefined();
  });
});

describe('recoil and contact in the Clash', () => {
  const BIG = {
    attackerType: 'Normal' as BattleType, defenderType: 'Normal' as BattleType, moveType: 'Normal' as BattleType,
    category: 'Physical' as const, basePower: 100, offensiveStat: 250, defensiveStat: 150,
  };
  const SMALL = {
    attackerType: 'Normal' as BattleType, defenderType: 'Normal' as BattleType, moveType: 'Normal' as BattleType,
    category: 'Physical' as const, basePower: 10, offensiveStat: 50, defensiveStat: 400,
  };

  function clash(extra: Record<string, unknown>) {
    const attacker = { hp: 300, maxHp: 300, speed: 300, pristine: true };
    const defender = { hp: 400, maxHp: 400, speed: 1, pristine: true };
    const result = resolveClash(
      { attacker, defender, attackerBlow: BIG, defenderBlow: SMALL, attackerSuperEffective: false, ...extra },
      { hits: true, crit: false, momentum: 100 },
    );
    return { result, attacker, defender };
  }

  it('a recoil move costs the attacker a share of the damage it dealt', () => {
    const plain = clash({});
    const recoiling = clash({ attackerRecoil: { ofDamage: 1 / 3 } });
    expect(recoiling.result.recoilTaken).toBeGreaterThan(0);
    expect(recoiling.result.attackerHpAfter).toBeLessThan(plain.result.attackerHpAfter);

    // The cost is exactly a third of each blow it landed — derived from the blows rather than assumed, so
    // the test does not depend on how many swings the exchange happened to take.
    const own = recoiling.result.blows.filter((b) => b.by === 'attacker');
    const expected = own.reduce((sum, b) => sum + Math.max(1, Math.floor(b.damage / 3)), 0);
    expect(recoiling.result.recoilTaken).toBe(expected);
  });

  it('Life Orb charges a flat tenth of max HP per blow', () => {
    const orb = clash({ attackerRecoil: { ofMaxHp: 1 / 10 } });
    const swings = orb.result.blows.filter((b) => b.by === 'attacker').length;
    expect(swings).toBeGreaterThan(0);
    expect(orb.result.recoilTaken).toBe(swings * 30); // a tenth of 300, once per landed blow
  });

  it('Rocky Helmet only punishes a move that makes contact', () => {
    const contact = clash({ defenderContact: { ofAttackerMaxHp: 1 / 6 }, attackerMakesContact: true });
    const ranged = clash({ defenderContact: { ofAttackerMaxHp: 1 / 6 } });
    expect(contact.result.recoilTaken).toBeGreaterThan(0);
    expect(ranged.result.recoilTaken).toBe(0);
    expect(contact.result.attackerHpAfter).toBeLessThan(ranged.result.attackerHpAfter);
  });

  it('recoil can fell the attacker, turning a knockout into a mutual destruction', () => {
    const attacker = { hp: 20, maxHp: 300, speed: 300, pristine: true };
    const defender = { hp: 30, maxHp: 400, speed: 1, pristine: true };
    const result = resolveClash(
      {
        attacker, defender, attackerBlow: BIG, defenderBlow: SMALL, attackerSuperEffective: false,
        attackerRecoil: { ofDamage: 1 / 3 },
      },
      { hits: true, crit: false, momentum: 100 },
    );
    expect(result.defenderHpAfter).toBe(0);
    expect(result.attackerHpAfter).toBe(0);
    expect(result.verdict).toBe('mutual');
  });

  it('a Focus Sash does not save the attacker from its own recoil', () => {
    const attacker = { hp: 20, maxHp: 300, speed: 300, pristine: true, surviveOnce: true };
    const defender = { hp: 30, maxHp: 400, speed: 1, pristine: true };
    const result = resolveClash(
      {
        attacker, defender, attackerBlow: BIG, defenderBlow: SMALL, attackerSuperEffective: false,
        attackerRecoil: { ofDamage: 1 / 3 },
      },
      { hits: true, crit: false, momentum: 100 },
    );
    expect(result.attackerHpAfter).toBe(0);
  });

  it('no recoil inputs means no self-damage at all', () => {
    expect(clash({}).result.recoilTaken).toBe(0);
  });
});

describe('recoil data comes from real moves', () => {
  it('reads a recoil fraction and a contact flag off the dex', () => {
    const doubleEdge = dex.requireMove('doubleedge');
    expect(doubleEdge.recoil).toBeDefined();
    expect(doubleEdge.recoil![0] / doubleEdge.recoil![1]).toBeCloseTo(0.33, 2);
    expect(doubleEdge.flags).toContain('contact');
    // A ranged special move makes no contact.
    expect(dex.requireMove('thunderbolt').flags).not.toContain('contact');
    expect(dex.requireMove('thunderbolt').recoil).toBeUndefined();
  });
});
