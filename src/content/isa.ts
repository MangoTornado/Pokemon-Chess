/**
 * The board-effect instruction set — the vocabulary every move, ability and item compiles into.
 *
 * The point of the content system is that 950 moves, 311 abilities and 536 items become board effects by
 * a *compiler* rather than by hand. That is only possible because the effects they need are a small,
 * closed vocabulary: an effect is a triple of **when it fires** (a Trigger), **which squares or pieces it
 * touches** (a Region), and **what it does** (a list of Ops). Fifteen wildly different mechanics —
 * a hazard, a field inverter, a state-transfer, a random-move caller, an immunity, a self-halving buff —
 * are all lists of the same twenty ops. See SPEC §13.
 *
 * The Trigger and Region axes are the dataset's measured 14-trigger / 16-region vocabulary. The Op axis
 * is twenty instructions, each a pure mutation over game state.
 *
 * Four properties are load-bearing and enforced by tests:
 *   1. No op increases the piece count — there is no `SUMMON`. This is what the turn-termination proof
 *      rests on (a Substitute is a MARK, not a second piece).
 *   2. `INVOKE.depth` is literally `1` in the type, so Metronome→Metronome is unconstructible rather than
 *      guarded at runtime.
 *   3. The eight ops that write no persistent state are the only ones legal at a `CLASH_*` trigger, which
 *      is what lets the pre-move forecast be computed speculatively and safely.
 *   4. Every state-writing op is reversible, which the engine's journal relies on.
 */

import type { BattleType } from '../data/schema.ts';
import type { PieceClass } from '../engine/board.ts';

// ---------------------------------------------------------------------------
// Triggers — when an effect fires
// ---------------------------------------------------------------------------

/**
 * The 14 triggers. `CLASH_*` fire inside a capture's resolution; the rest fire at points in the turn.
 */
export type Trigger =
  | 'ON_ACT' // the piece uses this move as its action
  | 'ON_ENTER' // the piece arrives on a square (hazards, Intimidate)
  | 'ON_EXIT' // the piece leaves a square
  | 'ON_RESTACK' // an ordering/priority recomputation
  | 'ON_CHECKUP' // end-of-turn upkeep (status ticks, weather, Leftovers)
  | 'CLASH_LEGAL' // decides whether a capture may happen at all (immunities, wards)
  | 'CLASH_CHART' // rewrites the type reading of a capture (Freeze-Dry, Tar Shot)
  | 'CLASH_ROLL' // modifies the damage roll (Choice items, screens)
  | 'CLASH_RESULT' // fires on the resolved outcome (survive-once clamps)
  | 'ON_DAMAGED' // this piece took a blow (thorns, Static)
  | 'ON_STRUCK' // this piece dealt a blow (recoil, Life Orb, drain)
  | 'ON_KO' // a piece was removed (Aftermath, Destiny Bond)
  | 'ON_CAPTURE' // this piece captured (Moxie, self-destruct removal)
  | 'ALWAYS'; // a standing modifier with no event

export const TRIGGERS: readonly Trigger[] = [
  'ON_ACT', 'ON_ENTER', 'ON_EXIT', 'ON_RESTACK', 'ON_CHECKUP', 'CLASH_LEGAL', 'CLASH_CHART',
  'CLASH_ROLL', 'CLASH_RESULT', 'ON_DAMAGED', 'ON_STRUCK', 'ON_KO', 'ON_CAPTURE', 'ALWAYS',
];

// ---------------------------------------------------------------------------
// Regions — which squares or pieces an effect touches
// ---------------------------------------------------------------------------

/**
 * The 16 regions, resolved entirely in terms of `board.ts`'s geometry — `board.ts` is never modified.
 *
 * `KING_RING` is the bounded form of "board-wide": there is no global region an ability can reach, which
 * makes the balance bound on board-wide abilities (Shadow Tag, Arena Trap) a compiler invariant rather
 * than a rule someone must remember.
 */
export type Region =
  | 'MELEE' // the square you step onto (or, for a standing action, any square your pattern reaches)
  | 'SELF' // the caster
  | 'RING1_FOES' // the 8 neighbours, enemies only
  | 'RING1_ALL' // the 8 neighbours, friend and foe
  | 'RAY_LOS' // 8 rays, first occupied square only; the caster does not move
  | 'RAY_ANY' // 8 rays, blockers ignored
  | 'BOARD' // every square / the global field
  | 'OWN_SIDE' // your own army
  | 'ALLY' // one adjacent friendly piece
  | 'RANDOM_FOE' // a seeded-random adjacent enemy
  | 'REACTIVE' // whoever last attacked this piece
  | 'FOE_ZONE' // a segment of the enemy's third rank (hazards)
  | 'TARGET' // the current Clash's defender
  | 'KING_RING' // the 8 squares around this piece — the bounded form of board-wide
  | 'SQUARE' // the square this piece stands on
  | 'NONE'; // no spatial extent — a pure standing modifier

export const REGIONS: readonly Region[] = [
  'MELEE', 'SELF', 'RING1_FOES', 'RING1_ALL', 'RAY_LOS', 'RAY_ANY', 'BOARD', 'OWN_SIDE', 'ALLY',
  'RANDOM_FOE', 'REACTIVE', 'FOE_ZONE', 'TARGET', 'KING_RING', 'SQUARE', 'NONE',
];

// ---------------------------------------------------------------------------
// Ops — what an effect does
// ---------------------------------------------------------------------------

