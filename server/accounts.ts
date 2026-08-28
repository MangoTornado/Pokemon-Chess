/**
 * Account, profile and collection operations — the service layer over the database.
 *
 * Every write validates with the shared rules the client uses (`src/profile/*`), so the server never
 * trusts a request. Passwords go straight to {@link hashPassword} and are never held in plaintext beyond
 * the hashing call. Reads return only the public projection of a profile; nothing here exposes a hash or
 * a session token.
 */

import { Db } from './db.ts';
import type { AccountRow, ProfileRow } from './db.ts';
import { hashPassword, verifyPassword, newSessionToken, hashToken } from './auth.ts';
import { DEFAULT_AVATAR, normalizeAvatar } from '../src/profile/avatar.ts';
import type { Avatar } from '../src/profile/avatar.ts';
import {
  validateUsername, validatePassword, validateDisplayName, validateBio, validateStatus,
} from '../src/profile/profile.ts';
import type { PublicProfile } from '../src/profile/profile.ts';
import { updateRating, kFactorFor } from '../src/ladder/rating.ts';
import { GYM_BY_ID, GYM_LEADERS, highestBadge } from '../src/ladder/badges.ts';

/** Sessions live a fortnight; a returning player is not re-challenged constantly, but a token expires. */
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The starter collection a new account receives, so it can field a legal 16-piece army immediately —
 * the day-one floor `DIRECTION.md` requires. A spread of accessible, recognisable species across roles.
 */
export const STARTER_SPECIES: readonly string[] = [
  'bulbasaur', 'charmander', 'squirtle', 'pikachu', 'eevee', 'growlithe', 'machop', 'geodude',
  'gastly', 'abra', 'magikarp', 'snorlax', 'dratini', 'larvitar', 'ralts', 'rufflet', 'rockruff', 'applin',
];

export type ServiceError = { error: string; field?: string };
export type Result<T> = { ok: true; value: T } | { ok: false; error: ServiceError };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string, field?: string): Result<never> =>
  ({ ok: false, error: field ? { error, field } : { error } });

export class Accounts {
  private readonly db: Db;
  private readonly now: () => Date;

