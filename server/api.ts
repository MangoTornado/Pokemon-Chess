/**
 * The API surface, as a pure async function over a parsed request.
 *
 * Keeping the routing logic free of `node:http` means the whole API is testable by calling one function
 * with a plain object — no sockets, no ports — which is how `api.test.ts` exercises the full auth and
 * profile flow. The thin `node:http` adapter in `server.ts` is the only part that touches the network.
 *
 * The session cookie is `httpOnly`, `SameSite=Lax` and (in production) `Secure`, so it is invisible to
 * scripts, not sent cross-site on unsafe methods, and only ever travels over TLS.
 */

import { Accounts } from './accounts.ts';
import { TRAINERS } from '../src/profile/avatar.ts';

export interface ApiRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
  readonly cookies: Readonly<Record<string, string>>;
}

export interface ApiResponse {
  readonly status: number;
  readonly json?: unknown;
  /** Set the session cookie to this token, or clear it when null. */
  readonly session?: string | null;
}

export const SESSION_COOKIE = 'pc_session';

const json = (status: number, body: unknown, session?: string | null): ApiResponse =>
  session === undefined ? { status, json: body } : { status, json: body, session };

export async function handleApi(accounts: Accounts, req: ApiRequest): Promise<ApiResponse> {
  const { method, path } = req;

  // Public: the trainer roster, so the client's picker shows the exact set the server accepts.
  if (method === 'GET' && path === '/api/avatar-options') {
    return json(200, { trainers: TRAINERS });
  }

  if (method === 'POST' && path === '/api/register') {
    const b = asObject(req.body);
    const result = await accounts.register({
      username: b.username, password: b.password, displayName: b.displayName, avatar: b.avatar,
    });
    if (!result.ok) return json(400, result.error);
    return json(201, { profile: result.value.profile }, result.value.token);
  }

  if (method === 'POST' && path === '/api/login') {
    const b = asObject(req.body);
    const result = await accounts.login(b.username, b.password);
    if (!result.ok) return json(401, result.error);
    return json(200, { profile: result.value.profile }, result.value.token);
  }

  if (method === 'POST' && path === '/api/logout') {
    accounts.logout(req.cookies[SESSION_COOKIE]);
    return json(200, { ok: true }, null);
  }

  if (method === 'GET' && path === '/api/me') {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    return json(200, { profile: accounts.publicProfile(accountId) });
  }

  if (method === 'PATCH' && path === '/api/profile') {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    const b = asObject(req.body);
    const result = accounts.updateProfile(accountId, {
      displayName: b.displayName, bio: b.bio, status: b.status, avatar: b.avatar,
    });
    if (!result.ok) return json(400, result.error);
    return json(200, { profile: result.value });
  }

  if (method === 'GET' && path === '/api/collection') {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    return json(200, { collection: accounts.collection(accountId) });
  }

  // Viewing another player's public profile: /api/profile/:username
  const profileMatch = /^\/api\/profile\/([A-Za-z0-9_-]{1,20})$/.exec(path);
  if (method === 'GET' && profileMatch) {
    const profile = accounts.publicProfileByUsername(profileMatch[1]!);
    if (!profile) return json(404, { error: 'No such player.' });
    return json(200, { profile });
  }

  return json(404, { error: 'Not found.' });
}

function asObject(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}
