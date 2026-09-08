/**
 * Wonder trade and the marketplace.
 *
 * Both move ownership of a specific individual between accounts, so the properties that matter are
 * conservation (nothing is duplicated or lost) and honesty (you cannot take what was not offered, or pay with
 * something you do not own).
 */

import { describe, expect, it } from 'vitest';

import { Accounts } from './accounts.ts';
import { Db } from './db.ts';

async function players() {
  const accounts = new Accounts(new Db(':memory:'));
  const mk = async (username: string) => {
    const r = await accounts.register({ username, password: 'password123', displayName: username });
    if (!r.ok) throw new Error('setup failed');
    return accounts.accountForToken(r.value.token)!;
  };
  return { accounts, ash: await mk('ash'), misty: await mk('misty'), brock: await mk('brock') };
}

/** A distinctive individual, so it can be tracked across a trade. */
function give(accounts: Accounts, id: number, species: string) {
  accounts.grant(id, species);
  return accounts.collection(id).find((c) => c.species === species)!;
}

describe('wonder trade', () => {
  it('the first deposit waits in the pool', () => {
    return players().then(({ accounts, ash }) => {
      const gengar = give(accounts, ash, 'gengar');
      const r = accounts.wonderTrade(ash, gengar.id);
      expect(r.ok && r.value.waiting).toBe(true);

      // It has left the collection, so it cannot be traded twice or fielded while waiting.
      expect(accounts.collection(ash).some((c) => c.id === gengar.id)).toBe(false);
      expect(accounts.wonderPoolStatus(ash)).toEqual({ total: 1, yours: 1 });
    });
  });

  it('the second deposit swaps with the first, both ways', async () => {
    const { accounts, ash, misty } = await players();
    const gengar = give(accounts, ash, 'gengar');
    const lapras = give(accounts, misty, 'lapras');

    accounts.wonderTrade(ash, gengar.id);
    const r = accounts.wonderTrade(misty, lapras.id);
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toMatchObject({ gave: 'lapras', got: 'gengar', waiting: false });

    // Misty holds Ash's Gengar; Ash holds Misty's Lapras. The pool is empty again.
    expect(accounts.collection(misty).some((c) => c.species === 'gengar')).toBe(true);
    expect(accounts.collection(ash).some((c) => c.species === 'lapras')).toBe(true);
    expect(accounts.wonderPoolStatus(ash).total).toBe(0);
  });

  it('never hands you back your own deposit', async () => {
    const { accounts, ash } = await players();
    const a = give(accounts, ash, 'gengar');
    const b = give(accounts, ash, 'lapras');
    accounts.wonderTrade(ash, a.id);
    // Ash's own Gengar is the only thing in the pool, so this must wait rather than self-swap.
    const second = accounts.wonderTrade(ash, b.id);
    expect(second.ok && second.value.waiting).toBe(true);
    expect(accounts.wonderPoolStatus(ash)).toEqual({ total: 2, yours: 2 });
  });

  it('refuses a Pokémon you do not own', async () => {
    const { accounts, ash, misty } = await players();
    const hers = give(accounts, misty, 'lapras');
    expect(accounts.wonderTrade(ash, hers.id).ok).toBe(false);
    expect(accounts.wonderTrade(ash, 999999).ok).toBe(false);
  });

  it('conserves the total number of Pokémon', async () => {
    const { accounts, ash, misty } = await players();
    const before = accounts.collection(ash).length + accounts.collection(misty).length;
    const a = give(accounts, ash, 'gengar');
    const b = give(accounts, misty, 'lapras');
    accounts.wonderTrade(ash, a.id);
    accounts.wonderTrade(misty, b.id);
    const after = accounts.collection(ash).length + accounts.collection(misty).length;
    expect(after).toBe(before + 2); // the two we granted, still exactly two
  });
});