  // Fields are declared and assigned explicitly rather than via constructor parameter properties, because
  // Node's strip-only TypeScript loader (which runs the server) does not support parameter properties.
  constructor(db: Db, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  // -------------------------------------------------------------------------
  // Registration and login
  // -------------------------------------------------------------------------

  async register(input: {
    username: unknown;
    password: unknown;
    displayName?: unknown;
    avatar?: unknown;
  }): Promise<Result<{ profile: PublicProfile; token: string }>> {
    const username = validateUsername(input.username);
    if (!username.ok) return fail(username.error, 'username');
    const password = validatePassword(input.password);
    if (!password.ok) return fail(password.error, 'password');
    const displayName = validateDisplayName(input.displayName ?? username.value);
    if (!displayName.ok) return fail(displayName.error, 'displayName');

    const lower = username.value.toLowerCase();
    const taken = this.db.raw.prepare('SELECT 1 FROM accounts WHERE username_lower = ?').get(lower);
    if (taken) return fail('That username is taken.', 'username');

    const hash = await hashPassword(password.value);
    const createdAt = this.now().toISOString();
    const avatar = normalizeAvatar(input.avatar ?? DEFAULT_AVATAR);

    // A single transaction so an account never exists without its profile and starter collection.
    const accountId = this.db.raw
      .prepare('INSERT INTO accounts (username, username_lower, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(username.value, lower, hash, createdAt).lastInsertRowid as number;

    this.db.raw
      .prepare('INSERT INTO profiles (account_id, display_name, bio, status, avatar, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(accountId, displayName.value, '', '', JSON.stringify(avatar), createdAt);

    const grant = this.db.raw.prepare(
      'INSERT INTO collection (account_id, species_id, acquired_at) VALUES (?, ?, ?)',
    );
    for (const species of STARTER_SPECIES) grant.run(accountId, species, createdAt);

    const token = this.openSession(accountId);
    return ok({ profile: this.publicProfile(accountId)!, token });
  }

  async login(username: unknown, password: unknown): Promise<Result<{ profile: PublicProfile; token: string }>> {
    if (typeof username !== 'string' || typeof password !== 'string') {
      return fail('Enter your username and password.');
    }
    const row = this.db.raw
      .prepare('SELECT * FROM accounts WHERE username_lower = ?')
      .get(username.toLowerCase()) as AccountRow | undefined;

    // Verify against a decoy hash when the user is unknown, so login time does not reveal whether a
    // username exists (a timing side channel).
    const stored = row?.password_hash ?? DECOY_HASH;
    const good = await verifyPassword(password, stored);
    if (!row || !good) return fail('Incorrect username or password.');

    return ok({ profile: this.publicProfile(row.id)!, token: this.openSession(row.id) });
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  private openSession(accountId: number): string {
    const { token, hash } = newSessionToken();
    const created = this.now();
    const expires = new Date(created.getTime() + SESSION_TTL_MS);
    this.db.raw
      .prepare('INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(hash, accountId, created.toISOString(), expires.toISOString());
    return token;
  }

  /** The account id for a live session token, or null if unknown or expired. Sweeps the expired one. */
  accountForToken(token: string | undefined): number | null {
    if (!token) return null;
    const row = this.db.raw
      .prepare('SELECT account_id, expires_at FROM sessions WHERE token = ?')
      .get(hashToken(token)) as { account_id: number; expires_at: string } | undefined;
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < this.now().getTime()) {
      this.db.raw.prepare('DELETE FROM sessions WHERE token = ?').run(hashToken(token));
      return null;
    }
    return row.account_id;
  }

  logout(token: string | undefined): void {
    if (token) this.db.raw.prepare('DELETE FROM sessions WHERE token = ?').run(hashToken(token));
  }

  // -------------------------------------------------------------------------
  // Profile
  // -------------------------------------------------------------------------

  /** The public profile for an account id, or null if none. */
  publicProfile(accountId: number): PublicProfile | null {
    const acc = this.db.raw.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow | undefined;
    const prof = this.db.raw.prepare('SELECT * FROM profiles WHERE account_id = ?').get(accountId) as ProfileRow | undefined;
    if (!acc || !prof) return null;
    const dex = this.db.raw
      .prepare('SELECT COUNT(DISTINCT species_id) AS n FROM collection WHERE account_id = ?')
      .get(accountId) as { n: number };
    return {
      username: acc.username,
      displayName: prof.display_name,
      bio: prof.bio,
      status: prof.status,
      avatar: JSON.parse(prof.avatar) as Avatar,
      joinedAt: acc.created_at,
      dexCount: dex.n,
      badge: prof.badge,
      rating: prof.rating,
      games: prof.games,
      badges: this.parseBadges(prof.badges),
    };
  }

  /** Earned badge ids, tolerant of a malformed value (an old row, a hand-edited DB). */
  private parseBadges(raw: string): string[] {
    try {
      const value = JSON.parse(raw);
      return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  /** The public profile for a username, for viewing other players. */
  publicProfileByUsername(username: string): PublicProfile | null {
    const acc = this.db.raw
      .prepare('SELECT id FROM accounts WHERE username_lower = ?')
      .get(username.toLowerCase()) as { id: number } | undefined;
    return acc ? this.publicProfile(acc.id) : null;
  }

  /** Updates the editable profile fields, validating each. Any invalid field aborts with its message. */
  updateProfile(
    accountId: number,
    input: { displayName?: unknown; bio?: unknown; status?: unknown; avatar?: unknown },
  ): Result<PublicProfile> {
    const current = this.db.raw.prepare('SELECT * FROM profiles WHERE account_id = ?').get(accountId) as ProfileRow | undefined;
    if (!current) return fail('No such profile.');

    let { display_name: displayName, bio, status } = current;
    if (input.displayName !== undefined) {
      const r = validateDisplayName(input.displayName);
      if (!r.ok) return fail(r.error, 'displayName');
      displayName = r.value;
    }
    if (input.bio !== undefined) {
      const r = validateBio(input.bio);
      if (!r.ok) return fail(r.error, 'bio');
      bio = r.value;
    }
    if (input.status !== undefined) {
      const r = validateStatus(input.status);
      if (!r.ok) return fail(r.error, 'status');
      status = r.value;
    }
    const avatar = input.avatar !== undefined ? normalizeAvatar(input.avatar) : (JSON.parse(current.avatar) as Avatar);

    this.db.raw
      .prepare('UPDATE profiles SET display_name = ?, bio = ?, status = ?, avatar = ?, updated_at = ? WHERE account_id = ?')
      .run(displayName, bio, status, JSON.stringify(avatar), this.now().toISOString(), accountId);
    return ok(this.publicProfile(accountId)!);
  }

  // -------------------------------------------------------------------------
  // Collection / Pokédex
  // -------------------------------------------------------------------------

  /** Every owned individual, most recent first. */
  collection(accountId: number): { id: number; species: string; nickname: string | null; acquiredAt: string }[] {
    const rows = this.db.raw
      .prepare('SELECT id, species_id, nickname, acquired_at FROM collection WHERE account_id = ? ORDER BY id DESC')
      .all(accountId) as { id: number; species_id: string; nickname: string | null; acquired_at: string }[];
    return rows.map((r) => ({ id: r.id, species: r.species_id, nickname: r.nickname, acquiredAt: r.acquired_at }));
  }

  /**
   * Settles a rated head-to-head result between two accounts, updating both ratings and game counts.
   *
   * Each side's rating moves by the Elo update against the other's current rating; a win is 1, a loss 0,
   * a draw ½. Used for ranked online games, which are now server-validated (see `gameValidator.ts`), so a
   * rating can no longer be inflated by a lying client. Badges are untouched — those belong to the Gyms.
   */
  recordHeadToHead(whiteId: number, blackId: number, winner: 'white' | 'black' | 'draw'): void {
    const load = (id: number) =>
      this.db.raw.prepare('SELECT rating, games FROM profiles WHERE account_id = ?').get(id) as
        | { rating: number; games: number }
        | undefined;
    const w = load(whiteId);
    const b = load(blackId);
    if (!w || !b) return;

    const whiteScore: 0 | 0.5 | 1 = winner === 'white' ? 1 : winner === 'draw' ? 0.5 : 0;
    const blackScore: 0 | 0.5 | 1 = winner === 'black' ? 1 : winner === 'draw' ? 0.5 : 0;
    const newWhite = updateRating(w.rating, b.rating, whiteScore, kFactorFor(w.games));
    const newBlack = updateRating(b.rating, w.rating, blackScore, kFactorFor(b.games));

    const stamp = this.now().toISOString();
    const set = this.db.raw.prepare('UPDATE profiles SET rating = ?, games = ?, updated_at = ? WHERE account_id = ?');
    set.run(newWhite, w.games + 1, stamp, whiteId);
    set.run(newBlack, b.games + 1, stamp, blackId);
  }

  /** Grants a species to an account — a post-match reward, a starter pick, or a trade in. */
  grant(accountId: number, species: string): void {
    this.db.raw
      .prepare('INSERT INTO collection (account_id, species_id, acquired_at) VALUES (?, ?, ?)')
      .run(accountId, species, this.now().toISOString());
  }

  /**
   * Claims a post-match reward Pokémon into the collection, returning the updated profile.
   *
   * Validation is deliberately light: the collection has zero competitive weight (SPEC §17.11 — ranked is
   * point-buy from a shared pool, so collection depth is worth nothing in a match), so a spare grant is a
   * completionist reward, not an advantage. The id shape is checked and the total is capped to keep the
   * table from growing without bound; duplicates are allowed, because you own individuals (§17.8).
   */
  claimSpecies(accountId: number, species: unknown): Result<PublicProfile> {
    if (typeof species !== 'string' || !/^[a-z0-9.'-]{1,40}$/.test(species)) return fail('Unknown Pokémon.');
    const { n } = this.db.raw.prepare('SELECT COUNT(*) AS n FROM collection WHERE account_id = ?').get(accountId) as { n: number };
    if (n >= 2000) return fail('Your collection is full.');
    this.grant(accountId, species);
    return ok(this.publicProfile(accountId)!);
  }

  /**
   * Records a rated match result and updates the account's rating, games count, and badge case.
   *
   * The rating maths lives server-side so the number is authoritative — the client reports only the
   * matchup and outcome, never the delta. A gym badge is awarded only on a win against that gym, and the
   * visible `badge` chip is always kept as the highest badge earned (SPEC §17.8: a losing streak never
   * strips an earned badge).
   */
  recordLadderResult(
    accountId: number,
    input: { opponentRating: unknown; score: unknown; gymId?: unknown },
  ): Result<PublicProfile> {
    const prof = this.db.raw.prepare('SELECT * FROM profiles WHERE account_id = ?').get(accountId) as ProfileRow | undefined;
    if (!prof) return fail('No such profile.');

    const opponentRating = Number(input.opponentRating);
    const score = input.score;
    if (!Number.isFinite(opponentRating) || opponentRating < 100 || opponentRating > 4000) {
      return fail('Invalid opponent rating.');
    }
    if (score !== 0 && score !== 0.5 && score !== 1) return fail('Invalid score.');

    const newRating = updateRating(prof.rating, opponentRating, score, kFactorFor(prof.games));
    const badges = new Set(this.parseBadges(prof.badges));

    // Beating a gym leader earns its badge (idempotent — a rematch does not duplicate it).
    if (score === 1 && typeof input.gymId === 'string' && GYM_BY_ID.has(input.gymId)) {
      badges.add(input.gymId);
    }

    const orderedBadges = GYM_LEADERS.filter((g) => badges.has(g.id)).map((g) => g.id);
    const highest = highestBadge(badges);

    this.db.raw
      .prepare('UPDATE profiles SET rating = ?, games = ?, badges = ?, badge = ?, updated_at = ? WHERE account_id = ?')
      .run(newRating, prof.games + 1, JSON.stringify(orderedBadges), highest?.badge ?? null, this.now().toISOString(), accountId);

    return ok(this.publicProfile(accountId)!);
  }
}

/**
 * A precomputed decoy hash, verified against when a username is unknown, so a failed login takes the
 * same time whether or not the account exists. Its plaintext is unguessable and unused.
 */
const DECOY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
