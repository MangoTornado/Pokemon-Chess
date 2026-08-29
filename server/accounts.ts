/**
 * Account, profile and collection operations — the service layer over the database.
 *
 * Every write validates with the shared rules the client uses (`src/profile/*`), so the server never
 * trusts a request. Passwords go straight to {@link hashPassword} and are never held in plaintext beyond
 * the hashing call. Reads return only the public projection of a profile; nothing here exposes a hash or
 * a session token.
 */

import { Db } from './db.ts';
import type { AccountRow, ProfileRow, TradeRow } from './db.ts';
import { hashPassword, verifyPassword, newSessionToken, hashToken } from './auth.ts';
import { DEFAULT_AVATAR, normalizeAvatar } from '../src/profile/avatar.ts';
import type { Avatar } from '../src/profile/avatar.ts';
import {
  validateUsername, validatePassword, validateDisplayName, validateBio, validateStatus,
} from '../src/profile/profile.ts';
import type { FriendView, ListingView, PublicProfile, TradeView, WonderResult } from '../src/profile/profile.ts';
import { updateRating, kFactorFor } from '../src/ladder/rating.ts';
import { GYM_BY_ID, GYM_LEADERS, highestBadge } from '../src/ladder/badges.ts';
import type { Encounter, MatchOutcome } from '../src/game/encounters.ts';

/** Sessions live a fortnight; a returning player is not re-challenged constantly, but a token expires. */
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The starter team a new account receives.
 *
 * Enough to field a full legal army on day one — the floor `DIRECTION.md` requires — and chosen so the very
 * first game already teaches the type layer. That means: one of each Kanto starter so the Fire/Water/Grass
 * triangle is in hand from the start; a spread that covers most of the chart, so almost every matchup a
 * player meets has an answer somewhere on the bench; and eight unevolved species, so the evolution loop has
 * something to work on immediately.
 *
 * Recognisable on purpose. A new player should see names they know, not a random draw from 1025.
 */
export const STARTER_SPECIES: readonly string[] = [
  // The starter triangle — the first type lesson, in three Pokémon.
  'bulbasaur', 'charmander', 'squirtle',
  // Familiar faces that also widen the type coverage.
  'pikachu', 'eevee', 'machop', 'geodude', 'gastly', 'abra', 'growlithe',
  // Unevolved species with somewhere to go, so evolution is reachable at once.
  'dratini', 'larvitar', 'ralts', 'rockruff', 'applin', 'rufflet', 'magikarp',
  // One bulky body, so a new army has something that can hold a square.
  'snorlax',
];

export type ServiceError = { error: string; field?: string };
export type Result<T> = { ok: true; value: T } | { ok: false; error: ServiceError };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (error: string, field?: string): Result<never> =>
  ({ ok: false, error: field ? { error, field } : { error } });

/** Wins needed to train an individual before it can evolve (SPEC §17.8 "through play"). */
export const EVOLVE_XP = 3;

/**
 * How recently an account must have been seen to count as online.
 *
 * Generously wide because presence here is polled from ordinary requests rather than a socket: a player
 * reading their collection is still "around", and a window shorter than the poll interval would flicker.
 */
export const PRESENCE_WINDOW_MS = 3 * 60 * 1000;

export class Accounts {
  private readonly db: Db;
  private readonly now: () => Date;
  /** Resolves a species' possible evolutions; injected so the service need not import the dex. */
  private readonly evosOf: (species: string) => string[];
  /**
   * Rolls a post-match encounter, and reports whether an offer counts as rare-or-better for the pity counter.
   *
   * Injected rather than imported so this service stays dex-free and a test can supply a fixed roll.
   */
  private readonly rollEncounter: ((outcome: MatchOutcome, seed: string, pity: number) => Encounter) | undefined;
  private readonly satisfiesPity: ((choices: readonly string[]) => boolean) | undefined;

