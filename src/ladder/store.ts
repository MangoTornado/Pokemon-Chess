/**
 * The ladder state, local-first.
 *
 * SPEC §17.11 is firm that no core play is gated behind an account and the profile is local-first, so the
 * ladder must work signed out and simply *sync* when signed in. This hook hides that split: signed in, the
 * rating and badge case are the server's authoritative copy on the profile, updated through the session;
 * signed out, they live in `localStorage` and the Elo maths runs client-side. Either way a caller just
 * reads `rating`/`badges` and calls `record(...)` after a match.
 */

import { useCallback, useState } from 'react';

import type { Session } from '../ui/useSession.ts';
import { BASE_RATING, updateRating, kFactorFor } from './rating.ts';
import { GYM_BY_ID, GYM_LEADERS, highestBadge } from './badges.ts';

const KEY = 'pc.ladder';

interface LocalLadder {
  rating: number;
  games: number;
  badges: string[];
}

function loadLocal(): LocalLadder {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<LocalLadder>;
      return {
        rating: typeof v.rating === 'number' ? v.rating : BASE_RATING,
        games: typeof v.games === 'number' ? v.games : 0,
        badges: Array.isArray(v.badges) ? v.badges.filter((x): x is string => typeof x === 'string') : [],
      };
    }
  } catch {
    // fall through to defaults
  }
  return { rating: BASE_RATING, games: 0, badges: [] };
}

function saveLocal(state: LocalLadder): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage unavailable — the ladder still works for this session, just unremembered
  }
}

export interface LadderView {
  readonly rating: number;
  readonly games: number;
  readonly earned: ReadonlySet<string>;
  /** True when progress is being persisted to a signed-in account rather than only this browser. */
  readonly synced: boolean;
  /** Records a rated result; resolves once persisted. `gymId` awards that badge on a win. */
  record: (input: { opponentRating: number; score: 0 | 0.5 | 1; gymId?: string }) => Promise<void>;
}

export function useLadder(session: Session): LadderView {
  const [local, setLocal] = useState<LocalLadder>(() => loadLocal());
  const signedIn = !!session.profile;

  const rating = signedIn ? session.profile!.rating : local.rating;
  const games = signedIn ? session.profile!.games : local.games;
  const earned = new Set(signedIn ? session.profile!.badges : local.badges);

  const record = useCallback<LadderView['record']>(
    async ({ opponentRating, score, gymId }) => {
      if (session.profile) {
        await session.recordLadderResult({ opponentRating, score, ...(gymId ? { gymId } : {}) });
        return;
      }
      setLocal((prev) => {
        const nextRating = updateRating(prev.rating, opponentRating, score, kFactorFor(prev.games));
        const badges = new Set(prev.badges);
        if (score === 1 && gymId && GYM_BY_ID.has(gymId)) badges.add(gymId);
        const ordered = GYM_LEADERS.filter((g) => badges.has(g.id)).map((g) => g.id);
        const next = { rating: nextRating, games: prev.games + 1, badges: ordered };
        saveLocal(next);
        return next;
      });
    },
    [session],
  );

  return { rating, games, earned, synced: signedIn, record };
}

/** The display badge (highest earned) for a set of earned ids — used by the profile chip and screens. */
export function displayBadge(earned: ReadonlySet<string>): string | null {
  return highestBadge(earned)?.badge ?? null;
}
