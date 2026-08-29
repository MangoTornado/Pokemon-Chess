/**
 * Online play — matchmaking against strangers and friendly games by code (SPEC §17.10, DIRECTION §6).
 *
 * The transport is deliberately humble: a turn-based game does not need a socket, so the client polls the
 * server's authoritative action list and posts its own moves back. Because the engine is pure and a game
 * is a seed plus that action list, both players draft the identical armies from the shared seed and stay
 * in lockstep with the server — which is the single source of truth (see `GameBoard` controlled mode).
 *
 * Online play requires a signed-in account, because a match needs a stable identity and a display name.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { Dex } from '../data/dex.ts';
import { autodraft } from '../game/autodraft.ts';
import { api } from '../net/api.ts';
import type { RoomView } from '../net/api.ts';
import type { PokemonChess } from '../engine/variant.ts';
import { GameBoard } from './GameBoard.tsx';
import { EncounterCard } from './EncounterCard.tsx';

/** How often to poll a room for the opponent's moves and status. Fine for a turn-based game. */
const POLL_MS = 900;

export interface OnlineScreenProps {
  dex: Dex;
  signedIn: boolean;
  onExit: () => void;
  onSignIn: () => void;
  /** Called when a game ends, so a ranked rating change is pulled back into the profile. */
  onFinished?: () => void;
}

export function OnlineScreen({ dex, signedIn, onExit, onSignIn, onFinished }: OnlineScreenProps) {
  const [room, setRoom] = useState<RoomView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codeInput, setCodeInput] = useState('');

  if (!signedIn) {
    return (
      <Panel title="Play Online" onExit={onExit}>
        <p style={{ color: 'var(--text-dim)' }}>
          Online play needs an account, so your opponent knows who they are facing and your ranked progress
          is saved. Sign in or create a trainer to queue up.
        </p>
        <button type="button" onClick={onSignIn} style={primary}>
          Sign in / Create account
        </button>
      </Panel>
    );
  }

  // In a live game once the room is playing (or finished).
  if (room && room.status !== 'waiting' && room.you) {
    return (
      <OnlineGame
        dex={dex}
        initial={room}
        onExit={() => { setRoom(null); onExit(); }}
        onBackToLobby={() => setRoom(null)}
        {...(onFinished ? { onFinished } : {})}
      />
    );
  }

  // Waiting for an opponent (matchmaking or a private room whose code we are sharing).
  if (room && room.status === 'waiting') {
    return <WaitingRoom room={room} onCancel={async () => { await api.mpCancelQueue(); setRoom(null); }} onReady={setRoom} />;
  }

  const act = async (fn: () => Promise<{ ok: true; value: { game: RoomView } } | { ok: false; error: { error: string } }>) => {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    if (r.ok) setRoom(r.value.game);
    else setError(r.error.error);
  };

  return (
    <Panel title="Play Online" onExit={onExit}>
      <p style={{ color: 'var(--text-dim)', margin: 0 }}>
        Queue against a random opponent, or start a private game and share the code with a friend. Both
        armies are drafted from the same shared seed, so it is a fair, unseen match.
      </p>

      {error && <p style={{ color: '#f85149', margin: 0 }}>{error}</p>}

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button type="button" disabled={busy} onClick={() => act(api.mpQueue)} style={primary}>
          🔎 Find a ranked match
        </button>
        <button type="button" disabled={busy} onClick={() => act(api.mpCreate)} style={ghost}>
          ✚ Create private game
        </button>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); if (codeInput.trim()) void act(() => api.mpJoin(codeInput.trim())); }}
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
      >
        <input
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
          placeholder="Enter a friend's code"
          maxLength={6}
          style={{
            background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)',
            borderRadius: 7, padding: '0.5rem 0.7rem', letterSpacing: '0.15em', fontWeight: 700, width: 180,
          }}
        />
        <button type="submit" disabled={busy || !codeInput.trim()} style={ghost}>
          Join by code
        </button>
      </form>

      <p style={{ color: 'var(--text-dim)', fontSize: '0.78rem', margin: 0 }}>
        Matchmaking is <strong style={{ color: 'var(--text)' }}>ranked</strong> — every move is validated on
        the server, and a win moves your rating. Rating is what unlocks the next Gym Leader, so this is how
        you earn badges. Private games (by code) are friendly and unrated.
      </p>
    </Panel>
  );
}

