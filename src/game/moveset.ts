/**
 * The four-slot moveset a piece fights with, chosen from its real learnset.
 *
 * In the games a Pokémon knows four moves, and that is what makes the whole move layer matter: Gengar
 * declared Ghost cannot touch a Dark piece with its melee (Ghost→Dark is 0.5×) but *can* with Sludge Bomb
 * or Focus Blast. Slot 0 is always a damaging move of the piece's own declared type — so an ordinary
 * capture is "attack with your own type", the video's rule — and slots 1–3 are coverage, picked for type
 * diversity so a piece is rarely without a legal, effective option. See SPEC §8.
 *
 * The picker is deterministic given the species, declared type and a seed, so a draft reproduces the same
 * kit, and it draws only from the baked learnset, so a kit is always legal.
 */

import type { Dex } from '../data/dex.ts';
import type { BattleType, MoveEntry, SpeciesEntry } from '../data/schema.ts';
import { Rng } from '../engine/rng.ts';

/** A status rider a move can inflict on a surviving defender, carried on the slot. */
export interface MoveRider {
  /** The status mark, e.g. `burned`, `paralyzed`, `poisoned`, `badly-poisoned`, `asleep`. */
  readonly mark: string;
  /** Chance in percent (100 for a guaranteed primary status). */
  readonly chance: number;
}

/** A stage change a move applies, and how often it lands. */
export interface MoveBoosts {
  /** Stat keys to deltas, e.g. `{ spe: -1 }`. */
  readonly boosts: Readonly<Record<string, number>>;
  /** Chance in percent (100 for a guaranteed effect). */
  readonly chance: number;
}

/** A resolved slot: the move id and the facts the Clash needs, so it need not re-look-up per action. */
export interface MoveSlot {
  readonly id: string;
  readonly name: string;
  readonly type: BattleType;
  readonly category: 'Physical' | 'Special';
  readonly basePower: number;
  /** A status this move can inflict, if any — so the engine applies it without a dex lookup. */
  readonly rider?: MoveRider;
  /**
   * Stage changes this move inflicts on the target (Icy Wind's −1 Speed, Crunch's −1 Defence).
   *
   * A Speed drop is the sharpest effect in this variant, because Speed decides who swings first.
   */
  readonly targetBoosts?: MoveBoosts;
  /** Stage changes the move costs its own user (Close Combat's −1 Def/SpD, Leaf Storm's −2 SpA). */
  readonly selfBoosts?: Readonly<Record<string, number>>;
}

/** Extracts the stage change a move lands on its target: a guaranteed `boosts`, or a boost secondary. */
function targetBoostsOf(move: MoveEntry): MoveBoosts | undefined {
  // On a damaging move, a top-level `boosts` applies to the target.
  if (move.boosts && Object.keys(move.boosts).length > 0) {
    return { boosts: move.boosts, chance: 100 };
  }
  for (const sec of move.secondaries ?? []) {
    if (sec.boosts && Object.keys(sec.boosts).length > 0) {
      return { boosts: sec.boosts, chance: sec.chance ?? 100 };
    }
  }
  return undefined;
}

const STATUS_MARK: Record<string, string> = {
  brn: 'burned', par: 'paralyzed', slp: 'asleep', psn: 'poisoned', tox: 'badly-poisoned', frz: 'asleep',
};

/** Extracts a move's status rider (primary status or the first status secondary) for the slot. */
function riderOf(move: MoveEntry): MoveRider | undefined {
  if (move.status && STATUS_MARK[move.status]) return { mark: STATUS_MARK[move.status]!, chance: 100 };
  for (const sec of move.secondaries ?? []) {
    if (sec.status && STATUS_MARK[sec.status]) return { mark: STATUS_MARK[sec.status]!, chance: sec.chance ?? 100 };
  }
  return undefined;
}

/** Exactly four slots. Slot 0 is the declared-type melee; 1–3 are coverage. */
export type Moveset = readonly [MoveSlot, MoveSlot, MoveSlot, MoveSlot];

const BATTLE_TYPES: readonly BattleType[] = [
  'Normal', 'Fire', 'Water', 'Electric', 'Grass', 'Ice', 'Fighting', 'Poison', 'Ground',
  'Flying', 'Psychic', 'Bug', 'Rock', 'Ghost', 'Dragon', 'Dark', 'Steel', 'Fairy',
];

/** A synthetic melee slot for a piece whose declared type has no damaging move in its learnset. */
function struggle(type: BattleType): MoveSlot {
  return { id: 'struggle', name: 'Struggle', type, category: 'Physical', basePower: 50 };
}

function toSlot(move: MoveEntry): MoveSlot {
  const rider = riderOf(move);
  const targetBoosts = targetBoostsOf(move);
  // `self.boosts` is what the move costs its user — a real trade-off the player should feel.
  const selfBoosts = move.self?.boosts && Object.keys(move.self.boosts).length > 0 ? move.self.boosts : undefined;
  return {
    id: move.id,
    name: move.name,
    // A status move has no offensive category; treat it as physical for slotting purposes (it will not
    // be chosen as a damaging slot, but the type is what matters for coverage).
    type: (BATTLE_TYPES as readonly string[]).includes(move.type) ? (move.type as BattleType) : 'Normal',
    category: move.category === 'Special' ? 'Special' : 'Physical',
    basePower: move.basePower || 60,
    ...(rider ? { rider } : {}),
    ...(targetBoosts ? { targetBoosts } : {}),
    ...(selfBoosts ? { selfBoosts } : {}),
  };
}

/**
 * Builds a piece's moveset.
 *
 * Slot 0: the strongest damaging move whose type equals the declared type (STAB melee); Struggle if the
 * learnset has none of that type. Slots 1–3: the strongest damaging move of each of the most useful
 * *other* types the piece can learn, chosen to maximise distinct attacking types — which is what raises
 * the share of matchups where the piece has an effective answer.
 */
export function buildMoveset(dex: Dex, species: SpeciesEntry, declaredType: BattleType, seed: string | number): Moveset {
  const rng = new Rng(`kit:${seed}:${species.id}:${declaredType}`);
  const learn = dex.learnsetOf(species.id).filter((m) => m.category !== 'Status' && m.basePower !== undefined);

  // Best damaging move per type, by base power (ties broken by the seed for variety).
  const bestByType = new Map<BattleType, MoveEntry>();
  for (const move of learn) {
    const type = move.type as BattleType;
    if (!(BATTLE_TYPES as readonly string[]).includes(type)) continue;
    const current = bestByType.get(type);
    const power = move.basePower || 60;
    const curPower = current ? current.basePower || 60 : -1;
    if (!current || power > curPower || (power === curPower && rng.chance(50))) {
      bestByType.set(type, move);
    }
  }

  const slot0 = bestByType.has(declaredType) ? toSlot(bestByType.get(declaredType)!) : struggle(declaredType);

  // Coverage: the highest-power moves of other types, most powerful first, capped at three distinct types.
  const coverage = [...bestByType.entries()]
    .filter(([type]) => type !== declaredType)
    .sort((a, b) => (b[1].basePower || 60) - (a[1].basePower || 60))
    .slice(0, 3)
    .map(([, move]) => toSlot(move));

  // Pad to four with repeats of slot 0 when a species has a tiny learnset (Ditto, Magikarp), so the
  // shape is always four slots.
  while (coverage.length < 3) coverage.push(slot0);

  return [slot0, coverage[0]!, coverage[1]!, coverage[2]!];
}
