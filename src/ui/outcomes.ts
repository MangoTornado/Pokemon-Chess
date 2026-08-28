/**
 * How each capture outcome is presented.
 *
 * Kept in one place because the same four outcomes have to read consistently in three different
 * situations: as a *prediction* while a player considers a move, as a *result* once it resolves, and as a
 * *lesson* in the tutorial. Inconsistency between those is how a player ends up unsure what the rules are.
 *
 * Colour is never the only channel. Each outcome also has a distinct glyph and distinct wording, because
 * roughly one in twelve men cannot reliably separate the green and red these outcomes naturally want.
 */

import type { CaptureOutcome } from '../engine/typechart.ts';
import type { CritFlip, Resolution, ResolutionCause } from '../engine/variant.ts';

export interface OutcomePresentation {
  readonly label: string;
  readonly glyph: string;
  readonly color: string;
  /** What the rule is, phrased for a player who has not read a manual. */
  readonly detail: string;
}

export const OUTCOME_PRESENTATION: Record<CaptureOutcome, OutcomePresentation> = {
  super: {
    label: 'Super effective',
    glyph: '× 2',
    color: '#3fb950',
    detail: 'The capture succeeds and this piece immediately moves again.',
  },
  neutral: {
    label: 'Neutral',
    glyph: '× 1',
    color: '#a0a8b4',
    detail: 'An ordinary chess capture.',
  },
  resisted: {
    label: 'Not very effective',
    glyph: '½',
    color: '#e3a008',
    detail: 'Both pieces are destroyed.',
  },
  immune: {
    label: 'No effect',
    glyph: '⊘',
    color: '#f85149',
    detail: 'This capture is impossible — that piece cannot be touched by this type at all.',
  },
};

export const RESOLUTION_PRESENTATION: Record<Resolution, OutcomePresentation> = {
  quiet: {
    label: 'Move',
    glyph: '→',
    color: '#a0a8b4',
    detail: 'No capture.',
  },
  capture: {
    label: 'Captured',
    glyph: '×',
    color: '#a0a8b4',
    detail: 'The target was removed.',
  },
  'capture-and-continue': {
    label: 'Captured — move again',
    glyph: '↻',
    color: '#3fb950',
    detail: 'The target was removed and this piece may move again.',
  },
  'mutual-destruction': {
    label: 'Both destroyed',
    glyph: '✕',
    color: '#e3a008',
    detail: 'The attack failed to land cleanly and both pieces were destroyed.',
  },
};

/**
 * One line naming *why* a resolution happened, which is what stops variance reading as a cheat.
 *
 * Coins are named as coins rather than as a percentage. A player who is told they had a 6.25% chance has
 * to trust the game; a player who watches four coins land has seen it.
 */
export function causeLabel(cause: ResolutionCause | null, crit: CritFlip | null): string | null {
  if (cause === 'critical-hit') {
    return `Critical hit — ${crit?.coins.length ?? 0} heads`;
  }
  if (cause === 'type') {
    if (!crit) return 'By type matchup';
    const heads = crit.coins.filter(Boolean).length;
    return `By type matchup — ${heads} of ${crit.coins.length} heads, no crit`;
  }
  return null;
}

/** Renders a coin run as characters, so the flip is legible in text and to a screen reader. */
export function coinString(crit: CritFlip): string {
  return crit.coins.map((head) => (head ? '●' : '○')).join(' ');
}
