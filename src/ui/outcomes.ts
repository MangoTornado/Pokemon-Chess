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
import type { Resolution, ResolutionCause } from '../engine/variant.ts';

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

/** One line naming *why* a resolution happened, which is what stops variance reading as a cheat. */
export function causeLabel(cause: ResolutionCause | null, roll: number | null): string | null {
  if (cause === 'critical-hit') return `Critical hit — rolled ${roll}`;
  if (cause === 'miss') return `Missed — rolled ${roll}`;
  if (cause === 'type') return roll === null ? 'By type matchup' : `By type matchup — rolled ${roll}`;
  return null;
}
