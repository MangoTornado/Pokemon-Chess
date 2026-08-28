/**
 * The tutorial as data — a lesson is a position and a seed, not a script.
 *
 * `DIRECTION.md` directive 7 makes an interactive tutorial the game's single most important feature,
 * because three rulesets are stacked here — chess movement, the type chart, and the capture variant — and
 * nobody arrives knowing all three. SPEC §18 shows why the tutorial is *cheap*: the engine is pure,
 * deterministic and seeded, so to make a specific outcome happen you do not force a die — you pick a
 * position where the matchup makes that outcome the natural result, and a seed under which it lands. The
 * explanatory beats are keyed to the events the real engine emits (`ResolvedMove`), so a lesson can never
 * describe an outcome the game did not produce, and `lessons.test.ts` runs every lesson headlessly to
 * prove its goal is reachable — a lesson that rots after a rule change fails CI (§18.1, §21.3).
 *
 * The trick that makes the four outcome lessons deterministic is the **type-pinned moveset**: a teaching
 * piece is given four slots of a single type, so it has no coverage move to escape the matchup the lesson
 * is about. A Grass attacker into Steel *must* use its resisted Grass melee, so the ROUT is guaranteed;
 * a Ghost attacker into Normal has genuinely no legal move, so the refusal fires. See SPEC §18.3.
 */

import type { PieceClass, Side } from '../engine/board.ts';
import { parseSquare } from '../engine/board.ts';
import { Position } from '../engine/position.ts';
import type { BattleType } from '../data/schema.ts';
import type { Moveset } from '../game/moveset.ts';
import type { Loadout, PokemonLoadout, ResolvedMove, Verdict } from '../engine/variant.ts';

/** One placed piece in a lesson position. `type` is the single declared battle type it fights as. */
export interface LessonPiece {
  readonly at: string;
  readonly side: Side;
  readonly cls: PieceClass;
  readonly species: string;
  readonly type: BattleType;
  /**
   * When set, the piece fights with a moveset of exactly this type — no coverage. This is what forces the
   * matchup the lesson teaches (a resisted attacker cannot reach for an effective coverage move).
   */
  readonly pin?: BattleType;
  /**
   * When set alongside `pin`, every slot carries this status rider, so a surviving defender is marked —
   * used to teach status without depending on a particular learnset.
   */
  readonly rider?: string;
}

/**
 * The machine-checkable success condition, keyed to what the engine emits.
 *
 * Deliberately a subset of SPEC §18.1's `Goal`: each variant maps to a field of `ResolvedMove` or to the
 * board's refusal event, so completion is detected from real play rather than a parallel script.
 */
export type Goal =
  /** Cause a specific Clash verdict — the four outcome lessons. */
  | { readonly kind: 'causeVerdict'; readonly verdict: Verdict }
  /** Try a capture the type chart forbids, and feel the refusal (§18.3, lesson 4). */
  | { readonly kind: 'attemptBlocked' }
  /** Cause an ADVANTAGE and then actually use the bonus move it grants. */
  | { readonly kind: 'spendBonus' }
  /** Capture the enemy king — the win condition. */
  | { readonly kind: 'captureKing' }
  /** Heed a forecast miss: a super-effective capture that will REPEL, so you play something else instead. */
  | { readonly kind: 'heedMiss' }
  /** Land a critical hit that turns a losing exchange into a capture. */
  | { readonly kind: 'critRescue' }
  /** Inflict a status condition on a surviving defender. */
  | { readonly kind: 'applyStatus' }
  /** Move a piece to a specific square — the piece-movement track teaches geometry this way. */
  | { readonly kind: 'reachSquare'; readonly square: string };

/** When a beat's coaching line is shown. Triggers map to the events a resolution produces. */
export type BeatTrigger =
  | 'enter' // shown when the lesson opens
  | 'done' // shown when the goal is met
  | 'blocked' // a refusal fired
  | Verdict; // a specific verdict just resolved

export interface Beat {
  readonly on: BeatTrigger;
  readonly say: string;
}

/** The two branch tracks plus the shared spine everyone plays. */
export type Track = 'shared' | 'chess-player' | 'pokemon-player';

export interface Lesson {
  readonly id: string;
  readonly track: Track;
  readonly title: string;
  /** One line under the title, framing what this lesson is about before it starts. */
  readonly blurb: string;
  readonly pieces: readonly LessonPiece[];
  /** Side to move. The player always controls this side. */
  readonly turn: Side;
  /** Chosen so the reveal makes the intended outcome reachable (§18.1). */
  readonly seed: string;
  readonly goal: Goal;
  /**
   * Restricts the offered actions to those from these squares, so the lesson steers without a cage — the
   * player still chooses, but among the moves the lesson is about. Absent means every legal move is open.
   */
  readonly allowFrom?: readonly string[];
  readonly beats: readonly Beat[];
}

