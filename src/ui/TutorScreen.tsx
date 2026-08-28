/**
 * The interactive tutorial (DIRECTION directive 7, SPEC §18).
 *
 * A lesson is not a script — it is a real game on a hand-built position, played on the same board as a
 * match. This screen layers three things over that board: a coaching bubble whose lines are keyed to the
 * events the engine actually emits, a goal detector that watches resolved moves and refusals, and an
 * action filter that steers the player to the piece the lesson is about without ever forcing their hand.
 * The branch is the SPEC's "which would you rather skip?" — framed as what you may skip, never as what you
 * need taught, so neither path feels remedial.
 */

import { useCallback, useMemo, useState } from 'react';

import type { Dex } from '../data/dex.ts';
import { parseSquare, squareName } from '../engine/board.ts';
import type { PokemonChess, ResolvedMove, VariantMove } from '../engine/variant.ts';
import { GameBoard } from './GameBoard.tsx';
import { LESSONS } from '../tutor/content.ts';
import { buildLessonSetup } from '../tutor/lessons.ts';
import type { Lesson, Track } from '../tutor/lessons.ts';

const DONE_KEY = 'pc.tutorial.done';

function loadDone(): Set<string> {
  try {
    const raw = localStorage.getItem(DONE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveDone(done: Set<string>): void {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...done]));
  } catch {
    // A private-mode browser with no storage still gets a working tutorial, just no memory of it.
  }
}

const TRACK_LABEL: Record<Track, string> = {
  'chess-player': 'For chess players — the type chart',
  'pokemon-player': 'For Pokémon players — how the pieces move',
  shared: 'The capture rules — everyone plays these',
};

const TRACK_ORDER: readonly Track[] = ['pokemon-player', 'chess-player', 'shared'];

export interface TutorScreenProps {
  dex: Dex;
  onExit: () => void;
}

