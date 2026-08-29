/**
 * The blow-by-blow battle effects layer.
 *
 * The square tints in `global.css` say what a capture *meant* (its verdict); this says what *happened*.
 * A Clash is an exchange of up to four blows, and until now the player saw only the final HP bars — the
 * drama the engine computes was invisible. `ResolvedMove.blows` carries every blow, so the board can play
 * the exchange out: the attacker lunges, each blow lands with a type-coloured impact and a rising damage
 * number, the struck piece recoils, and a status mark pops if one landed.
 *
 * The timeline is derived from the resolution, not scripted, so it can never disagree with the outcome: if
 * the engine recorded three blows, three land. It is purely presentational — nothing here can change game
 * state — and it is skipped entirely under `prefers-reduced-motion`, where the HP bars and the verdict
 * tint already carry the information.
 */

import { useEffect, useState } from 'react';

import { fileOf, rankOf } from '../engine/board.ts';
import type { Square } from '../engine/board.ts';
import type { ResolvedMove } from '../engine/variant.ts';
import { TYPE_COLORS } from './typeColors.ts';

/** How long after the previous blow the next one lands. */
const BLOW_GAP_MS = 240;
/** The attacker's lunge plays before the first blow connects. */
const FIRST_BLOW_MS = 170;

/** A single presentational effect, positioned on a square (or centred, for the move callout). */
export type Fx =
  | { readonly id: string; readonly kind: 'damage'; readonly square: Square; readonly amount: number; readonly crit: boolean; readonly color: string }
  | { readonly id: string; readonly kind: 'impact'; readonly square: Square; readonly color: string }
  | { readonly id: string; readonly kind: 'status'; readonly square: Square; readonly mark: string }
  | { readonly id: string; readonly kind: 'stage'; readonly square: Square; readonly text: string; readonly drop: boolean }
  | { readonly id: string; readonly kind: 'heal'; readonly square: Square; readonly amount: number }
  | { readonly id: string; readonly kind: 'callout'; readonly text: string; readonly color: string; readonly crit: boolean };

/** Per-square motion the board applies to a piece while the exchange plays. */
export interface Motion {
  /** The attacker lunging toward its target, as a unit-ish direction. */
  readonly lunge?: { readonly dx: number; readonly dy: number };
  /** The piece recoiling from a blow that just landed. */
  readonly hit?: boolean;
}

interface Step {
  readonly at: number;
  readonly fx?: Fx;
  /** Squares to apply a hit recoil to at this moment. */
  readonly hit?: Square;
}

/** How long the whole sequence for a resolution runs. */
export function fxDuration(resolved: ResolvedMove): number {
  return FIRST_BLOW_MS + Math.max(1, resolved.blows.length) * BLOW_GAP_MS + 900;
}

/**
 * Where the attacker stands once the outcome has been applied, or null if it fell.
 *
 * The board updates to the post-Clash position before the effects play, so an effect anchored to the
 * attacker must follow it: it holds the target square after a capture, returns to its origin after a
 * repel, and is gone after a rout or a mutual destruction.
 */
export function attackerSquareAfter(resolved: ResolvedMove): Square | null {
  if (resolved.attackerHpAfter <= 0) return null;
  return resolved.verdict === 'repel' ? resolved.move.from : resolved.move.to;
}

/** Where the defender stands afterwards, or null if it fell. */
export function defenderSquareAfter(resolved: ResolvedMove): Square | null {
  return resolved.defenderHpAfter <= 0 ? null : resolved.move.to;
}

/**
 * Turns a resolution into a timed list of effects.
 *
 * An attacker's blow lands on the defender's square and a defender's counter lands on the attacker's, which
 * is what makes a ROUT read correctly: the numbers appear over the piece that is actually being hurt.
 */
