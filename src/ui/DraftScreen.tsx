/**
 * Interactive draft.
 *
 * Both armies are drafted in one seat — hot-seat friendly, and it doubles as the surface a tutorial
 * uses to teach type matchups by asking the player to pick around them. Ranked and online modes will
 * layer sequential picking on top of this UI without rewriting it.
 *
 * Two things it must do that a naïve species list will not: surface the type profile of each pick so a
 * player who does not remember all 324 matchups can still play them, and honour the "one type per
 * piece" rule as a real *choice* for dual-typed species.
 */

import { useMemo, useState } from 'react';

import type { Dex } from '../data/dex.ts';
import type { BattleType, SpeciesEntry } from '../data/schema.ts';
import { squareName } from '../engine/board.ts';
import { Rng } from '../engine/rng.ts';
import type { Loadout } from '../engine/variant.ts';
import type { Position } from '../engine/position.ts';
import { typeProfile } from '../engine/typechart.ts';
import {
  DEFAULT_DRAFT_CONFIG,
  applyPick,
  buildSlots,
  checkPick,
  clearSlot,
  finalizeDraft,
  isDraftComplete,
} from '../game/draft.ts';
import type { DraftSlot } from '../game/draft.ts';
import { PokemonIcon } from './PokemonIcon.tsx';
import { ROLE_GLYPH, ROLE_LABEL, GLYPH_FONT_STACK } from './pieceRoles.ts';
import { TYPE_COLORS, textColorOn } from './typeColors.ts';

export interface DraftScreenProps {
  dex: Dex;
  onCancel: () => void;
  onReady: (result: { position: Position; loadout: Loadout }) => void;
}

