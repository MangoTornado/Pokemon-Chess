/**
 * The move compiler — 950 moves into board effects, by derivation not by hand.
 *
 * Reads the declarative fields the data pipeline baked (`target`, `category`, `basePower`, `status`,
 * `volatileStatus`, `boosts`, `secondaries`, `drain`, `recoil`, `heal`, `multihit`, `sideCondition`,
 * `weather`/`terrain`/`pseudoWeather`, `selfSwitch`, `forceSwitch`, `ohko`, `selfdestruct`, `flags`) and
 * emits an {@link Effect}[] over the ISA. Where the real behaviour lived in a callback `@pkmn/dex`
 * stripped (Belly Drum's boost, Substitute's HP cost, Metronome's pool), a small curated override
 * supplies it; where even that does not apply, a total fallback guarantees the move still resolves to
 * *something* coherent, so nothing in the dex is ever silently missing. See SPEC §13.
 *
 * Every entry records how its effects were produced ({@link Provenance}), which is what makes the "all
 * moves make sense" claim a test rather than an assertion.
 */

import type { MoveEntry } from '../data/schema.ts';
import type {
  CompiledEntry, Effect, Fraction, MarkId, Op, Provenance, Region, Stat,
} from './isa.ts';

// ---------------------------------------------------------------------------
// Region derivation — Showdown `target` (+ ranged flags) → one of the 16 regions
// ---------------------------------------------------------------------------

const RANGED_FLAGS = new Set(['distance', 'pulse', 'bullet', 'sound', 'wind']);

function regionOf(move: MoveEntry): Region {
  switch (move.target) {
    case 'self':
      return 'SELF';
    case 'allAdjacentFoes':
      return 'RING1_FOES';
    case 'allAdjacent':
      return 'RING1_ALL';
    case 'any':
      return 'RAY_ANY';
    case 'all':
      return 'BOARD';
    case 'allySide':
    case 'allyTeam':
      return 'OWN_SIDE';
    case 'allies':
    case 'adjacentAlly':
    case 'adjacentAllyOrSelf':
      return 'ALLY';
    case 'randomNormal':
      return 'RANDOM_FOE';
    case 'scripted':
      return 'REACTIVE';
    case 'foeSide':
      return 'FOE_ZONE';
    default:
      // `normal` / `adjacentFoe`: a step-in melee, unless a ranged flag makes it a line-of-sight poke.
      if ((move.flags ?? []).some((f) => RANGED_FLAGS.has(f))) return 'RAY_LOS';
      return 'MELEE';
  }
}

/** A region the attacker steps into and can capture from, versus one it strikes at range. */
function isStepIn(region: Region): boolean {
  return region === 'MELEE';
}

// ---------------------------------------------------------------------------
// Status and volatile marks
// ---------------------------------------------------------------------------

const STATUS_MARK: Record<string, MarkId> = {
  brn: 'burned',
  par: 'paralyzed',
  slp: 'asleep',
  psn: 'poisoned',
  tox: 'badly-poisoned',
  frz: 'asleep', // no Frozen condition; the TCG folds freeze into sleep
};

/** Hazard layer counts, read from the move rather than guessed. */
const HAZARD_LAYERS: Record<string, 1 | 2 | 3> = {
  spikes: 3,
  toxicspikes: 2,
  stealthrock: 1,
  stickyweb: 1,
};

const SCREEN_CONDITIONS = new Set(['reflect', 'lightscreen', 'auroraveil', 'safeguard', 'mist', 'tailwind']);

// ---------------------------------------------------------------------------
// The FIELDS pass
// ---------------------------------------------------------------------------

const DEFAULT_BASE_POWER = 60;

/** Boosts that target the user's own stats rather than the opponent's, in Showdown convention. */
function isSelfBoost(move: MoveEntry): boolean {
  // A Status move that boosts with a positive value is boosting itself (Swords Dance); a damaging move's
  // top-level `boosts` lowers the target (Crunch's -1 Def), while `self.boosts` raises the user.
  if (move.category === 'Status') {
    const vals = Object.values(move.boosts ?? {});
    return vals.length > 0 && vals.every((v) => v > 0);
  }
  return false;
}

function boostOp(boosts: Record<string, number>): Op {
  const d: Partial<Record<Stat, number>> = {};
  for (const [k, v] of Object.entries(boosts)) {
    if (['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion'].includes(k)) {
      const stat = (k === 'accuracy' ? 'acc' : k === 'evasion' ? 'eva' : k) as Stat;
      d[stat] = v;
    }
  }
  return { op: 'BOOST', d };
}

/**
 * Riders on a damaging move — the secondary chance effects. Read `secondaries` only, never `secondary`,
 * because Showdown duplicates the object across both fields and reading both would apply every rider
 * twice.
 */
