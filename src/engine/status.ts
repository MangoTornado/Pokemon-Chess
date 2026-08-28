/**
 * Status conditions, modelled after the Pokémon TCG rather than the video games.
 *
 * The TCG splits status conditions into two classes with two physical affordances, and that split is not
 * arbitrary: it is the games' volatile/non-volatile distinction encoded in cardboard, regrouped in a way
 * that suits a board game with a small action budget per turn.
 *
 * **Rotation class** — `asleep`, `paralyzed`, `confused`. Turn-scoped, mutually exclusive, newest wins.
 * On the physical card these rotate the card 90° or 180°; on a chess piece the sprite rotates. Because
 * only one may apply at a time and the newest overrides the previous, this is a single-slot state.
 *
 * **Counter class** — `poisoned`, `burned`. Persistent, stackable, marked with counters on the card. On
 * a chess piece these are pips under the sprite. `poisoned` accumulates and kills at three counters;
 * `burned` does not stack in that way but clears on a coin flip.
 *
 * A piece can be poisoned AND burned AND rotation-afflicted at once, but never two rotation conditions.
 *
 * These are provisional pieces of the SPEC's §9 (Status), which lands once the full spec ships. This
 * module gives the game a place to hang them; it does not yet apply them to captures — the moves that
 * inflict them do not exist yet either. `SPEC.md` §9 is being written.
 *
 * See `docs/design/recon-tcg.md` §3 for the measured mapping between games and TCG, and why the TCG
 * mechanism (with the games' 3-turn cap on sleep) is the design.
 */

/**
 * The three turn-scoped, mutually-exclusive rotation-class statuses.
 *
 * Only one may apply to a piece at a time. Applying a new one replaces whichever was there — this is
 * the TCG's "newest condition overriding the previous one" rule.
 */
export type RotationStatus = 'asleep' | 'paralyzed' | 'confused';

/** The two persistent counter-class statuses. */
export type CounterStatus = 'poisoned' | 'burned';

/** Any status condition. Kept together for the UI and for effect filtering. */
export type StatusCondition = RotationStatus | CounterStatus;

export const ROTATION_STATUSES: readonly RotationStatus[] = ['asleep', 'paralyzed', 'confused'];
export const COUNTER_STATUSES: readonly CounterStatus[] = ['poisoned', 'burned'];
export const ALL_STATUSES: readonly StatusCondition[] = [...ROTATION_STATUSES, ...COUNTER_STATUSES];

/**
 * Turn-scoped state for the rotation class.
 *
 * `turns` counts how many times this piece has begun its owner's turn already carrying the status. For
 * sleep it enforces the 3-turn cap, at which point the piece wakes regardless of the coin. For
 * paralysis it distinguishes "just inflicted" from "the tempo tax has been paid". For confusion it is
 * informational — confusion clears by a defined event, not by the counter.
 */
export interface RotationState {
  readonly kind: RotationStatus;
  /** Owner-turns this status has lasted, incrementing at the start of the owner's turn. */
  readonly turns: number;
}

/**
 * Counter-class state for one status.
 *
 * `count` is the number of pips visible under the piece. Zero means the status is not present.
 */
export interface CounterState {
  readonly kind: CounterStatus;
  readonly count: number;
}

/**
 * All the status a single piece is carrying.
 *
 * Empty is the vast majority of pieces most of the time, so callers can treat any missing field as an
 * absence of that condition rather than a special case.
 */
export interface PieceStatus {
  /** The single rotation-class condition present, or absent. */
  readonly rotation?: RotationState;
  /** Poison counters, in `1..POISON_LETHAL_COUNT`. */
  readonly poisoned?: CounterState;
  /** Burn is present when this is set; the `count` field carries how many owner-turns it has lasted. */
  readonly burned?: CounterState;
}

/**
 * Poison kills at three counters — a visible three-turn death clock rather than a hidden HP number.
 *
 * Chosen for legibility: three pips fit under the sprite without crowding, three turns is long enough
 * for the opponent to react, and it matches the TCG's damage-counter economy where 1 counter per
 * checkup is the base rate.
 */
export const POISON_LETHAL_COUNT = 3;