export function DraftScreen({ dex, onCancel, onReady }: DraftScreenProps) {
  const [slots, setSlots] = useState<readonly DraftSlot[]>(() => buildSlots());
  const [active, setActive] = useState<number>(0);
  const [query, setQuery] = useState('');
  const [chosenTypes, setChosenTypes] = useState<Record<string, BattleType | undefined>>({});

  const activeSlot = slots[active];
  const complete = isDraftComplete(slots);

  const pickedSpeciesOnSide = useMemo(() => {
    if (!activeSlot) return new Set<string>();
    const same = new Set<string>();
    for (const slot of slots) {
      if (slot.side === activeSlot.side && slot.picked && slot !== activeSlot) {
        same.add(slot.picked.species);
      }
    }
    return same;
  }, [slots, activeSlot]);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    let candidates = dex.baseFormes.filter((s) => s.types.length > 0);
    if (term) {
      candidates = candidates.filter((s) => s.name.toLowerCase().includes(term));
    }
    if (activeSlot) {
      // A very light sort: role affinity, so a player who does not yet know what suits a bishop still
      // gets sensible candidates near the top. The player is free to draft any way they want.
      const rank = (s: SpeciesEntry) => dex.roleAffinity(s)[activeSlot.cls];
      candidates = candidates.slice().sort((a, b) => rank(b) - rank(a));
    }
    return candidates.slice(0, 200);
  }, [dex, query, activeSlot]);

  function suggestRandomFill() {
    // Fills every unfilled slot with a sensible pick, biased by role affinity, for a player who wants
    // to skip the drafting step. The tutorial and sandbox both need this.
    const rng = new Rng(`fill-${Date.now()}`);
    let filled = slots.slice();
    for (let i = 0; i < filled.length; i++) {
      if (filled[i]!.picked) continue;
      const slot = filled[i]!;
      const already = new Set<string>();
      for (let j = 0; j < filled.length; j++) {
        const p = filled[j]!.picked;
        if (p && filled[j]!.side === slot.side) already.add(p.species);
      }
      const candidates = dex.baseFormes
        .filter((s) => s.types.length > 0 && !already.has(s.id))
        .map((s) => ({ species: s, score: dex.roleAffinity(s)[slot.cls] }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 40)
        .map((c) => c.species);
      const chosen = rng.pick(candidates);
      const type = rng.pick(chosen.types);
      filled = applyPick(filled, i, { species: chosen.id, type });
    }
    setSlots(filled);
    // Advance to the first slot so the picks are visible in the panel.
    setActive(0);
  }

  function attemptPick(species: SpeciesEntry, type: BattleType) {
    if (!activeSlot) return;
    const error = checkPick(dex, slots, active, species, type, DEFAULT_DRAFT_CONFIG);
    if (error) return; // The list disables invalid entries; this is defence in depth.
    setSlots(applyPick(slots, active, { species: species.id, type }));
    setChosenTypes({ ...chosenTypes, [species.id]: type });
    // Advance to the next unfilled slot, so a player racing through the draft never has to click a slot
    // themselves.
    for (let i = active + 1; i < slots.length; i++) {
      if (!slots[i]!.picked) {
        setActive(i);
        return;
      }
    }
    for (let i = 0; i < active; i++) {
      if (!slots[i]!.picked) {
        setActive(i);
        return;
      }
    }
  }

  function readyForKickoff() {
    if (!complete) return;
    const finalized = finalizeDraft(dex, slots);
    onReady({ position: finalized.position, loadout: finalized.loadout });
  }

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <DraftHeader
        slots={slots}
        onFill={suggestRandomFill}
        onClear={() => setSlots(buildSlots())}
        onCancel={onCancel}
        onReady={readyForKickoff}
        canStart={complete}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', alignItems: 'start' }}>
        <SlotBoard
          dex={dex}
          slots={slots}
          active={active}
          onSelect={(i) => setActive(i)}
          onClear={(i) => {
            setSlots(clearSlot(slots, i));
            setActive(i);
          }}
        />
        <PickerPanel
          dex={dex}
          activeSlot={activeSlot ?? null}
          filtered={filtered}
          query={query}
          setQuery={setQuery}
          pickedOnSide={pickedSpeciesOnSide}
          chosenTypes={chosenTypes}
          setChosenTypes={setChosenTypes}
          onPick={attemptPick}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function DraftHeader({
  slots,
  onFill,
  onClear,
  onCancel,
  onReady,
  canStart,
}: {
  slots: readonly DraftSlot[];
  onFill: () => void;
  onClear: () => void;
  onCancel: () => void;
  onReady: () => void;
  canStart: boolean;
}) {
  const filled = slots.filter((s) => s.picked).length;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.7rem',
        flexWrap: 'wrap',
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '0.55rem 0.85rem',
      }}
    >
      <strong>Draft</strong>
      <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
        {filled}/{slots.length} slots filled
      </span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>
        <PillButton onClick={onCancel}>Cancel</PillButton>
        <PillButton onClick={onClear}>Clear all</PillButton>
        <PillButton onClick={onFill}>Auto-fill rest</PillButton>
        <PillButton onClick={onReady} disabled={!canStart} primary>
          {canStart ? 'Start match →' : 'Fill every slot to start'}
        </PillButton>
      </span>
    </div>
  );
}

