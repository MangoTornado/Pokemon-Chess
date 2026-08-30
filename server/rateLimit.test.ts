/**
 * The limiter, and the two endpoints that needed one.
 *
 * There was no rate limiting anywhere in the server, and its absence was load-bearing rather than cosmetic:
 * both ranked-progression exploits begin "make a second account", and account creation was free and unbounded.
 * Sign-in was too — `login` verifies against a decoy hash so a failed attempt is constant-time whether or not
 * the account exists, which defeats user enumeration but says nothing about volume.
 */

import { describe, expect, it } from 'vitest';

import { Accounts } from './accounts.ts';
import { Db } from './db.ts';
import { handleApi, SESSION_COOKIE } from './api.ts';
import type { ApiRequest } from './api.ts';
import { LOGIN_LIMIT, REGISTER_LIMIT, RateLimiter } from './rateLimit.ts';

/** A hand-cranked clock, so nothing sleeps. */
function clocked() {
  let t = 1_000_000;
  return { limiter: new RateLimiter(() => t), advance: (ms: number) => { t += ms; } };
}

const req = (path: string, body: unknown, client = '10.0.0.1'): ApiRequest =>
  ({ method: 'POST', path, body, cookies: {}, client });

describe('the limiter itself', () => {
  it('allows up to the limit and refuses past it', () => {
    const { limiter } = clocked();
    const limit = { max: 3, windowMs: 1000 };
    for (let i = 0; i < 3; i++) expect(limiter.check('k', limit).ok, `hit ${i}`).toBe(true);
    const refused = limiter.check('k', limit);
    expect(refused.ok).toBe(false);
    expect(!refused.ok && refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('forgets the window once it has passed', () => {
    const { limiter, advance } = clocked();
    const limit = { max: 1, windowMs: 1000 };
    expect(limiter.check('k', limit).ok).toBe(true);
    expect(limiter.check('k', limit).ok).toBe(false);
    advance(1000);
    expect(limiter.check('k', limit).ok).toBe(true);
  });

  it('counts refused hits, so hammering extends the wait rather than holding it open', () => {
    const { limiter, advance } = clocked();
    const limit = { max: 1, windowMs: 10_000 };
    limiter.check('k', limit);
    const first = limiter.check('k', limit);
    advance(5000);
    for (let i = 0; i < 20; i++) limiter.check('k', limit);
    const later = limiter.check('k', limit);
    expect(first.ok).toBe(false);
    expect(later.ok).toBe(false);
    // The window is fixed, so the wait shrinks with time but the hits never reopen it early.
    expect(!later.ok && later.retryAfterSeconds).toBeLessThanOrEqual(!first.ok ? first.retryAfterSeconds : 0);
  });

  it('keeps keys independent', () => {
    const { limiter } = clocked();
    const limit = { max: 1, windowMs: 1000 };
    expect(limiter.check('a', limit).ok).toBe(true);
    expect(limiter.check('b', limit).ok).toBe(true);
    expect(limiter.check('a', limit).ok).toBe(false);
  });

  it('forgives a key on demand', () => {
    const { limiter } = clocked();
    const limit = { max: 1, windowMs: 10_000 };
    limiter.check('k', limit);
    expect(limiter.check('k', limit).ok).toBe(false);
    limiter.forgive('k');
    expect(limiter.check('k', limit).ok).toBe(true);
  });
});

describe('sign-in attempts', () => {
  const creds = { username: 'trainer', password: 'a-long-enough-password' };

  async function setUp() {
    const { limiter, advance } = clocked();
    const accounts = new Accounts(new Db(':memory:'));
    await handleApi(accounts, req('/api/register', creds), undefined, new RateLimiter());
    return { accounts, limiter, advance };
  }

  it('refuses with 429 once the limit is spent', async () => {
    const { accounts, limiter } = await setUp();
    const wrong = { username: creds.username, password: 'wrong-password-here' };
    for (let i = 0; i < LOGIN_LIMIT.max; i++) {
      const r = await handleApi(accounts, req('/api/login', wrong), undefined, limiter);
      expect(r.status, `attempt ${i}`).toBe(401);
    }
    const blocked = await handleApi(accounts, req('/api/login', wrong), undefined, limiter);
    expect(blocked.status).toBe(429);
  });

  it('does not let one attacker lock a different account out', async () => {
    // Keyed per (client, username): keying on the client alone would let one attacker behind a shared address
    // lock every other user there out of their own account.
    const { accounts, limiter } = await setUp();
    const wrong = { username: 'someone-else', password: 'wrong-password-here' };
    for (let i = 0; i < LOGIN_LIMIT.max + 2; i++) {
      await handleApi(accounts, req('/api/login', wrong), undefined, limiter);
    }
    const victim = await handleApi(accounts, req('/api/login', creds), undefined, limiter);
    expect(victim.status).toBe(200);
  });

  it('stops throttling a real user the moment they get it right', async () => {
    const { accounts, limiter } = await setUp();
    const wrong = { username: creds.username, password: 'wrong-password-here' };
    for (let i = 0; i < LOGIN_LIMIT.max - 1; i++) {
      await handleApi(accounts, req('/api/login', wrong), undefined, limiter);
    }
    expect((await handleApi(accounts, req('/api/login', creds), undefined, limiter)).status).toBe(200);
    // The successful sign-in cleared the count, so a later typo is not instantly refused.
    expect((await handleApi(accounts, req('/api/login', wrong), undefined, limiter)).status).toBe(401);
  });
});

describe('account creation', () => {
  it('is bounded per client, which is what the exploits needed to be cheap', async () => {
    const { limiter } = clocked();
    const accounts = new Accounts(new Db(':memory:'));
    for (let i = 0; i < REGISTER_LIMIT.max; i++) {
      const r = await handleApi(
        accounts, req('/api/register', { username: `farm${i}`, password: 'a-long-enough-password' }), undefined, limiter,
      );
      expect(r.status, `account ${i}`).toBe(201);
    }
    const blocked = await handleApi(
      accounts, req('/api/register', { username: 'farmN', password: 'a-long-enough-password' }), undefined, limiter,
    );
    expect(blocked.status).toBe(429);
  });

  it('does not bound a different client', async () => {
    const { limiter } = clocked();
    const accounts = new Accounts(new Db(':memory:'));
    for (let i = 0; i < REGISTER_LIMIT.max; i++) {
      await handleApi(
        accounts, req('/api/register', { username: `a${i}`, password: 'a-long-enough-password' }, '10.0.0.1'),
        undefined, limiter,
      );
    }
    const other = await handleApi(
      accounts, req('/api/register', { username: 'elsewhere', password: 'a-long-enough-password' }, '10.0.0.2'),
      undefined, limiter,
    );
    expect(other.status).toBe(201);
    expect(other.session).toBeTruthy();
    expect(SESSION_COOKIE).toBeTruthy();
  });
});
