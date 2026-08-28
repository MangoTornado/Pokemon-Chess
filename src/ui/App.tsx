/**
 * Application shell and mode router.
 *
 * A tiny state machine — title, draft, match — that owns the transitions between them. The screens
 * themselves are self-contained; this layer's only job is to answer "what does the whole screen show
 * right now" and to hand off the two things a match needs to start: a `Position` and a `Loadout`.
 *
 * The router is where sandbox and tutorial modes will attach as they arrive. Kept in one place because
 * the transitions matter — a player exiting a match should land somewhere they can pick what to do
 * next, not back at a menu with no context.
 */

import { useEffect, useState } from 'react';

import { Dex } from '../data/dex.ts';
import type { Position } from '../engine/position.ts';
import type { Loadout } from '../engine/variant.ts';
import { autodraft } from '../game/autodraft.ts';
import { DIFFICULTIES } from '../ai/search.ts';
import type { Difficulty } from '../ai/search.ts';
import type { Side } from '../engine/variant.ts';
import { DraftScreen } from './DraftScreen.tsx';
import { GameBoard } from './GameBoard.tsx';
import { TIER_PRESENTATION } from './outcomes.ts';
import { PIECE_CLASSES } from '../engine/board.ts';
import { ROLE_GLYPH, ROLE_LABEL, GLYPH_FONT_STACK } from './pieceRoles.ts';

type Screen =
  | { readonly kind: 'title' }
  | { readonly kind: 'draft'; readonly ai?: { side: Side; difficulty: Difficulty } }
  | {
      readonly kind: 'match';
      readonly seed: string;
      readonly setup: MatchSetup;
      readonly ai?: { side: Side; difficulty: Difficulty };
    };

interface MatchSetup {
  readonly position: Position;
  readonly loadout: Loadout;
}

export function App() {
  const [dex, setDex] = useState<Dex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: 'title' });

  useEffect(() => {
    Dex.load().then(setDex, (cause: unknown) => setError(String(cause)));
  }, []);

  if (error) {
    return (
      <main style={{ maxWidth: 640, margin: '0 auto' }}>
        <Header />
        <p style={{ color: TIER_PRESENTATION.immune.color }}>Failed to load the dex: {error}</p>
      </main>
    );
  }

  if (!dex) {
    return (
      <main style={{ maxWidth: 640, margin: '0 auto' }}>
        <Header />
        <p style={{ color: 'var(--text-dim)' }}>Loading the dex…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1024, margin: '0 auto', display: 'grid', gap: '1.25rem' }}>
      <Header />

      {screen.kind === 'title' && (
        <TitleScreen
          onQuickPlay={(ai) => {
            const seed = `sandbox-${Date.now()}`;
            const drafted = autodraft(dex, seed);
            setScreen({ kind: 'match', seed, setup: { position: drafted.position, loadout: drafted.loadout }, ...(ai ? { ai } : {}) });
          }}
          onDraft={(ai) => setScreen({ kind: 'draft', ...(ai ? { ai } : {}) })}
        />
      )}

      {screen.kind === 'draft' && (
        <DraftScreen
          dex={dex}
          onCancel={() => setScreen({ kind: 'title' })}
          onReady={(setup) =>
            setScreen({ kind: 'match', seed: `drafted-${Date.now()}`, setup, ...(screen.ai ? { ai: screen.ai } : {}) })
          }
        />
      )}

      {screen.kind === 'match' && (
        <>
          <RulesSummary />
          <GameBoard
            dex={dex}
            seed={screen.seed}
            setup={screen.setup}
            onLeave={() => setScreen({ kind: 'title' })}
            {...(screen.ai ? { ai: screen.ai } : {})}
          />
          <Legend />
        </>
      )}

      <footer style={{ color: 'var(--text-dim)', fontSize: '0.78rem' }}>
        {new Set(dex.species.map((s) => s.num)).size} Pokémon · {dex.moves.length} moves ·{' '}
        {dex.abilities.length} abilities · {dex.items.length} items
      </footer>
    </main>
  );
}