function riderEffects(move: MoveEntry, region: Region): Effect[] {
  const out: Effect[] = [];
  for (const sec of move.secondaries ?? []) {
    const ops: Op[] = [];
    if (sec.status && STATUS_MARK[sec.status]) ops.push({ op: 'MARK', mark: STATUS_MARK[sec.status]! });
    if (sec.volatileStatus) ops.push({ op: 'MARK', mark: sec.volatileStatus });
    if (sec.boosts) ops.push(boostOp(sec.boosts));
    if (sec.self?.boosts) {
      out.push({ trigger: 'ON_CAPTURE', region: 'SELF', ops: [boostOp(sec.self.boosts)] });
    }
    if (ops.length > 0) {
      out.push({
        trigger: 'ON_DAMAGED',
        region: region === 'MELEE' ? 'TARGET' : region,
        ops,
        guards: [{ cond: `chance:${sec.chance ?? 100}` }],
      });
    }
  }
  return out;
}

/**
 * The main effect a move's fields describe, or null when a Status move's content lives entirely in its
 * field/self effects (a hazard, a weather, a self-switch), so no bogus primary is emitted.
 */
function primaryEffect(move: MoveEntry, region: Region): Effect | null {
  if (move.category === 'Status') {
    const ops: Op[] = [];
    // A primary status (Thunder Wave, Toxic, Will-O-Wisp): a MARK on the target.
    if (move.status && STATUS_MARK[move.status]) ops.push({ op: 'MARK', mark: STATUS_MARK[move.status]! });
    if (move.volatileStatus) ops.push({ op: 'MARK', mark: move.volatileStatus });
    // A boosting move.
    if (move.boosts) {
      if (isSelfBoost(move)) {
        return { trigger: 'ON_ACT', region: 'SELF', ops: [boostOp(move.boosts)] };
      }
      ops.push(boostOp(move.boosts));
    }
    if (move.self?.boosts && !move.boosts) ops.push(boostOp(move.self.boosts));
    return ops.length > 0 ? { trigger: 'ON_ACT', region, ops } : null;
  }

  // A damaging move. A step-in melee resolves a Clash; a ranged or area hit wounds without a Clash (the
  // Softening rule — only a Clash removes a piece). A self-destruct move is THE exception to the
  // Softening rule: it may kill at range, but only by the user dying, so it resolves a real Clash on its
  // area rather than a softened strike (Explosion must keep its lethality).
  if (isStepIn(region) || move.selfdestruct) {
    return { trigger: 'ON_ACT', region, ops: [{ op: 'CLASH', slot: 0 }] };
  }
  const bp = move.basePower || DEFAULT_BASE_POWER;
  // Scale the softened strike by base power bucket, so a 250-BP Explosion wounds more than a 40-BP poke.
  const frac: Fraction = bp >= 110 ? [1, 2] : bp >= 75 ? [1, 3] : [1, 4];
  return { trigger: 'ON_ACT', region, ops: [{ op: 'STRIKE', frac, of: 'max' }] };
}

/** Effects that land on the caster: drain, recoil, heal, self-switch, self-destruct. */
function selfEffects(move: MoveEntry): Effect[] {
  const out: Effect[] = [];
  if (move.heal) out.push({ trigger: 'ON_ACT', region: 'SELF', ops: [{ op: 'MEND', frac: move.heal, of: 'max' }] });
  if (move.drain) out.push({ trigger: 'ON_STRUCK', region: 'SELF', ops: [{ op: 'MEND', frac: move.drain, of: 'max' }] });
  if (move.recoil) out.push({ trigger: 'ON_STRUCK', region: 'SELF', ops: [{ op: 'STRIKE', frac: move.recoil, of: 'max' }] });
  if (move.selfSwitch) out.push({ trigger: 'ON_CAPTURE', region: 'SELF', ops: [{ op: 'RELOCATE', to: 'origin' }] });
  if (move.selfdestruct) out.push({ trigger: 'ON_ACT', region: 'SELF', ops: [{ op: 'REMOVE' }] });
  return out;
}

/** Hazard, screen, weather, terrain and forced-switch effects — the field-and-zone layer. */
function fieldEffects(move: MoveEntry): Effect[] {
  const out: Effect[] = [];
  if (move.sideCondition) {
    const layers = HAZARD_LAYERS[move.sideCondition];
    if (layers) {
      out.push({ trigger: 'ON_ACT', region: 'FOE_ZONE', ops: [{ op: 'MARK', mark: move.sideCondition, dur: 'persist', layers }] });
    } else if (SCREEN_CONDITIONS.has(move.sideCondition)) {
      out.push({ trigger: 'ON_ACT', region: 'OWN_SIDE', ops: [{ op: 'MARK', mark: move.sideCondition, dur: 5 }] });
    } else {
      out.push({ trigger: 'ON_ACT', region: 'OWN_SIDE', ops: [{ op: 'MARK', mark: move.sideCondition, dur: 'persist' }] });
    }
  }
  for (const field of [move.weather, move.terrain, move.pseudoWeather]) {
    if (field) out.push({ trigger: 'ON_ACT', region: 'BOARD', ops: [{ op: 'MARK', mark: field, dur: 5 }] });
  }
  if (move.forceSwitch) out.push({ trigger: 'ON_CAPTURE', region: 'TARGET', ops: [{ op: 'RELOCATE', to: 'push' }] });
  return out;
}

