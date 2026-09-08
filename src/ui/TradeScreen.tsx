/**
 * Trading — player-to-player exchange of collection individuals (the owner's "trading with other people").
 *
 * You own individuals, so a trade moves specific rows between collections. A proposal names what you give
 * and what you want from a partner; the recipient accepts or declines. The server validates ownership on
 * both ends when the offer is made and again when it is accepted, so a trade is always honest and nothing
 * is duplicated. Collection has no competitive weight (SPEC §17.11), so this is a completionist exchange.
 */

import { useCallback, useEffect, useState } from 'react';

import type { Dex } from '../data/dex.ts';
import { api } from '../net/api.ts';
import type { CollectionEntry } from '../net/api.ts';
import type { TradeView } from '../profile/profile.ts';
import { PokemonIcon } from './PokemonIcon.tsx';

export interface TradeScreenProps {
  dex: Dex;
  signedIn: boolean;
  onExit: () => void;
  onSignIn: () => void;
}

export function TradeScreen({ dex, signedIn, onExit, onSignIn }: TradeScreenProps) {
  const [trades, setTrades] = useState<TradeView[]>([]);
  const [mine, setMine] = useState<CollectionEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [proposing, setProposing] = useState(false);

  const refresh = useCallback(async () => {
    const [t, c] = await Promise.all([api.trades(), api.collection()]);
    if (t.ok) setTrades(t.value.trades);
    if (c.ok) setMine(c.value.collection);
  }, []);

  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

  const respond = async (id: number, action: 'accept' | 'decline' | 'cancel') => {
    setError(null);
    const r = await api.respondTrade(id, action);
    if (!r.ok) setError(r.error.error);
    await refresh();
  };

  if (!signedIn) {
    return (
      <Frame title="Trading" onExit={onExit}>
        <p style={{ color: 'var(--text-dim)' }}>Trading needs an account. Sign in to swap Pokémon with other trainers.</p>
        <button type="button" onClick={onSignIn} style={primary}>Sign in / Create account</button>
      </Frame>
    );
  }

  if (proposing) {
    return <ProposeTrade dex={dex} mine={mine} onDone={async () => { setProposing(false); await refresh(); }} onCancel={() => setProposing(false)} />;
  }

  const incoming = trades.filter((t) => t.direction === 'incoming');
  const outgoing = trades.filter((t) => t.direction === 'outgoing');

  return (
    <Frame title="Trading" onExit={onExit}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
        <p style={{ margin: 0, color: 'var(--text-dim)' }}>Swap individuals with other trainers. Duplicates are fair game.</p>
        <button type="button" onClick={() => setProposing(true)} style={primary}>Propose a trade</button>
      </div>
      {error && <p style={{ color: '#f85149' }}>{error}</p>}

      <Section title={`Incoming (${incoming.length})`}>
        {incoming.length === 0 && <Empty>No offers waiting for you.</Empty>}
        {incoming.map((t) => (
          <TradeCard key={t.id} dex={dex} trade={t}>
            <button type="button" onClick={() => respond(t.id, 'accept')} style={primary}>Accept</button>
            <button type="button" onClick={() => respond(t.id, 'decline')} style={ghost}>Decline</button>
          </TradeCard>
        ))}
      </Section>

      <Section title={`Outgoing (${outgoing.length})`}>
        {outgoing.length === 0 && <Empty>You have not proposed any trades.</Empty>}
        {outgoing.map((t) => (
          <TradeCard key={t.id} dex={dex} trade={t}>
            <button type="button" onClick={() => respond(t.id, 'cancel')} style={ghost}>Cancel</button>
          </TradeCard>
        ))}
      </Section>
    </Frame>
  );
}

function TradeCard({ dex, trade, children }: { dex: Dex; trade: TradeView; children: React.ReactNode }) {
  const partner = trade.direction === 'incoming' ? trade.from : trade.to;
  // From the viewer's side: what they receive vs what they give.
  const receive = trade.direction === 'incoming' ? trade.offer : trade.request;
  const give = trade.direction === 'incoming' ? trade.request : trade.offer;
  return (
    <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.8rem 0.9rem', display: 'grid', gap: '0.5rem' }}>
      <div style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>
        {trade.direction === 'incoming' ? `${partner} offers` : `To ${partner}`}
      </div>
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <ItemRow dex={dex} label="You get" items={receive} />
        <span aria-hidden style={{ fontSize: '1.2rem', color: 'var(--text-dim)' }}>⇄</span>
        <ItemRow dex={dex} label="You give" items={give} />
        <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>{children}</span>
      </div>
    </div>
  );
}

function ItemRow({ dex, label, items }: { dex: Dex; label: string; items: readonly { id: number; species: string; nickname: string | null }[] }) {
  return (
    <div style={{ display: 'grid', gap: '0.2rem' }}>
      <span style={{ fontSize: '0.68rem', color: 'var(--text-dim)', textTransform: 'uppercase' }}>{label}</span>
      <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
        {items.length === 0 && <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>nothing</span>}
        {items.map((it) => <Chip key={it.id} dex={dex} species={it.species} nickname={it.nickname} />)}
      </div>
    </div>
  );
}

