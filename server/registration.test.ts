/**
 * Registration is all-or-nothing.
 *
 * It writes four things — the account, its profile, its starter collection, and a session — and a comment
 * promised they were one transaction. They were not: the writes ran in autocommit, so a failure part-way left
 * an account row with no profile while permanently reserving the username. That state is unrecoverable through
 * any API: every later `publicProfile` read for it returns null, and nothing releases a taken name.
 */

import { describe, expect, it } from 'vitest';

import { Accounts } from './accounts.ts';
import { Db } from './db.ts';

const make = () => new Accounts(new Db(':memory:'));
const CREDS = { username: 'rollbackuser', password: 'a-long-enough-password' };

describe('registration atomicity', () => {
  it('creates the account, its profile, its starter team and a session together', async () => {
    const accounts = make();
    const r = await accounts.register(CREDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // A profile that reads back is the thing the broken version could silently omit.
    expect(r.value.profile.username).toBe('rollbackuser');
    expect(accounts.accountForToken(r.value.token)).not.toBeNull();
    expect(accounts.collection(accounts.accountForToken(r.value.token)!).length).toBeGreaterThan(0);
  });

  it('leaves nothing behind when a write inside the transaction fails', async () => {
    const accounts = make();
    const db = (accounts as unknown as { db: { raw: { prepare: (s: string) => unknown } } }).db;

    // Break the *second* write, so the account INSERT has already happened when the failure lands. That is
    // exactly the shape that used to strand a nameless, profile-less account.
    const realPrepare = db.raw.prepare.bind(db.raw);
    let broken = true;
    db.raw.prepare = ((sql: string) => {
      if (broken && sql.startsWith('INSERT INTO profiles')) throw new Error('injected failure');
      return realPrepare(sql);
    }) as typeof db.raw.prepare;

    await expect(accounts.register(CREDS)).rejects.toThrow('injected failure');

    // With the failure removed, the name must still be free — i.e. the rolled-back attempt reserved nothing.
    broken = false;
    const second = await accounts.register(CREDS);
    expect(second.ok, 'the username must not have been burned by the failed attempt').toBe(true);
    if (!second.ok) return;
    expect(second.value.profile.username).toBe('rollbackuser');
    expect(accounts.collection(accounts.accountForToken(second.value.token)!).length).toBeGreaterThan(0);
  });

  it('reports a duplicate username as a field error rather than throwing', async () => {
    const accounts = make();
    expect((await accounts.register(CREDS)).ok).toBe(true);
    const again = await accounts.register(CREDS);
    expect(again.ok).toBe(false);
    if (again.ok) return;
    expect(again.error).toMatchObject({ field: 'username' });
    expect(again.error.error.toLowerCase()).toContain('taken');
  });
});
