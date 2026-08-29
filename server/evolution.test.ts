import { describe, expect, it } from 'vitest';

import { Accounts, EVOLVE_XP } from './accounts.ts';
import { Db } from './db.ts';
import { loadDexFromDisk } from './gameDex.ts';

const dex = loadDexFromDisk();
const evosOf = (species: string) => dex.getSpecies(species)?.evos ?? [];

async function player() {
  const accounts = new Accounts(new Db(':memory:'), () => new Date(), evosOf);
  const r = await accounts.register({ username: 'trainer', password: 'charizard1', displayName: 'T' });
  if (!r.ok) throw new Error('setup failed');
  const id = accounts.accountForToken(r.value.token)!;
  return { accounts, id };
}

describe('evolution through play', () => {
  it('an individual evolves only once trained', async () => {
    const { accounts, id } = await player();
    accounts.grant(id, 'charmander');
    const before = accounts.collection(id).find((c) => c.species === 'charmander')!;
    expect(before.evolvesTo).toEqual([]); // no training yet

    for (let i = 0; i < EVOLVE_XP; i++) accounts.grantTeamXp(id);
    const trained = accounts.collection(id).find((c) => c.species === 'charmander')!;
    expect(trained.xp).toBe(EVOLVE_XP);
    expect(trained.evolvesTo).toContain('charmeleon');

    const result = accounts.evolve(id, trained.id, 'charmeleon');
    expect(result.ok).toBe(true);
    // The specific individual became a Charmeleon and spent its training.
    const evolved = accounts.collection(id).find((c) => c.id === trained.id)!;
    expect(evolved.species).toBe('charmeleon');
    expect(evolved.xp).toBe(0);
  });

  it('rejects evolving an untrained individual, and an invalid target', async () => {
    const { accounts, id } = await player();
    accounts.grant(id, 'charmander');
    const row = accounts.collection(id).find((c) => c.species === 'charmander')!;
    expect(accounts.evolve(id, row.id, 'charmeleon').ok).toBe(false); // untrained
    for (let i = 0; i < EVOLVE_XP; i++) accounts.grantTeamXp(id);
    expect(accounts.evolve(id, row.id, 'mewtwo').ok).toBe(false); // not a valid evolution
    expect(accounts.evolve(id, 999999, 'charmeleon').ok).toBe(false); // not owned
  });

  it('a fully-evolved species offers no evolution', async () => {
    const { accounts, id } = await player();
    accounts.grant(id, 'charizard');
    for (let i = 0; i < EVOLVE_XP; i++) accounts.grantTeamXp(id);
    const row = accounts.collection(id).find((c) => c.species === 'charizard')!;
    expect(row.evolvesTo).toEqual([]);
  });

  it('a gym win trains the team', async () => {
    const { accounts, id } = await player();
    accounts.grant(id, 'charmander');
    accounts.recordLadderResult(id, { opponentRating: 1300, score: 1, gymId: 'boulder' });
    expect(accounts.collection(id).find((c) => c.species === 'charmander')!.xp).toBe(1);
    // A loss does not train.
    accounts.recordLadderResult(id, { opponentRating: 1300, score: 0 });
    expect(accounts.collection(id).find((c) => c.species === 'charmander')!.xp).toBe(1);
  });
});

describe('gym rating rules', () => {
  it('a first gym win moves the rating and awards the badge', async () => {
    const { accounts, id } = await player();
    const before = accounts.publicProfile(id)!;
    const after = accounts.recordLadderResult(id, { opponentRating: 1300, score: 1, gymId: 'boulder' });
    expect(after.ok).toBe(true);
    const p = after.ok ? after.value : before;
    expect(p.rating).toBeGreaterThan(before.rating);
    expect(p.badges).toContain('boulder');
    expect(p.games).toBe(before.games + 1);
  });

  it('a rematch of an earned gym is unrated, so it cannot be farmed', async () => {
    const { accounts, id } = await player();
    accounts.recordLadderResult(id, { opponentRating: 1300, score: 1, gymId: 'boulder' });
    const earned = accounts.publicProfile(id)!;

    // Beat Brock again, and again — neither the rating nor the game count may move.
    accounts.recordLadderResult(id, { opponentRating: 1300, score: 1, gymId: 'boulder' });
    accounts.recordLadderResult(id, { opponentRating: 1300, score: 1, gymId: 'boulder' });
    const after = accounts.publicProfile(id)!;
    expect(after.rating).toBe(earned.rating);
    expect(after.games).toBe(earned.games);
    expect(after.badges).toEqual(earned.badges);
  });

  it('losing a rematch also costs nothing', async () => {
    const { accounts, id } = await player();
    accounts.recordLadderResult(id, { opponentRating: 1300, score: 1, gymId: 'boulder' });
    const earned = accounts.publicProfile(id)!;
    accounts.recordLadderResult(id, { opponentRating: 1300, score: 0, gymId: 'boulder' });
    expect(accounts.publicProfile(id)!.rating).toBe(earned.rating);
    // And the badge is certainly not lost.
    expect(accounts.publicProfile(id)!.badges).toContain('boulder');
  });

  it('a PvP result is always rated', async () => {
    const { accounts, id } = await player();
    const before = accounts.publicProfile(id)!;
    accounts.recordLadderResult(id, { opponentRating: 1500, score: 1 });
    expect(accounts.publicProfile(id)!.rating).toBeGreaterThan(before.rating);
  });
});
