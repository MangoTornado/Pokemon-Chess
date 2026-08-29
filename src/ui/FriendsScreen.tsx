/**
 * Friends — add, accept, remove, and challenge (SPEC §17.10, DIRECTION §6).
 *
 * Deliberately small: a friend list is an address book, and its job is to get you into a game with someone
 * you know. So a friend row's primary action is "Challenge", which opens a private game and hands you the
 * code to send them — the same friendly, unrated room the Online screen creates.
 *
 * There is no free-text chat here on purpose: SPEC §17.10 makes chat between strangers a moderation
 * liability for this audience, and a code you paste into your own channel is the honest minimum.
 */

import { useCallback, useEffect, useState } from 'react';

import { api } from '../net/api.ts';
import type { FriendView } from '../profile/profile.ts';
import { AvatarView } from './AvatarView.tsx';

export interface FriendsScreenProps {
  signedIn: boolean;
  onExit: () => void;
  onSignIn: () => void;
  /** Opens a private game and returns its join code, so a friend can be invited to it. */
  onChallenge: () => Promise<string | null>;
}

export function FriendsScreen({ signedIn, onExit, onSignIn, onChallenge }: FriendsScreenProps) {
  const [friends, setFriends] = useState<FriendView[] | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await api.friends();
    if (r.ok) setFriends(r.value.friends);
    else setError(r.error.error);
  }, []);

  useEffect(() => {
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

  const act = async (fn: () => Promise<{ ok: true; value: unknown } | { ok: false; error: { error: string } }>, done?: string) => {
    setError(null);
    setNotice(null);
    const r = await fn();
    if (r.ok) { if (done) setNotice(done); }
    else setError(r.error.error);
    await refresh();
  };

  if (!signedIn) {
    return (
      <Frame onExit={onExit}>
        <p style={{ color: 'var(--text-dim)' }}>Friends live with your account. Sign in to add other trainers.</p>
        <button type="button" onClick={onSignIn} style={primary}>Sign in / Create account</button>
      </Frame>
    );
  }

  const accepted = (friends ?? []).filter((f) => f.state === 'friend');
  const incoming = (friends ?? []).filter((f) => f.state === 'incoming');
  const outgoing = (friends ?? []).filter((f) => f.state === 'outgoing');

  const challenge = async () => {
    setError(null);
    const code = await onChallenge();
    if (code) setInviteCode(code);
    else setError('Could not open a private game.');
  };

  return (
    <Frame onExit={onExit}>
      <form
        onSubmit={(e) => { e.preventDefault(); if (name.trim()) void act(() => api.addFriend(name.trim()), `Request sent to ${name.trim()}.`).then(() => setName('')); }}
        style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add by username"
          style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 7, padding: '0.5rem 0.7rem', width: 200 }}
        />
        <button type="submit" disabled={!name.trim()} style={primary}>Add friend</button>
      </form>

      {error && <p style={{ color: '#f85149', margin: 0 }}>{error}</p>}
      {notice && <p style={{ color: 'var(--accent)', margin: 0, fontSize: '0.85rem' }}>{notice}</p>}

      {inviteCode && (
        <div style={{ background: 'var(--bg-raised)', border: '1px solid var(--accent)', borderRadius: 10, padding: '0.8rem 1rem', display: 'grid', gap: '0.3rem' }}>
          <strong>Private game open — send this code to your friend:</strong>
          <span style={{ fontSize: '1.8rem', fontWeight: 800, letterSpacing: '0.3em' }}>{inviteCode}</span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>
            Then open Play Online to find the game waiting.
          </span>
        </div>
      )}

      {incoming.length > 0 && (
        <Group title={`Requests (${incoming.length})`}>
          {incoming.map((f) => (
            <Row key={f.username} friend={f}>
              <button type="button" onClick={() => act(() => api.acceptFriend(f.username), `${f.username} is now your friend.`)} style={primary}>Accept</button>
              <button type="button" onClick={() => act(() => api.removeFriend(f.username))} style={ghost}>Decline</button>
            </Row>
          ))}
        </Group>
      )}

      <Group title={`Friends (${accepted.length})`}>
        {accepted.length === 0 && <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: '0.85rem' }}>No friends yet — add someone by username.</p>}
        {accepted.map((f) => (
          <Row key={f.username} friend={f}>
            <button type="button" onClick={challenge} style={primary}>Challenge</button>
            <button type="button" onClick={() => act(() => api.removeFriend(f.username))} style={ghost}>Remove</button>
          </Row>
        ))}
      </Group>

      {outgoing.length > 0 && (
        <Group title={`Sent (${outgoing.length})`}>
          {outgoing.map((f) => (
            <Row key={f.username} friend={f}>
              <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Pending</span>
              <button type="button" onClick={() => act(() => api.removeFriend(f.username))} style={ghost}>Withdraw</button>
            </Row>
          ))}
        </Group>
      )}
    </Frame>
  );
}

function Row({ friend, children }: { friend: FriendView; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 9, padding: '0.5rem 0.7rem' }}>
      <AvatarView avatar={friend.avatar} size={34} framed />
      <span style={{ display: 'grid', gap: '0.05rem', minWidth: 0 }}>
        <strong style={{ fontSize: '0.9rem' }}>{friend.displayName}</strong>
        <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
          @{friend.username} · {friend.rating}{friend.badge ? ` · ${friend.badge}` : ''}
        </span>
      </span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.4rem' }}>{children}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'grid', gap: '0.45rem' }}>
      <h3 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-dim)' }}>{title}</h3>
      {children}
    </div>
  );
}

function Frame({ children, onExit }: { children: React.ReactNode; onExit: () => void }) {
  return (
    <section style={{ display: 'grid', gap: '1rem', maxWidth: 560 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem' }}>
        <h2 style={{ margin: 0 }}>Friends</h2>
        <button type="button" onClick={onExit} style={ghost}>Back to menu</button>
      </div>
      {children}
    </section>
  );
}

const ghost = {
  background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)',
  borderRadius: 7, padding: '0.35rem 0.75rem', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' as const,
};
const primary = {
  background: 'var(--accent)', color: '#1a1500', border: 'none',
  borderRadius: 7, padding: '0.4rem 0.85rem', cursor: 'pointer', fontWeight: 800, whiteSpace: 'nowrap' as const,
};