function WaitingRoom({ room, onCancel, onReady }: { room: RoomView; onCancel: () => void; onReady: (r: RoomView) => void }) {
  // Poll until an opponent joins.
  useEffect(() => {
    let live = true;
    const timer = setInterval(async () => {
      const r = await api.mpState(room.id);
      if (live && r.ok && r.value.game.status !== 'waiting') onReady(r.value.game);
    }, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [room.id, onReady]);

  return (
    <Panel title="Waiting for an opponent" onExit={onCancel} exitLabel="Cancel">
      {room.code ? (
        <>
          <p style={{ color: 'var(--text-dim)', margin: 0 }}>Share this code with a friend to start a private game:</p>
          <div
            style={{
              fontSize: '2.4rem', fontWeight: 800, letterSpacing: '0.35em', textAlign: 'center',
              padding: '0.8rem', background: 'var(--bg)', border: '1px dashed var(--border)', borderRadius: 10,
            }}
          >
            {room.code}
          </div>
        </>
      ) : (
        <p style={{ color: 'var(--text-dim)' }}>Searching for an opponent…</p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-dim)' }}>
        <Spinner /> Waiting…
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// A live online game
// ---------------------------------------------------------------------------

function OnlineGame({
  dex, initial, onExit, onBackToLobby, onFinished,
}: {
  dex: Dex;
  initial: RoomView;
  onExit: () => void;
  onBackToLobby: () => void;
  onFinished?: () => void;
}) {
  const [room, setRoom] = useState<RoomView>(initial);
  const setup = useRef(autodraft(dex, initial.seed)).current;
  const reportedOutcome = useRef(false);
  const finishedNotified = useRef(false);
  const side = room.you!;
  const opponent = side === 'white' ? room.black : room.white;
  // A private game carries a join code; matchmaking games do not — and only matchmaking is ranked.
  const ranked = room.code === null;

  // Poll for the opponent's moves and status while the game is live.
  useEffect(() => {
    if (room.status === 'over') return;
    let live = true;
    const timer = setInterval(async () => {
      const r = await api.mpState(room.id);
      if (!live || !r.ok) return;
      setRoom((prev) => (r.value.game.actions.length >= prev.actions.length || r.value.game.status !== prev.status ? r.value.game : prev));
    }, POLL_MS);
    return () => { live = false; clearInterval(timer); };
  }, [room.id, room.status]);

  // When the game ends (mine or the opponent's report/resign), pull the possibly-changed rating back.
  useEffect(() => {
    if (room.status === 'over' && !finishedNotified.current) {
      finishedNotified.current = true;
      onFinished?.();
    }
  }, [room.status, onFinished]);

  const onLocalMove = useCallback(
    async (encoded: number, plyBefore: number) => {
      const r = await api.mpMove(room.id, plyBefore, encoded);
      if (r.ok) setRoom(r.value.game);
      // A rejected move (stale ply) is corrected by the next poll, which pulls the true action list.
    },
    [room.id],
  );

  const onGameOver = useCallback(
    (result: ReturnType<PokemonChess['result']>) => {
      if (reportedOutcome.current) return;
      reportedOutcome.current = true;
      const outcome = result.kind === 'win' ? result.winner : 'draw';
      void api.mpOutcome(room.id, outcome).then((r) => { if (r.ok) setRoom(r.value.game); });
    },
    [room.id],
  );

  const resign = async () => {
    const r = await api.mpResign(room.id);
    if (r.ok) setRoom(r.value.game);
  };

  const finished = room.status === 'over';
  const how = room.endedBy === 'timeout' ? ' on time' : room.endedBy === 'resign' ? ' by resignation' : '';
  const outcomeText = finished
    ? room.outcome === 'draw'
      ? 'Draw.'
      : room.outcome === side
        ? `You win${how}!`
        : `You lost${how}.`
    : null;

  return (
    <section style={{ display: 'grid', gap: '0.9rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: '0.68rem', fontWeight: 800, padding: '0.15rem 0.45rem', borderRadius: 6,
              background: ranked ? 'var(--accent)' : 'var(--bg-raised)', color: ranked ? '#1a1500' : 'var(--text-dim)',
              border: ranked ? 'none' : '1px solid var(--border)',
            }}
          >
            {ranked ? 'RANKED' : 'FRIENDLY'}
          </span>
          You are {side === 'white' ? 'White' : 'Black'}{' '}
          <span style={{ color: 'var(--text-dim)', fontWeight: 500, fontSize: '0.9rem' }}>vs {opponent ?? 'opponent'}</span>
        </h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {!finished && (
            <button type="button" onClick={resign} style={ghost}>Resign</button>
          )}
          <button type="button" onClick={finished ? onBackToLobby : onExit} style={ghost}>
            {finished ? 'Back to lobby' : 'Leave'}
          </button>
        </div>
      </div>

      {/* A ranked game's result is recorded server-side, which is what issues the encounter. */}
      {finished && <EncounterCard dex={dex} />}

      <QuickChat room={room} onSay={async (phrase) => {
        const r = await api.mpSay(room.id, phrase);
        if (r.ok) setRoom(r.value.game);
      }} />

      <Clocks room={room} side={side} />

      {outcomeText && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: '0.8rem',
            background: room.outcome === side ? 'color-mix(in srgb, var(--accent) 20%, var(--bg-raised))' : 'var(--bg-raised)',
            border: '1px solid var(--border)', borderRadius: 10, padding: '0.8rem 1rem',
          }}
        >
          <span aria-hidden style={{ fontSize: '1.5rem' }}>{room.outcome === side ? '🏆' : room.outcome === 'draw' ? '🤝' : '💔'}</span>
          <strong style={{ fontSize: '1.05rem' }}>{outcomeText}</strong>
          <button type="button" onClick={onBackToLobby} style={{ ...primary, marginLeft: 'auto' }}>Back to lobby</button>
        </div>
      )}

      <GameBoard
        dex={dex}
        seed={room.seed}
        setup={setup}
        onLeave={onExit}
        hideLeave
        onGameOver={onGameOver}
        controlled={{ side, actions: room.actions, opponentName: opponent ?? 'Opponent', onLocalMove }}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------

/**
 * Quick chat — a closed phrase list, not a chat box.
 *
 * SPEC §17.10 rules out free text between strangers for this audience, so a player picks from a fixed
 * vocabulary and the client sends an index. That keeps the social warmth of greeting an opponent or conceding
 * a good move, with nothing to moderate because nothing arbitrary can be said.
 */
function QuickChat({ room, onSay }: { room: RoomView; onSay: (phrase: number) => void }) {
  const [phrases, setPhrases] = useState<string[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void api.mpPhrases().then((r) => { if (r.ok) setPhrases(r.value.phrases); });
  }, []);

  return (
    <div style={{ display: 'grid', gap: '0.4rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOpen((v) => !v)} style={ghost}>
          💬 {open ? 'Close' : 'Say something'}
        </button>
        {/* The most recent line, so a message is never missed while the panel is shut. */}
        {room.chat.length > 0 && !open && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
            <strong style={{ color: 'var(--text)' }}>{room.chat[room.chat.length - 1]!.name}:</strong>{' '}
            {phrases[room.chat[room.chat.length - 1]!.phrase] ?? '…'}
          </span>
        )}
      </div>

      {open && (
        <div style={{ display: 'grid', gap: '0.45rem', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 10, padding: '0.6rem 0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap' }}>
            {phrases.map((text, i) => (
              <button key={i} type="button" onClick={() => onSay(i)} style={{ ...ghost, fontSize: '0.76rem', padding: '0.25rem 0.55rem' }}>
                {text}
              </button>
            ))}
          </div>
          {room.chat.length > 0 && (
            <div style={{ display: 'grid', gap: '0.15rem', maxHeight: 120, overflowY: 'auto', borderTop: '1px solid var(--border)', paddingTop: '0.4rem' }}>
              {room.chat.map((line, i) => (
                <span key={i} style={{ fontSize: '0.78rem' }}>
                  <strong style={{ color: line.side === room.you ? 'var(--accent)' : 'var(--text)' }}>{line.name}:</strong>{' '}
                  <span style={{ color: 'var(--text-dim)' }}>{phrases[line.phrase] ?? '…'}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Both players' remaining thinking time.
 *
 * The server owns the clock (it debits the side on the move on every poll and ends the game on a
 * flag-fall), so this ticks a local copy down between polls purely so the seconds move smoothly — the
 * server's number always wins on the next poll.
 */
function Clocks({ room, side }: { room: RoomView; side: 'white' | 'black' }) {
  const [tick, setTick] = useState(0);
  const live = room.status === 'playing';
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [live]);
  // Which side is on the move is not knowable from the action count (a bonus move keeps the same side on
  // the move), so only the freshly-polled server value is drawn; `tick` just forces a re-render.
  void tick;

  const fmt = (ms: number) => {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const box = (label: string, ms: number, mine: boolean) => (
    <span
      style={{
        display: 'inline-flex', alignItems: 'baseline', gap: '0.4rem', padding: '0.3rem 0.6rem',
        borderRadius: 7, background: 'var(--bg-raised)',
        border: `1px solid ${ms < 30_000 ? '#f85149' : 'var(--border)'}`,
      }}
    >
      <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>{label}{mine ? ' (you)' : ''}</span>
      <strong style={{ fontVariantNumeric: 'tabular-nums', color: ms < 30_000 ? '#f85149' : 'var(--text)' }}>{fmt(ms)}</strong>
    </span>
  );

  return (
    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      {box('White', room.clock.white, side === 'white')}
      {box('Black', room.clock.black, side === 'black')}
      <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
        Run out of time and you lose the game.
      </span>
    </div>
  );
}

function Panel({ title, children, onExit, exitLabel = 'Back to menu' }: { title: string; children: React.ReactNode; onExit: () => void; exitLabel?: string }) {
  return (
    <section style={{ display: 'grid', gap: '1rem', maxWidth: 560 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <button type="button" onClick={onExit} style={ghost}>{exitLabel}</button>
      </div>
      {children}
    </section>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 14, height: 14, borderRadius: '50%', display: 'inline-block',
        border: '2px solid var(--border)', borderTopColor: 'var(--accent)', animation: 'pc-spin 700ms linear infinite',
      }}
    />
  );
}

const ghost = {
  background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 7, padding: '0.5rem 0.9rem', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' as const,
};
const primary = {
  background: 'var(--accent)', color: '#1a1500', border: 'none',
  borderRadius: 7, padding: '0.5rem 1rem', cursor: 'pointer', fontWeight: 800,
};