  // Fields are declared and assigned explicitly rather than via constructor parameter properties, because
  // Node's strip-only TypeScript loader (which runs the server) does not support parameter properties.
  constructor(
    db: Db,
    now: () => Date = () => new Date(),
    evosOf: (species: string) => string[] = () => [],
    encounters?: {
      roll: (outcome: MatchOutcome, seed: string, pity: number) => Encounter;
      satisfiesPity: (choices: readonly string[]) => boolean;
    },
  ) {
    this.db = db;
    this.now = now;
    this.evosOf = evosOf;
    this.rollEncounter = encounters?.roll;
    this.satisfiesPity = encounters?.satisfiesPity;
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

    // A single transaction so an account never exists without its profile and starter collection. This comment
    // used to be the only thing making that true: the writes ran in autocommit, so a failure part-way left an
    // account with no profile (every later `publicProfile` read returns null) while permanently reserving the
    // username, which cannot be released through any API. The password hash is computed above, outside the
    // transaction, because it is deliberately slow and must not hold a write lock.
    //
    // The UNIQUE index on username_lower is what actually decides the race: two simultaneous registrations both
    // pass the availability check above, and the loser's INSERT throws in here and rolls back cleanly.
    let accountId: number;
    let token: string;
    this.db.raw.prepare('BEGIN').run();
    try {
      accountId = this.db.raw
        .prepare('INSERT INTO accounts (username, username_lower, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(username.value, lower, hash, createdAt).lastInsertRowid as number;

      this.db.raw
        .prepare('INSERT INTO profiles (account_id, display_name, bio, status, avatar, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(accountId, displayName.value, '', '', JSON.stringify(avatar), createdAt);

      const grant = this.db.raw.prepare(
        'INSERT INTO collection (account_id, species_id, acquired_at) VALUES (?, ?, ?)',
      );
      for (const species of STARTER_SPECIES) grant.run(accountId, species, createdAt);

      token = this.openSession(accountId);
      this.db.raw.prepare('COMMIT').run();
    } catch (error) {
      this.db.raw.prepare('ROLLBACK').run();
      // A lost username race is the expected failure here and reads as a taken name, not a server error.
      const message = error instanceof Error ? error.message : '';
      if (/UNIQUE|constraint/i.test(message)) return fail('That username is taken.', 'username');
      throw error;
    }

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
    // Any authenticated request is evidence the player is around, which is all presence needs.
    this.touchPresence(row.account_id);
    return row.account_id;
  }

  /** Records that an account was just active. Cheap enough to run on every authenticated request. */
  private touchPresence(accountId: number): void {
    this.db.raw
      .prepare('UPDATE profiles SET last_seen = ? WHERE account_id = ?')
      .run(this.now().toISOString(), accountId);
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
  collection(accountId: number): { id: number; species: string; nickname: string | null; xp: number; evolvesTo: string[]; acquiredAt: string }[] {
    const rows = this.db.raw
      .prepare('SELECT id, species_id, nickname, xp, acquired_at FROM collection WHERE account_id = ? ORDER BY id DESC')
      .all(accountId) as { id: number; species_id: string; nickname: string | null; xp: number; acquired_at: string }[];
    return rows.map((r) => ({
      id: r.id,
      species: r.species_id,
      nickname: r.nickname,
      xp: r.xp,
      // Evolutions the individual is ready for: it must have trained enough and have somewhere to evolve.
      evolvesTo: r.xp >= EVOLVE_XP ? this.evosOf(r.species_id) : [],
      acquiredAt: r.acquired_at,
    }));
  }

  /** Trains the whole team by one — every owned individual gains a point of evolution progress on a win. */
  grantTeamXp(accountId: number): void {
    this.db.raw.prepare('UPDATE collection SET xp = xp + 1 WHERE account_id = ?').run(accountId);
  }

  /**
   * Evolves an owned individual into one of its evolutions, spending its training.
   *
   * "Evolving through play" (§17.8): an individual trains as your team wins, and once trained can evolve —
   * changing which species it is (and, for a branching line like Eevee, which one you choose).
   */
  evolve(accountId: number, collectionId: unknown, target: unknown): Result<PublicProfile> {
    if (!Number.isInteger(collectionId) || typeof target !== 'string') return fail('Invalid evolution.');
    const cid = collectionId as number;
    const row = this.db.raw
      .prepare('SELECT species_id, xp FROM collection WHERE id = ? AND account_id = ?')
      .get(cid, accountId) as { species_id: string; xp: number } | undefined;
    if (!row) return fail('You do not own that Pokémon.');
    if (row.xp < EVOLVE_XP) return fail('This Pokémon needs more training to evolve.');
    if (!this.evosOf(row.species_id).includes(target)) return fail('It cannot evolve into that.');
    this.db.raw
      .prepare('UPDATE collection SET species_id = ?, xp = xp - ? WHERE id = ? AND account_id = ?')
      .run(target, EVOLVE_XP, cid, accountId);
    return ok(this.publicProfile(accountId)!);
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

    // The winner's team trains (a draw trains neither).
    if (winner === 'white') this.grantTeamXp(whiteId);
    else if (winner === 'black') this.grantTeamXp(blackId);

    // Both players meet wild Pokémon; the loser simply meets fewer.
    this.issueEncounter(whiteId, winner === 'draw' ? 'draw' : winner === 'white' ? 'win' : 'loss');
    this.issueEncounter(blackId, winner === 'draw' ? 'draw' : winner === 'black' ? 'win' : 'loss');
  }

  // -------------------------------------------------------------------------
  // Friends
  // -------------------------------------------------------------------------

  private accountIdForUsername(username: string): number | null {
    const row = this.db.raw.prepare('SELECT id FROM accounts WHERE username_lower = ?').get(username.toLowerCase()) as
      | { id: number }
      | undefined;
    return row?.id ?? null;
  }

  /**
   * Sends a friend request, or accepts one that is already pending from the other side.
   *
   * Requesting someone who has already requested you is the natural way to accept, so the same call does
   * both — no separate "accept" needed when both sides ask.
   */
  requestFriend(accountId: number, username: unknown): Result<{ state: 'pending' | 'accepted' }> {
    if (typeof username !== 'string') return fail('Choose someone to add.');
    const other = this.accountIdForUsername(username);
    if (other === null) return fail('No player with that name.');
    if (other === accountId) return fail('You cannot add yourself.');

    const existing = this.db.raw
      .prepare('SELECT id, requester, status FROM friendships WHERE (requester = ? AND addressee = ?) OR (requester = ? AND addressee = ?)')
      .get(accountId, other, other, accountId) as { id: number; requester: number; status: string } | undefined;

    if (existing) {
      if (existing.status === 'accepted') return fail('You are already friends.');
      if (existing.status === 'blocked') return fail('That player cannot be added.');
      // A pending request from the other side: this call accepts it.
      if (existing.requester === other) {
        this.db.raw.prepare('UPDATE friendships SET status = ? WHERE id = ?').run('accepted', existing.id);
        return ok({ state: 'accepted' });
      }
      return fail('You have already sent a request.');
    }

    this.db.raw
      .prepare('INSERT INTO friendships (requester, addressee, status, created_at) VALUES (?, ?, ?, ?)')
      .run(accountId, other, 'pending', this.now().toISOString());
    return ok({ state: 'pending' });
  }

  /** Accepts a pending incoming request. */
  acceptFriend(accountId: number, username: unknown): Result<{ ok: true }> {
    if (typeof username !== 'string') return fail('Choose a request.');
    const other = this.accountIdForUsername(username);
    if (other === null) return fail('No player with that name.');
    const info = this.db.raw
      .prepare("UPDATE friendships SET status = 'accepted' WHERE requester = ? AND addressee = ? AND status = 'pending'")
      .run(other, accountId);
    if (info.changes === 0) return fail('No pending request from that player.');
    return ok({ ok: true });
  }

  /** Removes a friend, or withdraws/declines a request — the same "no longer connected" action. */
  removeFriend(accountId: number, username: unknown): Result<{ ok: true }> {
    if (typeof username !== 'string') return fail('Choose someone to remove.');
    const other = this.accountIdForUsername(username);
    if (other === null) return fail('No player with that name.');
    this.db.raw
      .prepare('DELETE FROM friendships WHERE (requester = ? AND addressee = ?) OR (requester = ? AND addressee = ?)')
      .run(accountId, other, other, accountId);
    return ok({ ok: true });
  }

  /** Friends and pending requests for an account, each with the public bits needed to show a row. */
  friends(accountId: number): FriendView[] {
    const rows = this.db.raw
      .prepare(`
        SELECT f.requester, f.addressee, f.status,
               a.username, p.display_name, p.avatar, p.rating, p.badge, p.last_seen
          FROM friendships f
          JOIN accounts a ON a.id = CASE WHEN f.requester = ? THEN f.addressee ELSE f.requester END
          JOIN profiles p ON p.account_id = a.id
         WHERE (f.requester = ? OR f.addressee = ?) AND f.status IN ('pending', 'accepted')
         ORDER BY f.status, a.username
      `)
      .all(accountId, accountId, accountId) as {
        requester: number; addressee: number; status: string;
        username: string; display_name: string; avatar: string; rating: number; badge: string | null;
        last_seen: string | null;
      }[];

    const now = this.now().getTime();
    return rows.map((r) => ({
      username: r.username,
      displayName: r.display_name,
      avatar: JSON.parse(r.avatar) as Avatar,
      state: r.status === 'accepted' ? 'friend' : r.requester === accountId ? 'outgoing' : 'incoming',
      rating: r.rating,
      badge: r.badge,
      online: r.last_seen !== null && now - new Date(r.last_seen).getTime() <= PRESENCE_WINDOW_MS,
    }));
  }

  // -------------------------------------------------------------------------
  // Wonder trade
  // -------------------------------------------------------------------------

  /**
   * Deposits one of your Pokémon for a stranger's, sight unseen.
   *
   * The deposit leaves your collection immediately and joins a pool. If someone else's is already waiting you
   * swap on the spot; otherwise yours waits for the next depositor. That is what makes it a *wonder* trade —
   * you give something up before you know what you get — and holding the Pokémon in the pool rather than in
   * the collection is what stops it being traded twice or fielded while it waits.
   *
   * You never receive your own deposit back.
   */
  wonderTrade(accountId: number, collectionId: unknown): Result<WonderResult> {
    if (!Number.isInteger(collectionId)) return fail('Choose a Pokémon to send.');
    const cid = collectionId as number;
    const mine = this.db.raw
      .prepare('SELECT species_id, nickname, xp FROM collection WHERE id = ? AND account_id = ?')
      .get(cid, accountId) as { species_id: string; nickname: string | null; xp: number } | undefined;
    if (!mine) return fail('You do not own that Pokémon.');

    // Someone else's deposit, oldest first so the pool drains fairly.
    const theirs = this.db.raw
      .prepare('SELECT id, account_id, species_id, nickname, xp FROM wonder_pool WHERE account_id != ? ORDER BY id LIMIT 1')
      .get(accountId) as { id: number; account_id: number; species_id: string; nickname: string | null; xp: number } | undefined;

    const stamp = this.now().toISOString();
    this.db.raw.prepare('BEGIN').run();
    try {
      this.db.raw.prepare('DELETE FROM collection WHERE id = ? AND account_id = ?').run(cid, accountId);

      if (!theirs) {
        // Nobody waiting: our Pokémon joins the pool and we are told to come back.
        this.db.raw
          .prepare('INSERT INTO wonder_pool (account_id, species_id, nickname, xp, deposited_at) VALUES (?, ?, ?, ?, ?)')
          .run(accountId, mine.species_id, mine.nickname, mine.xp, stamp);
        this.db.raw.prepare('COMMIT').run();
        return ok({ gave: mine.species_id, got: mine.species_id, waiting: true });
      }

      // A match: we take theirs, and ours goes to them.
      this.db.raw.prepare('DELETE FROM wonder_pool WHERE id = ?').run(theirs.id);
      const insert = this.db.raw.prepare(
        'INSERT INTO collection (account_id, species_id, nickname, xp, acquired_at) VALUES (?, ?, ?, ?, ?)',
      );
      insert.run(accountId, theirs.species_id, theirs.nickname, theirs.xp, stamp);
      insert.run(theirs.account_id, mine.species_id, mine.nickname, mine.xp, stamp);
      this.db.raw.prepare('COMMIT').run();
      return ok({ gave: mine.species_id, got: theirs.species_id, waiting: false });
    } catch {
      this.db.raw.prepare('ROLLBACK').run();
      return fail('The trade could not be completed.');
    }
  }

  /** How many Pokémon are waiting in the wonder pool, and how many are the viewer's own. */
  wonderPoolStatus(accountId: number): { total: number; yours: number } {
    const total = (this.db.raw.prepare('SELECT COUNT(*) AS n FROM wonder_pool').get() as { n: number }).n;
    const yours = (this.db.raw
      .prepare('SELECT COUNT(*) AS n FROM wonder_pool WHERE account_id = ?')
      .get(accountId) as { n: number }).n;
    return { total, yours };
  }

  // -------------------------------------------------------------------------
  // Marketplace
  // -------------------------------------------------------------------------

  /**
   * Lists a Pokémon publicly, naming the species you will accept for it.
   *
   * An empty want-list means "any Pokémon", which is the quickest way to shift a spare. The listed individual
   * leaves the collection while it is listed, for the same reason as the wonder pool.
   */
  createListing(accountId: number, collectionId: unknown, wants: unknown): Result<ListingView> {
    if (!Number.isInteger(collectionId)) return fail('Choose a Pokémon to list.');
    const cid = collectionId as number;
    const wantList = Array.isArray(wants)
      ? wants.filter((w): w is string => typeof w === 'string' && /^[a-z0-9.'-]{1,40}$/.test(w)).slice(0, 12)
      : [];

    const row = this.db.raw
      .prepare('SELECT species_id, nickname, xp FROM collection WHERE id = ? AND account_id = ?')
      .get(cid, accountId) as { species_id: string; nickname: string | null; xp: number } | undefined;
    if (!row) return fail('You do not own that Pokémon.');

    const open = (this.db.raw
      .prepare("SELECT COUNT(*) AS n FROM listings WHERE account_id = ? AND status = 'open'")
      .get(accountId) as { n: number }).n;
    if (open >= 12) return fail('You already have twelve Pokémon listed.');

    const stamp = this.now().toISOString();
    this.db.raw.prepare('BEGIN').run();
    try {
      this.db.raw.prepare('DELETE FROM collection WHERE id = ? AND account_id = ?').run(cid, accountId);
      const info = this.db.raw
        .prepare('INSERT INTO listings (account_id, species_id, nickname, xp, wants, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(accountId, row.species_id, row.nickname, row.xp, JSON.stringify(wantList), 'open', stamp);
      this.db.raw.prepare('COMMIT').run();
      return ok(this.listingView(Number(info.lastInsertRowid), accountId)!);
    } catch {
      this.db.raw.prepare('ROLLBACK').run();
      return fail('The listing could not be created.');
    }
  }

  /** Open listings, newest first. */
  listings(accountId: number, limit = 60): ListingView[] {
    const rows = this.db.raw
      .prepare("SELECT id FROM listings WHERE status = 'open' ORDER BY id DESC LIMIT ?")
      .all(limit) as { id: number }[];
    return rows.map((r) => this.listingView(r.id, accountId)).filter((l): l is ListingView => l !== null);
  }

  private listingView(listingId: number, viewerId: number): ListingView | null {
    const row = this.db.raw.prepare('SELECT * FROM listings WHERE id = ?').get(listingId) as
      | { id: number; account_id: number; species_id: string; nickname: string | null; wants: string; created_at: string }
      | undefined;
    if (!row) return null;
    const seller = (this.db.raw.prepare('SELECT username FROM accounts WHERE id = ?').get(row.account_id) as
      | { username: string }
      | undefined)?.username ?? '?';
    let wants: string[] = [];
    try {
      const parsed = JSON.parse(row.wants);
      if (Array.isArray(parsed)) wants = parsed.filter((w): w is string => typeof w === 'string');
    } catch { /* a malformed want-list reads as "any" */ }
    return {
      id: row.id,
      seller,
      species: row.species_id,
      nickname: row.nickname,
      wants,
      mine: row.account_id === viewerId,
      createdAt: row.created_at,
    };
  }

  /**
   * Takes a listing, paying with one of your own Pokémon.
   *
   * Validates that your payment is something the seller actually asked for (or that they asked for anything),
   * then swaps in one transaction: their listed Pokémon becomes yours, your payment becomes theirs.
   */
  buyListing(accountId: number, listingId: unknown, payWith: unknown): Result<{ got: string; gave: string }> {
    if (!Number.isInteger(listingId) || !Number.isInteger(payWith)) return fail('Choose what to trade.');
    const lid = listingId as number;
    const pid = payWith as number;

    const listing = this.db.raw.prepare("SELECT * FROM listings WHERE id = ? AND status = 'open'").get(lid) as
      | { id: number; account_id: number; species_id: string; nickname: string | null; xp: number; wants: string }
      | undefined;
    if (!listing) return fail('That listing is no longer available.');
    if (listing.account_id === accountId) return fail('That is your own listing.');

    const payment = this.db.raw
      .prepare('SELECT species_id, nickname, xp FROM collection WHERE id = ? AND account_id = ?')
      .get(pid, accountId) as { species_id: string; nickname: string | null; xp: number } | undefined;
    if (!payment) return fail('You do not own that Pokémon.');

    let wants: string[] = [];
    try {
      const parsed = JSON.parse(listing.wants);
      if (Array.isArray(parsed)) wants = parsed.filter((w): w is string => typeof w === 'string');
    } catch { /* treat as "any" */ }
    if (wants.length > 0 && !wants.includes(payment.species_id)) {
      return fail('The seller is not asking for that Pokémon.');
    }

    const stamp = this.now().toISOString();
    this.db.raw.prepare('BEGIN').run();
    try {
      this.db.raw.prepare("UPDATE listings SET status = 'sold' WHERE id = ?").run(lid);
      this.db.raw.prepare('DELETE FROM collection WHERE id = ? AND account_id = ?').run(pid, accountId);
      const insert = this.db.raw.prepare(
        'INSERT INTO collection (account_id, species_id, nickname, xp, acquired_at) VALUES (?, ?, ?, ?, ?)',
      );
      insert.run(accountId, listing.species_id, listing.nickname, listing.xp, stamp);
      insert.run(listing.account_id, payment.species_id, payment.nickname, payment.xp, stamp);
      this.db.raw.prepare('COMMIT').run();
      return ok({ got: listing.species_id, gave: payment.species_id });
    } catch {
      this.db.raw.prepare('ROLLBACK').run();
      return fail('The trade could not be completed.');
    }
  }

  /** Withdraws your own listing, returning the Pokémon to your collection. */
  cancelListing(accountId: number, listingId: unknown): Result<{ ok: true }> {
    if (!Number.isInteger(listingId)) return fail('Choose a listing.');
    const lid = listingId as number;
    const listing = this.db.raw
      .prepare("SELECT * FROM listings WHERE id = ? AND status = 'open' AND account_id = ?")
      .get(lid, accountId) as { species_id: string; nickname: string | null; xp: number } | undefined;
    if (!listing) return fail('That listing is not yours, or is no longer open.');

    this.db.raw.prepare('BEGIN').run();
    try {
      this.db.raw.prepare("UPDATE listings SET status = 'cancelled' WHERE id = ?").run(lid);
      this.db.raw
        .prepare('INSERT INTO collection (account_id, species_id, nickname, xp, acquired_at) VALUES (?, ?, ?, ?, ?)')
        .run(accountId, listing.species_id, listing.nickname, listing.xp, this.now().toISOString());
      this.db.raw.prepare('COMMIT').run();
      return ok({ ok: true });
    } catch {
      this.db.raw.prepare('ROLLBACK').run();
      return fail('The listing could not be withdrawn.');
    }
  }

  // -------------------------------------------------------------------------
  // Trading
  // -------------------------------------------------------------------------

  /** Collection rows (id → species/nickname) owned by an account, among the given ids. */
  private ownedRows(accountId: number, ids: number[]): { id: number; species_id: string; nickname: string | null }[] {
    if (ids.length === 0) return [];
    const holes = ids.map(() => '?').join(',');
    return this.db.raw
      .prepare(`SELECT id, species_id, nickname FROM collection WHERE account_id = ? AND id IN (${holes})`)
      .all(accountId, ...ids) as { id: number; species_id: string; nickname: string | null }[];
  }

  /** Species/nickname for a set of collection ids regardless of owner, for displaying a trade. */
  private rowsById(ids: number[]): { id: number; species: string; nickname: string | null }[] {
    if (ids.length === 0) return [];
    const holes = ids.map(() => '?').join(',');
    const rows = this.db.raw
      .prepare(`SELECT id, species_id, nickname FROM collection WHERE id IN (${holes})`)
      .all(...ids) as { id: number; species_id: string; nickname: string | null }[];
    return rows.map((r) => ({ id: r.id, species: r.species_id, nickname: r.nickname }));
  }

  private static asIdList(input: unknown): number[] {
    if (!Array.isArray(input)) return [];
    return input.filter((x): x is number => Number.isInteger(x));
  }

  /**
   * Proposes a trade to another player: the individuals you give, and the ones you want from them.
   *
   * Validates that you own everything you offer and that they own everything you request, so an offer is
   * always honourable when made. Ownership is re-checked at accept time, since the world may move.
   */
  proposeTrade(fromId: number, toUsername: unknown, offer: unknown, request: unknown): Result<TradeView> {
    const offerIds = Accounts.asIdList(offer);
    const requestIds = Accounts.asIdList(request);
    if (offerIds.length === 0 && requestIds.length === 0) return fail('A trade needs at least one Pokémon.');
    if (typeof toUsername !== 'string') return fail('Choose someone to trade with.');

    const to = this.db.raw.prepare('SELECT id FROM accounts WHERE username_lower = ?').get(toUsername.toLowerCase()) as
      | { id: number }
      | undefined;
    if (!to) return fail('No player with that name.');
    if (to.id === fromId) return fail('You cannot trade with yourself.');

    if (this.ownedRows(fromId, offerIds).length !== offerIds.length) return fail('You no longer own part of that offer.');
    if (this.ownedRows(to.id, requestIds).length !== requestIds.length) return fail('They no longer own what you asked for.');

    const info = this.db.raw
      .prepare('INSERT INTO trades (from_account, to_account, offer, request, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(fromId, to.id, JSON.stringify(offerIds), JSON.stringify(requestIds), 'pending', this.now().toISOString());
    return ok(this.tradeView(Number(info.lastInsertRowid), fromId)!);
  }

  /** The pending trades an account is party to, incoming and outgoing, with species resolved. */
  listTrades(accountId: number): TradeView[] {
    const rows = this.db.raw
      .prepare('SELECT id FROM trades WHERE (from_account = ? OR to_account = ?) AND status = ? ORDER BY id DESC')
      .all(accountId, accountId, 'pending') as { id: number }[];
    return rows.map((r) => this.tradeView(r.id, accountId)).filter((t): t is TradeView => t !== null);
  }

  private tradeView(tradeId: number, viewerId: number): TradeView | null {
    const t = this.db.raw.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId) as TradeRow | undefined;
    if (!t) return null;
    const fromName = (this.db.raw.prepare('SELECT username FROM accounts WHERE id = ?').get(t.from_account) as { username: string } | undefined)?.username ?? '?';
    const toName = (this.db.raw.prepare('SELECT username FROM accounts WHERE id = ?').get(t.to_account) as { username: string } | undefined)?.username ?? '?';
    return {
      id: t.id,
      direction: t.from_account === viewerId ? 'outgoing' : 'incoming',
      from: fromName,
      to: toName,
      offer: this.rowsById(Accounts.asIdList(JSON.parse(t.offer))),
      request: this.rowsById(Accounts.asIdList(JSON.parse(t.request))),
      createdAt: t.created_at,
    };
  }

  /**
   * Responds to a trade. The recipient may `accept` or `decline`; the proposer may `cancel`.
   *
   * On accept, ownership is re-validated and the individuals change hands in a single transaction, so a
   * trade never half-completes and nothing is duplicated.
   */
  respondTrade(accountId: number, tradeId: number, action: 'accept' | 'decline' | 'cancel'): Result<{ ok: true }> {
    const t = this.db.raw.prepare('SELECT * FROM trades WHERE id = ?').get(tradeId) as TradeRow | undefined;
    if (!t || t.status !== 'pending') return fail('That trade is no longer open.');

    if (action === 'cancel') {
      if (t.from_account !== accountId) return fail('Only the proposer can cancel this trade.');
      this.setTradeStatus(tradeId, 'cancelled');
      return ok({ ok: true });
    }
    if (t.to_account !== accountId) return fail('Only the recipient can respond to this trade.');
    if (action === 'decline') {
      this.setTradeStatus(tradeId, 'declined');
      return ok({ ok: true });
    }

    // action === 'accept'
    const offerIds = Accounts.asIdList(JSON.parse(t.offer));
    const requestIds = Accounts.asIdList(JSON.parse(t.request));
    if (this.ownedRows(t.from_account, offerIds).length !== offerIds.length ||
        this.ownedRows(t.to_account, requestIds).length !== requestIds.length) {
      this.setTradeStatus(tradeId, 'cancelled');
      return fail('Some of these Pokémon are no longer available. The trade was cancelled.');
    }

    const reassign = this.db.raw.prepare('UPDATE collection SET account_id = ? WHERE id = ?');
    const runTxn = this.db.raw.prepare('BEGIN');
    runTxn.run();
    try {
      for (const id of offerIds) reassign.run(t.to_account, id);
      for (const id of requestIds) reassign.run(t.from_account, id);
      this.setTradeStatus(tradeId, 'accepted');
      this.db.raw.prepare('COMMIT').run();
    } catch (err) {
      this.db.raw.prepare('ROLLBACK').run();
      return fail('The trade could not be completed.');
    }
    return ok({ ok: true });
  }

  private setTradeStatus(tradeId: number, status: string): void {
    this.db.raw.prepare('UPDATE trades SET status = ? WHERE id = ?').run(status, tradeId);
  }

  /** Another player's collection, for building a trade offer. */
  collectionOf(username: string): { id: number; species: string; nickname: string | null }[] | null {
    const acc = this.db.raw.prepare('SELECT id FROM accounts WHERE username_lower = ?').get(username.toLowerCase()) as
      | { id: number }
      | undefined;
    if (!acc) return null;
    return this.collection(acc.id).map((c) => ({ id: c.id, species: c.species, nickname: c.nickname }));
  }

  // -------------------------------------------------------------------------
  // Post-match encounters
  // -------------------------------------------------------------------------

  /**
   * Issues an encounter for a finished game, replacing any unclaimed one.
   *
   * Called only from the paths that record a real result, which is what makes the offer trustworthy: a client
   * cannot ask for an encounter, so it cannot reroll one either. Advances the pity counter unless the offer
   * itself contained something rare.
   */
  private issueEncounter(accountId: number, outcome: MatchOutcome): void {
    if (!this.rollEncounter || !this.satisfiesPity) return;
    const row = this.db.raw.prepare('SELECT pity FROM profiles WHERE account_id = ?').get(accountId) as
      | { pity: number }
      | undefined;
    if (!row) return;

    const seed = `${accountId}:${this.now().toISOString()}:${outcome}`;
    const encounter = this.rollEncounter(outcome, seed, row.pity);
    const nextPity = this.satisfiesPity(encounter.choices) ? 0 : row.pity + 1;

    this.db.raw
      .prepare('UPDATE profiles SET encounter = ?, pity = ? WHERE account_id = ?')
      .run(JSON.stringify(encounter), nextPity, accountId);
  }

  /** The account's unclaimed encounter, or null. */
  pendingEncounter(accountId: number): Encounter | null {
    const row = this.db.raw.prepare('SELECT encounter FROM profiles WHERE account_id = ?').get(accountId) as
      | { encounter: string | null }
      | undefined;
    if (!row?.encounter) return null;
    try {
      return JSON.parse(row.encounter) as Encounter;
    } catch {
      return null;
    }
  }

  /**
   * Claims one choice from the pending encounter, by index.
   *
   * By index rather than by species id, deliberately: the offer is the server's, so a client can only ever
   * take something it was actually offered. Clears the encounter, so each is claimed once.
   */
  claimEncounter(accountId: number, index: unknown): Result<{ species: string; profile: PublicProfile }> {
    const encounter = this.pendingEncounter(accountId);
    if (!encounter) return fail('You have no Pokémon waiting.');
    if (!Number.isInteger(index)) return fail('Choose one of the Pokémon offered.');
    const i = index as number;
    const species = encounter.choices[i];
    if (species === undefined) return fail('Choose one of the Pokémon offered.');

    this.db.raw.prepare('UPDATE profiles SET encounter = NULL WHERE account_id = ?').run(accountId);
    this.grant(accountId, species);
    return ok({ species, profile: this.publicProfile(accountId)! });
  }

  /** Grants a species to an account — a post-match reward, a starter pick, or a trade in. */
  grant(accountId: number, species: string): void {
    this.db.raw
      .prepare('INSERT INTO collection (account_id, species_id, acquired_at) VALUES (?, ?, ?)')
      .run(accountId, species, this.now().toISOString());
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

    const badges = new Set(this.parseBadges(prof.badges));
    const gymId = typeof input.gymId === 'string' && GYM_BY_ID.has(input.gymId) ? input.gymId : null;

    // A rematch of a gym already beaten is practice, not progress: it must not move the rating, or a player
    // could farm an easy leader instead of climbing against real opponents.
    const rematch = gymId !== null && badges.has(gymId);
    const newRating = rematch ? prof.rating : updateRating(prof.rating, opponentRating, score, kFactorFor(prof.games));
    const games = rematch ? prof.games : prof.games + 1;

    // Beating a gym leader earns its badge (idempotent — a rematch does not duplicate it).
    if (score === 1 && gymId !== null) badges.add(gymId);

    const orderedBadges = GYM_LEADERS.filter((g) => badges.has(g.id)).map((g) => g.id);
    const highest = highestBadge(badges);

    this.db.raw
      .prepare('UPDATE profiles SET rating = ?, games = ?, badges = ?, badge = ?, updated_at = ? WHERE account_id = ?')
      .run(newRating, games, JSON.stringify(orderedBadges), highest?.badge ?? null, this.now().toISOString(), accountId);

    // A win trains the team toward evolution (§17.8).
    if (score === 1) this.grantTeamXp(accountId);

    // Every finished game yields an encounter — a win offers more and better, a loss fewer and worse, but
    // never nothing: the player who is losing is the one who most needs new Pokémon to try.
    if (!rematch) {
      this.issueEncounter(accountId, score === 1 ? 'win' : score === 0 ? 'loss' : 'draw');
    }

    return ok(this.publicProfile(accountId)!);
  }
}

/**
 * A precomputed decoy hash, verified against when a username is unknown, so a failed login takes the
 * same time whether or not the account exists. Its plaintext is unguessable and unused.
 */
const DECOY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
