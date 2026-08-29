/**
 * The browser's client for the account API.
 *
 * Thin and typed: every call goes to the same-origin `/api/*` the server exposes, sends and receives
 * JSON, and relies on the httpOnly session cookie the server sets — the token is never touched by JS,
 * which is the point of it being httpOnly. Errors come back as a typed {@link ApiError} rather than
 * thrown strings, so the UI can show a field-specific message.
 *
 * In dev, Vite proxies `/api` to the server (see `vite.config.ts`); in production the same server serves
 * both the client and the API, so the origin is always the same and no base URL is needed.
 */

import type { FriendView, ListingView, PublicProfile, TradeView, WonderResult } from '../profile/profile.ts';
import type { Avatar, TrainerOption } from '../profile/avatar.ts';

export interface ApiError {
  readonly error: string;
  /** The field the error belongs to, when the server tagged one. */
  readonly field?: string;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

async function call<T>(method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  const init: RequestInit = { method, credentials: 'same-origin' };
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    return { ok: false, error: { error: 'Could not reach the server. Is it running?' } };
  }

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      error: {
        error: typeof json.error === 'string' ? json.error : `Request failed (${res.status}).`,
        ...(typeof json.field === 'string' ? { field: json.field } : {}),
      },
    };
  }
  return { ok: true, value: json as T };
}

export interface CollectionEntry {
  readonly id: number;
  readonly species: string;
  readonly nickname: string | null;
  /** Training progress toward evolution. */
  readonly xp: number;
  /** Species this individual can evolve into right now (empty until trained / if it has no evolution). */
  readonly evolvesTo: readonly string[];
  readonly acquiredAt: string;
}

/** A live online match's state, mirroring the server's `RoomView`. */
/** A post-match encounter, as offered by the server. */
export interface EncounterView {
  readonly outcome: 'win' | 'draw' | 'loss';
  readonly choices: readonly string[];
  /** True when the pity counter guaranteed a rare in this offer. */
  readonly pity: boolean;
}

export interface RoomView {
  readonly id: string;
  readonly code: string | null;
  readonly seed: string;
  readonly status: 'waiting' | 'playing' | 'over';
  readonly white: string | null;
  readonly black: string | null;
  readonly actions: readonly number[];
  readonly outcome: 'white' | 'black' | 'draw' | null;
  /** The requesting player's side, or null if only watching. */
  readonly you: 'white' | 'black' | null;
  /** Thinking time left per side in ms. */
  readonly clock: { white: number; black: number };
  /** How the game ended, when it did. */
  readonly endedBy: 'king-capture' | 'draw' | 'resign' | 'timeout' | null;
}

export const api = {
  register: (input: { username: string; password: string; displayName?: string; avatar?: Avatar }) =>
    call<{ profile: PublicProfile }>('POST', '/api/register', input),

  login: (username: string, password: string) =>
    call<{ profile: PublicProfile }>('POST', '/api/login', { username, password }),

  logout: () => call<{ ok: true }>('POST', '/api/logout'),

  me: () => call<{ profile: PublicProfile }>('GET', '/api/me'),

  updateProfile: (input: { displayName?: string; bio?: string; status?: string; avatar?: Avatar }) =>
    call<{ profile: PublicProfile }>('PATCH', '/api/profile', input),

  profileOf: (username: string) =>
    call<{ profile: PublicProfile }>('GET', `/api/profile/${encodeURIComponent(username)}`),

  collection: () => call<{ collection: CollectionEntry[] }>('GET', '/api/collection'),

  // --- Post-match encounters ---
  /** The Pokémon waiting to be claimed after your last game, if any. */
  encounter: () => call<{ encounter: EncounterView | null }>('GET', '/api/encounter'),
  /** Claims one of the offered Pokémon, by its index in the offer. */
  claimEncounter: (index: number) =>
    call<{ species: string; profile: PublicProfile }>('POST', '/api/encounter/claim', { index }),

  // --- Wonder trade ---
  wonderPool: () => call<{ pool: { total: number; yours: number } }>('GET', '/api/wonder'),
  wonderTrade: (id: number) => call<WonderResult>('POST', '/api/wonder', { id }),

  // --- Marketplace ---
  listings: () => call<{ listings: ListingView[] }>('GET', '/api/listings'),
  createListing: (id: number, wants: string[]) =>
    call<{ listing: ListingView }>('POST', '/api/listings', { id, wants }),
  buyListing: (id: number, payWith: number) =>
    call<{ got: string; gave: string }>('POST', `/api/listings/${id}/buy`, { payWith }),
  cancelListing: (id: number) => call<{ ok: true }>('POST', `/api/listings/${id}/cancel`),

  /** Evolves a trained individual into one of its evolutions. */
  evolve: (id: number, target: string) => call<{ profile: PublicProfile }>('POST', '/api/collection/evolve', { id, target }),

  avatarOptions: () => call<{ trainers: TrainerOption[] }>('GET', '/api/avatar-options'),

  // --- Friends ---
  friends: () => call<{ friends: FriendView[] }>('GET', '/api/friends'),
  addFriend: (username: string) => call<{ state: 'pending' | 'accepted' }>('POST', '/api/friends/request', { username }),
  acceptFriend: (username: string) => call<{ ok: true }>('POST', '/api/friends/accept', { username }),
  removeFriend: (username: string) => call<{ ok: true }>('POST', '/api/friends/remove', { username }),

  // --- Trading ---
  trades: () => call<{ trades: TradeView[] }>('GET', '/api/trades'),
  playerCollection: (username: string) =>
    call<{ collection: { id: number; species: string; nickname: string | null }[] }>(
      'GET', `/api/players/${encodeURIComponent(username)}/collection`,
    ),
  proposeTrade: (to: string, offer: number[], request: number[]) =>
    call<{ trade: TradeView }>('POST', '/api/trades', { to, offer, request }),
  respondTrade: (id: number, action: 'accept' | 'decline' | 'cancel') =>
    call<{ ok: true }>('POST', `/api/trades/${id}/${action}`),

  /** Reports a rated match result; the server updates rating and the badge case and returns the profile. */
  ladderResult: (input: { opponentRating: number; score: 0 | 0.5 | 1; gymId?: string }) =>
    call<{ profile: PublicProfile }>('POST', '/api/ladder/result', input),

  // --- Online multiplayer ---
  mpQueue: () => call<{ game: RoomView }>('POST', '/api/mp/queue'),
  mpCancelQueue: () => call<{ ok: true }>('POST', '/api/mp/queue/cancel'),
  mpCreate: () => call<{ game: RoomView }>('POST', '/api/mp/create'),
  mpJoin: (code: string) => call<{ game: RoomView }>('POST', '/api/mp/join', { code }),
  mpState: (id: string) => call<{ game: RoomView }>('GET', `/api/mp/game/${encodeURIComponent(id)}`),
  mpMove: (id: string, ply: number, encoded: number) =>
    call<{ game: RoomView }>('POST', `/api/mp/game/${encodeURIComponent(id)}/move`, { ply, encoded }),
  mpResign: (id: string) => call<{ game: RoomView }>('POST', `/api/mp/game/${encodeURIComponent(id)}/resign`),
  mpOutcome: (id: string, outcome: 'white' | 'black' | 'draw') =>
    call<{ game: RoomView }>('POST', `/api/mp/game/${encodeURIComponent(id)}/outcome`, { outcome }),
};