function PillButton({
  onClick,
  disabled,
  primary,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled ?? false}
      style={{
        background: primary ? 'var(--accent)' : 'transparent',
        color: primary ? '#1a1500' : 'var(--text)',
        border: primary ? 'none' : '1px solid var(--border)',
        borderRadius: 6,
        padding: '0.3rem 0.7rem',
        fontWeight: primary ? 800 : 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.45 : 1,
        fontSize: '0.82rem',
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------

function SlotBoard({
  dex,
  slots,
  active,
  onSelect,
  onClear,
}: {
  dex: Dex;
  slots: readonly DraftSlot[];
  active: number;
  onSelect: (index: number) => void;
  onClear: (index: number) => void;
}) {
  const groups = [
    ['White pieces', slots.map((s, i) => ({ slot: s, index: i })).filter((r) => r.slot.side === 'white')],
    ['Black pieces', slots.map((s, i) => ({ slot: s, index: i })).filter((r) => r.slot.side === 'black')],
  ] as const;

  return (
    <div style={{ display: 'grid', gap: '0.9rem' }}>
      {groups.map(([label, rows]) => (
        <section
          key={label}
          style={{
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: '0.6rem 0.75rem',
          }}
        >
          <h3
            style={{
              fontSize: '0.7rem',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              color: 'var(--text-dim)',
              marginBottom: '0.4rem',
            }}
          >
            {label}
          </h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
              gap: '0.35rem',
            }}
          >
            {rows.map(({ slot, index }) => (
              <SlotCard
                key={slot.square}
                dex={dex}
                slot={slot}
                active={index === active}
                onSelect={() => onSelect(index)}
                onClear={() => onClear(index)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SlotCard({
  dex,
  slot,
  active,
  onSelect,
  onClear,
}: {
  dex: Dex;
  slot: DraftSlot;
  active: boolean;
  onSelect: () => void;
  onClear: () => void;
}) {
  const picked = slot.picked;
  const species = picked ? dex.getSpecies(picked.species) : null;

  return (
    <div
      style={{
        border: active ? '2px solid #58a6ff' : '1px solid var(--border)',
        borderRadius: 6,
        padding: '0.35rem 0.4rem 0.4rem',
        display: 'grid',
        gap: '0.15rem',
        background: active ? 'rgba(88,166,255,0.08)' : 'transparent',
      }}
    >
      <button
        type="button"
        onClick={onSelect}
        style={{
          background: 'none',
          border: 'none',
          color: 'inherit',
          textAlign: 'left',
          padding: 0,
          cursor: 'pointer',
          display: 'grid',
          gap: '0.15rem',
        }}
      >
        <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', fontSize: '0.72rem' }}>
          <span style={{ fontFamily: GLYPH_FONT_STACK, fontVariantEmoji: 'text' }}>
            {ROLE_GLYPH[slot.cls]}
          </span>
          <span style={{ color: 'var(--text-dim)' }}>
            {ROLE_LABEL[slot.cls]} · {squareName(slot.square)}
          </span>
        </div>
        {picked && species ? (
          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            <PokemonIcon species={species} />
            <div style={{ display: 'grid' }}>
              <strong style={{ fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {species.name}
              </strong>
              <span
                style={{
                  fontSize: '0.65rem',
                  color: textColorOn(picked.type),
                  background: TYPE_COLORS[picked.type],
                  padding: '0 0.35rem',
                  borderRadius: 999,
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.03em',
                  justifySelf: 'start',
                }}
              >
                {picked.type}
              </span>
            </div>
          </div>
        ) : (
          <span style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>
            {active ? 'Pick from the right' : 'Empty'}
          </span>
        )}
      </button>
      {picked && (
        <button
          type="button"
          onClick={onClear}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-dim)',
            cursor: 'pointer',
            fontSize: '0.68rem',
            justifySelf: 'start',
            padding: 0,
          }}
        >
          clear
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PickerPanel({
  dex,
  activeSlot,
  filtered,
  query,
  setQuery,
  pickedOnSide,
  chosenTypes,
  setChosenTypes,
  onPick,
}: {
  dex: Dex;
  activeSlot: DraftSlot | null;
  filtered: readonly SpeciesEntry[];
  query: string;
  setQuery: (q: string) => void;
  pickedOnSide: Set<string>;
  chosenTypes: Record<string, BattleType | undefined>;
  setChosenTypes: (next: Record<string, BattleType | undefined>) => void;
  onPick: (species: SpeciesEntry, type: BattleType) => void;
}) {
  return (
    <section
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '0.6rem 0.75rem',
        display: 'grid',
        gap: '0.55rem',
      }}
    >
      <h3
        style={{
          fontSize: '0.72rem',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          color: 'var(--text-dim)',
        }}
      >
        {activeSlot
          ? `Pick for ${activeSlot.side} ${ROLE_LABEL[activeSlot.cls].toLowerCase()} on ${squareName(activeSlot.square)}`
          : 'Pick a slot'}
      </h3>
      <input
        type="search"
        value={query}
        placeholder="Search 1025 Pokémon…"
        onChange={(e) => setQuery(e.target.value)}
        style={{
          background: '#0b0e13',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '0.35rem 0.55rem',
          color: 'inherit',
          fontSize: '0.85rem',
        }}
      />
      <div
        style={{
          maxHeight: 520,
          overflowY: 'auto',
          display: 'grid',
          gap: '0.3rem',
          paddingRight: '0.25rem',
        }}
      >
        {filtered.map((species) => (
          <CandidateRow
            key={species.id}
            dex={dex}
            species={species}
            takenOnSide={pickedOnSide.has(species.id)}
            selectedType={chosenTypes[species.id] ?? species.types[0]!}
            setSelectedType={(t) => setChosenTypes({ ...chosenTypes, [species.id]: t })}
            onPick={(type) => onPick(species, type)}
          />
        ))}
      </div>
    </section>
  );
}

function CandidateRow({
  dex,
  species,
  takenOnSide,
  selectedType,
  setSelectedType,
  onPick,
}: {
  dex: Dex;
  species: SpeciesEntry;
  takenOnSide: boolean;
  selectedType: BattleType;
  setSelectedType: (t: BattleType) => void;
  onPick: (type: BattleType) => void;
}) {
  const profile = typeProfile(selectedType);
  void dex;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        alignItems: 'center',
        gap: '0.4rem',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '0.3rem 0.4rem',
        background: takenOnSide ? 'rgba(255,255,255,0.02)' : 'transparent',
        opacity: takenOnSide ? 0.55 : 1,
      }}
    >
      <PokemonIcon species={species} />
      <div style={{ display: 'grid', gap: '0.1rem', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
          <strong style={{ fontSize: '0.82rem' }}>{species.name}</strong>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>BST {species.bst}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {species.types.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setSelectedType(t)}
              style={{
                border: 'none',
                background: TYPE_COLORS[t],
                color: textColorOn(t),
                borderRadius: 999,
                fontSize: '0.65rem',
                fontWeight: 800,
                textTransform: 'uppercase',
                padding: '0.05rem 0.4rem',
                letterSpacing: '0.03em',
                cursor: 'pointer',
                outline: selectedType === t ? '2px solid #fff' : 'none',
                outlineOffset: -2,
              }}
            >
              {t}
            </button>
          ))}
          {species.types.length > 1 && (
            <span style={{ fontSize: '0.66rem', color: 'var(--text-dim)' }}>
              (choose one — it decides what this piece can and cannot capture)
            </span>
          )}
        </div>
        <MatchupChips profile={profile} />
      </div>
      <button
        type="button"
        onClick={() => onPick(selectedType)}
        disabled={takenOnSide}
        style={{
          background: takenOnSide ? 'transparent' : 'var(--accent)',
          color: takenOnSide ? 'var(--text-dim)' : '#1a1500',
          border: takenOnSide ? '1px solid var(--border)' : 'none',
          borderRadius: 6,
          padding: '0.25rem 0.6rem',
          fontWeight: 800,
          fontSize: '0.75rem',
          cursor: takenOnSide ? 'not-allowed' : 'pointer',
        }}
      >
        {takenOnSide ? 'On army' : 'Pick'}
      </button>
    </div>
  );
}

function MatchupChips({ profile }: { profile: ReturnType<typeof typeProfile> }) {
  const brief = (types: BattleType[]) =>
    types.map((t) => (
      <span
        key={t}
        style={{
          background: TYPE_COLORS[t],
          color: textColorOn(t),
          borderRadius: 3,
          padding: '0 0.3rem',
          fontSize: '0.6rem',
          fontWeight: 700,
        }}
      >
        {t}
      </span>
    ));

  return (
    <div style={{ display: 'grid', gap: '0.12rem', fontSize: '0.66rem', color: 'var(--text-dim)' }}>
      {profile.superEffectiveAgainst.length > 0 && (
        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: '#3fb950', fontWeight: 700 }}>×2</span>
          {brief(profile.superEffectiveAgainst)}
        </div>
      )}
      {profile.cannotCapture.length > 0 && (
        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ color: '#f85149', fontWeight: 700 }}>⊘</span>
          {brief(profile.cannotCapture)}
        </div>
      )}
    </div>
  );
}
