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
import type { FriendView, PublicProfile, TradeView } from '../src/profile/profile.ts';
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

  // Fields are declared and assigned explicitly rather than via constructor parameter properties, because
  // Node's strip-only TypeScript loader (which runs the server) does not support parameter properties.
  constructor(db: Db, now: () => Date = () => new Date(), evosOf: (species: string) => string[] = () => []) {
    this.db = db;
    this.now = now;
    this.evosOf = evosOf;
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

    return ok(this.publicProfile(accountId)!);
  }
}

/**
 * A precomputed decoy hash, verified against when a username is unknown, so a failed login takes the
 * same time whether or not the account exists. Its plaintext is unguessable and unused.
 */
const DECOY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