/**
 * How many counters per checkup for each poison flavour.
 *
 * Badly Poisoned (`tox` in Showdown, "Toxic" in-game) is twice as fast, which makes a 2-turn death
 * clock — the TCG's own escalation via cards like Toxicroak ex is ×6, but on a 3-counter track ×2 is
 * the right magnitude.
 */
export const POISON_RATE = { poisoned: 1, badlyPoisoned: 2 } as const;

/**
 * Hard cap on turns asleep.
 *
 * The TCG's raw rule is a coin flip per checkup, geometric with `E = 2` and an unbounded tail. The
 * games cap sleep at 3 turns, and applying that cap here removes the tail without removing the coin —
 * `P(3 turns) = 25%`, so the cap binds a quarter of the time and reads as a visible mercy rather than
 * a hidden rule.
 */
export const SLEEP_TURN_CAP = 3;

// ---------------------------------------------------------------------------
// Predicates and transitions
// ---------------------------------------------------------------------------

/** Whether a rotation status is present. */
export const hasRotationStatus = (status: PieceStatus): boolean => status.rotation !== undefined;

/** Whether any status of any kind is present. */
export const hasAnyStatus = (status: PieceStatus): boolean =>
  status.rotation !== undefined || status.poisoned !== undefined || status.burned !== undefined;

/**
 * Applies a new rotation-class status.
 *
 * Overrides whichever was there — the TCG's "newest wins" rule. Returns a new object; the input is not
 * mutated, since the game's state is immutable-by-convention through the reducer.
 */
export function applyRotation(status: PieceStatus, kind: RotationStatus): PieceStatus {
  return { ...status, rotation: { kind, turns: 0 } };
}

/**
 * Applies or refreshes poison.
 *
 * `severity` selects the tick rate. Applying Badly Poisoned to a piece already poisoned upgrades it;
 * applying Poisoned to one that is already Badly Poisoned does nothing, because a downgrade would be
 * the opponent unwittingly rescuing you.
 */
export function applyPoison(
  status: PieceStatus,
  severity: 'poisoned' | 'badlyPoisoned' = 'poisoned',
): PieceStatus {
  const existing = status.poisoned;
  // A downgrade is a no-op; nothing else changes the counter count on application. The counter grows
  // at checkup, not at the moment of inflicting.
  if (existing && severity === 'poisoned' && existing.count > 1) return status;
  const initialCount = existing?.count ?? 1;
  return { ...status, poisoned: { kind: 'poisoned', count: initialCount } };
}

/** Applies burn if not already present. Burn does not stack, matching the TCG. */
export function applyBurn(status: PieceStatus): PieceStatus {
  if (status.burned) return status;
  return { ...status, burned: { kind: 'burned', count: 1 } };
}

/** Removes every status — the effect of a cleanse, a promotion, or a Full Heal. */
export const CLEANSED: PieceStatus = Object.freeze({});

/** Removes a specific status class, leaving the rest. */
export function cure(status: PieceStatus, kind: StatusCondition): PieceStatus {
  const next = { ...status };
  if (kind === 'poisoned') delete next.poisoned;
  else if (kind === 'burned') delete next.burned;
  else if (next.rotation?.kind === kind) delete next.rotation;
  return next;
}

// ---------------------------------------------------------------------------
// Movement implications the rest of the engine needs to know about
// ---------------------------------------------------------------------------

/**
 * Whether this piece cannot move this turn because of a status.
 *
 * Sleep locks the piece entirely, and paralysis costs it exactly the next activation and then clears.
 * Confusion does not immobilise on its own — it turns a *capture* into a coin flip; the reducer that
 * plays the move handles that.
 *
 * Returns the reason so the UI can explain why a piece is locked.
 */
export function movementLock(status: PieceStatus): 'asleep' | 'paralyzed' | null {
  const r = status.rotation;
  if (!r) return null;
  if (r.kind === 'asleep') return 'asleep';
  if (r.kind === 'paralyzed') return 'paralyzed';
  return null;
}

/**
 * Damage penalty applied to a Physical attack while burned.
 *
 * The games halve the attacker's Attack stat, which is the reason Will-O-Wisp is a real move. In a
 * binary-capture game the equivalent is a Clash penalty rather than a scalar. `−1` is a category-shift
 * on the Clash ladder, which matches how a "one tempo step" reduction reads in the TCG.
 */
export const BURN_CONTACT_PENALTY = -1;