export function TutorScreen({ dex, onExit }: TutorScreenProps) {
  const [done, setDone] = useState<Set<string>>(() => loadDone());
  const [active, setActive] = useState<Lesson | null>(null);
  // The branch: which track the player chooses to skip. Both default to "teach me" (nothing skipped).
  const [skipMovement, setSkipMovement] = useState(false);
  const [skipTypes, setSkipTypes] = useState(false);

  const markDone = useCallback((id: string) => {
    setDone((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      saveDone(next);
      return next;
    });
  }, []);

  const visible = useMemo(() => {
    return LESSONS.filter((l) => {
      if (l.track === 'pokemon-player' && skipMovement) return false;
      if (l.track === 'chess-player' && skipTypes) return false;
      return true;
    });
  }, [skipMovement, skipTypes]);

  if (active) {
    return (
      <LessonPlayer
        key={active.id}
        dex={dex}
        lesson={active}
        onComplete={() => markDone(active.id)}
        onBack={() => setActive(null)}
        onNext={() => {
          const idx = visible.findIndex((l) => l.id === active.id);
          const next = visible[idx + 1];
          setActive(next ?? null);
        }}
        hasNext={visible.findIndex((l) => l.id === active.id) < visible.length - 1}
      />
    );
  }

  const grouped = TRACK_ORDER.map((track) => ({ track, lessons: visible.filter((l) => l.track === track) })).filter(
    (g) => g.lessons.length > 0,
  );

  return (
    <section style={{ display: 'grid', gap: '1.1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>Learn to play</h2>
          <p style={{ margin: '0.3rem 0 0', color: 'var(--text-dim)', maxWidth: '60ch' }}>
            Three rule sets are stacked here: how the pieces move, the type chart, and what a capture means.
            You learn each by causing it. Play a lesson, or skip the parts you already know.
          </p>
        </div>
        <button type="button" onClick={onExit} style={ghostButton}>
          Back to menu
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '0.7rem',
        }}
      >
        <SkipCard
          title="I know how chess pieces move"
          detail="Skip the movement lessons and start with type."
          on={skipMovement}
          onToggle={() => setSkipMovement((v) => !v)}
        />
        <SkipCard
          title="I know the Pokémon type chart"
          detail="Skip the type lessons and start with movement."
          on={skipTypes}
          onToggle={() => setSkipTypes((v) => !v)}
        />
      </div>

      {grouped.map(({ track, lessons }) => (
        <div key={track} style={{ display: 'grid', gap: '0.5rem' }}>
          <h3 style={{ margin: '0.3rem 0 0', fontSize: '0.95rem', color: 'var(--text-dim)', letterSpacing: '0.02em' }}>
            {TRACK_LABEL[track]}
          </h3>
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {lessons.map((lesson, i) => (
              <LessonRow
                key={lesson.id}
                lesson={lesson}
                index={i + 1}
                done={done.has(lesson.id)}
                onPlay={() => setActive(lesson)}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

const ghostButton = {
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 7,
  padding: '0.4rem 0.9rem',
  cursor: 'pointer',
  fontWeight: 600,
} as const;

function SkipCard({ title, detail, on, onToggle }: { title: string; detail: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      style={{
        textAlign: 'left',
        background: on ? 'var(--accent)' : 'var(--bg-raised)',
        color: on ? '#1a1500' : 'var(--text)',
        border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 9,
        padding: '0.7rem 0.85rem',
        cursor: 'pointer',
        display: 'grid',
        gap: '0.2rem',
      }}
    >
      <span style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <span aria-hidden>{on ? '✓' : '＋'}</span>
        {title}
      </span>
      <span style={{ fontSize: '0.8rem', opacity: on ? 0.85 : 0.7 }}>{detail}</span>
    </button>
  );
}

function LessonRow({ lesson, index, done, onPlay }: { lesson: Lesson; index: number; done: boolean; onPlay: () => void }) {
  return (
    <button
      type="button"
      onClick={onPlay}
      style={{
        textAlign: 'left',
        background: 'var(--bg-raised)',
        border: '1px solid var(--border)',
        borderRadius: 9,
        padding: '0.7rem 0.9rem',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '0.85rem',
      }}
    >
      <span
        aria-hidden
        style={{
          flexShrink: 0,
          width: 30,
          height: 30,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 800,
          background: done ? 'var(--accent)' : 'transparent',
          color: done ? '#1a1500' : 'var(--text-dim)',
          border: `1.5px solid ${done ? 'var(--accent)' : 'var(--border)'}`,
        }}
      >
        {done ? '✓' : index}
      </span>
      <span style={{ display: 'grid', gap: '0.15rem' }}>
        <span style={{ fontWeight: 700, color: 'var(--text)' }}>{lesson.title}</span>
        <span style={{ fontSize: '0.82rem', color: 'var(--text-dim)' }}>{lesson.blurb}</span>
      </span>
      <span style={{ marginLeft: 'auto', color: 'var(--text-dim)', fontSize: '0.8rem' }}>{done ? 'Replay' : 'Play ▸'}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Playing one lesson
// ---------------------------------------------------------------------------

function LessonPlayer({
  dex,
  lesson,
  onComplete,
  onBack,
  onNext,
  hasNext,
}: {
  dex: Dex;
  lesson: Lesson;
  onComplete: () => void;
  onBack: () => void;
  onNext: () => void;
  hasNext: boolean;
}) {
  const setup = useMemo(() => buildLessonSetup(lesson), [lesson]);
  const enterBeat = lesson.beats.find((b) => b.on === 'enter')?.say ?? '';
  const doneBeat = lesson.beats.find((b) => b.on === 'done')?.say ?? '';

  const [message, setMessage] = useState(enterBeat);
  const [complete, setComplete] = useState(false);
  // Whether a bonus move was pending going into the current resolution (for the spend-the-bonus goal).
  const [bonusPending, setBonusPending] = useState(false);

  const allow = useMemo(() => {
    if (!lesson.allowFrom) return undefined;
    const froms = new Set(lesson.allowFrom);
    return (m: VariantMove) => froms.has(squareName(m.move.from));
  }, [lesson]);

  const finish = useCallback(() => {
    setComplete(true);
    setMessage(doneBeat);
    onComplete();
  }, [doneBeat, onComplete]);

  const beatFor = useCallback(
    (trigger: string) => {
      const beat = lesson.beats.find((b) => b.on === trigger);
      if (beat) setMessage(beat.say);
    },
    [lesson],
  );

  const handleResolved = useCallback(
    (resolved: ResolvedMove, next: PokemonChess) => {
      const hadBonus = bonusPending;
      const nowBonus = next.extraMovePieceId !== null;
      setBonusPending(nowBonus);

      // Show the beat that matches what just happened.
      if (resolved.defender) beatFor(resolved.verdict);

      if (complete) return;
      const goal = lesson.goal;
      switch (goal.kind) {
        case 'causeVerdict':
          if (resolved.verdict === goal.verdict) finish();
          break;
        case 'critRescue':
          if (resolved.crit && (resolved.verdict === 'capture' || resolved.verdict === 'advantage')) finish();
          break;
        case 'captureKing':
          if (resolved.kingCaptured) finish();
          break;
        case 'applyStatus': {
          const defId = next.position.pieceAt(resolved.move.to)?.id;
          const marked = defId != null && Object.keys(next.statusOf(defId)).length > 0;
          if (marked) finish();
          break;
        }
        case 'spendBonus':
          if (hadBonus) finish();
          break;
        case 'reachSquare':
          if (!resolved.defender && resolved.move.to === parseSquare(goal.square)) finish();
          break;
        case 'heedMiss': {
          // The flagged miss is the steered capture that only bounces. Playing anything else = heeding it.
          const flaggedFrom = lesson.allowFrom?.[0];
          const playedTheMiss =
            !!resolved.defender && resolved.verdict === 'repel' && flaggedFrom === squareName(resolved.move.from);
          if (playedTheMiss) {
            setMessage('See? It bounced — a super-effective read is not a capture this turn. Now make the move that actually helps.');
          } else {
            finish();
          }
          break;
        }
        case 'attemptBlocked':
          break; // handled by the refusal, not a resolution
      }
    },
    [bonusPending, complete, finish, beatFor, lesson],
  );

  const handleDenied = useCallback(() => {
    if (complete) return;
    if (lesson.goal.kind === 'attemptBlocked') {
      beatFor('blocked');
      // Give the "why it is impossible" beat a moment to land before completing.
      window.setTimeout(finish, 1400);
    } else {
      setMessage('That piece is untouchable for your type — the dashed ring says so. Try a different target.');
    }
  }, [complete, lesson, beatFor, finish]);

  return (
    <section style={{ display: 'grid', gap: '0.9rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>{lesson.title}</h2>
        <button type="button" onClick={onBack} style={ghostButton}>
          ◂ All lessons
        </button>
      </div>

      <Coach message={message} complete={complete} />

      <GameBoard
        dex={dex}
        seed={lesson.seed}
        setup={setup}
        onLeave={onBack}
        hideLeave
        {...(allow ? { allow } : {})}
        onResolved={handleResolved}
        onDenied={handleDenied}
      />

      {complete && (
        <div style={{ display: 'flex', gap: '0.6rem', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onBack} style={ghostButton}>
            All lessons
          </button>
          {hasNext && (
            <button
              type="button"
              onClick={onNext}
              style={{ ...ghostButton, background: 'var(--accent)', color: '#1a1500', border: 'none' }}
            >
              Next lesson ▸
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Coach({ message, complete }: { message: string; complete: boolean }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        gap: '0.7rem',
        alignItems: 'flex-start',
        background: complete ? 'color-mix(in srgb, var(--accent) 18%, var(--bg-raised))' : 'var(--bg-raised)',
        border: `1px solid ${complete ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 10,
        padding: '0.75rem 0.9rem',
        transition: 'background 200ms ease, border-color 200ms ease',
      }}
    >
      <span aria-hidden style={{ fontSize: '1.3rem', lineHeight: 1.2 }}>
        {complete ? '✓' : '💬'}
      </span>
      <p style={{ margin: 0, lineHeight: 1.5 }}>{message}</p>
    </div>
  );
}
