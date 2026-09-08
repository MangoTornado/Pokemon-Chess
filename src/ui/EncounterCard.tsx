/**
 * The post-match encounter — pick one Pokémon to keep.
 *
 * The offer is the server's: it is issued when a real game ends and claimed by index, so a client can only
 * ever take something it was actually offered. This component just renders what is waiting.
 *
 * The framing is deliberately kind about losing. A loss offers fewer and plainer Pokémon, but it offers
 * some — a collection loop that pays only winners punishes the players who most need a better team.
 */

import { useCallback, useEffect, useState } from 'react';

import type { Dex } from '../data/dex.ts';
import { api } from '../net/api.ts';
import type { EncounterView } from '../net/api.ts';
import { RARITY_COLOR, RARITY_LABEL, rarityOf } from '../game/rarity.ts';
import { PokemonIcon } from './PokemonIcon.tsx';
import { TYPE_COLORS } from './typeColors.ts';

const HEADLINE: Record<EncounterView['outcome'], string> = {
  win: 'Victory! Wild Pokémon appeared',
  draw: 'A draw — wild Pokémon appeared',
  loss: 'Defeated, but wild Pokémon appeared',
};

const SUBLINE: Record<EncounterView['outcome'], string> = {
  win: 'Winning drew a bigger crowd, and better ones. Choose one to keep.',
  draw: 'Choose one to keep.',
  loss: 'Fewer, and plainer — but yours to keep. Choose one.',
};

export interface EncounterCardProps {
  dex: Dex;
  /** Called once something is claimed, so the caller can refresh a collection view. */
  onClaimed?: (species: string) => void;
}

/**
 * Shows the pending encounter, if there is one, and nothing at all otherwise.
 *
 * Safe to mount anywhere for a signed-in player: it asks the server whether anything is waiting.
 */
export function EncounterCard({ dex, onClaimed }: EncounterCardProps) {
  const [encounter, setEncounter] = useState<EncounterView | null>(null);
  const [claimed, setClaimed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api.encounter();
    if (r.ok) setEncounter(r.value.encounter);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const claim = async (index: number) => {
    setBusy(true);
    setError(null);
    const r = await api.claimEncounter(index);
    setBusy(false);
    if (!r.ok) { setError(r.error.error); return; }
    setClaimed(r.value.species);
    setEncounter(null);
    onClaimed?.(r.value.species);
  };

  if (claimed) {
    const species = dex.getSpecies(claimed);
    return (
      <div style={{ ...panel, borderColor: 'var(--accent)' }}>
        <span aria-hidden style={{ fontSize: '1.5rem' }}>🎉</span>
        <strong>{species?.name ?? claimed} joined your collection!</strong>
      </div>
    );
  }

  if (!encounter) return null;

  return (
    <div style={{ ...panel, flexDirection: 'column', alignItems: 'stretch', gap: '0.6rem' }}>
      <div>
        <strong style={{ fontSize: '1.02rem' }}>{HEADLINE[encounter.outcome]}</strong>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.82rem' }}>{SUBLINE[encounter.outcome]}</div>
        {encounter.pity && (
          <div style={{ color: RARITY_COLOR.rare, fontSize: '0.78rem', marginTop: '0.2rem' }}>
            ✦ It has been a while — a rare one showed up.
          </div>
        )}
      </div>

      {error && <span style={{ color: '#f85149', fontSize: '0.82rem' }}>{error}</span>}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
        {encounter.choices.map((id, index) => {
          const species = dex.getSpecies(id);
          if (!species) return null;
          const rarity = rarityOf(species);
          return (
            <button
              key={id}
              type="button"
              disabled={busy}
              onClick={() => claim(index)}
              style={{
                display: 'grid', placeItems: 'center', gap: '0.2rem', padding: '0.6rem 0.7rem',
                flex: '1 1 110px', minWidth: 110,
                background: 'var(--bg)', border: `1px solid ${RARITY_COLOR[rarity]}`, borderRadius: 9,
                cursor: busy ? 'default' : 'pointer', color: 'var(--text)',
              }}
            >
              <div style={{ height: 42, display: 'grid', placeItems: 'center' }}>
                <PokemonIcon species={species} />
              </div>
              <strong style={{ fontSize: '0.8rem' }}>{species.name}</strong>
              <span style={{ fontSize: '0.66rem', color: RARITY_COLOR[rarity], fontWeight: 700 }}>
                {RARITY_LABEL[rarity]}
              </span>
              <span style={{ display: 'flex', gap: '0.2rem' }}>
                {species.types.map((t) => (
                  <span key={t} style={{ width: 8, height: 8, borderRadius: '50%', background: TYPE_COLORS[t] }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const panel = {
  display: 'flex', alignItems: 'center', gap: '0.7rem',
  background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.85rem 1rem',
} as const;