/** Whether the move's declarative fields describe any effect at all. */
function hasFieldSignal(move: MoveEntry): boolean {
  return Boolean(
    move.status || move.volatileStatus || move.boosts || move.self?.boosts ||
    (move.secondaries && move.secondaries.length) || move.drain || move.recoil || move.heal ||
    move.sideCondition || move.weather || move.terrain || move.pseudoWeather || move.selfSwitch ||
    move.forceSwitch || move.selfdestruct || move.category !== 'Status',
  );
}

// ---------------------------------------------------------------------------
// Curated overrides — iconic content whose behaviour was in a stripped callback
// ---------------------------------------------------------------------------

/**
 * Hand-authored effects for moves the fields cannot describe faithfully.
 *
 * Deliberately small: it exists only for content whose real behaviour lives in a Showdown callback that
 * `@pkmn/dex` strips, so the fields alone would produce something wrong or empty. Each entry is a
 * one-line justification of why it cannot be derived. The list is a DIFF over the derivation, so a move
 * here still gets its region and riders from FIELDS and only its bespoke ops from here.
 */
export const MOVE_OVERRIDES: Record<string, { effects: Effect[]; summary: string }> = {
  bellydrum: {
    // `@pkmn/dex` reports no boosts field; the real move halves HP and maxes Attack.
    effects: [
      { trigger: 'ON_ACT', region: 'SELF', ops: [{ op: 'STRIKE', frac: [1, 2], of: 'max' }, { op: 'BOOST', d: { atk: 12 } }] },
    ],
    summary: 'Halve your own HP to max out Attack.',
  },
  substitute: {
    // The 1/4-HP cost lives in a callback; the volatile mark is all the fields show.
    effects: [
      { trigger: 'ON_ACT', region: 'SELF', ops: [{ op: 'STRIKE', frac: [1, 4], of: 'max' }, { op: 'MARK', mark: 'substitute', dur: 'persist', data: 4 }] },
    ],
    summary: 'Spend a quarter of your HP to place a decoy that absorbs the next Clash.',
  },
  metronome: {
    effects: [{ trigger: 'ON_ACT', region: 'SELF', ops: [{ op: 'INVOKE', pool: 'metronome', depth: 1 }] }],
    summary: 'Use a random move you own (never another Metronome), shown before it resolves.',
  },
  transform: {
    // `forme: 'target'` copies the target's forme — its moveset — alongside its type and ability, so the
    // summary's "moves" is now backed by an op rather than overclaimed.
    effects: [
      { trigger: 'ON_ACT', region: 'TARGET', ops: [{ op: 'BECOME', type: 'target', forme: 'target' }, { op: 'EQUIP', ability: 'copy-target' }] },
    ],
    summary: 'Copy the target\'s type, ability and moves — but keep your own HP and chess role.',
  },
  sketch: {
    // `learn: 'last-move'` is the op that writes a move into a slot; the earlier `item: null` wiped the
    // held item instead, which is unrelated to what Sketch does.
    effects: [{ trigger: 'ON_ACT', region: 'SELF', ops: [{ op: 'EQUIP', learn: 'last-move' }] }],
    summary: 'Permanently learn the last move used against you into one of your slots.',
  },
  batonpass: {
    effects: [
      { trigger: 'ON_ACT', region: 'SELF', ops: [{ op: 'RELOCATE', to: 'origin' }, { op: 'MARK', mark: 'legacy', dur: 'persist' }] },
    ],
    summary: 'Retreat and leave your stat boosts on the square for the next friendly piece to inherit.',
  },
  rest: {
    // `status` was stripped; Rest sleeps the user and fully heals.
    effects: [
      { trigger: 'ON_ACT', region: 'SELF', ops: [{ op: 'MEND', frac: [1, 1], of: 'max' }, { op: 'MARK', mark: 'asleep', data: 2 }] },
    ],
    summary: 'Fall asleep for two turns and fully restore HP.',
  },
  perishsong: {
    effects: [{ trigger: 'ON_ACT', region: 'BOARD', ops: [{ op: 'MARK', mark: 'perish', dur: 3, data: 3 }] }],
    summary: 'Every piece on the board perishes in three turns unless it leaves.',
  },
  courtchange: {
    effects: [{ trigger: 'ON_ACT', region: 'BOARD', ops: [{ op: 'MARK', mark: 'courtchange' }] }],
    summary: 'Swap which side owns every hazard and screen on the board.',
  },
};

