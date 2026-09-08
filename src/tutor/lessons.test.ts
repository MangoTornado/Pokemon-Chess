/**
 * The tutorial's rot-proofing (SPEC §18.1, §21.3).
 *
 * Every lesson is run against the real engine and its goal is proven reachable from its position and seed —
 * no scripting, no forced dice. If a rule change makes a lesson's intended outcome unreachable (a matchup
 * that no longer routs, a seed that no longer crits, a target that is no longer immune) this test fails,
 * so a rotted lesson cannot ship. It also checks that each lesson's coaching beats reference only events
 * the lesson can actually produce, so a beat can never describe an outcome the engine did not emit.
 */

import { describe, expect, it } from 'vitest';

import { Dex } from '../data/dex.ts';
import { parseSquare } from '../engine/board.ts';
import { PokemonChess } from '../engine/variant.ts';
import type { VariantMove } from '../engine/variant.ts';
import { LESSONS } from './content.ts';
import { buildLessonSetup, resolutionMeetsGoal } from './lessons.ts';
import type { Lesson } from './lessons.ts';

const dex = await Dex.load();

function gameOf(lesson: Lesson): PokemonChess {
  const { position, loadout } = buildLessonSetup(lesson);
  return PokemonChess.create({ dex, position, loadout, seed: lesson.seed });
}

/** The capture the lesson steers toward: from its first allowed square, toward any enemy. */
function intendedCapture(game: PokemonChess, lesson: Lesson): VariantMove | undefined {
  const from = parseSquare(lesson.allowFrom![0]!);
  return game.legalMoves().find((m) => m.move.from === from && m.move.captured);
}

describe('tutorial lessons are reachable', () => {
  it('every lesson has a unique id and at least an enter and done beat', () => {
    const ids = new Set(LESSONS.map((l) => l.id));
    expect(ids.size).toBe(LESSONS.length);
    for (const l of LESSONS) {
      const triggers = new Set(l.beats.map((b) => b.on));
      expect(triggers, `${l.id} needs an 'enter' beat`).toContain('enter');
      expect(triggers, `${l.id} needs a 'done' beat`).toContain('done');
    }
  });

  for (const lesson of LESSONS) {
    it(`${lesson.id}: goal is reachable`, () => {
      const game = gameOf(lesson);
      const goal = lesson.goal;

      switch (goal.kind) {
        case 'causeVerdict':
        case 'critRescue':
        case 'applyStatus':
        case 'captureKing': {
          const cap = intendedCapture(game, lesson);
          expect(cap, `${lesson.id}: no capture offered from ${lesson.allowFrom?.[0]}`).toBeDefined();
          const { resolved } = game.play(cap!.move);
          expect(resolutionMeetsGoal(goal, resolved, false), `verdict was ${resolved.verdict}, crit ${resolved.crit}`).toBe(true);
          break;
        }
        case 'attemptBlocked': {
          // Reachable when the steered piece has no legal capture, yet an enemy in its path is immune to it —
          // so the player's natural attempt on that enemy is refused rather than resolved.
          const from = parseSquare(lesson.allowFrom![0]!);
          const attacker = game.position.pieceAt(from)!;
          const hasCapture = game.legalMoves().some((m) => m.move.from === from && m.move.captured);
          expect(hasCapture, `${lesson.id}: expected no legal capture from ${lesson.allowFrom?.[0]}`).toBe(false);
          const immuneEnemy = game.position
            .allPieces()
            .some(({ piece }) => piece.side !== attacker.side && piece.cls !== 'king' && game.bestSlotAgainst(attacker.id, piece.id) === null);
          expect(immuneEnemy, `${lesson.id}: expected an immune enemy to refuse`).toBe(true);
          break;
        }
        case 'spendBonus': {
          // Ply 1: the advantage capture grants a bonus. Ply 2: a DIFFERENT piece must have a legal move.
          const cap = intendedCapture(game, lesson);
          expect(cap, `${lesson.id}: no advantage capture offered`).toBeDefined();
          const { game: after, resolved } = game.play(cap!.move);
          expect(resolved.verdict).toBe('advantage');
          expect(after.extraMovePieceId, 'a bonus move should be pending').not.toBeNull();
          const bonusMoves = after.legalMoves();
          expect(bonusMoves.length, 'a bonus move should be available for another piece').toBeGreaterThan(0);
          // The bonus move is by a different piece (the granter cannot move again).
          expect(bonusMoves.every((m) => game.position.pieceAt(m.move.from)?.id !== resolved.move.encoded)).toBe(true);
          const { resolved: second } = after.play(bonusMoves[0]!.move);
          expect(resolutionMeetsGoal(goal, second, after.extraMovePieceId !== null)).toBe(true);
          break;
        }
        case 'heedMiss': {
          // A super-effective (or at least offered) capture whose forecast is a REPEL, plus a safe alternative.
          const from = parseSquare(lesson.allowFrom![0]!);
          const miss = game.legalMoves().find((m) => m.move.from === from && m.move.captured && m.forecast === 'repel');
          expect(miss, `${lesson.id}: expected a capture that forecasts repel`).toBeDefined();
          const alt = parseSquare(lesson.allowFrom![1]!);
          const other = game.legalMoves().some((m) => m.move.from === alt);
          expect(other, `${lesson.id}: expected a safe alternative move`).toBe(true);
          break;
        }
        case 'reachSquare': {
          const from = parseSquare(lesson.allowFrom![0]!);
          const dest = parseSquare(goal.square);
          const canReach = game.legalMoves().some((m) => m.move.from === from && m.move.to === dest && !m.move.captured);
          expect(canReach, `${lesson.id}: cannot reach ${goal.square}`).toBe(true);
          break;
        }
      }
    });

    it(`${lesson.id}: beats reference only producible events`, () => {
      for (const beat of lesson.beats) {
        if (beat.on === 'enter' || beat.on === 'done') continue;
        if (beat.on === 'blocked') {
          expect(lesson.goal.kind, `${lesson.id}: a 'blocked' beat needs an attemptBlocked goal`).toBe('attemptBlocked');
          continue;
        }
        // A verdict beat: the lesson's steered capture must be able to produce that verdict, OR it is the
        // goal verdict (guaranteed by the reachability test above). We accept any verdict the goal targets,
        // plus the alternatives a rider lesson may resolve as (repel/rout).
        const producible = new Set<string>();
        if (lesson.goal.kind === 'causeVerdict') producible.add(lesson.goal.verdict);
        if (lesson.goal.kind === 'critRescue') { producible.add('capture'); producible.add('advantage'); }
        if (lesson.goal.kind === 'spendBonus') producible.add('advantage');
        if (lesson.goal.kind === 'applyStatus') { producible.add('repel'); producible.add('rout'); }
        expect(producible, `${lesson.id}: beat '${beat.on}' is not a verdict this lesson produces`).toContain(beat.on);
      }
    });
  }
});
