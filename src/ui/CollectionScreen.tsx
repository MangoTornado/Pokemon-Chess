/**
 * The collection and Pokédex (SPEC §17.8) — the progression the owner asked for: catch new Pokémon and
 * grow your dex.
 *
 * You own *individuals*, not species (DIRECTION §15), so duplicates are real fieldable pieces and the grid
 * shows a count per species. The Pokédex figure is distinct species owned against the full 1025 — the
 * long-tail completionist pursuit. Rewards flow in from the {@link RewardChooser}, offered after a win.
 */

import { useEffect, useMemo, useState } from 'react';

import type { Dex } from '../data/dex.ts';
import type { SpeciesEntry } from '../data/schema.ts';
import { api } from '../net/api.ts';
import type { CollectionEntry } from '../net/api.ts';
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

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    api.collection().then((r) => {
      if (!live) return;
      if (r.ok) setEntries(r.value.collection);
      else setError(r.error.error);
    });
    return () => { live = false; };
  }, [signedIn]);

  // Group owned individuals by species, keeping a count.
  const owned = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of entries ?? []) counts.set(e.species, (counts.get(e.species) ?? 0) + 1);
    return [...counts.entries()]
      .map(([id, count]) => ({ species: dex.getSpecies(id), count }))
      .filter((x): x is { species: SpeciesEntry; count: number } => !!x.species)
      .sort((a, b) => a.species.num - b.species.num);
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
        <Metric big={String(owned.length)} small={`of ${totalSpecies} species`} label="Pokédex" />
        <Metric big={String(entries?.length ?? '…')} small="individuals owned" label="Collection" />
      </div>

      {error && <p style={{ color: '#f85149' }}>{error}</p>}

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
// Post-win reward
// ---------------------------------------------------------------------------

export interface RewardChooserProps {
  dex: Dex;
  /** A stable key (e.g. the match seed) so the same three choices persist across re-renders of one win. */
  rollKey: string;
  claim: (species: string) => Promise<{ error: string } | null>;
}

/**
 * Offers three Pokémon to catch after a win. The three are rolled once per win from the base formes; a
 * pick is claimed into the collection and the panel confirms the catch.
 */
export function RewardChooser({ dex, rollKey, claim }: RewardChooserProps) {
  const choices = useMemo(() => rollThree(dex, rollKey), [dex, rollKey]);
  const [claimed, setClaimed] = useState<SpeciesEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (claimed) {
    return (
      <div style={panel}>
        <span aria-hidden style={{ fontSize: '1.4rem' }}>🎉</span>
        <strong>{claimed.name} was added to your collection!</strong>
      </div>
    );
  }

  const pick = async (s: SpeciesEntry) => {
    setBusy(true);
    setError(null);
    const err = await claim(s.id);
    setBusy(false);
    if (err) setError(err.error);
    else setClaimed(s);
  };

  return (
    <div style={{ ...panel, flexDirection: 'column', alignItems: 'stretch' }}>
      <strong>Choose a Pokémon to catch</strong>
      {error && <span style={{ color: '#f85149', fontSize: '0.82rem' }}>{error}</span>}
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        {choices.map((s) => (
          <button
            key={s.id}
            type="button"
            disabled={busy}
            onClick={() => pick(s)}
            style={{
              display: 'grid', placeItems: 'center', gap: '0.15rem', padding: '0.6rem 0.8rem', flex: 1, minWidth: 96,
              background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 9, cursor: busy ? 'default' : 'pointer',
            }}
          >
            <div style={{ height: 40, display: 'grid', placeItems: 'center' }}>
              <PokemonIcon species={s} />
            </div>
            <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>{s.name}</span>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)' }}>{s.types.join('/')}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Three distinct base-forme species, chosen from a stable string key so the offer is steady per win. */
function rollThree(dex: Dex, key: string): SpeciesEntry[] {
  // A small string hash seeds a simple LCG, so the same win always offers the same three.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  const pool = dex.baseFormes.filter((s) => s.types.length > 0);
  const picks: SpeciesEntry[] = [];
  const seen = new Set<number>();
  let state = h >>> 0;
  while (picks.length < 3 && seen.size < pool.length) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const idx = state % pool.length;
    if (seen.has(idx)) continue;
    seen.add(idx);
    picks.push(pool[idx]!);
  }
  return picks;
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

const panel = {
  display: 'flex', alignItems: 'center', gap: '0.7rem',
  background: 'var(--bg-raised)', border: '1px solid var(--accent)', borderRadius: 10, padding: '0.85rem 1rem',
} as const;
const ghost = {
  background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 7, padding: '0.4rem 0.9rem', cursor: 'pointer', fontWeight: 600,
};
const primary = {
  background: 'var(--accent)', color: '#1a1500', border: 'none',
  borderRadius: 7, padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 800, justifySelf: 'start' as const,
};
