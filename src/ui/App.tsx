/**
 * Application shell.
 *
 * Loads the dex, then hands off to the playable board. The draft screen, tutorial, sandbox and ladder
 * will hang off this same shell as they land; for now the game goes straight to a hot-seat match so that
 * the rules can be played rather than described.
 */

import { useEffect, useState } from 'react';

import { Dex } from '../data/dex.ts';
import { GameBoard } from './GameBoard.tsx';
import { OUTCOME_PRESENTATION } from './outcomes.ts';
import { ROLE_GLYPH, ROLE_LABEL, GLYPH_FONT_STACK } from './pieceRoles.ts';
import { PIECE_CLASSES } from '../engine/board.ts';

export function App() {
  const [dex, setDex] = useState<Dex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seed, setSeed] = useState('pokemon-chess-1');

  useEffect(() => {
    Dex.load().then(setDex, (cause: unknown) => setError(String(cause)));
  }, []);

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', display: 'grid', gap: '1.25rem' }}>
      <header style={{ display: 'grid', gap: '0.3rem' }}>
        <h1 style={{ fontSize: '1.75rem' }}>Pokémon Chess</h1>
        <p style={{ margin: 0, color: 'var(--text-dim)', maxWidth: '72ch', fontSize: '0.92rem' }}>
          Chess where every piece is a Pokémon with a single type, and the type matchup decides what a
          capture means.
        </p>
      </header>

      {error && <p style={{ color: OUTCOME_PRESENTATION.immune.color }}>Failed to load the dex: {error}</p>}

      {!dex && !error && <p style={{ color: 'var(--text-dim)' }}>Loading the dex…</p>}

      {dex && (
        <>
          <RulesSummary />
          <GameBoard
            dex={dex}
            seed={seed}
            onNewGame={() => setSeed(`pokemon-chess-${Date.now()}`)}
          />
          <Legend />
          <footer style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
            {new Set(dex.species.map((s) => s.num)).size} Pokémon · {dex.moves.length} moves ·{' '}
            {dex.abilities.length} abilities · {dex.items.length} items · seed <code>{seed}</code>
          </footer>
        </>
      )}
    </main>
  );
}

/**
 * The four outcomes, stated up front.
 *
 * A stopgap until the interactive tutorial exists — but a necessary one, because a player who does not
 * know these rules will read mutual destruction as a bug the first time it happens to them.
 */
function RulesSummary() {
  const rows = [
    ['super', 'Capture succeeds, and your piece moves again.'],
    ['neutral', 'An ordinary chess capture.'],
    ['resisted', 'Both pieces are destroyed.'],
    ['immune', 'The capture is impossible. That piece cannot be touched.'],
  ] as const;

  return (
    <section
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '0.7rem 0.9rem',
        display: 'grid',
        gap: '0.35rem',
      }}
    >
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'baseline' }}>
        {rows.map(([key, text]) => {
          const p = OUTCOME_PRESENTATION[key];
          return (
            <span
              key={key}
              style={{ display: 'inline-flex', gap: '0.3rem', alignItems: 'center', fontSize: '0.8rem' }}
            >
              <span style={{ color: p.color, fontWeight: 800, minWidth: 24, textAlign: 'right' }}>
                {p.glyph}
              </span>
              <strong style={{ color: p.color }}>{p.label}:</strong>
              <span style={{ color: 'var(--text-dim)' }}>{text}</span>
            </span>
          );
        })}
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>
        Every capture also rolls a die: a <strong>1</strong> misses and destroys both pieces, a{' '}
        <strong>6</strong> is a critical hit that captures and moves again.
      </div>
    </section>
  );
}

function Legend() {
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.9rem',
        flexWrap: 'wrap',
        alignItems: 'center',
        color: 'var(--text-dim)',
        fontSize: '0.8rem',
      }}
    >
      {PIECE_CLASSES.map((cls) => (
        <span key={cls} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
          <span
            aria-hidden
            style={{
              display: 'grid',
              placeItems: 'center',
              width: '1.3rem',
              height: '1.3rem',
              borderRadius: '24%',
              background: '#f6f4ef',
              color: '#15171c',
              border: '1px solid #15171c',
              fontSize: '0.9rem',
              lineHeight: 1,
              fontFamily: GLYPH_FONT_STACK,
              fontVariantEmoji: 'text',
              paddingBottom: '0.1rem',
            }}
          >
            {ROLE_GLYPH[cls]}
          </span>
          {ROLE_LABEL[cls]}
        </span>
      ))}
      <span style={{ opacity: 0.75 }}>light badge = white, dark badge = black</span>
    </div>
  );
}