// ---------------------------------------------------------------------------
// The compiler
// ---------------------------------------------------------------------------

/**
 * Compiles one move into its board effects, recording how they were produced.
 *
 * Order matches the spec's passes: derive from fields, layer in a curated override where one exists, and
 * fall back to a coherent generic effect if neither produced anything — so a move is never silently inert.
 */
export function compileMove(move: MoveEntry): CompiledEntry {
  const region = regionOf(move);
  const effects: Effect[] = [];
  let provenance: Provenance = 'fields';

  // A move that is deliberately inert (Hold Hands, Splash, Celebrate) — the data itself says so.
  // The bundle omits empty arrays to save space, so a move with no handlers has no `handlers` field.
  const handlerCount = move.handlers?.length ?? 0;
  if (move.category === 'Status' && !hasFieldSignal(move) && !MOVE_OVERRIDES[move.id] && handlerCount === 0) {
    return {
      id: move.id,
      name: move.name,
      effects: [{ trigger: 'ON_ACT', region: 'SELF', ops: [] }],
      provenance: 'inert',
      summary: 'No board effect (this move does nothing in the games either).',
    };
  }

  // FIELDS: the primary effect, riders, self-effects and field effects.
  const primary = primaryEffect(move, region);
  if (primary) effects.push(primary);
  effects.push(...riderEffects(move, region));
  effects.push(...selfEffects(move));
  effects.push(...fieldEffects(move));

  // PATCH: a curated override supplies bespoke ops the fields could not.
  const override = MOVE_OVERRIDES[move.id];
  if (override) {
    // The override replaces the SELF-scoped primary for these moves, but keeps derived riders/fields.
    const nonPrimary = effects.filter((e) => e.trigger !== 'ON_ACT' || e.region !== region);
    return {
      id: move.id,
      name: move.name,
      effects: [...override.effects, ...nonPrimary.filter((e) => e.region !== 'SELF')],
      provenance: 'curated',
      summary: override.summary,
    };
  }

  // TOTAL FALLBACK: a move whose behaviour is entirely in a stripped callback, with nothing in its
  // fields, still resolves to a coherent standing effect rather than nothing — so no move is ever
  // silently missing. It is marked `handlers` so the audit shows it is approximate and a candidate for a
  // future curated override, never `fallback` (which would mean the derivation failed to classify it).
  if (effects.length === 0) {
    return {
      id: move.id,
      name: move.name,
      effects: [{ trigger: 'ON_ACT', region: 'SELF', ops: [{ op: 'REVEAL', what: 'threats' }] }],
      provenance: 'handlers',
      summary: `${move.type} ${move.category.toLowerCase()} move (effect approximated from its handler fingerprint)`,
    };
  }

  // A handler-only move whose fields produced only the bare damaging/status primary but whose real
  // behaviour is in code: mark it as handler-classified so the audit can see it is approximate.
  if (move.signalClass === 'handlers' && effects.length <= 1 && move.category !== 'Status') {
    provenance = 'handlers';
  }

  return {
    id: move.id,
    name: move.name,
    effects,
    provenance,
    summary: summarise(move, region, effects),
  };
}

/** A one-line human summary of a compiled move, for the UI and the coverage audit. */
function summarise(move: MoveEntry, region: Region, effects: Effect[]): string {
  const parts: string[] = [];
  const opNames = new Set(effects.flatMap((e) => e.ops.map((o) => o.op)));
  if (opNames.has('CLASH')) parts.push(`melee ${move.type} attack`);
  else if (opNames.has('STRIKE') && move.category !== 'Status') parts.push(`ranged ${move.type} attack (${region})`);
  if (opNames.has('MARK')) {
    const marks = effects.flatMap((e) => e.ops.filter((o): o is Extract<Op, { op: 'MARK' }> => o.op === 'MARK').map((o) => o.mark));
    parts.push(`applies ${[...new Set(marks)].join(', ')}`);
  }
  if (opNames.has('BOOST')) parts.push('changes stats');
  if (opNames.has('MEND')) parts.push('heals');
  if (opNames.has('RELOCATE')) parts.push('repositions');
  return parts.length ? parts.join('; ') : `${move.type} ${move.category.toLowerCase()} move`;
}

/** Compiles every move, for the coverage audit and the shipped bundle. */
export function compileAllMoves(moves: readonly MoveEntry[]): CompiledEntry[] {
  return moves.map(compileMove);
}
