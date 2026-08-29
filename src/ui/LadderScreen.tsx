/**
 * The Gym Challenge — the single-player ranked ladder (SPEC §17.8–17.9).
 *
 * The loop, not a corridor: rating comes from beating real players online, and a Gym Leader is the milestone
 * that marks each rung — reach their required rating, take the badge, go back to climbing. So this screen is
 * a career view, showing where the player stands, what the next gate costs, and which badges are banked. The
 * badge case is an achievement track a losing streak never strips; gyms still open in canon order, so each
 * fight is also a fair difficulty step.
 *
 * Rating and badges are local-first (they work signed out) and sync to the account when signed in — the
 * screen shows which, so a guest knows their climb is only remembered on this device.
 */

import { useMemo, useRef, useState } from 'react';

import type { Dex } from '../data/dex.ts';
import type { PokemonChess } from '../engine/variant.ts';
import { buildGymMatch } from '../game/gymArmy.ts';
import { GYM_LEADERS, gymGate, isGymUnlocked, nextGym } from '../ladder/badges.ts';
import type { GymLeader } from '../ladder/badges.ts';
import { BASE_RATING, kFactorFor, tierProgress, updateRating } from '../ladder/rating.ts';
import type { LadderView } from '../ladder/store.ts';
import { GameBoard } from './GameBoard.tsx';
import { RewardChooser } from './CollectionScreen.tsx';
import { TYPE_COLORS, textColorOn } from './typeColors.ts';

export interface LadderScreenProps {
  ladder: LadderView;
  onChallenge: (gym: GymLeader) => void;
  onExit: () => void;
}

