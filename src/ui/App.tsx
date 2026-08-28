/**
 * Interim landing view.
 *
 * This is deliberately a working slice rather than a mock: it drafts an army from the real dex, lays it
 * out on real starting squares, and resolves capture outcomes through the real type chart. That makes it
 * an end-to-end check that data loading, the seeded RNG, board geometry, the type chart, and sprite
 * rendering all work together in the browser — and it doubles as a playable demonstration of the one
 * mechanic the whole game is built on.
 *
 * It will be replaced by the drafting and match UI once the ruleset is settled.
 */

import { useEffect, useMemo, useState } from 'react';

import { Dex } from '../data/dex.ts';
import type { BattleType, SpeciesEntry } from '../data/schema.ts';
import {
  ALL_SQUARES,
  PIECE_CLASSES,
  STARTING_SQUARES,
  rankOf,
  squareColor,
  squareName,
} from '../engine/board.ts';
import type { PieceClass, Side, Square } from '../engine/board.ts';
import { Rng } from '../engine/rng.ts';
import { captureOutcome, effectiveness } from '../engine/typechart.ts';
import type { CaptureOutcome } from '../engine/typechart.ts';
import { PokemonIcon } from './PokemonIcon.tsx';
import { TYPE_COLORS, textColorOn } from './typeColors.ts';

interface DemoPiece {
  square: Square;
  side: Side;
  cls: PieceClass;
  species: SpeciesEntry;
  /** The single type this piece fights as — chosen from the species' real typing at draft time. */
  type: BattleType;
}

