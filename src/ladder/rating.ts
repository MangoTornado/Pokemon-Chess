/**
 * The rating number behind the ladder.
 *
 * SPEC §17.10 calls for Glicko-2 once human matchmaking exists; until then the ladder is single-player
 * against rated AI, where a full Glicko deviation/volatility model has nothing to estimate — every
 * opponent's strength is known exactly. So this is a clean Elo update against a known opponent rating,
 * stored as the single `rating` integer the accounts schema already carries. The seam is deliberate: when
 * live opponents arrive (tract: multiplayer), this module gains a Glicko path without the callers changing,
 * because they already speak in (playerRating, opponentRating, score).
 */

/** The rating everyone starts at, matching the accounts default. */
export const BASE_RATING = 1500;

/** Ratings never fall below this, so a losing streak cannot produce a nonsensical negative number. */
export const RATING_FLOOR = 100;

/** The expected score (win probability) for `a` against `b` on the logistic Elo curve. */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/**
 * The new rating after a game.
 *
 * `score` is 1 for a win, 0 for a loss, 0.5 for a draw. `k` is the sensitivity — larger swings the rating
 * faster, which is what a provisional (few-games) player wants; callers pass a higher k early and settle it
 * as games accumulate.
 */
export function updateRating(playerRating: number, opponentRating: number, score: 0 | 0.5 | 1, k = 32): number {
  const expected = expectedScore(playerRating, opponentRating);
  const next = playerRating + k * (score - expected);
  return Math.max(RATING_FLOOR, Math.round(next));
}

/**
 * The K-factor for a player with `games` rated games behind them.
 *
 * A steep 48 while provisional (the first ten games move fast so a strong new player climbs quickly),
 * settling to a stable 24 afterwards.
 */
export function kFactorFor(games: number): number {
  return games < 10 ? 48 : 24;
}

/**
 * The league tier a rating sits in, themed after the game's competitive ladders.
 *
 * This is the matchmaking-facing number's human face — distinct from the gym badge case (see `badges.ts`),
 * which is an achievement track that a bad run never strips.
 */
export interface LeagueTier {
  readonly id: string;
  readonly name: string;
  /** Inclusive lower bound of the tier. */
  readonly floor: number;
  /** A colour for the tier chip. */
  readonly color: string;
}

export const LEAGUE_TIERS: readonly LeagueTier[] = [
  { id: 'rookie', name: 'Rookie League', floor: 0, color: '#9aa4b2' },
  { id: 'great', name: 'Great League', floor: 1350, color: '#3b82f6' },
  { id: 'ultra', name: 'Ultra League', floor: 1550, color: '#eab308' },
  { id: 'master', name: 'Master League', floor: 1750, color: '#a855f7' },
  { id: 'champion', name: 'Champion League', floor: 1950, color: '#ef4444' },
];

/** The tier a rating currently sits in (highest tier whose floor it clears). */
export function tierFor(rating: number): LeagueTier {
  let tier = LEAGUE_TIERS[0]!;
  for (const t of LEAGUE_TIERS) if (rating >= t.floor) tier = t;
  return tier;
}

/** Progress toward the next tier: the next tier and how far into the current band the rating sits (0..1). */
export function tierProgress(rating: number): { current: LeagueTier; next: LeagueTier | null; fraction: number } {
  const current = tierFor(rating);
  const idx = LEAGUE_TIERS.findIndex((t) => t.id === current.id);
  const next = LEAGUE_TIERS[idx + 1] ?? null;
  if (!next) return { current, next: null, fraction: 1 };
  const span = next.floor - current.floor;
  const fraction = span > 0 ? Math.max(0, Math.min(1, (rating - current.floor) / span)) : 1;
  return { current, next, fraction };
}