export function LadderScreen({ ladder, onChallenge, onExit }: LadderScreenProps) {
  const { current, next, fraction } = tierProgress(ladder.rating);
  const due = nextGym(ladder.earned);

  return (
    <section style={{ display: 'grid', gap: '1.1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>Gym Challenge</h2>
          <p style={{ margin: '0.3rem 0 0', color: 'var(--text-dim)', maxWidth: '62ch' }}>
            Climb by beating <strong style={{ color: 'var(--text)' }}>real players</strong> online; each Gym
            Leader accepts your challenge once you reach their rating. Win and the badge is yours — then back
            to the queue for the next one. Every leader fields a single-type army: one known weakness to exploit.
          </p>
        </div>
        <button type="button" onClick={onExit} style={ghost}>
          Back to menu
        </button>
      </div>

      {/* Rating + league tier */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          background: 'var(--bg-raised)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '0.85rem 1rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'grid', gap: '0.1rem' }}>
          <span style={{ fontSize: '1.7rem', fontWeight: 800, lineHeight: 1 }}>{ladder.rating}</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            rating · {ladder.games} {ladder.games === 1 ? 'game' : 'games'}
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 180, display: 'grid', gap: '0.35rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem' }}>
            <strong style={{ color: current.color }}>{current.name}</strong>
            {next && <span style={{ color: 'var(--text-dim)' }}>{next.name} at {next.floor}</span>}
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${fraction * 100}%`, background: current.color, transition: 'width 300ms ease' }} />
          </div>
        </div>
        <span
          style={{
            fontSize: '0.72rem',
            color: ladder.synced ? 'var(--accent)' : 'var(--text-dim)',
            border: '1px solid var(--border)',
            borderRadius: 999,
            padding: '0.2rem 0.6rem',
          }}
          title={ladder.synced ? 'Saved to your account.' : 'Saved on this device. Sign in to keep your progress across devices.'}
        >
          {ladder.synced ? '☁ Synced' : '💾 This device'}
        </span>
      </div>

      {/* What the next badge costs, so the climb has a visible target. */}
      <NextGateCard ladder={ladder} onChallenge={onChallenge} />

      {/* The badge case */}
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <h3 style={{ margin: 0, fontSize: '0.95rem', color: 'var(--text-dim)' }}>
          Badge case — {ladder.earned.size} / {GYM_LEADERS.length}
        </h3>
        <div style={{ display: 'flex', gap: '0.55rem', flexWrap: 'wrap' }}>
          {GYM_LEADERS.map((g) => {
            const earned = ladder.earned.has(g.id);
            return (
              <span
                key={g.id}
                title={`${g.badge} — ${g.leader} (${g.type})`}
                style={{
                  width: 46,
                  height: 46,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '0.62rem',
                  fontWeight: 800,
                  textAlign: 'center',
                  lineHeight: 1,
                  background: earned ? TYPE_COLORS[g.type] : 'transparent',
                  color: earned ? textColorOn(g.type) : 'var(--text-dim)',
                  border: `2px ${earned ? 'solid' : 'dashed'} ${earned ? TYPE_COLORS[g.type] : 'var(--border)'}`,
                  opacity: earned ? 1 : 0.55,
                }}
              >
                {earned ? g.badge.split(' ')[0] : '?'}
              </span>
            );
          })}
        </div>
      </div>

      {/* Gym leader challenge cards */}
      <div style={{ display: 'grid', gap: '0.55rem' }}>
        {GYM_LEADERS.map((g) => {
          const earned = ladder.earned.has(g.id);
          const unlocked = isGymUnlocked(g, ladder.earned, ladder.rating);
          const isDue = due?.id === g.id;
          return (
            <div
              key={g.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.85rem',
                background: 'var(--bg-raised)',
                border: `1px solid ${isDue ? TYPE_COLORS[g.type] : 'var(--border)'}`,
                borderRadius: 10,
                padding: '0.7rem 0.9rem',
                opacity: unlocked ? 1 : 0.5,
              }}
            >
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 42,
                  height: 42,
                  borderRadius: 9,
                  display: 'grid',
                  placeItems: 'center',
                  fontWeight: 800,
                  fontSize: '0.7rem',
                  background: TYPE_COLORS[g.type],
                  color: textColorOn(g.type),
                }}
              >
                {g.type.slice(0, 3).toUpperCase()}
              </span>
              <div style={{ display: 'grid', gap: '0.1rem', minWidth: 0 }}>
                <span style={{ fontWeight: 700 }}>
                  {g.leader} <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>· {g.city}</span>
                </span>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {earned
                    ? `${g.badge} earned — Mono-${g.type}, rated ${g.rating}`
                    : unlocked
                      ? g.taunt
                      : isDue
                        ? `Reach ${g.ratingRequired} rating to challenge — ${g.ratingRequired - ladder.rating} to go`
                        : 'Earn the previous badge first.'}
                </span>
              </div>
              <span style={{ marginLeft: 'auto', flexShrink: 0 }}>
                {earned ? (
                  <button type="button" onClick={() => onChallenge(g)} style={ghost}>
                    ✓ Rematch
                  </button>
                ) : unlocked ? (
                  <button
                    type="button"
                    onClick={() => onChallenge(g)}
                    style={{ ...ghost, background: TYPE_COLORS[g.type], color: textColorOn(g.type), border: 'none', fontWeight: 800 }}
                  >
                    Challenge ▸
                  </button>
                ) : (
                  <span aria-hidden style={{ color: 'var(--text-dim)', fontSize: '1.1rem' }}>🔒</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const ghost = {
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
  borderRadius: 7,
  padding: '0.4rem 0.85rem',
  cursor: 'pointer',
  fontWeight: 600,
  whiteSpace: 'nowrap' as const,
};

/**
 * The next rung: either the leader now waiting, or how much rating is still needed to reach them.
 *
 * This is the screen's answer to "what do I do next", and it deliberately points back at online play when
 * the gate is not yet met — that is where rating comes from.
 */
function NextGateCard({ ladder, onChallenge }: { ladder: LadderView; onChallenge: (gym: GymLeader) => void }) {
  const due = nextGym(ladder.earned);
  if (!due) {
    return (
      <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--accent)', borderRadius: 10, padding: '0.85rem 1rem' }}>
        <strong>All eight badges earned.</strong>{' '}
        <span style={{ color: 'var(--text-dim)' }}>Keep climbing the ladder — Champion is a leaderboard, not a threshold.</span>
      </div>
    );
  }

  const gate = gymGate(ladder.earned, ladder.rating);
  const open = gate === null;
  // Progress from the previous badge's gate to this one, so the bar fills across the rung being climbed.
  const previous = GYM_LEADERS.find((g) => g.order === due.order - 1);
  const floor = previous?.ratingRequired ?? BASE_RATING;
  const span = Math.max(1, due.ratingRequired - floor);
  const fraction = Math.max(0, Math.min(1, (ladder.rating - floor) / span));

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
        background: 'var(--bg-raised)',
        border: `1px solid ${open ? TYPE_COLORS[due.type] : 'var(--border)'}`,
        borderRadius: 10, padding: '0.85rem 1rem',
      }}
    >
      <div style={{ display: 'grid', gap: '0.15rem', minWidth: 190 }}>
        <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)' }}>
          Next badge
        </span>
        <strong>
          {due.badge} · {due.leader}{' '}
          <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>(Mono-{due.type})</span>
        </strong>
      </div>

      {open ? (
        <>
          <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem', flex: 1, minWidth: 160 }}>
            {due.leader} will see you now.
          </span>
          <button
            type="button"
            onClick={() => onChallenge(due)}
            style={{ ...ghost, background: TYPE_COLORS[due.type], color: textColorOn(due.type), border: 'none', fontWeight: 800 }}
          >
            Challenge {due.leader} ▸
          </button>
        </>
      ) : (
        <div style={{ flex: 1, minWidth: 200, display: 'grid', gap: '0.3rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
            <span style={{ color: 'var(--text-dim)' }}>
              <strong style={{ color: 'var(--text)' }}>{gate.needed}</strong> more rating — win online matches
            </span>
            <span style={{ color: 'var(--text-dim)' }}>{ladder.rating} / {due.ratingRequired}</span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${fraction * 100}%`, background: TYPE_COLORS[due.type], transition: 'width 300ms ease' }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// A single gym match