describe('marketplace', () => {
  it('listing removes the Pokémon from the collection and shows it publicly', async () => {
    const { accounts, ash, misty } = await players();
    const gengar = give(accounts, ash, 'gengar');
    const r = accounts.createListing(ash, gengar.id, ['lapras']);
    expect(r.ok).toBe(true);

    expect(accounts.collection(ash).some((c) => c.id === gengar.id)).toBe(false);
    const seen = accounts.listings(misty);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ species: 'gengar', seller: 'ash', wants: ['lapras'], mine: false });
    // The seller sees it as their own.
    expect(accounts.listings(ash)[0]!.mine).toBe(true);
  });

  it('buying swaps both ways and closes the listing', async () => {
    const { accounts, ash, misty } = await players();
    const gengar = give(accounts, ash, 'gengar');
    const lapras = give(accounts, misty, 'lapras');
    const listing = accounts.createListing(ash, gengar.id, ['lapras']);
    const lid = listing.ok ? listing.value.id : -1;

    const bought = accounts.buyListing(misty, lid, lapras.id);
    expect(bought.ok && bought.value).toMatchObject({ got: 'gengar', gave: 'lapras' });
    expect(accounts.collection(misty).some((c) => c.species === 'gengar')).toBe(true);
    expect(accounts.collection(ash).some((c) => c.species === 'lapras')).toBe(true);
    // Closed, so nobody can buy it twice.
    expect(accounts.listings(misty)).toHaveLength(0);
    expect(accounts.buyListing(misty, lid, lapras.id).ok).toBe(false);
  });

  it('refuses payment the seller did not ask for', async () => {
    const { accounts, ash, misty } = await players();
    const gengar = give(accounts, ash, 'gengar');
    const wrong = give(accounts, misty, 'magikarp');
    const listing = accounts.createListing(ash, gengar.id, ['lapras']);
    const lid = listing.ok ? listing.value.id : -1;

    const bad = accounts.buyListing(misty, lid, wrong.id);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error.error).toMatch(/not asking/i);
    // And the listing is untouched, so it can still be bought properly.
    expect(accounts.listings(misty)).toHaveLength(1);
  });

  it('an empty want-list accepts anything', async () => {
    const { accounts, ash, misty } = await players();
    const gengar = give(accounts, ash, 'gengar');
    const anything = give(accounts, misty, 'magikarp');
    const listing = accounts.createListing(ash, gengar.id, []);
    const lid = listing.ok ? listing.value.id : -1;
    expect(accounts.buyListing(misty, lid, anything.id).ok).toBe(true);
  });

  it('refuses to sell to yourself, or to pay with what you do not own', async () => {
    const { accounts, ash, misty, brock } = await players();
    const gengar = give(accounts, ash, 'gengar');
    const listing = accounts.createListing(ash, gengar.id, []);
    const lid = listing.ok ? listing.value.id : -1;

    const own = accounts.collection(ash)[0]!;
    expect(accounts.buyListing(ash, lid, own.id).ok).toBe(false); // your own listing
    const mistys = accounts.collection(misty)[0]!;
    expect(accounts.buyListing(brock, lid, mistys.id).ok).toBe(false); // not Brock's to give
  });

  it('cancelling returns the Pokémon to its owner', async () => {
    const { accounts, ash, misty } = await players();
    const gengar = give(accounts, ash, 'gengar');
    const listing = accounts.createListing(ash, gengar.id, ['lapras']);
    const lid = listing.ok ? listing.value.id : -1;

    expect(accounts.cancelListing(ash, lid).ok).toBe(true);
    expect(accounts.collection(ash).some((c) => c.species === 'gengar')).toBe(true);
    expect(accounts.listings(misty)).toHaveLength(0);
    // Only the owner may cancel, and only once.
    expect(accounts.cancelListing(ash, lid).ok).toBe(false);
  });

  it('another player cannot cancel your listing', async () => {
    const { accounts, ash, misty } = await players();
    const gengar = give(accounts, ash, 'gengar');
    const listing = accounts.createListing(ash, gengar.id, []);
    const lid = listing.ok ? listing.value.id : -1;
    expect(accounts.cancelListing(misty, lid).ok).toBe(false);
    // Still listed, and still Ash's.
    expect(accounts.listings(ash)[0]!.mine).toBe(true);
  });

  it('caps how many you may list at once', async () => {
    const { accounts, ash } = await players();
    for (let i = 0; i < 12; i++) {
      const row = give(accounts, ash, 'magikarp');
      expect(accounts.createListing(ash, row.id, []).ok).toBe(true);
    }
    const extra = give(accounts, ash, 'magikarp');
    const over = accounts.createListing(ash, extra.id, []);
    expect(over.ok).toBe(false);
    expect(!over.ok && over.error.error).toMatch(/twelve/i);
  });
});
