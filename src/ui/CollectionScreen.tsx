/**
 * The collection and Pokédex (SPEC §17.8) — the progression the owner asked for: catch new Pokémon and
 * grow your dex.
 *
 * You own *individuals*, not species (DIRECTION §15), so duplicates are real fieldable pieces and the grid
 * shows a count per species. The Pokédex figure is distinct species owned against the full 1025 — the
 * long-tail completionist pursuit. New Pokémon arrive from post-match encounters (`EncounterCard`), from
 * evolution, and from the market.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Dex } from '../data/dex.ts';
import type { BattleType, SpeciesEntry } from '../data/schema.ts';
import { api } from '../net/api.ts';
import type { CollectionEntry } from '../net/api.ts';
import { EncounterCard } from './EncounterCard.tsx';
import { PokemonIcon } from './PokemonIcon.tsx';
import { TYPE_COLORS } from './typeColors.ts';

export interface CollectionScreenProps {
  dex: Dex;
  signedIn: boolean;
  onExit: () => void;
  onSignIn: () => void;
}

export function CollectionScreen({ dex, signedIn, onExit, onSignIn }: CollectionScreenProps) {
  const [entries, setEntries] = useState<CollectionEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<BattleType | 'all'>('all');
  const [sort, setSort] = useState<'dex' | 'name' | 'count'>('dex');

  const refresh = useCallback(() => {
    api.collection().then((r) => {
      if (r.ok) setEntries(r.value.collection);
      else setError(r.error.error);
    });
  }, []);

  useEffect(() => {
    if (signedIn) refresh();
  }, [signedIn, refresh]);

  const evolve = useCallback(async (id: number, target: string) => {
    setError(null);
    const r = await api.evolve(id, target);
    if (!r.ok) setError(r.error.error);
    refresh();
  }, [refresh]);

  const evolvable = (entries ?? []).filter((e) => e.evolvesTo.length > 0);

  // Group owned individuals by species, keeping a count.
  const owned = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries ?? []) counts.set(e.species, (counts.get(e.species) ?? 0) + 1);
    const all = [...counts.entries()]
      .map(([id, count]) => ({ species: dex.getSpecies(id), count }))
      .filter((x): x is { species: SpeciesEntry; count: number } => !!x.species);

    const needle = query.trim().toLowerCase();
    const filtered = all.filter(({ species }) => {
      if (typeFilter !== 'all' && !species.types.includes(typeFilter)) return false;
      if (needle && !species.name.toLowerCase().includes(needle)) return false;
      return true;
    });

    return filtered.sort((a, b) => {
      if (sort === 'name') return a.species.name.localeCompare(b.species.name);
      // Most-duplicated first is how you find your tradeable spares.
      if (sort === 'count') return b.count - a.count || a.species.num - b.species.num;
      return a.species.num - b.species.num;
    });
  }, [entries, dex, query, typeFilter, sort]);

  /**
   * Distinct species owned, regardless of any filter.
   *
   * The Pokédex figure is a fact about the account, not about the current view — filtering the grid must not
   * appear to shrink your dex.
   */
  const distinctOwned = useMemo(
    () => new Set((entries ?? []).map((e) => e.species)).size,
    [entries],
  );

  /** Types the player actually owns, so the filter offers nothing that would return an empty grid. */
  const ownedTypes = useMemo(() => {
    const set = new Set<BattleType>();
    for (const e of entries ?? []) {
      for (const t of dex.getSpecies(e.species)?.types ?? []) set.add(t);
    }
    return [...set].sort();
  }, [entries, dex]);

  const totalSpecies = useMemo(() => new Set(dex.species.map((s) => s.num)).size, [dex]);

  if (!signedIn) {
    return (
      <section style={{ display: 'grid', gap: '1rem', maxWidth: 560 }}>
        <Head title="Collection & Pokédex" onExit={onExit} />
        <p style={{ color: 'var(--text-dim)' }}>
          Your collection lives with your account. Sign in to see the Pokémon you own and track your Pokédex.
        </p>
        <button type="button" onClick={onSignIn} style={primary}>Sign in / Create account</button>
      </section>
    );
  }

  return (
    <section style={{ display: 'grid', gap: '1rem' }}>
      <Head title="Collection & Pokédex" onExit={onExit} />

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Metric big={String(distinctOwned)} small={`of ${totalSpecies} species`} label="Pokédex" />
        <Metric big={String(entries?.length ?? '…')} small="individuals owned" label="Collection" />
      </div>

      {error && <p style={{ color: '#f85149' }}>{error}</p>}

      {/* Anything waiting from your last game gets claimed here too, not only on the match screen. */}
      <EncounterCard dex={dex} onClaimed={refresh} />

      {/* Filters. Only offered once there is enough to filter, so a new account sees a clean screen. */}
      {(entries?.length ?? 0) > 8 && (
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            style={{
              background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)',
              borderRadius: 7, padding: '0.4rem 0.6rem', width: 170, fontSize: '0.85rem',
            }}
          />
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as BattleType | 'all')}
            style={selectStyle}
          >
            <option value="all">All types</option>
            {ownedTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as 'dex' | 'name' | 'count')} style={selectStyle}>
            <option value="dex">Pokédex order</option>
            <option value="name">Name</option>
            <option value="count">Most duplicates</option>
          </select>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>
            {owned.length} shown
          </span>
          {(query || typeFilter !== 'all') && (
            <button
              type="button"
              onClick={() => { setQuery(''); setTypeFilter('all'); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: '0.78rem', textDecoration: 'underline' }}
            >
              Clear
            </button>
          )}
        </div>
      )}

      {evolvable.length > 0 && (
        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <h3 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--accent)' }}>Ready to evolve ({evolvable.length})</h3>
          <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--text-dim)' }}>
            Trained by your wins. Evolving spends the training and advances the Pokémon.
          </p>
          <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
            {evolvable.map((e) => {
              const s = dex.getSpecies(e.species);
              return (
                <div key={e.id} style={{ display: 'grid', gap: '0.3rem', padding: '0.55rem', background: 'var(--bg-raised)', border: '1px solid var(--accent)', borderRadius: 9, placeItems: 'center' }}>
                  <div style={{ height: 40, display: 'grid', placeItems: 'center' }}>{s && <PokemonIcon species={s} />}</div>
                  <span style={{ fontSize: '0.72rem', fontWeight: 700 }}>{e.nickname ?? s?.name ?? e.species}</span>
                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                    {e.evolvesTo.map((target) => (
                      <button
                        key={target}
                        type="button"
                        onClick={() => evolve(e.id, target)}
                        style={{ background: 'var(--accent)', color: '#1a1500', border: 'none', borderRadius: 6, padding: '0.25rem 0.5rem', fontSize: '0.72rem', fontWeight: 800, cursor: 'pointer' }}
                      >
                        → {dex.getSpecies(target)?.name ?? target}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {entries && owned.length === 0 && (
        <p style={{ color: 'var(--text-dim)' }}>
          Your collection is empty. Win a Gym Challenge match to catch your first reward Pokémon.
        </p>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: '0.6rem' }}>
        {owned.map(({ species, count }) => (
          <div
            key={species.id}
            title={`${species.name} — ${species.types.join('/')}`}
            style={{
              display: 'grid', placeItems: 'center', gap: '0.15rem', padding: '0.5rem 0.3rem',
              background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 9, position: 'relative',
            }}
          >
            <div style={{ height: 40, display: 'grid', placeItems: 'center' }}>
              <PokemonIcon species={species} />
            </div>
            <span style={{ fontSize: '0.72rem', fontWeight: 600, textAlign: 'center', lineHeight: 1.1 }}>{species.name}</span>
            <span style={{ display: 'flex', gap: '0.2rem' }}>
              {species.types.map((t) => (
                <span key={t} style={{ width: 8, height: 8, borderRadius: '50%', background: TYPE_COLORS[t] }} />
              ))}
            </span>
            {count > 1 && (
              <span style={{ position: 'absolute', top: 4, right: 6, fontSize: '0.7rem', fontWeight: 800, color: 'var(--accent)' }}>×{count}</span>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function Head({ title, onExit }: { title: string; onExit: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
      <h2 style={{ margin: 0 }}>{title}</h2>
      <button type="button" onClick={onExit} style={ghost}>Back to menu</button>
    </div>
  );
}

function Metric({ big, small, label }: { big: string; small: string; label: string }) {
  return (
    <div style={{ display: 'grid', gap: '0.1rem' }}>
      <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span><strong style={{ fontSize: '1.6rem' }}>{big}</strong> <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>{small}</span></span>
    </div>
  );
}

const selectStyle = {
  background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 7, padding: '0.4rem 0.5rem', fontSize: '0.85rem',
} as const;

const ghost = {
  background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 7, padding: '0.4rem 0.9rem', cursor: 'pointer', fontWeight: 600,
};
const primary = {
  background: 'var(--accent)', color: '#1a1500', border: 'none',
  borderRadius: 7, padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 800, justifySelf: 'start' as const,
};