export type Stat = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'acc' | 'eva';
export type DamageSlot = 'bp' | 'atk' | 'def' | 'spa' | 'spd' | 'final' | 'crit-window';
export type VetoScope =
  | 'type' | 'element' | 'class' | 'chain' | 'indirect' | 'rider' | 'ally' | 'absolute'
  | 'bind' | 'item-theft' | 'mark' | 'boost';

/** An interned string id for a board mark (a status, hazard, field, or volatile). */
export type MarkId = string;

/** A restore/loss fraction, `[numerator, denominator]`, of max or current HP. */
export type Fraction = readonly [number, number];

export type Op =
  // A. State writes — one per mutable field of the state model.
  | { readonly op: 'REMOVE' } // the only op that deletes a piece
  | { readonly op: 'RELOCATE'; readonly to: 'origin' | 'push' | 'pull' | 'swap' | 'random-legal'; readonly dist?: 1 | 2 }
  | { readonly op: 'MARK'; readonly mark: MarkId; readonly dur?: number | 'persist'; readonly layers?: 1 | 2 | 3; readonly data?: number }
  | { readonly op: 'UNMARK'; readonly filter: string }
  | { readonly op: 'BOOST'; readonly d: Partial<Record<Stat, number>> }
  | { readonly op: 'MEND'; readonly frac: Fraction; readonly of: 'max' | 'cur' } // restore HP
  | { readonly op: 'BECOME'; readonly type?: BattleType | 'target'; readonly forme?: string; readonly cls?: PieceClass }
  | { readonly op: 'EQUIP'; readonly ability?: string; readonly item?: string | null; readonly consume?: boolean }
  | { readonly op: 'CHARGE'; readonly slot: 0 | 1 | 2 | 3 | 'all'; readonly d: number }

  // B. The Clash & damage pipeline — each a distinct point in the damage order of operations.
  | { readonly op: 'CLASH'; readonly slot: 0 | 1 | 2 | 3 } // the only op that can capture
  | { readonly op: 'STRIKE'; readonly frac: Fraction; readonly of: 'max' | 'cur' } // HP loss from a non-Clash source
  | { readonly op: 'MODIFY'; readonly slot: DamageSlot; readonly x: number }
  | { readonly op: 'CLAMP'; readonly to: 1; readonly when: 'pristine' | 'always' } // survive-once floor
  | { readonly op: 'CHART'; readonly d?: -2 | -1 | 1 | 2; readonly set?: 0 | 1; readonly union?: BattleType }
  | { readonly op: 'VETO'; readonly scope: VetoScope } // makes an action illegal

  // C. Legality & control flow.
  | { readonly op: 'PIERCE'; readonly scope: readonly VetoScope[] }
  | { readonly op: 'TEMPO'; readonly kind: 'grant-bonus' | 'end-turn' | 'skip-next' | 'react' | 'act-last' | 'lock-slot' }
  | { readonly op: 'SCHEDULE'; readonly delay: 1 | 2 | 3 | 4 | 5; readonly then: Effect }
  | { readonly op: 'INVOKE'; readonly pool: string; readonly depth: 1 } // depth is 1 in the type — recursion unconstructible

  // D. Information.
  | { readonly op: 'REVEAL'; readonly what: 'item' | 'slots' | 'threats' };

/** The ops that write no persistent state — the only ones legal at a `CLASH_*` trigger. */
export const STATELESS_OPS: ReadonlySet<Op['op']> = new Set([
  'VETO', 'PIERCE', 'CHART', 'MODIFY', 'CLAMP', 'STRIKE', 'TEMPO', 'REVEAL',
]);

/** No op may increase the piece count; `SUMMON` must never exist. Asserted by tests. */
export const FORBIDDEN_OPS: ReadonlySet<string> = new Set(['SUMMON']);

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

/** A guard predicate on an effect, so a veto or op fires only in the right circumstance. */
export interface Guard {
  /** e.g. `not-super-effective`, `vs-type:Ground`, `pristine`, `contact`, `grounded`. */
  readonly cond: string;
}

/** The compiler's unit of output: when it fires, where it lands, what it does, and any guards. */
export interface Effect {
  readonly trigger: Trigger;
  readonly region: Region;
  readonly ops: readonly Op[];
  readonly guards?: readonly Guard[];
}

// ---------------------------------------------------------------------------
// Provenance — how coverage is made auditable
// ---------------------------------------------------------------------------

/**
 * Which compiler pass produced an entry's effects.
 *
 * Recorded per entry so the coverage ledger is regenerated on every build rather than asserted in prose,
 * and so a test can prove nothing fell through to the fallback by accident.
 *
 * - `fields`   — derived from declarative data fields alone (pass FIELDS).
 * - `handlers` — classified from the handler fingerprint and/or source (passes NAMES/SOURCE).
 * - `curated`  — supplied by a hand-authored override (pass PATCH).
 * - `fallback` — nothing else applied; the generic total fallback fired.
 * - `inert`    — deliberately no effect (a Poké Ball, a valuable, "no competitive use").
 */
export type Provenance = 'fields' | 'handlers' | 'curated' | 'fallback' | 'inert';

/** A compiled content entry: its effects, and the audit trail proving how they were produced. */
export interface CompiledEntry {
  readonly id: string;
  readonly name: string;
  readonly effects: readonly Effect[];
  readonly provenance: Provenance;
  /** A one-line human summary of what it does on the board, for the UI and the audit. */
  readonly summary: string;
}