function Chip({ dex, species, nickname, onClick, selected }: { dex: Dex; species: string; nickname: string | null; onClick?: () => void; selected?: boolean }) {
  const s = dex.getSpecies(species);
  const inner = (
    <>
      <span style={{ width: 28, height: 22, display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
        {s ? <PokemonIcon species={s} scale={0.7} /> : '?'}
      </span>
      <span style={{ fontSize: '0.72rem', fontWeight: 600 }}>{nickname ?? s?.name ?? species}</span>
    </>
  );
  const style = {
    display: 'inline-flex', alignItems: 'center', gap: '0.25rem', padding: '0.2rem 0.45rem',
    borderRadius: 7, border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
    background: selected ? 'color-mix(in srgb, var(--accent) 22%, var(--bg))' : 'var(--bg)',
  } as const;
  return onClick ? (
    <button type="button" onClick={onClick} style={{ ...style, cursor: 'pointer', color: 'var(--text)' }}>{inner}</button>
  ) : (
    <span style={style}>{inner}</span>
  );
}

// ---------------------------------------------------------------------------

function ProposeTrade({ dex, mine, onDone, onCancel }: { dex: Dex; mine: CollectionEntry[]; onDone: () => void; onCancel: () => void }) {
  const [partner, setPartner] = useState('');
  const [theirs, setTheirs] = useState<{ id: number; species: string; nickname: string | null }[] | null>(null);
  const [offer, setOffer] = useState<Set<number>>(new Set());
  const [request, setRequest] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError(null);
    setBusy(true);
    const r = await api.playerCollection(partner.trim());
    setBusy(false);
    if (r.ok) setTheirs(r.value.collection);
    else { setTheirs(null); setError(r.error.error); }
  };

  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, id: number) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    setter(next);
  };

  const send = async () => {
    setError(null);
    setBusy(true);
    const r = await api.proposeTrade(partner.trim(), [...offer], [...request]);
    setBusy(false);
    if (r.ok) onDone();
    else setError(r.error.error);
  };

  const canSend = theirs !== null && (offer.size > 0 || request.size > 0);

  return (
    <Frame title="Propose a trade" onExit={onCancel} exitLabel="Cancel">
      {error && <p style={{ color: '#f85149', margin: 0 }}>{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); if (partner.trim()) void load(); }} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          value={partner}
          onChange={(e) => setPartner(e.target.value)}
          placeholder="Trainer's username"
          style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 7, padding: '0.5rem 0.7rem', width: 220 }}
        />
        <button type="submit" disabled={busy || !partner.trim()} style={ghost}>Load their collection</button>
      </form>

      {theirs && (
        <>
          <PickGrid title={`What you want from ${partner}`} items={theirs} selected={request} dex={dex} onToggle={(id) => toggle(request, setRequest, id)} />
          <PickGrid title="What you give" items={mine} selected={offer} dex={dex} onToggle={(id) => toggle(offer, setOffer, id)} />
          <button type="button" disabled={busy || !canSend} onClick={send} style={{ ...primary, justifySelf: 'start', opacity: canSend ? 1 : 0.5 }}>
            Send offer
          </button>
        </>
      )}
    </Frame>
  );
}

function PickGrid({ title, items, selected, dex, onToggle }: { title: string; items: { id: number; species: string; nickname: string | null }[]; selected: Set<number>; dex: Dex; onToggle: (id: number) => void }) {
  return (
    <div style={{ display: 'grid', gap: '0.35rem' }}>
      <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>{title}</span>
      {items.length === 0 ? (
        <Empty>Empty collection.</Empty>
      ) : (
        <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap', maxHeight: 180, overflowY: 'auto', padding: '0.15rem' }}>
          {items.map((it) => (
            <Chip key={it.id} dex={dex} species={it.species} nickname={it.nickname} selected={selected.has(it.id)} onClick={() => onToggle(it.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function Frame({ title, children, onExit, exitLabel = 'Back to menu' }: { title: string; children: React.ReactNode; onExit: () => void; exitLabel?: string }) {
  return (
    <section style={{ display: 'grid', gap: '1rem', maxWidth: 760 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <button type="button" onClick={onExit} style={ghost}>{exitLabel}</button>
      </div>
      {children}
    </section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <h3 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-dim)' }}>{title}</h3>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.85rem' }}>{children}</p>;
}

const ghost = {
  background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 7, padding: '0.4rem 0.85rem', cursor: 'pointer', fontWeight: 600,
};
const primary = {
  background: 'var(--accent)', color: '#1a1500', border: 'none',
  borderRadius: 7, padding: '0.45rem 0.95rem', cursor: 'pointer', fontWeight: 800,
};
