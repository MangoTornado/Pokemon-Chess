import { describe, expect, it } from 'vitest';

import { Db } from './db.ts';
import { Accounts, STARTER_SPECIES } from './accounts.ts';
import { handleApi, SESSION_COOKIE } from './api.ts';
import { RateLimiter } from './rateLimit.ts';
import type { ApiRequest } from './api.ts';
import { DEFAULT_AVATAR } from '../src/profile/avatar.ts';

/**
 * `handleApi` with a throwaway rate limiter.
 *
 * The limiter `handleApi` defaults to is module-level, so it deliberately outlives a single request — which would
 * otherwise couple every test in this file together and start failing them at the sixth registration. This file
 * is about auth and profile behaviour; the limiter has its own tests.
 */
const callApi: typeof handleApi = (accounts, r, matches) => handleApi(accounts, r, matches, new RateLimiter());

/** A fresh in-memory service per test, so tests never share state or touch disk. */
function freshAccounts(): Accounts {
  return new Accounts(new Db(':memory:'));
}

function req(method: string, path: string, opts: { body?: unknown; token?: string } = {}): ApiRequest {
  return {
    method,
    path,
    body: opts.body,
    cookies: opts.token ? { [SESSION_COOKIE]: opts.token } : {},
  };
}

async function registerUser(accounts: Accounts, username = 'AshK', password = 'pikapika123') {
  const res = await callApi(accounts, req('POST', '/api/register', { body: { username, password } }));
  return res;
}

describe('registration', () => {
  it('creates an account, sets a session, and returns the public profile', async () => {
    const accounts = freshAccounts();
    const res = await registerUser(accounts);
    expect(res.status).toBe(201);
    expect(res.session).toBeTruthy();
    const profile = (res.json as { profile: { username: string; dexCount: number } }).profile;
    expect(profile.username).toBe('AshK');
    // The starter grant means the account can field an army from day one.
    expect(profile.dexCount).toBe(new Set(STARTER_SPECIES).size);
  });

  it('never returns a password hash or token in the profile body', async () => {
    const accounts = freshAccounts();
    const res = await registerUser(accounts);
    const body = JSON.stringify(res.json);
    expect(body).not.toContain('scrypt');
    expect(body).not.toContain('password');
  });

  it('rejects a taken username case-insensitively', async () => {
    const accounts = freshAccounts();
    await registerUser(accounts, 'Misty');
    const dup = await callApi(accounts, req('POST', '/api/register', { body: { username: 'MISTY', password: 'watertypes1' } }));
    expect(dup.status).toBe(400);
    expect((dup.json as { field?: string }).field).toBe('username');
  });

  it('rejects a weak password and an unsafe username with a field-tagged error', async () => {
    const accounts = freshAccounts();
    const weak = await callApi(accounts, req('POST', '/api/register', { body: { username: 'Brock', password: 'short' } }));
    expect(weak.status).toBe(400);
    expect((weak.json as { field?: string }).field).toBe('password');

    const bad = await callApi(accounts, req('POST', '/api/register', { body: { username: '<b>', password: 'longenough1' } }));
    expect((bad.json as { field?: string }).field).toBe('username');
  });
});

describe('login and sessions', () => {
  it('logs in with the right password and rejects the wrong one', async () => {
    const accounts = freshAccounts();
    await registerUser(accounts, 'Gary', 'shellshocker');

    const good = await callApi(accounts, req('POST', '/api/login', { body: { username: 'gary', password: 'shellshocker' } }));
    expect(good.status).toBe(200);
    expect(good.session).toBeTruthy();

    const bad = await callApi(accounts, req('POST', '/api/login', { body: { username: 'gary', password: 'wrong' } }));
    expect(bad.status).toBe(401);
    expect(bad.session).toBeUndefined();
  });

  it('does not reveal whether a username exists on a failed login', async () => {
    const accounts = freshAccounts();
    await registerUser(accounts, 'RealUser', 'correcthorse');
    const unknownUser = await callApi(accounts, req('POST', '/api/login', { body: { username: 'ghost', password: 'whatever1' } }));
    const wrongPass = await callApi(accounts, req('POST', '/api/login', { body: { username: 'RealUser', password: 'whatever1' } }));
    // Identical status and message, so a probe cannot distinguish the two cases.
    expect(unknownUser.status).toBe(wrongPass.status);
    expect((unknownUser.json as { error: string }).error).toBe((wrongPass.json as { error: string }).error);
  });

  it('serves /api/me for a valid session and 401 without one', async () => {
    const accounts = freshAccounts();
    const reg = await registerUser(accounts, 'Cynthia', 'garchomp99');
    const token = reg.session!;

    const me = await callApi(accounts, req('GET', '/api/me', { token }));
    expect(me.status).toBe(200);
    expect((me.json as { profile: { username: string } }).profile.username).toBe('Cynthia');

    const anon = await callApi(accounts, req('GET', '/api/me'));
    expect(anon.status).toBe(401);
  });

  it('invalidates the session on logout', async () => {
    const accounts = freshAccounts();
    const reg = await registerUser(accounts, 'Red', 'charizard1');
    const token = reg.session!;
    const out = await callApi(accounts, req('POST', '/api/logout', { token }));
    expect(out.session).toBeNull(); // cookie cleared
    const me = await callApi(accounts, req('GET', '/api/me', { token }));
    expect(me.status).toBe(401);
  });
});

