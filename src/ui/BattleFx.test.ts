/**
 * The effects timeline is derived from a resolution, so it can never disagree with what the engine did.
 * These tests pin that: the number of impacts equals the number of blows, and each blow's number appears
 * over the piece that actually took it — which is what makes a ROUT read correctly.
 */

import { describe, expect, it } from 'vitest';

import { parseSquare } from '../engine/board.ts';
import type { ResolvedMove } from '../engine/variant.ts';
import { attackerSquareAfter, buildTimeline, defenderSquareAfter, fxDuration } from './BattleFx.tsx';

const FROM = parseSquare('d4');
const TO = parseSquare('d6');

function resolution(over: Partial<ResolvedMove> = {}): ResolvedMove {
  return {
    move: { from: FROM, to: TO, captured: { id: 2, side: 'black', cls: 'pawn' }, capturedSquare: TO, promotion: null, encoded: 1, flags: 0 } as unknown as ResolvedMove['move'],
    side: 'white',
    attacker: { species: 'charizard', type: 'Fire' },
    defender: { species: 'venusaur', type: 'Grass' },
    effectiveness: 2,
    verdict: 'capture',
    attackerHpAfter: 100,
    defenderHpAfter: 0,
    attackerMaxHp: 150,
    defenderMaxHp: 160,
    crit: false,
    momentum: 100,
    blowCount: 2,
    blows: [
      { by: 'attacker', damage: 90, crit: false, targetHpAfter: 70 },
      { by: 'defender', damage: 30, crit: false, targetHpAfter: 120 },
    ],
    moveName: 'Flamethrower',
    moveType: 'Fire',
    statusInflicted: null,
    boostsInflicted: null,
    recoilTaken: 0,
    grantsBonus: false,
    removed: [2],
    kingCaptured: false,
    ...over,
  };
}

describe('battle effects timeline', () => {
  it('plays one impact and one damage number per blow', () => {
    const steps = buildTimeline(resolution());
    expect(steps.filter((s) => s.fx?.kind === 'impact')).toHaveLength(2);
    expect(steps.filter((s) => s.fx?.kind === 'damage')).toHaveLength(2);
  });

  it("puts each blow's number over the piece that took it, after a capture", () => {
    // The board has already applied the outcome: the defender fell on the target square and the attacker
    // now occupies it, so both numbers belong there — the 90 the defender took, and the 30 the attacker did.
    const damage = buildTimeline(resolution()).filter((s) => s.fx?.kind === 'damage').map((s) => s.fx!);
    expect(damage[0]).toMatchObject({ square: TO, amount: 90 });
    expect(damage[1]).toMatchObject({ square: TO, amount: 30 });
  });

  it('follows the pieces after a repel, where both survive on their own squares', () => {
    const damage = buildTimeline(resolution({
      verdict: 'repel',
      defenderHpAfter: 70,
      removed: [],
    })).filter((s) => s.fx?.kind === 'damage').map((s) => s.fx!);
    // The defender held its square; the attacker bounced back to its origin.
    expect(damage[0]).toMatchObject({ square: TO, amount: 90 });
    expect(damage[1]).toMatchObject({ square: FROM, amount: 30 });
  });

  it('anchors the attacker to its origin only when it survives a repel, and nowhere when it falls', () => {
    expect(attackerSquareAfter(resolution({ verdict: 'repel', attackerHpAfter: 40 }))).toBe(FROM);
    expect(attackerSquareAfter(resolution({ verdict: 'capture', attackerHpAfter: 40 }))).toBe(TO);
    expect(attackerSquareAfter(resolution({ verdict: 'rout', attackerHpAfter: 0 }))).toBeNull();
    expect(defenderSquareAfter(resolution({ defenderHpAfter: 0 }))).toBeNull();
    expect(defenderSquareAfter(resolution({ defenderHpAfter: 12 }))).toBe(TO);
  });

  it('announces the move by name and type colour', () => {
    const callout = buildTimeline(resolution()).find((s) => s.fx?.kind === 'callout')!.fx!;
    expect(callout).toMatchObject({ kind: 'callout', text: 'Flamethrower' });
  });

  it('marks a crit on its own blow only', () => {
    const steps = buildTimeline(resolution({
      crit: true,
      blows: [
        { by: 'attacker', damage: 140, crit: true, targetHpAfter: 0 },
        { by: 'defender', damage: 20, crit: false, targetHpAfter: 130 },
      ],
    }));
    const damage = steps.filter((s) => s.fx?.kind === 'damage').map((s) => s.fx as { crit: boolean });
    expect(damage[0]!.crit).toBe(true);
    expect(damage[1]!.crit).toBe(false);
  });

  it('pops a status mark when one landed, after the blows', () => {
    const steps = buildTimeline(resolution({ statusInflicted: 'burned', verdict: 'repel', defenderHpAfter: 40 }));
    const status = steps.find((s) => s.fx?.kind === 'status');
    expect(status).toBeDefined();
    const lastBlow = Math.max(...steps.filter((s) => s.fx?.kind === 'impact').map((s) => s.at));
    expect(status!.at).toBeGreaterThanOrEqual(lastBlow);
    expect(status!.fx).toMatchObject({ mark: 'burned', square: TO });
  });

  it('does nothing for a quiet move', () => {
    expect(buildTimeline(resolution({ defender: null, blows: [], moveName: null }))).toHaveLength(0);
  });

  it('steps are ordered and the reported duration covers them all', () => {
    const r = resolution();
    const steps = buildTimeline(r);
    const times = steps.map((s) => s.at);
    expect(Math.max(...times)).toBeLessThan(fxDuration(r));
    // Blows land in sequence, never simultaneously.
    const impacts = steps.filter((s) => s.fx?.kind === 'impact').map((s) => s.at);
    expect(impacts[1]).toBeGreaterThan(impacts[0]!);
  });
});