/** Picks the species for one role, biased by stat profile but still varied. */
function draftFor(dex: Dex, cls: PieceClass, rng: Rng, taken: Set<string>): SpeciesEntry {
  const pool = dex.baseFormes.filter((s) => !taken.has(s.id) && s.types.length > 0);

  const eligible = pool.filter((s) => {
    if (cls === 'pawn') return s.bst <= 420;
    if (cls === 'queen') return s.bst >= 520;
    if (cls === 'king') return s.bst >= 480;
    return s.bst >= 380 && s.bst <= 600;
  });

  const candidates = (eligible.length >= 40 ? eligible : pool)
    .map((s) => ({ s, score: dex.roleAffinity(s)[cls] }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 60)
    .map((c) => c.s);

  const chosen = rng.pick(candidates);
  taken.add(chosen.id);
  return chosen;
}

/**
 * Builds a full two-army board.
 *
 * Seeded, so the same demo appears on every load and a surprising layout can be reproduced.
 */
function draftArmies(dex: Dex, seed: string): DemoPiece[] {
  const rng = new Rng(seed);
  const taken = new Set<string>();
  const pieces: DemoPiece[] = [];

  for (const side of ['white', 'black'] as const) {
    for (const cls of PIECE_CLASSES) {
      for (const square of STARTING_SQUARES[side][cls]) {
        const species = draftFor(dex, cls, rng, taken);
        pieces.push({
          square,
          side,
          cls,
          species,
          // A dual-typed species is a real choice: Lapras as Water or as Ice changes what it can take.
          type: rng.pick(species.types),
        });
      }
    }
  }
  return pieces;
}

const OUTCOME_COPY: Record<CaptureOutcome, { label: string; detail: string; color: string }> = {
  super: {
    label: 'Super effective',
    detail: 'The capture succeeds and the attacker immediately moves again.',
    color: '#3fb950',
  },
  neutral: {
    label: 'Neutral',
    detail: 'An ordinary chess capture.',
    color: '#8b949e',
  },
  resisted: {
    label: 'Not very effective',
    detail: 'Both pieces are destroyed.',
    color: '#d29922',
  },
  immune: {
    label: 'No effect',
    detail: 'The capture is illegal — this piece cannot be taken by that type at all.',
    color: '#f85149',
  },
};

function TypeBadge({ type }: { type: BattleType }) {
  return (
    <span
      style={{
        background: TYPE_COLORS[type],
        color: textColorOn(type),
        padding: '0.1rem 0.45rem',
        borderRadius: 999,
        fontSize: '0.7rem',
        fontWeight: 700,
        letterSpacing: '0.02em',
        textTransform: 'uppercase',
      }}
    >
      {type}
    </span>
  );
}

export function App() {
  const [dex, setDex] = useState<Dex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attacker, setAttacker] = useState<Square | null>(null);
  const [defender, setDefender] = useState<Square | null>(null);

  useEffect(() => {
    Dex.load().then(setDex, (cause: unknown) => setError(String(cause)));
  }, []);

  const pieces = useMemo(() => (dex ? draftArmies(dex, 'pokemon-chess-demo') : []), [dex]);
  const bySquare = useMemo(() => {
    const map = new Map<Square, DemoPiece>();
    for (const p of pieces) map.set(p.square, p);
    return map;
  }, [pieces]);

  if (error) {
    return (
      <main style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1>Pokémon Chess</h1>
        <p style={{ color: '#f85149' }}>Failed to load the dex: {error}</p>
      </main>
    );
  }

  if (!dex) {
    return (
      <main style={{ maxWidth: 640, margin: '0 auto' }}>
        <h1>Pokémon Chess</h1>
        <p style={{ color: 'var(--text-dim)' }}>Loading the dex…</p>
      </main>
    );
  }

  const attackerPiece = attacker === null ? null : bySquare.get(attacker) ?? null;
  const defenderPiece = defender === null ? null : bySquare.get(defender) ?? null;

  const outcome =
    attackerPiece && defenderPiece
      ? captureOutcome(attackerPiece.type, defenderPiece.type)
      : null;
  const multiplier =
    attackerPiece && defenderPiece
      ? effectiveness(attackerPiece.type, defenderPiece.type)
      : null;

  function onSquareClick(square: Square) {
    const piece = bySquare.get(square);
    if (!piece) {
      setAttacker(null);
      setDefender(null);
      return;
    }
    if (attacker === null || attackerPiece?.side === piece.side) {
      setAttacker(square);
      setDefender(null);
      return;
    }
    setDefender(square);
  }

  // Rank 8 renders first so white sits at the bottom, as a player expects.
  const rows = [7, 6, 5, 4, 3, 2, 1, 0];

  return (
    <main style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gap: '1.5rem' }}>
      <header style={{ display: 'grid', gap: '0.35rem' }}>
        <h1 style={{ fontSize: '1.9rem' }}>Pokémon Chess</h1>
        <p style={{ margin: 0, color: 'var(--text-dim)', maxWidth: '60ch' }}>
          Chess where every piece is a Pokémon with a single type, and the type matchup decides what a
          capture means. Click one of your pieces, then an enemy piece, to see how that capture resolves.
        </p>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
          border: '2px solid var(--border)',
          borderRadius: 8,
          overflow: 'hidden',
          aspectRatio: '1 / 1',
          maxWidth: 640,
        }}
      >
        {rows.flatMap((rank) =>
          ALL_SQUARES.filter((sq) => rankOf(sq) === rank).map((square) => {
            const piece = bySquare.get(square);
            const isAttacker = square === attacker;
            const isDefender = square === defender;
            return (
              <button
                key={square}
                type="button"
                onClick={() => onSquareClick(square)}
                aria-label={
                  piece
                    ? `${squareName(square)}: ${piece.side} ${piece.cls}, ${piece.species.name}, ${piece.type} type`
                    : `${squareName(square)}: empty`
                }
                style={{
                  position: 'relative',
                  border: 'none',
                  padding: 0,
                  cursor: piece ? 'pointer' : 'default',
                  background:
                    squareColor(square) === 'light' ? 'var(--square-light)' : 'var(--square-dark)',
                  display: 'grid',
                  placeItems: 'center',
                  outline: isAttacker
                    ? '3px solid #58a6ff'
                    : isDefender
                      ? `3px solid ${outcome ? OUTCOME_COPY[outcome].color : '#fff'}`
                      : 'none',
                  outlineOffset: -3,
                }}
              >
                {piece && (
                  <>
                    {/* A ring rather than a filled disc: at any opacity high enough to identify the
                        type, a solid fill swallows the sprite and muddies the whole board. */}
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        inset: '9%',
                        borderRadius: '50%',
                        background: `${TYPE_COLORS[piece.type]}2e`,
                        boxShadow: `inset 0 0 0 2.5px ${TYPE_COLORS[piece.type]}`,
                      }}
                    />
                    <span
                      aria-hidden
                      style={{
                        position: 'absolute',
                        inset: 0,
                        // Marks which army owns the piece, independently of its type colour.
                        boxShadow:
                          piece.side === 'white'
                            ? 'inset 0 -3px 0 0 rgba(255,255,255,0.85)'
                            : 'inset 0 3px 0 0 rgba(20,20,25,0.85)',
                      }}
                    />
                    <PokemonIcon
                      species={piece.species}
                      scale={1.6}
                      flipped={piece.side === 'black'}
                      style={{
                        position: 'relative',
                        zIndex: 1,
                        filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.55))',
                      }}
                    />
                  </>
                )}
              </button>
            );
          }),
        )}
      </div>

      <section
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '1rem 1.15rem',
          minHeight: 120,
        }}
      >
        {!attackerPiece && (
          <p style={{ margin: 0, color: 'var(--text-dim)' }}>
            Select a piece to inspect it.
          </p>
        )}

        {attackerPiece && (
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <PokemonIcon species={attackerPiece.species} scale={1.4} />
              <strong>{attackerPiece.species.name}</strong>
              <TypeBadge type={attackerPiece.type} />
              <span style={{ color: 'var(--text-dim)' }}>
                {attackerPiece.side} {attackerPiece.cls} · base stat total{' '}
                {attackerPiece.species.bst}
              </span>
            </div>

            {defenderPiece && outcome && (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}
                >
                  <span style={{ color: 'var(--text-dim)' }}>attacking</span>
                  <PokemonIcon species={defenderPiece.species} flipped />
                  <strong>{defenderPiece.species.name}</strong>
                  <TypeBadge type={defenderPiece.type} />
                </div>
                <div
                  style={{
                    borderLeft: `4px solid ${OUTCOME_COPY[outcome].color}`,
                    paddingLeft: '0.7rem',
                  }}
                >
                  <div style={{ fontWeight: 700, color: OUTCOME_COPY[outcome].color }}>
                    {OUTCOME_COPY[outcome].label} · {multiplier}×
                  </div>
                  <div style={{ color: 'var(--text-dim)' }}>{OUTCOME_COPY[outcome].detail}</div>
                </div>
              </div>
            )}

            {!defenderPiece && (
              <p style={{ margin: 0, color: 'var(--text-dim)' }}>
                Now select an enemy piece to resolve a capture.
              </p>
            )}
          </div>
        )}
      </section>

      <footer style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
        {dex.species.length} formes across {new Set(dex.species.map((s) => s.num)).size} Pokémon ·{' '}
        {dex.moves.length} moves · {dex.abilities.length} abilities · {dex.items.length} items
      </footer>
    </main>
  );
}