describe('profile editing', () => {
  it('updates the display name, bio, status and trainer', async () => {
    const accounts = freshAccounts();
    const reg = await registerUser(accounts, 'Lance', 'dragonite1');
    const token = reg.session!;

    const res = await callApi(accounts, req('PATCH', '/api/profile', {
      token,
      body: { displayName: 'Champion Lance', bio: 'I train dragons.', status: 'Looking for a match', avatar: { trainer: 'lance' } },
    }));
    expect(res.status).toBe(200);
    const profile = (res.json as { profile: { displayName: string; bio: string; status: string; avatar: { trainer: string } } }).profile;
    expect(profile.displayName).toBe('Champion Lance');
    expect(profile.bio).toBe('I train dragons.');
    expect(profile.avatar.trainer).toBe('lance');
  });

  it('rejects an over-long bio with a field error and requires a session', async () => {
    const accounts = freshAccounts();
    const reg = await registerUser(accounts, 'Steven', 'metagross1');
    const bad = await callApi(accounts, req('PATCH', '/api/profile', { token: reg.session!, body: { bio: 'x'.repeat(281) } }));
    expect(bad.status).toBe(400);
    expect((bad.json as { field?: string }).field).toBe('bio');

    const anon = await callApi(accounts, req('PATCH', '/api/profile', { body: { bio: 'hi' } }));
    expect(anon.status).toBe(401);
  });

  it('sanitises a bogus trainer rather than rejecting it', async () => {
    const accounts = freshAccounts();
    const reg = await registerUser(accounts, 'Wallace', 'milotic123');
    const res = await callApi(accounts, req('PATCH', '/api/profile', {
      token: reg.session!,
      body: { avatar: { trainer: '../../hack', junk: 1 } },
    }));
    expect(res.status).toBe(200);
    const avatar = (res.json as { profile: { avatar: { trainer: string } } }).profile.avatar;
    expect(avatar.trainer).toBe(DEFAULT_AVATAR.trainer); // bogus fell back to the default
    expect('junk' in avatar).toBe(false);
  });
});

describe('public profiles and collection', () => {
  it('serves another player\'s public profile by username, without private fields', async () => {
    const accounts = freshAccounts();
    await registerUser(accounts, 'Leon', 'charizard0');
    const res = await callApi(accounts, req('GET', '/api/profile/Leon'));
    expect(res.status).toBe(200);
    const profile = (res.json as { profile: { username: string } }).profile;
    expect(profile.username).toBe('Leon');
    expect(JSON.stringify(res.json)).not.toContain('password');
  });

  it('404s an unknown player', async () => {
    const accounts = freshAccounts();
    const res = await callApi(accounts, req('GET', '/api/profile/Nobody'));
    expect(res.status).toBe(404);
  });

  it('lists the starter collection for a signed-in account', async () => {
    const accounts = freshAccounts();
    const reg = await registerUser(accounts, 'Iris', 'haxorus123');
    const res = await callApi(accounts, req('GET', '/api/collection', { token: reg.session! }));
    expect(res.status).toBe(200);
    const collection = (res.json as { collection: { species: string }[] }).collection;
    expect(collection.length).toBe(STARTER_SPECIES.length);
    expect(collection.some((c) => c.species === 'pikachu')).toBe(true);
  });

  it('exposes the trainer roster publicly', async () => {
    const accounts = freshAccounts();
    const res = await callApi(accounts, req('GET', '/api/avatar-options'));
    expect(res.status).toBe(200);
    expect((res.json as { trainers: unknown[] }).trainers.length).toBeGreaterThan(12);
  });
});
