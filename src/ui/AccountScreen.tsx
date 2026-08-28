/**
 * The account surface: sign up, sign in, and view/edit your profile.
 *
 * A single component with three states — signed out (auth), the sign-up flow (which folds in the
 * character customizer, because building your trainer is the fun part of creating an account), and
 * signed in (the profile card and its editor). Field errors from the server are shown against the field
 * they belong to, in the interface's own voice.
 */

import { useState } from 'react';

import { DEFAULT_AVATAR } from '../profile/avatar.ts';
import type { Avatar } from '../profile/avatar.ts';
import {
  BIO_MAX, DISPLAY_NAME_MAX, STATUS_MAX,
} from '../profile/profile.ts';
import type { PublicProfile } from '../profile/profile.ts';
import type { Session } from './useSession.ts';
import { AvatarView } from './AvatarView.tsx';
import { AvatarCustomizer } from './AvatarCustomizer.tsx';

export interface AccountScreenProps {
  session: Session;
  onClose: () => void;
}

export function AccountScreen({ session, onClose }: AccountScreenProps) {
  if (session.profile === undefined) {
    return <Card><p style={{ color: 'var(--text-dim)' }}>Loading your trainer…</p></Card>;
  }
  if (session.profile === null) {
    return <AuthFlow session={session} onClose={onClose} />;
  }
  return <ProfilePanel session={session} profile={session.profile} onClose={onClose} />;
}

// ---------------------------------------------------------------------------

function AuthFlow({ session, onClose }: { session: Session; onClose: () => void }) {
  const [tab, setTab] = useState<'signup' | 'signin'>('signup');
  return (
    <Card>
      <Header title={tab === 'signup' ? 'Create your trainer' : 'Welcome back'} onClose={onClose} />
      <div style={{ display: 'inline-flex', border: '1px solid var(--border)', borderRadius: 7, overflow: 'hidden', marginBottom: '1rem' }}>
        {(['signup', 'signin'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            style={{
              background: tab === t ? 'var(--accent)' : 'transparent',
              color: tab === t ? '#1a1500' : 'var(--text)',
              border: 'none', padding: '0.35rem 0.9rem', fontWeight: tab === t ? 700 : 500, cursor: 'pointer',
            }}
          >
            {t === 'signup' ? 'Sign up' : 'Sign in'}
          </button>
        ))}
      </div>
      {tab === 'signup' ? <SignUp session={session} /> : <SignIn session={session} />}
    </Card>
  );
}

function SignUp({ session }: { session: Session }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [avatar, setAvatar] = useState<Avatar>(DEFAULT_AVATAR);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setErrors({});
    const err = await session.register({ username, password, avatar });
    setBusy(false);
    if (err) setErrors(err.field ? { [err.field]: err.error } : { form: err.error });
  };

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <Field label="Username" hint="Letters, numbers, _ and - · 3–20 characters" error={errors.username}>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" style={inputStyle} />
      </Field>
      <Field label="Password" hint="At least 8 characters" error={errors.password}>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" style={inputStyle} />
      </Field>

      <div>
        <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
          Build your trainer
        </span>
        <div style={{ marginTop: '0.5rem' }}>
          <AvatarCustomizer avatar={avatar} onChange={setAvatar} />
        </div>
      </div>

      {errors.form && <p style={{ color: '#f85149', margin: 0, fontSize: '0.85rem' }}>{errors.form}</p>}
      <PrimaryButton onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create trainer & sign in'}</PrimaryButton>
    </div>
  );
}

