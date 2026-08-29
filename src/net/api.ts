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

import type { PublicProfile, TradeView } from '../profile/profile.ts';
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
  readonly acquiredAt: string;
}

/** A live online match's state, mirroring the server's `RoomView`. */
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

  /** Claims a post-match reward Pokémon into the collection; returns the updated profile. */
  claimReward: (species: string) => call<{ profile: PublicProfile }>('POST', '/api/collection/claim', { species }),

  avatarOptions: () => call<{ trainers: TrainerOption[] }>('GET', '/api/avatar-options'),

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
