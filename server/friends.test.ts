import { describe, expect, it } from 'vitest';

import { Accounts } from './accounts.ts';
import { Db } from './db.ts';

async function threePlayers() {
  const accounts = new Accounts(new Db(':memory:'));
  const mk = async (username: string, password: string) => {
    const r = await accounts.register({ username, password, displayName: username });
    if (!r.ok) throw new Error('setup failed');
    return accounts.accountForToken(r.value.token)!;
  };
  return {
    accounts,
    ash: await mk('ash', 'pikachu10'),
    misty: await mk('misty', 'starmie99'),
    brock: await mk('brock', 'onixrock1'),
  };
}

describe('friends', () => {
  it('a request appears as outgoing for the sender and incoming for the recipient', async () => {
    const { accounts, ash, misty } = await threePlayers();
    expect(accounts.requestFriend(ash, 'misty').ok).toBe(true);

    const ashList = accounts.friends(ash);
    expect(ashList).toHaveLength(1);
    expect(ashList[0]).toMatchObject({ username: 'misty', state: 'outgoing' });

    const mistyList = accounts.friends(misty);
    expect(mistyList[0]).toMatchObject({ username: 'ash', state: 'incoming' });
  });

  it('accepting makes it mutual', async () => {
    const { accounts, ash, misty } = await threePlayers();
    accounts.requestFriend(ash, 'misty');
    expect(accounts.acceptFriend(misty, 'ash').ok).toBe(true);
    expect(accounts.friends(ash)[0]).toMatchObject({ username: 'misty', state: 'friend' });
    expect(accounts.friends(misty)[0]).toMatchObject({ username: 'ash', state: 'friend' });
  });

  it('requesting someone who already requested you accepts instead', async () => {
    const { accounts, ash, misty } = await threePlayers();
    accounts.requestFriend(ash, 'misty');
    const back = accounts.requestFriend(misty, 'ash');
    expect(back.ok && back.value.state).toBe('accepted');
    expect(accounts.friends(ash)[0]!.state).toBe('friend');
  });

  it('rejects self-adding, unknown players, and duplicate requests', async () => {
    const { accounts, ash } = await threePlayers();
    expect(accounts.requestFriend(ash, 'ash').ok).toBe(false);
    expect(accounts.requestFriend(ash, 'nobody').ok).toBe(false);
    expect(accounts.requestFriend(ash, 'misty').ok).toBe(true);
    expect(accounts.requestFriend(ash, 'misty').ok).toBe(false); // already sent
  });

  it('cannot accept a request that was never sent', async () => {
    const { accounts, misty } = await threePlayers();
    expect(accounts.acceptFriend(misty, 'ash').ok).toBe(false);
  });

  it('removing disconnects both sides, and works on a pending request too', async () => {
    const { accounts, ash, misty, brock } = await threePlayers();
    accounts.requestFriend(ash, 'misty');
    accounts.acceptFriend(misty, 'ash');
    expect(accounts.removeFriend(ash, 'misty').ok).toBe(true);
    expect(accounts.friends(ash)).toHaveLength(0);
    expect(accounts.friends(misty)).toHaveLength(0);

    // Declining a pending request is the same action from the recipient's side.
    accounts.requestFriend(brock, 'ash');
    expect(accounts.friends(ash)).toHaveLength(1);
    expect(accounts.removeFriend(ash, 'brock').ok).toBe(true);
    expect(accounts.friends(ash)).toHaveLength(0);
  });

  it('a friend row carries the public bits needed to show it', async () => {
    const { accounts, ash, misty } = await threePlayers();
    accounts.requestFriend(ash, 'misty');
    accounts.acceptFriend(misty, 'ash');
    const row = accounts.friends(ash)[0]!;
    expect(row.displayName).toBe('misty');
    expect(row.avatar.trainer).toBeTruthy();
    expect(typeof row.rating).toBe('number');
  });
});
