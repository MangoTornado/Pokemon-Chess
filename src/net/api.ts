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

import type { PublicProfile } from '../profile/profile.ts';
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

  avatarOptions: () => call<{ trainers: TrainerOption[] }>('GET', '/api/avatar-options'),
};