// ---------------------------------------------------------------------------

export interface LadderMatchProps {
  dex: Dex;
  gym: GymLeader;
  ladder: LadderView;
  onExit: () => void;
  /** When signed in, claims a reward Pokémon after a win. Absent for guests (no collection). */
  onClaimReward?: (species: string) => Promise<{ error: string } | null>;
}

interface Outcome {
  readonly score: 0 | 0.5 | 1;
  readonly ratingBefore: number;
  readonly ratingAfter: number;
  readonly badgeEarned: boolean;
  /** True when this was a rematch of an already-earned badge, so no rating moved. */
  readonly rematch: boolean;
}

/**
 * Plays one Gym Leader match: the player as White against the leader's mono-type army, driven by an AI
 * with the leader's compensating budget. On game over it records the result to the ladder and shows the
 * rating change and any badge earned.
 */
export function LadderMatch({ dex, gym, ladder, onExit, onClaimReward }: LadderMatchProps) {
  // A fresh seed per mount so a rematch is a new game, captured once so React state changes do not reroll it.
  const seed = useRef(`gym-${gym.id}-${Math.floor(performance.now())}`).current;
  const setup = useMemo(() => buildGymMatch(dex, gym.type, seed), [dex, gym.type, seed]);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const recorded = useRef(false);

  const difficulty = { name: gym.leader, depth: gym.depth, typeBlindness: gym.typeBlindness };

  // A rematch of a badge already won is practice: unrated, so an easy leader cannot be farmed for rating.
  const rematch = ladder.earned.has(gym.id);

  const handleGameOver = (result: ReturnType<PokemonChess['result']>) => {
    if (recorded.current) return;
    recorded.current = true;
    const score: 0 | 0.5 | 1 =
      result.kind === 'win' ? (result.winner === 'white' ? 1 : 0) : 0.5;
    const ratingBefore = ladder.rating;
    const ratingAfter = rematch ? ratingBefore : updateRating(ratingBefore, gym.rating, score, kFactorFor(ladder.games));
    const badgeEarned = score === 1 && !rematch;
    setOutcome({ score, ratingBefore, ratingAfter, badgeEarned, rematch });
    // The gym id always goes up, win or lose: the server needs it to recognise a rematch.
    void ladder.record({ opponentRating: gym.rating, score, gymId: gym.id });
  };

  return (
    <section style={{ display: 'grid', gap: '0.9rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <span
            style={{
              fontSize: '0.7rem', fontWeight: 800, padding: '0.2rem 0.5rem', borderRadius: 6,
              background: TYPE_COLORS[gym.type], color: textColorOn(gym.type),
            }}
          >
            {gym.type}
          </span>
          {gym.leader}
          <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)', fontWeight: 500 }}>
            · {gym.badge}{rematch ? ' · practice (unrated)' : ''}
          </span>
        </h2>
        <button type="button" onClick={onExit} style={ghost}>
          {outcome ? 'Back to Gym Challenge' : 'Forfeit'}
        </button>
      </div>

      {outcome && <OutcomeBanner gym={gym} outcome={outcome} onExit={onExit} />}

      {/* A win catches a reward Pokémon (signed-in players only — the collection is account-bound). */}
      {outcome?.score === 1 && onClaimReward && (
        <RewardChooser dex={dex} rollKey={seed} claim={onClaimReward} />
      )}

      <GameBoard
        dex={dex}
        seed={seed}
        setup={setup}
        onLeave={onExit}
        hideLeave
        ai={{ side: 'black', difficulty }}
        onGameOver={handleGameOver}
      />
    </section>
  );
}

function OutcomeBanner({ gym, outcome, onExit }: { gym: GymLeader; outcome: Outcome; onExit: () => void }) {
  const delta = outcome.ratingAfter - outcome.ratingBefore;
  const won = outcome.score === 1;
  const drew = outcome.score === 0.5;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '1rem',
        flexWrap: 'wrap',
        background: won ? `color-mix(in srgb, ${TYPE_COLORS[gym.type]} 22%, var(--bg-raised))` : 'var(--bg-raised)',
        border: `1px solid ${won ? TYPE_COLORS[gym.type] : 'var(--border)'}`,
        borderRadius: 10,
        padding: '0.85rem 1rem',
      }}
    >
      <span aria-hidden style={{ fontSize: '1.6rem' }}>{won ? '🏆' : drew ? '🤝' : '💔'}</span>
      <div style={{ display: 'grid', gap: '0.15rem' }}>
        <strong style={{ fontSize: '1.05rem' }}>
          {won ? (outcome.badgeEarned ? `You earned the ${gym.badge}!` : `You beat ${gym.leader} again!`) : drew ? 'A draw.' : `${gym.leader} won this time.`}
        </strong>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.85rem' }}>
          {outcome.rematch ? (
            <>Practice rematch — rating unchanged at <strong style={{ color: 'var(--text)' }}>{outcome.ratingAfter}</strong>.</>
          ) : (
            <>
              Rating {outcome.ratingBefore} → <strong style={{ color: 'var(--text)' }}>{outcome.ratingAfter}</strong>{' '}
              <span style={{ color: delta >= 0 ? '#3fb950' : '#f85149' }}>({delta >= 0 ? '+' : ''}{delta})</span>
            </>
          )}
        </span>
      </div>
      <button
        type="button"
        onClick={onExit}
        style={{ ...ghost, marginLeft: 'auto', background: 'var(--accent)', color: '#1a1500', border: 'none', fontWeight: 800 }}
      >
        Continue
      </button>
    </div>
  );
}