export function buildTimeline(resolved: ResolvedMove): Step[] {
  const steps: Step[] = [];
  if (!resolved.defender) return steps;

  // Anchor every effect to where its piece stands once the outcome is applied, so a number always floats
  // over the piece that took the damage. A piece that fell keeps the square it died on.
  const attackerSquare = attackerSquareAfter(resolved) ?? resolved.move.from;
  const defenderSquare = defenderSquareAfter(resolved) ?? resolved.move.to;
  const typeColor = resolved.moveType ? TYPE_COLORS[resolved.moveType] : '#e6edf3';

  if (resolved.moveName) {
    steps.push({
      at: 0,
      fx: { id: 'callout', kind: 'callout', text: resolved.moveName, color: typeColor, crit: resolved.crit },
    });
  }

  resolved.blows.forEach((blow, i) => {
    const at = FIRST_BLOW_MS + i * BLOW_GAP_MS;
    // The attacker's blow hurts the defender; the defender's counter hurts the attacker.
    const target = blow.by === 'attacker' ? defenderSquare : attackerSquare;
    // A counterblow is the defender's own type, which the UI does not separately carry, so colour the
    // attacker's blows by the move's type and counters neutrally.
    const color = blow.by === 'attacker' ? typeColor : '#c9d1d9';
    steps.push({ at, fx: { id: `impact-${i}`, kind: 'impact', square: target, color }, hit: target });
    steps.push({
      at: at + 40,
      fx: { id: `dmg-${i}`, kind: 'damage', square: target, amount: blow.damage, crit: blow.crit, color },
    });
  });

  const afterBlows = FIRST_BLOW_MS + resolved.blows.length * BLOW_GAP_MS;

  if (resolved.statusInflicted) {
    steps.push({
      at: afterBlows,
      fx: { id: 'status', kind: 'status', square: defenderSquare, mark: resolved.statusInflicted },
    });
  }

  // A stage change — a Speed drop above all — decides who swings first next time, so it is announced.
  if (resolved.boostsInflicted) {
    const text = describeBoosts(resolved.boostsInflicted);
    if (text) {
      steps.push({
        at: afterBlows + (resolved.statusInflicted ? 220 : 0),
        fx: { id: 'stage', kind: 'stage', square: defenderSquare, text, drop: isDrop(resolved.boostsInflicted) },
      });
    }
  }

  return steps;
}

/**
 * Plays a resolution's timeline, returning the currently-visible effects and per-square motion.
 *
 * Returns nothing when motion is reduced, so the caller renders a still board.
 */
export function useBattleFx(resolved: ResolvedMove | null, nonce: number): { fx: readonly Fx[]; motion: ReadonlyMap<Square, Motion> } {
  const [fx, setFx] = useState<readonly Fx[]>([]);
  const [motion, setMotion] = useState<ReadonlyMap<Square, Motion>>(new Map());

  useEffect(() => {
    if (!resolved || !resolved.defender) {
      setFx([]);
      setMotion(new Map());
      return;
    }
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    const steps = buildTimeline(resolved);
    const timers: number[] = [];

    // The attacker lunges along its attack vector — but from wherever it *now* stands, because the board has
    // already applied the outcome: after a capture it occupies the target square (the thrust reads as
    // follow-through), after a repel it is back at its origin (it lunged and bounced), and if it fell there
    // is nothing left to animate.
    const from = resolved.move.from;
    const to = resolved.move.to;
    const attackerSquare = attackerSquareAfter(resolved);
    if (attackerSquare !== null) {
      const dx = Math.sign(fileOf(to) - fileOf(from));
      const dy = Math.sign(rankOf(from) - rankOf(to)); // screen y grows downward as rank falls
      setMotion(new Map([[attackerSquare, { lunge: { dx, dy } }]]));
      timers.push(window.setTimeout(() => setMotion(new Map()), 470));
    }

    for (const step of steps) {
      if (step.fx) {
        const item = step.fx;
        timers.push(window.setTimeout(() => setFx((prev) => [...prev, item]), step.at));
        // Each effect clears itself once its own animation has run, so the layer never accumulates.
        timers.push(window.setTimeout(() => setFx((prev) => prev.filter((f) => f.id !== item.id)), step.at + 1150));
      }
      if (step.hit !== undefined) {
        const square = step.hit;
        timers.push(window.setTimeout(() => setMotion(new Map([[square, { hit: true }]])), step.at));
        timers.push(window.setTimeout(() => setMotion(new Map()), step.at + 330));
      }
    }

    return () => {
      for (const t of timers) window.clearTimeout(t);
      setFx([]);
      setMotion(new Map());
    };
    // `nonce` restarts the sequence when the same move object resolves again (a replayed action).
  }, [resolved, nonce]);

  return { fx, motion };
}

/** `{ spe: -1 }` → `Spe fell!`; `{ atk: 2 }` → `Atk rose sharply!` — the games' own phrasing. */
function describeBoosts(boosts: Readonly<Record<string, number>>): string {
  const parts: string[] = [];
  for (const [key, delta] of Object.entries(boosts)) {
    const label = STAGE_STAT_LABEL[key];
    if (!label || delta === 0) continue;
    const magnitude = Math.abs(delta) >= 3 ? ' drastically' : Math.abs(delta) === 2 ? ' sharply' : '';
    parts.push(`${label} ${delta < 0 ? 'fell' : 'rose'}${magnitude}!`);
  }
  return parts.join(' ');
}

/** Whether a set of boosts is (predominantly) a drop, for colouring. */
function isDrop(boosts: Readonly<Record<string, number>>): boolean {
  return Object.values(boosts).reduce((a, b) => a + b, 0) < 0;
}

