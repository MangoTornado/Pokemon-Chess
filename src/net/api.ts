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
  readonly endedBy: 'king-capture' | 'draw' | 'resign' | 'timeout' | 'abandoned' | null;
  /** Seconds the opponent has left to reconnect before forfeiting, or null while they are present. */
  readonly opponentReconnectSeconds: number | null;
  /** Recent quick-chat, oldest first. */
  readonly chat: readonly { side: 'white' | 'black'; name: string; phrase: number; at: number }[];
}

/** A gym battle as the server describes it. The action list is the server's, and it is the authority. */
export interface GymBattleView {
  readonly id: string;
  readonly gymId: string;
  /** The server's seed. The client builds the same board from it; it never chooses one. */
  readonly seed: string;
  readonly status: 'playing' | 'over';
  readonly actions: readonly number[];
  readonly outcome: 'white' | 'black' | 'draw' | null;
  readonly turn: 'white' | 'black';
  readonly you: 'white' | 'black';
  readonly recorded: boolean;
  /** Seconds left to come back before the battle forfeits itself, or null when nothing is at stake yet. */
  readonly reconnectSeconds: number | null;
}

interface GymResponse {
  readonly battle: GymBattleView;
  readonly profile: PublicProfile | null;
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

  
  // --- Online multiplayer ---
  mpQueue: () => call<{ game: RoomView }>('POST', '/api/mp/queue'),
  mpCancelQueue: () => call<{ ok: true }>('POST', '/api/mp/queue/cancel'),
  // --- Gym battles, refereed by the server ---
  //
  // There is no "report a gym result" call, deliberately. One used to exist and the score came from the request
  // body, so a client could declare a win. The server plays the leader now and records its own verdict, so the
  // client's only inputs are which gym to challenge and which move it wants to make.

  /** Opens a gym battle. The server issues the seed, which is what stops a client shopping for a favourable one. */
  gymStart: (gymId: string) => call<GymResponse>('POST', '/api/gym/start', { gymId }),
  /** Plays one move and receives the leader's reply. Slow by nature: the leader thinks on the server. */
  gymMove: (id: string, ply: number, encoded: number) =>
    call<GymResponse>('POST', '/api/gym/move', { id, ply, encoded }),
  /** Forfeits: a recorded loss. Leaving a battle does not do this — `gymActive` finds it again. */
  gymForfeit: (id: string) => call<{ battle: GymBattleView; profile: PublicProfile | null }>(
    'POST', '/api/gym/forfeit', { id },
  ),
  /** The battle already in progress, so a refresh resumes instead of losing it. */
  gymActive: () => call<{ battle: GymBattleView; profile: PublicProfile | null }>('GET', '/api/gym/active'),
  gymState: (id: string) => call<GymResponse>('GET', `/api/gym/${encodeURIComponent(id)}`),

  /** Abandons one specific waiting room — the private-game counterpart of cancelling the queue. */
  mpAbandon: (id: string) => call<{ ok: boolean }>('POST', '/api/mp/abandon', { id }),
  /** The room already in progress, so a refresh reconnects instead of losing the game. */
  mpActive: () => call<{ game: RoomView }>('GET', '/api/mp/active'),
  mpCreate: () => call<{ game: RoomView }>('POST', '/api/mp/create'),
  mpJoin: (code: string) => call<{ game: RoomView }>('POST', '/api/mp/join', { code }),
  mpState: (id: string) => call<{ game: RoomView }>('GET', `/api/mp/game/${encodeURIComponent(id)}`),
  mpMove: (id: string, ply: number, encoded: number) =>
    call<{ game: RoomView }>('POST', `/api/mp/game/${encodeURIComponent(id)}/move`, { ply, encoded }),
  mpResign: (id: string) => call<{ game: RoomView }>('POST', `/api/mp/game/${encodeURIComponent(id)}/resign`),
  /** The fixed quick-chat vocabulary; the client sends an index into it, never a string. */
  mpPhrases: () => call<{ phrases: string[] }>('GET', '/api/mp/phrases'),
  mpSay: (id: string, phrase: number) =>
    call<{ game: RoomView }>('POST', `/api/mp/game/${encodeURIComponent(id)}/say`, { phrase }),
  mpOutcome: (id: string, outcome: 'white' | 'black' | 'draw') =>
    call<{ game: RoomView }>('POST', `/api/mp/game/${encodeURIComponent(id)}/outcome`, { outcome }),
};