// ---------------------------------------------------------------------------
// Building a lesson's board
// ---------------------------------------------------------------------------

const CLASS_FEN: Record<PieceClass, string> = {
  pawn: 'p', knight: 'n', bishop: 'b', rook: 'r', queen: 'q', king: 'k',
};

/** A four-slot moveset of a single type, so a pinned piece has no coverage escape. */
export function pinnedMoveset(type: BattleType, rider?: string): Moveset {
  const slot = (name: string, category: 'Physical' | 'Special'): Moveset[number] => ({
    id: `${type.toLowerCase()}-${name}`,
    name,
    type,
    category,
    basePower: 80,
    ...(rider ? { rider: { mark: rider, chance: 100 } } : {}),
  });
  // Two physical, two special of the same type; the Clash picks whichever suits the attacker's stats.
  return [slot('Strike', 'Physical'), slot('Blast', 'Special'), slot('Rush', 'Physical'), slot('Beam', 'Special')];
}

/** Turns a lesson's placed pieces into the FEN placement field (rank 8 down to rank 1). */
function placementFen(pieces: readonly LessonPiece[]): string {
  const board: (string | null)[] = Array.from({ length: 64 }, () => null);
  for (const p of pieces) {
    const sq = parseSquare(p.at);
    const letter = CLASS_FEN[p.cls];
    board[sq] = p.side === 'white' ? letter.toUpperCase() : letter;
  }
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = '';
    let gap = 0;
    for (let file = 0; file < 8; file++) {
      const cell = board[rank * 8 + file];
      if (cell === null) {
        gap++;
      } else {
        if (gap > 0) { row += String(gap); gap = 0; }
        row += cell;
      }
    }
    if (gap > 0) row += String(gap);
    rows.push(row);
  }
  return rows.join('/');
}

export interface LessonSetup {
  readonly position: Position;
  readonly loadout: Loadout;
}

/**
 * Builds the position and loadout for a lesson.
 *
 * Piece ids are assigned by the position in square order, so the loadout is attached deterministically —
 * the same lesson always yields the same board and the same kits.
 */
export function buildLessonSetup(lesson: Lesson): LessonSetup {
  const placement = placementFen(lesson.pieces);
  const fen = `${placement} ${lesson.turn === 'white' ? 'w' : 'b'} - - 0 1`;
  const position = Position.fromFen(fen);

  const loadout = new Map<number, PokemonLoadout>();
  for (const p of lesson.pieces) {
    const piece = position.pieceAt(parseSquare(p.at));
    if (!piece) throw new Error(`lesson ${lesson.id}: no piece landed on ${p.at}`);
    const entry: PokemonLoadout = p.pin
      ? { species: p.species, type: p.type, moves: pinnedMoveset(p.pin, p.rider) }
      : { species: p.species, type: p.type };
    loadout.set(piece.id, entry);
  }
  return { position, loadout };
}

// ---------------------------------------------------------------------------
// Goal detection
// ---------------------------------------------------------------------------

/**
 * Whether a resolved move satisfies a lesson's goal.
 *
 * `attemptBlocked` and `heedMiss` are not decided by a resolution alone — the first is the board's refusal
 * event, the second is the player declining a shown miss — so they are handled by the screen; this covers
 * the goals a single resolution can prove.
 */
export function resolutionMeetsGoal(goal: Goal, resolved: ResolvedMove, hadBonusPending: boolean): boolean {
  switch (goal.kind) {
    case 'causeVerdict':
      return resolved.verdict === goal.verdict;
    case 'captureKing':
      return resolved.kingCaptured;
    case 'spendBonus':
      // The bonus is spent when a move resolves that consumed a pending bonus (a move made while the
      // previous action had already granted one).
      return hadBonusPending;
    case 'critRescue':
      return resolved.crit && (resolved.verdict === 'capture' || resolved.verdict === 'advantage');
    case 'applyStatus':
      // A rider can only land on a defender that survives the exchange (repel, or a rout it lives through).
      // The screen confirms the actual mark via game.statusOf; a resolution alone proves survivability.
      return (resolved.verdict === 'repel' || resolved.verdict === 'rout') && resolved.defenderHpAfter > 0;
    case 'reachSquare':
      return !resolved.defender && resolved.move.to === parseSquare(goal.square);
    default:
      return false;
  }
}