function Header() {
  return (
    <header style={{ display: 'grid', gap: '0.3rem' }}>
      <h1 style={{ fontSize: '1.75rem' }}>Pokémon Chess</h1>
      <p style={{ margin: 0, color: 'var(--text-dim)', maxWidth: '72ch', fontSize: '0.92rem' }}>
        Chess where every piece is a Pokémon with a single type, and the type matchup decides what a
        capture means.
      </p>
    </header>
  );
}

const DIFFICULTY_ORDER = ['rookie', 'trainer', 'ace', 'champion'] as const;

function TitleScreen({
  onQuickPlay,
  onDraft,
}: {
  onQuickPlay: (ai?: { side: Side; difficulty: Difficulty }) => void;
  onDraft: (ai?: { side: Side; difficulty: Difficulty }) => void;
}) {
  const [mode, setMode] = useState<'ai' | 'hotseat'>('ai');
  const [difficultyKey, setDifficultyKey] = useState<(typeof DIFFICULTY_ORDER)[number]>('trainer');
  // The AI plays black, so the human (white) moves first.
  const ai = mode === 'ai' ? { side: 'black' as Side, difficulty: DIFFICULTIES[difficultyKey]! } : undefined;

  return (
    <section
      style={{
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '1.25rem 1.4rem',
        display: 'grid',
        gap: '0.9rem',
      }}
    >
      <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.92rem' }}>
        <strong style={{ color: 'var(--text)' }}>New here?</strong> Try Quick Play — both armies are
        drafted for you, so you can see the four capture outcomes without picking a team first. When
        you're ready to choose your own Pokémon, use Draft.
      </p>

      <div style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <Segmented
          label="Opponent"
          options={[
            ['ai', 'vs Computer'],
            ['hotseat', 'Two players'],
          ]}
          value={mode}
          onChange={(v) => setMode(v as 'ai' | 'hotseat')}
        />
        {mode === 'ai' && (
          <Segmented
            label="Difficulty"
            options={DIFFICULTY_ORDER.map((k) => [k, DIFFICULTIES[k]!.name] as [string, string])}
            value={difficultyKey}
            onChange={(v) => setDifficultyKey(v as (typeof DIFFICULTY_ORDER)[number])}
          />
        )}
      </div>
      {mode === 'ai' && (
        <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.78rem' }}>
          You play White. A Rookie hasn't learned the type chart yet and will walk into bad trades; a
          Champion knows it cold.
        </p>
      )}

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <BigButton onClick={() => onQuickPlay(ai)} primary>
          <span style={{ fontSize: '1.05rem' }}>Quick Play</span>
          <small>Auto-drafted armies</small>
        </BigButton>
        <BigButton onClick={() => onDraft(ai)}>
          <span style={{ fontSize: '1.05rem' }}>Draft your army</span>
          <small>Choose all 32 pieces from every Pokémon</small>
        </BigButton>
      </div>
    </section>
  );
}

function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [string, string][];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: 'grid', gap: '0.25rem' }}>
      <span style={{ fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
        {label}
      </span>
      <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
        {options.map(([k, name]) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(k)}
            style={{
              background: value === k ? 'var(--accent)' : 'transparent',
              color: value === k ? '#1a1500' : 'var(--text)',
              border: 'none',
              padding: '0.3rem 0.7rem',
              fontWeight: value === k ? 700 : 500,
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

function BigButton({
  onClick,
  primary,
  children,
}: {
  onClick: () => void;
  primary?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: primary ? 'var(--accent)' : 'transparent',
        color: primary ? '#1a1500' : 'var(--text)',
        border: primary ? 'none' : '1px solid var(--border)',
        borderRadius: 8,
        padding: '0.7rem 1rem',
        display: 'grid',
        gap: '0.2rem',
        cursor: 'pointer',
        textAlign: 'left',
        minWidth: 200,
      }}
    >
      {children}
    </button>
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
    ['super', 'Hit hard. A knockout lets your piece move again.'],
    ['neutral', 'An even trade of blows.'],
    ['resisted', 'You hit weakly and it hits back — you may lose the exchange.'],
    ['immune', 'Impossible. That type cannot be touched by yours.'],
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
          const p = TIER_PRESENTATION[key];
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
        Every piece has HP, and a capture is a short exchange of blows: the faster piece can strike first,
        and a piece can survive wounded or lose the exchange outright. The forecast on the board tells you
        how a capture will resolve before you commit. Win by capturing the enemy king.
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