function SignIn({ session }: { session: Session }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError('');
    const err = await session.login(username, password);
    setBusy(false);
    if (err) setError(err.error);
  };

  return (
    <div style={{ display: 'grid', gap: '1rem', maxWidth: 320 }}>
      <Field label="Username">
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" style={inputStyle} />
      </Field>
      <Field label="Password">
        <input
          type="password" value={password} autoComplete="current-password"
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          style={inputStyle}
        />
      </Field>
      {error && <p style={{ color: '#f85149', margin: 0, fontSize: '0.85rem' }}>{error}</p>}
      <PrimaryButton onClick={submit} disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</PrimaryButton>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ProfilePanel({ session, profile, onClose }: { session: Session; profile: PublicProfile; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <ProfileEditor session={session} profile={profile} onDone={() => setEditing(false)} />;
  }
  return (
    <Card>
      <Header title="Your trainer card" onClose={onClose} />
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '1.2rem', alignItems: 'start' }}>
        <AvatarView avatar={profile.avatar} size={120} framed />
        <div style={{ display: 'grid', gap: '0.4rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
            <strong style={{ fontSize: '1.2rem' }}>{profile.displayName}</strong>
            <span style={{ color: 'var(--text-dim)' }}>@{profile.username}</span>
          </div>
          {profile.status && <div style={{ color: 'var(--accent)', fontSize: '0.9rem' }}>“{profile.status}”</div>}
          {profile.bio && <p style={{ margin: 0, color: 'var(--text)', fontSize: '0.9rem' }}>{profile.bio}</p>}
          <div style={{ display: 'flex', gap: '1.2rem', color: 'var(--text-dim)', fontSize: '0.82rem', marginTop: '0.3rem' }}>
            <span><strong style={{ color: 'var(--text)' }}>{profile.dexCount}</strong> Pokémon</span>
            <span>Badge: {profile.badge ?? 'none yet'}</span>
            <span>Joined {new Date(profile.joinedAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1.2rem' }}>
        <PrimaryButton onClick={() => setEditing(true)}>Edit profile</PrimaryButton>
        <GhostButton onClick={() => void session.logout()}>Sign out</GhostButton>
      </div>
    </Card>
  );
}

function ProfileEditor({ session, profile, onDone }: { session: Session; profile: PublicProfile; onDone: () => void }) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [status, setStatus] = useState(profile.status);
  const [bio, setBio] = useState(profile.bio);
  const [avatar, setAvatar] = useState<Avatar>(profile.avatar);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setErrors({});
    const err = await session.updateProfile({ displayName, status, bio, avatar });
    setBusy(false);
    if (err) setErrors(err.field ? { [err.field]: err.error } : { form: err.error });
    else onDone();
  };

  return (
    <Card>
      <Header title="Edit profile" onClose={onDone} />
      <div style={{ display: 'grid', gap: '1rem' }}>
        <Field label="Display name" error={errors.displayName}>
          <input value={displayName} maxLength={DISPLAY_NAME_MAX} onChange={(e) => setDisplayName(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Status" hint={`${status.length}/${STATUS_MAX}`} error={errors.status}>
          <input value={status} maxLength={STATUS_MAX} placeholder="Looking for a match…" onChange={(e) => setStatus(e.target.value)} style={inputStyle} />
        </Field>
        <Field label="Bio" hint={`${bio.length}/${BIO_MAX}`} error={errors.bio}>
          <textarea value={bio} maxLength={BIO_MAX} rows={3} onChange={(e) => setBio(e.target.value)} style={{ ...inputStyle, resize: 'vertical' }} />
        </Field>
        <div>
          <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>Appearance</span>
          <div style={{ marginTop: '0.5rem' }}>
            <AvatarCustomizer avatar={avatar} onChange={setAvatar} />
          </div>
        </div>
        {errors.form && <p style={{ color: '#f85149', margin: 0, fontSize: '0.85rem' }}>{errors.form}</p>}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <PrimaryButton onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</PrimaryButton>
          <GhostButton onClick={onDone}>Cancel</GhostButton>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Small shared building blocks, styled to the app's dark identity.

const inputStyle = {
  background: '#0b0e13',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '0.45rem 0.6rem',
  color: 'inherit',
  fontSize: '0.9rem',
  width: '100%',
  boxSizing: 'border-box' as const,
  fontFamily: 'inherit',
};

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)', borderRadius: 10, padding: '1.25rem 1.4rem', maxWidth: 640 }}>
      {children}
    </section>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
      <h2 style={{ fontSize: '1.15rem' }}>{title}</h2>
      <GhostButton onClick={onClose}>← Back</GhostButton>
    </div>
  );
}

function Field({ label, hint, error, children }: { label: string; hint?: string | undefined; error?: string | undefined; children: React.ReactNode }) {
  return (
    <label style={{ display: 'grid', gap: '0.3rem' }}>
      <span style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)' }}>
        <span>{label}</span>
        {hint && <span style={{ textTransform: 'none', letterSpacing: 0 }}>{hint}</span>}
      </span>
      {children}
      {error && <span style={{ color: '#f85149', fontSize: '0.78rem' }}>{error}</span>}
    </label>
  );
}

function PrimaryButton({ onClick, disabled, children }: { onClick: () => void; disabled?: boolean | undefined; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled ?? false}
      style={{ background: 'var(--accent)', color: '#1a1500', border: 'none', borderRadius: 6, padding: '0.5rem 1rem', fontWeight: 700, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
      {children}
    </button>
  );
}

function GhostButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      style={{ background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.5rem 0.9rem', cursor: 'pointer', fontSize: '0.85rem' }}>
      {children}
    </button>
  );
}
