import { describe, expect, it } from 'vitest';

import { Accounts } from './accounts.ts';
import { Db } from './db.ts';

async function twoPlayers() {
  const accounts = new Accounts(new Db(':memory:'));
  const a = await accounts.register({ username: 'ash', password: 'pikachu10', displayName: 'Ash' });
  const b = await accounts.register({ username: 'gary', password: 'squirtle9', displayName: 'Gary' });
  if (!a.ok || !b.ok) throw new Error('setup failed');
  const idOf = (u: string) => accounts.accountForToken(u === 'ash' ? a.value.token : b.value.token)!;
  return { accounts, ashId: idOf('ash'), garyId: idOf('gary') };
}

describe('trading', () => {
  it('transfers ownership on accept and leaves collections consistent', async () => {
    const { accounts, ashId, garyId } = await twoPlayers();
    // Give each a distinctive extra individual so we can track it.
    accounts.grant(ashId, 'gengar');
    accounts.grant(garyId, 'blastoise');
    const ashGengar = accounts.collection(ashId).find((c) => c.species === 'gengar')!;
    const garyBlastoise = accounts.collection(garyId).find((c) => c.species === 'blastoise')!;

    const proposed = accounts.proposeTrade(ashId, 'gary', [ashGengar.id], [garyBlastoise.id]);
    expect(proposed.ok).toBe(true);
    const tradeId = proposed.ok ? proposed.value.id : -1;

    // Gary sees it as incoming and accepts.
    const garyTrades = accounts.listTrades(garyId);
    expect(garyTrades).toHaveLength(1);
    expect(garyTrades[0]!.direction).toBe('incoming');
    expect(accounts.respondTrade(garyId, tradeId, 'accept').ok).toBe(true);

    // The individuals swapped owners.
    expect(accounts.collection(ashId).some((c) => c.id === garyBlastoise.id)).toBe(true);
    expect(accounts.collection(ashId).some((c) => c.id === ashGengar.id)).toBe(false);
    expect(accounts.collection(garyId).some((c) => c.id === ashGengar.id)).toBe(true);
    // No trades left pending.
    expect(accounts.listTrades(ashId)).toHaveLength(0);
  });

  it('rejects offering a Pokémon you do not own', async () => {
    const { accounts, ashId, garyId } = await twoPlayers();
    const garyItem = accounts.collection(garyId)[0]!;
    // Ash tries to offer one of Gary's individuals.
    const bad = accounts.proposeTrade(ashId, 'gary', [garyItem.id], []);
    expect(bad.ok).toBe(false);
  });

  it('only the recipient can accept; only the proposer can cancel', async () => {
    const { accounts, ashId, garyId } = await twoPlayers();
    const ashItem = accounts.collection(ashId)[0]!;
    const t = accounts.proposeTrade(ashId, 'gary', [ashItem.id], []);
    const id = t.ok ? t.value.id : -1;
    expect(accounts.respondTrade(ashId, id, 'accept').ok).toBe(false); // proposer can't accept
    expect(accounts.respondTrade(garyId, id, 'cancel').ok).toBe(false); // recipient can't cancel
    expect(accounts.respondTrade(garyId, id, 'accept').ok).toBe(true); // recipient accepts
  });

  it('a trade cannot be accepted twice', async () => {
    const { accounts, ashId, garyId } = await twoPlayers();
    const ashItem = accounts.collection(ashId)[0]!;
    const t = accounts.proposeTrade(ashId, 'gary', [ashItem.id], []);
    const id = t.ok ? t.value.id : -1;
    expect(accounts.respondTrade(garyId, id, 'accept').ok).toBe(true);
    expect(accounts.respondTrade(garyId, id, 'accept').ok).toBe(false);
  });

  it('a proposal against an unknown player fails', async () => {
    const { accounts, ashId } = await twoPlayers();
    const ashItem = accounts.collection(ashId)[0]!;
    expect(accounts.proposeTrade(ashId, 'nobody', [ashItem.id], []).ok).toBe(false);
  });
});
