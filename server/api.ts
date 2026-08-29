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
import { Matches, QUICK_CHAT } from './matches.ts';
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

export async function handleApi(accounts: Accounts, req: ApiRequest, matches?: Matches): Promise<ApiResponse> {
  const { method, path } = req;

  // ---- Online multiplayer (present only when the server wired a Matches manager) --------------------
  if (matches && path.startsWith('/api/mp/')) {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Sign in to play online.' });
    const profile = accounts.publicProfile(accountId);
    const player = { accountId, name: profile?.displayName ?? 'Player' };
    const b = asObject(req.body);

    if (method === 'POST' && path === '/api/mp/queue') return mpResult(matches.enqueue(player));
    if (method === 'POST' && path === '/api/mp/queue/cancel') {
      matches.cancelQueue(accountId);
      return json(200, { ok: true });
    }
    if (method === 'POST' && path === '/api/mp/create') return mpResult(matches.createPrivate(player));
    if (method === 'POST' && path === '/api/mp/join') {
      const code = typeof b.code === 'string' ? b.code.trim() : '';
      if (!code) return json(400, { error: 'Enter a game code.' });
      return mpResult(matches.joinByCode(code, player));
    }

    if (method === 'GET' && path === '/api/mp/phrases') return json(200, { phrases: QUICK_CHAT });

    const gameMatch = /^\/api\/mp\/game\/([A-Za-z0-9]+)(\/move|\/resign|\/outcome|\/say)?$/.exec(path);
    if (gameMatch) {
      const gameId = gameMatch[1]!;
      const action = gameMatch[2];
      if (method === 'GET' && !action) return mpResult(matches.state(gameId, accountId));
      if (method === 'POST' && action === '/move') {
        return mpResult(matches.move(gameId, accountId, Number(b.ply), Number(b.encoded)));
      }
      if (method === 'POST' && action === '/resign') return mpResult(matches.resign(gameId, accountId));
      if (method === 'POST' && action === '/say') return mpResult(matches.say(gameId, accountId, b.phrase));
      if (method === 'POST' && action === '/outcome') {
        const outcome = b.outcome;
        if (outcome !== 'white' && outcome !== 'black' && outcome !== 'draw') {
          return json(400, { error: 'Invalid outcome.' });
        }
        return mpResult(matches.reportOutcome(gameId, accountId, outcome));
      }
    }
    return json(404, { error: 'Not found.' });
  }


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

  if (method === 'POST' && path === '/api/ladder/result') {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    const b = asObject(req.body);
    const result = accounts.recordLadderResult(accountId, {
      opponentRating: b.opponentRating, score: b.score, gymId: b.gymId,
    });
    if (!result.ok) return json(400, result.error);
    return json(200, { profile: result.value });
  }

  if (method === 'GET' && path === '/api/collection') {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    return json(200, { collection: accounts.collection(accountId) });
  }

  // The pending post-match encounter. Read-only: an offer is issued by the server when a real game ends, so
  // a client can neither request one nor reroll it.
  if (method === 'GET' && path === '/api/encounter') {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    return json(200, { encounter: accounts.pendingEncounter(accountId) });
  }

  if (method === 'POST' && path === '/api/encounter/claim') {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    const result = accounts.claimEncounter(accountId, asObject(req.body).index);
    if (!result.ok) return json(400, result.error);
    return json(200, result.value);
  }

  if (method === 'POST' && path === '/api/collection/evolve') {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    const b = asObject(req.body);
    const result = accounts.evolve(accountId, b.id, b.target);
    if (!result.ok) return json(400, result.error);
    return json(200, { profile: result.value });
  }

  // ---- Wonder trade ----
  if (method === 'GET' && path === '/api/wonder') {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    return json(200, { pool: accounts.wonderPoolStatus(accountId) });
  }

  if (method === 'POST' && path === '/api/wonder') {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    const result = accounts.wonderTrade(accountId, asObject(req.body).id);
    if (!result.ok) return json(400, result.error);
    return json(200, result.value);
  }

  // ---- Marketplace ----
  if (method === 'GET' && path === '/api/listings') {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    return json(200, { listings: accounts.listings(accountId) });
  }

  if (method === 'POST' && path === '/api/listings') {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    const b = asObject(req.body);
    const result = accounts.createListing(accountId, b.id, b.wants);
    if (!result.ok) return json(400, result.error);
    return json(201, { listing: result.value });
  }

  const listingMatch = /^\/api\/listings\/(\d+)\/(buy|cancel)$/.exec(path);
  if (method === 'POST' && listingMatch) {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    const id = Number(listingMatch[1]);
    const result = listingMatch[2] === 'buy'
      ? accounts.buyListing(accountId, id, asObject(req.body).payWith)
      : accounts.cancelListing(accountId, id);
    if (!result.ok) return json(400, result.error);
    return json(200, result.value);
  }

  // ---- Friends ----
  if (path === '/api/friends' || path.startsWith('/api/friends/')) {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    const b = asObject(req.body);

    if (method === 'GET' && path === '/api/friends') {
      return json(200, { friends: accounts.friends(accountId) });
    }
    if (method === 'POST' && path === '/api/friends/request') {
      const r = accounts.requestFriend(accountId, b.username);
      return r.ok ? json(200, r.value) : json(400, r.error);
    }
    if (method === 'POST' && path === '/api/friends/accept') {
      const r = accounts.acceptFriend(accountId, b.username);
      return r.ok ? json(200, r.value) : json(400, r.error);
    }
    if (method === 'POST' && path === '/api/friends/remove') {
      const r = accounts.removeFriend(accountId, b.username);
      return r.ok ? json(200, r.value) : json(400, r.error);
    }
    return json(404, { error: 'Not found.' });
  }

  // ---- Trading ----
  if (method === 'GET' && path === '/api/trades') {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    return json(200, { trades: accounts.listTrades(accountId) });
  }

  if (method === 'POST' && path === '/api/trades') {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    const b = asObject(req.body);
    const result = accounts.proposeTrade(accountId, b.to, b.offer, b.request);
    if (!result.ok) return json(400, result.error);
    return json(201, { trade: result.value });
  }

  const tradeMatch = /^\/api\/trades\/(\d+)\/(accept|decline|cancel)$/.exec(path);
  if (method === 'POST' && tradeMatch) {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    const result = accounts.respondTrade(accountId, Number(tradeMatch[1]), tradeMatch[2] as 'accept' | 'decline' | 'cancel');
    if (!result.ok) return json(400, result.error);
    return json(200, { ok: true });
  }

  // A player's collection, for building a trade offer against them.
  const playerCollMatch = /^\/api\/players\/([A-Za-z0-9_-]{1,20})\/collection$/.exec(path);
  if (method === 'GET' && playerCollMatch) {
    const accountId = accounts.accountForToken(req.cookies[SESSION_COOKIE]);
    if (accountId === null) return json(401, { error: 'Not signed in.' });
    const coll = accounts.collectionOf(playerCollMatch[1]!);
    if (!coll) return json(404, { error: 'No such player.' });
    return json(200, { collection: coll });
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

/** Maps a Matches result to an API response — the room view on success, its status/error otherwise. */
function mpResult(result: import('./matches.ts').MatchResult<import('./matches.ts').RoomView>): ApiResponse {
  return result.ok ? json(200, { game: result.value }) : json(result.status, { error: result.error });
}
