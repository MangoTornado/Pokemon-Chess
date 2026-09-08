/**
 * The market — wonder trade and the public listings.
 *
 * Two ways to get a Pokémon you did not earn, with opposite characters:
 *
 * - **Wonder trade** is a leap. You give one up before you know what comes back, which is how the games do it
 *   and why it is the fastest way to churn spares into surprises.
 * - **The marketplace** is deliberate. You list a spare and name the species you will take for it, so a player
 *   hunting one specific Pokémon can go and find it.
 *
 * In both, the Pokémon you offer leaves your collection the moment you offer it. That is what stops it being
 * traded twice or fielded while it waits, and it means every listing you see is real.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Dex } from '../data/dex.ts';
import { api } from '../net/api.ts';
import type { CollectionEntry } from '../net/api.ts';
import type { ListingView } from '../profile/profile.ts';
import { RARITY_COLOR, RARITY_LABEL, rarityOf } from '../game/rarity.ts';
import { PokemonIcon } from './PokemonIcon.tsx';

export interface MarketScreenProps {
  dex: Dex;
  signedIn: boolean;
  onExit: () => void;
  onSignIn: () => void;
}

type Tab = 'market' | 'wonder';

export function MarketScreen({ dex, signedIn, onExit, onSignIn }: MarketScreenProps) {
  const [tab, setTab] = useState<Tab>('market');
  const [mine, setMine] = useState<CollectionEntry[]>([]);
  const [listings, setListings] = useState<ListingView[]>([]);
  const [pool, setPool] = useState<{ total: number; yours: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [c, l, w] = await Promise.all([api.collection(), api.listings(), api.wonderPool()]);
    if (c.ok) setMine(c.value.collection);
    if (l.ok) setListings(l.value.listings);
    if (w.ok) setPool(w.value.pool);
  }, []);

  useEffect(() => { if (signedIn) void refresh(); }, [signedIn, refresh]);

  const name = useCallback((id: string) => dex.getSpecies(id)?.name ?? id, [dex]);

  /** Spares first: a duplicate is what a player actually wants to trade away. */
  const tradeable = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of mine) counts.set(e.species, (counts.get(e.species) ?? 0) + 1);
    return [...mine].sort((a, b) => {
      const dup = (counts.get(b.species) ?? 0) - (counts.get(a.species) ?? 0);
      return dup !== 0 ? dup : name(a.species).localeCompare(name(b.species));
    });
  }, [mine, name]);

  if (!signedIn) {
    return (
      <Frame onExit={onExit}>
        <p style={{ color: 'var(--text-dim)' }}>
          Trading needs an account, so the Pokémon you send and receive have somewhere to live.
        </p>
        <button type="button" onClick={onSignIn} style={primary}>Sign in / Create account</button>
      </Frame>
    );
  }

  const act = async (fn: () => Promise<{ ok: true; value: unknown } | { ok: false; error: { error: string } }>, done?: string) => {
    setError(null);
    setNotice(null);
    const r = await fn();
    if (r.ok) { if (done) setNotice(done); }
    else setError(r.error.error);
    await refresh();
  };

  return (
    <Frame onExit={onExit}>
      <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden', alignSelf: 'start' }}>
        {(['market', 'wonder'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              background: tab === t ? 'var(--accent)' : 'transparent',
              color: tab === t ? '#1a1500' : 'var(--text)',
              border: 'none', padding: '0.35rem 0.85rem', fontWeight: tab === t ? 700 : 500,
              fontSize: '0.85rem', cursor: 'pointer',
            }}
          >
            {t === 'market' ? 'Marketplace' : 'Wonder trade'}
          </button>
        ))}
      </div>

      {error && <p style={{ color: '#f85149', margin: 0 }}>{error}</p>}
      {notice && <p style={{ color: 'var(--accent)', margin: 0, fontSize: '0.85rem' }}>{notice}</p>}

      {tab === 'wonder' ? (
        <WonderTab dex={dex} mine={tradeable} pool={pool} onTrade={async (id) => {
          setError(null);
          setNotice(null);
          const r = await api.wonderTrade(id);
          if (!r.ok) { setError(r.error.error); return; }
          setNotice(r.value.waiting
            ? `${name(r.value.gave)} is waiting in the pool — come back once someone else deposits.`
            : `You sent ${name(r.value.gave)} and received ${name(r.value.got)}!`);
          await refresh();
        }} />
      ) : (
        <MarketTab
          dex={dex}
          mine={tradeable}
          listings={listings}
          onList={(id, wants) => act(() => api.createListing(id, wants), 'Listed.')}
          onBuy={(id, payWith) => act(() => api.buyListing(id, payWith), 'Traded!')}
          onCancel={(id) => act(() => api.cancelListing(id), 'Listing withdrawn.')}
        />
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------------------

function WonderTab({
  dex, mine, pool, onTrade,
}: {
  dex: Dex;
  mine: CollectionEntry[];
  pool: { total: number; yours: number } | null;
  onTrade: (id: number) => void;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const waiting = pool ? pool.total - pool.yours : 0;

  return (
    <>
      <p style={{ margin: 0, color: 'var(--text-dim)' }}>
        Send a Pokémon away and get a stranger's back, sight unseen. If nobody has deposited yet, yours waits
        in the pool until someone does.
      </p>
      <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--text-dim)' }}>
        {waiting > 0
          ? `${waiting} Pokémon waiting from other trainers — trade now and you get one immediately.`
          : 'Nobody is waiting right now, so yours will be the one that waits.'}
        {pool && pool.yours > 0 && ` You have ${pool.yours} in the pool.`}
      </p>

      <Picker dex={dex} items={mine} selected={picked} onSelect={setPicked} title="Choose what to send" />

      <button
        type="button"
        disabled={picked === null}
        onClick={() => { if (picked !== null) { onTrade(picked); setPicked(null); } }}
        style={{ ...primary, justifySelf: 'start', opacity: picked === null ? 0.5 : 1 }}
      >
        Send it away
      </button>
    </>
  );
}

function MarketTab({
  dex, mine, listings, onList, onBuy, onCancel,
}: {
  dex: Dex;
  mine: CollectionEntry[];
  listings: ListingView[];
  onList: (id: number, wants: string[]) => void;
  onBuy: (id: number, payWith: number) => void;
  onCancel: (id: number) => void;
}) {
  const [listing, setListing] = useState<number | null>(null);
  const [wants, setWants] = useState('');
  const [paying, setPaying] = useState<{ listing: number; with: number | null } | null>(null);

  const name = (id: string) => dex.getSpecies(id)?.name ?? id;

  return (
    <>
      {/* Create a listing */}
      <details style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.7rem 0.9rem' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>List a Pokémon</summary>
        <div style={{ display: 'grid', gap: '0.6rem', marginTop: '0.6rem' }}>
          <Picker dex={dex} items={mine} selected={listing} onSelect={setListing} title="Choose what to offer" />
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.82rem' }}>
            <span style={{ color: 'var(--text-dim)' }}>
              Wanted in return — comma-separated names. Leave empty to accept anything.
            </span>
            <input
              value={wants}
              onChange={(e) => setWants(e.target.value)}
              placeholder="e.g. Lapras, Gengar"
              style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 7, padding: '0.4rem 0.6rem' }}
            />
          </label>
          <button
            type="button"
            disabled={listing === null}
            onClick={() => {
              if (listing === null) return;
              // Accept names or ids: normalise to dex ids the way the dex itself does.
              const ids = wants
                .split(',')
                .map((w) => w.trim().toLowerCase().replace(/[^a-z0-9.'-]/g, ''))
                .filter((w) => w.length > 0 && dex.getSpecies(w) !== undefined);
              onList(listing, ids);
              setListing(null);
              setWants('');
            }}
            style={{ ...primary, justifySelf: 'start', opacity: listing === null ? 0.5 : 1 }}
          >
            List it
          </button>
        </div>
      </details>

      {/* Browse */}
      <h3 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-dim)' }}>Open listings ({listings.length})</h3>
      {listings.length === 0 && (
        <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.85rem' }}>
          Nothing listed yet. List a spare and someone may take it.
        </p>
      )}

      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {listings.map((l) => {
          const species = dex.getSpecies(l.species);
          const rarity = species ? rarityOf(species) : null;
          const wanted = l.wants.length > 0 ? l.wants.map(name).join(', ') : 'anything';
          // Only your Pokémon that the seller actually asked for can pay.
          const payable = mine.filter((m) => l.wants.length === 0 || l.wants.includes(m.species));
          const active = paying?.listing === l.id;
          return (
            <div key={l.id} style={{ background: 'var(--bg-raised)', border: `1px solid ${rarity ? RARITY_COLOR[rarity] : 'var(--border)'}`, borderRadius: 10, padding: '0.6rem 0.8rem', display: 'grid', gap: '0.4rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', flexWrap: 'wrap' }}>
                <div style={{ height: 38, width: 42, display: 'grid', placeItems: 'center' }}>
                  {species && <PokemonIcon species={species} />}
                </div>
                <span style={{ display: 'grid', gap: '0.1rem', minWidth: 0 }}>
                  <strong style={{ fontSize: '0.9rem' }}>
                    {l.nickname ?? name(l.species)}
                    {rarity && (
                      <span style={{ color: RARITY_COLOR[rarity], fontWeight: 700, fontSize: '0.7rem', marginLeft: '0.4rem' }}>
                        {RARITY_LABEL[rarity]}
                      </span>
                    )}
                  </strong>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-dim)' }}>
                    @{l.seller} wants {wanted}
                  </span>
                </span>
                <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
                  {l.mine ? (
                    <button type="button" onClick={() => onCancel(l.id)} style={ghost}>Withdraw</button>
                  ) : payable.length === 0 ? (
                    <span style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>You have none of these</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPaying(active ? null : { listing: l.id, with: null })}
                      style={ghost}
                    >
                      {active ? 'Cancel' : 'Trade for it'}
                    </button>
                  )}
                </span>
              </div>

              {active && (
                <div style={{ display: 'grid', gap: '0.4rem', borderTop: '1px solid var(--border)', paddingTop: '0.45rem' }}>
                  <Picker
                    dex={dex}
                    items={payable}
                    selected={paying?.with ?? null}
                    onSelect={(id) => setPaying({ listing: l.id, with: id })}
                    title="Pay with"
                  />
                  <button
                    type="button"
                    disabled={paying?.with == null}
                    onClick={() => {
                      if (paying?.with == null) return;
                      onBuy(l.id, paying.with);
                      setPaying(null);
                    }}
                    style={{ ...primary, justifySelf: 'start', opacity: paying?.with == null ? 0.5 : 1 }}
                  >
                    Confirm trade
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

/** A scrollable row of your Pokémon, one selectable. */
function Picker({
  dex, items, selected, onSelect, title,
}: {
  dex: Dex;
  items: CollectionEntry[];
  selected: number | null;
  onSelect: (id: number) => void;
  title: string;
}) {
  return (
    <div style={{ display: 'grid', gap: '0.3rem' }}>
      <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>{title}</span>
      {items.length === 0 ? (
        <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>Nothing available.</span>
      ) : (
        <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', maxHeight: 150, overflowY: 'auto', padding: '0.15rem' }}>
          {items.map((e) => {
            const species = dex.getSpecies(e.species);
            const on = selected === e.id;
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => onSelect(e.id)}
                title={species?.name ?? e.species}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.4rem',
                  borderRadius: 7, cursor: 'pointer', color: 'var(--text)',
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                  background: on ? 'color-mix(in srgb, var(--accent) 22%, var(--bg))' : 'var(--bg)',
                }}
              >
                <span style={{ width: 28, height: 22, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
                  {species ? <PokemonIcon species={species} scale={0.7} /> : '?'}
                </span>
                <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>{e.nickname ?? species?.name ?? e.species}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Frame({ children, onExit }: { children: React.ReactNode; onExit: () => void }) {
  return (
    <section style={{ display: 'grid', gap: '0.9rem', maxWidth: 760 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
        <h2 style={{ margin: 0 }}>Market</h2>
        <button type="button" onClick={onExit} style={ghost}>Back to menu</button>
      </div>
      {children}
    </section>
  );
}

const ghost = {
  background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 7, padding: '0.35rem 0.75rem', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' as const,
};
const primary = {
  background: 'var(--accent)', color: '#1a1500', border: 'none',
  borderRadius: 7, padding: '0.45rem 0.9rem', cursor: 'pointer', fontWeight: 800,
};
