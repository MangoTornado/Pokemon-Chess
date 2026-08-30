/**
 * A small in-memory rate limiter for the endpoints anyone can reach without signing in.
 *
 * There was none anywhere in the server, and its absence was load-bearing for the two ranked-progression
 * exploits: both stories begin "make a second account", and account creation was free and unbounded. Password
 * guessing was too — `login` goes to the trouble of verifying against a decoy hash so a failed attempt takes the
 * same time whether or not the account exists, which defeats user enumeration but does nothing about volume.
 *
 * A fixed-window counter rather than a token bucket: the thing being defended is a human-scale action (signing
 * in, making an account), so the exact smoothing does not matter and a counter is easier to reason about and to
 * explain in an error message. In-memory suits the single-VM deploy the rest of the server assumes; a restart
 * forgives everyone, which is the right failure direction for a limiter that could otherwise lock out a whole
 * NAT after a bad deploy.
 *
 * The clock is injected, as elsewhere in `server/`, so the tests do not sleep.
 */

/** One limit: at most `max` hits per `windowMs` for a given key. */
export interface Limit {
  readonly max: number;
  readonly windowMs: number;
}

/**
 * Sign-in attempts. Ten a minute is far more than a person needs and far less than a guessing run wants.
 *
 * Deliberately keyed per (client, username) at the call site rather than per client alone: keying on the client
 * only would let one attacker lock every user behind a shared NAT out of their own account.
 */
export const LOGIN_LIMIT: Limit = { max: 10, windowMs: 60_000 };

/** New accounts. Enough for a family sharing an address, not enough to farm a ladder. */
export const REGISTER_LIMIT: Limit = { max: 5, windowMs: 60 * 60_000 };

interface Window {
  count: number;
  /** When the current window began. */
  since: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly now: () => number;

  constructor(clock: () => number = () => Date.now()) {
    this.now = clock;
  }

  /**
   * Records a hit against `key` and reports whether it is allowed.
   *
   * Returns the seconds until the window resets when refused, so the caller can say something more useful than
   * "no". Counting the refused hit as well is deliberate: it means hammering the endpoint extends the wait
   * rather than politely holding it open.
   */
  check(key: string, limit: Limit): { ok: true } | { ok: false; retryAfterSeconds: number } {
    const t = this.now();
    this.sweep(t);
    const existing = this.windows.get(key);
    if (!existing || t - existing.since >= limit.windowMs) {
      this.windows.set(key, { count: 1, since: t });
      return { ok: true };
    }
    existing.count += 1;
    if (existing.count <= limit.max) return { ok: true };
    return { ok: false, retryAfterSeconds: Math.ceil((existing.since + limit.windowMs - t) / 1000) };
  }

  /** Forgets a key — used after a *successful* sign-in, so a real user is never punished for a typo run. */
  forgive(key: string): void {
    this.windows.delete(key);
  }

  /** How many keys are being tracked, for a health check. */
  size(): number {
    return this.windows.size;
  }

  /**
   * Drops windows old enough that no live limit could still refer to them.
   *
   * Bounded by the longest window in use rather than per-limit, since one map holds keys from several limits and
   * a key does not record which limit created it.
   */
  private sweep(t: number): void {
    const longest = Math.max(LOGIN_LIMIT.windowMs, REGISTER_LIMIT.windowMs);
    if (this.windows.size < 512) return; // cheap: only bother once the map is worth sweeping
    for (const [key, w] of this.windows) {
      if (t - w.since >= longest) this.windows.delete(key);
    }
  }
}
