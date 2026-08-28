/**
 * The sandbox — batch playtesting (the "trial runs" of the owner's ask; SPEC §19).
 *
 * Interactive playtests already live in Quick Play (vs the AI, or two-player hotseat). This screen is the
 * other half: run many AI-vs-AI games headlessly and read the outcome frequencies, so a balance question
 * ("does White's first move matter?", "how much is a search-depth edge worth?") gets a number instead of
 * an argument. Games run one at a time with a yield between them, so the batch shows progress rather than
 * freezing the tab; the run is seeded, so a surprising result is reproducible.
 */

import { useCallback, useRef, useState } from 'react';

import type { Dex } from '../data/dex.ts';
import { DIFFICULTIES } from '../ai/search.ts';
import type { Difficulty } from '../ai/search.ts';
import { autodraft } from '../game/autodraft.ts';
import { simulateGame } from '../sim/batch.ts';
import type { BatchReport } from '../sim/batch.ts';

const DIFF_KEYS = ['rookie', 'trainer', 'ace', 'champion'] as const;
const COUNTS = [5, 10, 25, 50] as const;

export interface SandboxScreenProps {
  dex: Dex;
  onExit: () => void;
}

export function SandboxScreen({ dex, onExit }: SandboxScreenProps) {
  const [whiteKey, setWhiteKey] = useState<(typeof DIFF_KEYS)[number]>('ace');
  const [blackKey, setBlackKey] = useState<(typeof DIFF_KEYS)[number]>('trainer');
  const [count, setCount] = useState<(typeof COUNTS)[number]>(10);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<BatchReport | null>(null);
  const cancelled = useRef(false);

  const run = useCallback(() => {
    const white: Difficulty = DIFFICULTIES[whiteKey]!;
    const black: Difficulty = DIFFICULTIES[blackKey]!;
    const seed = `sandbox:${whiteKey}-${blackKey}:${count}`;
    setRunning(true);
    setReport(null);
    setProgress(0);
    cancelled.current = false;

    let i = 0;
    let whiteWins = 0, blackWins = 0, draws = 0, capped = 0, totalPlies = 0;

    // One game per tick, so the progress bar advances and the tab stays responsive.
    const step = () => {
      if (cancelled.current) { setRunning(false); return; }
      const gameSeed = `${seed}:${i}`;
      const setup = autodraft(dex, gameSeed);
      const outcome = simulateGame(dex, setup, white, black, gameSeed, 260);
      if (outcome.winner === 'white') whiteWins++;
      else if (outcome.winner === 'black') blackWins++;
      else draws++;
      if (outcome.reason === 'ply-cap') capped++;
      totalPlies += outcome.plies;
      i++;
      setProgress(i);
      if (i < count) {
        setTimeout(step, 0);
      } else {
        setReport({
          games: count, whiteWins, blackWins, draws,
          whiteScore: (whiteWins + draws * 0.5) / count,
          avgPlies: totalPlies / count, capped,
        });
        setRunning(false);
      }
    };
    setTimeout(step, 0);
  }, [dex, whiteKey, blackKey, count]);

  return (
    <section style={{ display: 'grid', gap: '1.1rem', maxWidth: 640 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0 }}>Sandbox — batch playtest</h2>
          <p style={{ margin: '0.3rem 0 0', color: 'var(--text-dim)', maxWidth: '60ch' }}>
            Pit two AIs against each other over many auto-drafted games and read the results. Every run is
            seeded, so the same setup always produces the same numbers.
          </p>
        </div>
        <button type="button" onClick={onExit} style={ghost}>Back to menu</button>
      </div>

      <div style={{ display: 'grid', gap: '0.8rem', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
        <Picker label="White AI" value={whiteKey} onChange={(v) => setWhiteKey(v as (typeof DIFF_KEYS)[number])} options={DIFF_KEYS.map((k) => [k, DIFFICULTIES[k]!.name])} disabled={running} />
        <Picker label="Black AI" value={blackKey} onChange={(v) => setBlackKey(v as (typeof DIFF_KEYS)[number])} options={DIFF_KEYS.map((k) => [k, DIFFICULTIES[k]!.name])} disabled={running} />
        <Picker label="Games" value={String(count)} onChange={(v) => setCount(Number(v) as (typeof COUNTS)[number])} options={COUNTS.map((c) => [String(c), String(c)])} disabled={running} />

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          {!running ? (
            <button type="button" onClick={run} style={primary}>Run {count} games</button>
          ) : (
            <button type="button" onClick={() => { cancelled.current = true; }} style={ghost}>Stop</button>
          )}
          {(running || progress > 0) && (
            <div style={{ flex: 1, display: 'grid', gap: '0.25rem' }}>
              <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${(progress / count) * 100}%`, background: 'var(--accent)', transition: 'width 120ms linear' }} />
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>{progress} / {count} games</span>
            </div>
          )}
        </div>
        {(whiteKey === 'champion' || blackKey === 'champion') && !running && (
          <p style={{ margin: 0, fontSize: '0.76rem', color: 'var(--text-dim)' }}>
            Champion searches deep — a large batch will take a while.
          </p>
        )}
      </div>

      {report && <Report report={report} whiteName={DIFFICULTIES[whiteKey]!.name} blackName={DIFFICULTIES[blackKey]!.name} />}
    </section>
  );
}

function Report({ report, whiteName, blackName }: { report: BatchReport; whiteName: string; blackName: string }) {
  const pct = (n: number) => `${Math.round((n / report.games) * 100)}%`;
  return (
    <div style={{ display: 'grid', gap: '0.7rem', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 10, padding: '1rem' }}>
      <h3 style={{ margin: 0 }}>Results over {report.games} games</h3>
      {/* A single score bar: White share on the left, Black on the right, draws in the middle. */}
      <div style={{ display: 'flex', height: 26, borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
        <Segment flex={report.whiteWins} color="#f6f4ef" text={`W ${report.whiteWins}`} dark />
        <Segment flex={report.draws} color="#6b7280" text={report.draws ? `= ${report.draws}` : ''} />
        <Segment flex={report.blackWins} color="#15171c" text={`B ${report.blackWins}`} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem', fontSize: '0.85rem' }}>
        <Stat label={`${whiteName} (White)`} value={`${report.whiteWins} · ${pct(report.whiteWins)}`} />
        <Stat label="Draws" value={`${report.draws} · ${pct(report.draws)}`} />
        <Stat label={`${blackName} (Black)`} value={`${report.blackWins} · ${pct(report.blackWins)}`} />
        <Stat label="White score" value={report.whiteScore.toFixed(3)} />
        <Stat label="Avg. length" value={`${report.avgPlies.toFixed(1)} moves`} />
        {report.capped > 0 && <Stat label="Hit ply cap" value={String(report.capped)} />}
      </div>
    </div>
  );
}

function Segment({ flex, color, text, dark }: { flex: number; color: string; text: string; dark?: boolean }) {
  if (flex <= 0) return null;
  return (
    <div style={{ flex, background: color, color: dark ? '#15171c' : '#f6f4ef', display: 'grid', placeItems: 'center', fontSize: '0.72rem', fontWeight: 700 }}>
      {text}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gap: '0.1rem' }}>
      <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Picker({ label, value, onChange, options, disabled }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][]; disabled?: boolean }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.7rem' }}>
      <span style={{ width: 80, fontSize: '0.82rem', color: 'var(--text-dim)' }}>{label}</span>
      <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden' }}>
        {options.map(([k, name]) => (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => onChange(k)}
            style={{
              background: value === k ? 'var(--accent)' : 'transparent',
              color: value === k ? '#1a1500' : 'var(--text)',
              border: 'none', padding: '0.3rem 0.7rem', fontWeight: value === k ? 700 : 500,
              fontSize: '0.82rem', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
            }}
          >
            {name}
          </button>
        ))}
      </div>
    </label>
  );
}

const ghost = {
  background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 7, padding: '0.4rem 0.9rem', cursor: 'pointer', fontWeight: 600,
};
const primary = {
  background: 'var(--accent)', color: '#1a1500', border: 'none',
  borderRadius: 7, padding: '0.5rem 1.1rem', cursor: 'pointer', fontWeight: 800,
};
