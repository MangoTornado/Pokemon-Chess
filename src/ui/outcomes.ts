/**
 * How each Clash verdict and each effectiveness tier is presented.
 *
 * Kept in one place because the same outcomes must read consistently as a *prediction* while a player
 * weighs a move, as a *result* once it resolves, and as a *lesson* in the tutorial. Colour is never the
 * only channel — each verdict has a distinct glyph and distinct wording too, because the greens and reds
 * these outcomes want are the pair most commonly confused.
 */

import type { Verdict } from '../engine/variant.ts';

export interface OutcomePresentation {
  readonly label: string;
  readonly glyph: string;
  readonly color: string;
  readonly detail: string;
}

/** Presentation keyed by the effectiveness tier, for the pre-move forecast on the board. */
export type EffectivenessTier = 'super' | 'neutral' | 'resisted' | 'immune';

export function tierOf(multiplier: number): EffectivenessTier {
  if (multiplier === 0) return 'immune';
  if (multiplier < 1) return 'resisted';
  if (multiplier > 1) return 'super';
  return 'neutral';
}

export const TIER_PRESENTATION: Record<EffectivenessTier, OutcomePresentation> = {
  super: {
    label: 'Super effective',
    glyph: '×2',
    color: '#3fb950',
    detail: 'Your attack hits hard. A knockout here lets your piece move again.',
  },
  neutral: {
    label: 'Neutral',
    glyph: '×1',
    color: '#a0a8b4',
    detail: 'An even matchup.',
  },
  resisted: {
    label: 'Not very effective',
    glyph: '½',
    color: '#e3a008',
    detail: 'Your attack is weak here. You may fail to knock it out — and it hits back.',
  },
  immune: {
    label: 'No effect',
    glyph: '⊘',
    color: '#f85149',
    detail: 'This capture is impossible — that type cannot be touched by yours at all.',
  },
};

/** Presentation keyed by the resolved Clash verdict. */
export const VERDICT_PRESENTATION: Record<Verdict, OutcomePresentation> = {
  quiet: {
    label: 'Move',
    glyph: '→',
    color: '#a0a8b4',
    detail: 'No capture.',
  },
  advantage: {
    label: 'Super effective — move again',
    glyph: '↻',
    color: '#3fb950',
    detail: 'The target fell to a super-effective blow and your piece may move again.',
  },
  capture: {
    label: 'Captured',
    glyph: '×',
    color: '#7ee787',
    detail: 'The target fell. Your piece took the square, perhaps wounded.',
  },
  mutual: {
    label: 'Both destroyed',
    glyph: '✕',
    color: '#e3a008',
    detail: 'Both pieces fell in the exchange.',
  },
  rout: {
    label: 'Routed',
    glyph: '⤬',
    color: '#f85149',
    detail: 'Your piece failed to break through and fell to the counterattack.',
  },
  repel: {
    label: 'Repelled',
    glyph: '⟲',
    color: '#f0883e',
    detail: 'Neither piece fell. Your attacker returned to where it started.',
  },
  blocked: {
    label: 'No effect',
    glyph: '⊘',
    color: '#f85149',
    detail: 'This capture is impossible.',
  },
};

/** One line naming why a Clash resolved as it did, so a crit or a bad matchup does not read as a cheat. */
export function verdictCause(verdict: Verdict, crit: boolean, momentum: number): string | null {
  if (verdict === 'quiet') return null;
  const luck = crit ? 'critical hit' : `momentum ${momentum}`;
  return `by the Clash — ${luck}`;
}