const STAGE_STAT_LABEL: Record<string, string> = {
  atk: 'Atk', def: 'Def', spa: 'SpA', spd: 'SpD', spe: 'Speed', accuracy: 'Accuracy', evasion: 'Evasion',
};

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  burned: { text: 'Burned!', color: '#ee8130' },
  poisoned: { text: 'Poisoned!', color: '#a33ea1' },
  'badly-poisoned': { text: 'Badly poisoned!', color: '#a33ea1' },
  paralyzed: { text: 'Paralysed!', color: '#f7d02c' },
  asleep: { text: 'Asleep!', color: '#8b95a5' },
  confused: { text: 'Confused!', color: '#f85149' },
};

/** Where a square sits on the board, as percentages, for absolutely positioning an effect over it. */
function squareStyle(square: Square): { left: string; top: string } {
  return {
    left: `${((fileOf(square) + 0.5) / 8) * 100}%`,
    top: `${((7 - rankOf(square) + 0.5) / 8) * 100}%`,
  };
}

/** Renders the active effects as an overlay. Must sit inside a positioned ancestor covering the board. */
export function FxLayer({ fx }: { fx: readonly Fx[] }) {
  if (fx.length === 0) return null;
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6, overflow: 'hidden' }}>
      {fx.map((f) => {
        if (f.kind === 'callout') {
          return (
            <span
              key={f.id}
              className="pc-callout"
              style={{
                position: 'absolute', left: '50%', top: '4%', transform: 'translateX(-50%)',
                whiteSpace: 'nowrap', fontWeight: 800, fontSize: 'clamp(0.8rem, 2.4cqw, 1.05rem)',
                letterSpacing: '0.02em', color: f.color,
                textShadow: '0 1px 3px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.6)',
              }}
            >
              {f.text}{f.crit ? ' — critical hit!' : ''}
            </span>
          );
        }

        const pos = squareStyle(f.square);

        if (f.kind === 'impact') {
          return (
            <span
              key={f.id}
              className="pc-impact"
              style={{
                position: 'absolute', ...pos, width: '11%', height: '11%',
                marginLeft: '-5.5%', marginTop: '-5.5%', borderRadius: '50%',
                background: `radial-gradient(circle, ${f.color} 0%, ${f.color}88 45%, transparent 72%)`,
              }}
            />
          );
        }

        if (f.kind === 'damage') {
          return (
            <span
              key={f.id}
              className={f.crit ? 'pc-dmg pc-dmg-crit' : 'pc-dmg'}
              style={{
                position: 'absolute', ...pos,
                fontWeight: 900, fontVariantNumeric: 'tabular-nums',
                fontSize: f.crit ? 'clamp(0.85rem, 2.6cqw, 1.15rem)' : 'clamp(0.7rem, 2cqw, 0.95rem)',
                color: f.crit ? '#ffd866' : '#ffffff',
                textShadow: `0 1px 2px rgba(0,0,0,0.95), 0 0 10px ${f.color}`,
              }}
            >
              −{f.amount}
            </span>
          );
        }

        if (f.kind === 'heal') {
          return (
            <span
              key={f.id}
              className="pc-heal"
              style={{
                position: 'absolute', ...pos, fontWeight: 800, fontVariantNumeric: 'tabular-nums',
                fontSize: 'clamp(0.66rem, 1.9cqw, 0.9rem)', color: '#3fb950',
                textShadow: '0 1px 2px rgba(0,0,0,0.9)',
              }}
            >
              +{f.amount}
            </span>
          );
        }

        if (f.kind === 'stage') {
          return (
            <span
              key={f.id}
              className="pc-status-pop"
              style={{
                position: 'absolute', ...pos, whiteSpace: 'nowrap',
                fontWeight: 800, fontSize: 'clamp(0.58rem, 1.6cqw, 0.78rem)',
                color: f.drop ? '#f0883e' : '#58a6ff',
                textShadow: '0 1px 2px rgba(0,0,0,0.95)',
              }}
            >
              {f.text}
            </span>
          );
        }

        const label = STATUS_LABEL[f.mark] ?? { text: f.mark, color: '#e6edf3' };
        return (
          <span
            key={f.id}
            className="pc-status-pop"
            style={{
              position: 'absolute', ...pos, whiteSpace: 'nowrap',
              fontWeight: 800, fontSize: 'clamp(0.6rem, 1.7cqw, 0.8rem)', color: label.color,
              textShadow: '0 1px 2px rgba(0,0,0,0.95)',
            }}
          >
            {label.text}
          </span>
        );
      })}
    </div>
  );
}
