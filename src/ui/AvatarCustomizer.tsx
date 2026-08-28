/**
 * The character customizer — pick an option per slot and watch the trainer redraw.
 *
 * The live {@link AvatarView} is the anchor: every change is reflected there instantly, which is the
 * whole appeal of customization. Options come from the shared `AVATAR_SLOTS` (the same closed set the
 * server validates against), so the swatches a player sees are exactly the values the server will accept.
 */

import { AVATAR_SLOTS } from '../profile/avatar.ts';
import type { Avatar, AvatarSlotKey } from '../profile/avatar.ts';
import { AvatarView } from './AvatarView.tsx';

export interface AvatarCustomizerProps {
  avatar: Avatar;
  onChange: (avatar: Avatar) => void;
}

export function AvatarCustomizer({ avatar, onChange }: AvatarCustomizerProps) {
  const set = (key: AvatarSlotKey, id: string) => onChange({ ...avatar, [key]: id });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '1.25rem', alignItems: 'start' }}>
      <div style={{ position: 'sticky', top: '1rem', display: 'grid', gap: '0.5rem', justifyItems: 'center' }}>
        <AvatarView avatar={avatar} size={168} framed />
        <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>Your trainer</span>
      </div>

      <div style={{ display: 'grid', gap: '0.85rem' }}>
        {AVATAR_SLOTS.map((slot) => (
          <div key={slot.key} style={{ display: 'grid', gap: '0.35rem' }}>
            <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
              {slot.label}
            </span>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
              {slot.options.map((opt) => {
                const selected = avatar[slot.key] === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => set(slot.key, opt.id)}
                    title={opt.label}
                    aria-pressed={selected}
                    style={
                      opt.color
                        ? {
                            width: 30,
                            height: 30,
                            borderRadius: '50%',
                            background: opt.color,
                            border: selected ? '3px solid #58a6ff' : '2px solid var(--border)',
                            cursor: 'pointer',
                            padding: 0,
                          }
                        : {
                            padding: '0.3rem 0.7rem',
                            borderRadius: 999,
                            background: selected ? 'var(--accent)' : 'transparent',
                            color: selected ? '#1a1500' : 'var(--text)',
                            border: selected ? 'none' : '1px solid var(--border)',
                            fontWeight: selected ? 700 : 500,
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                          }
                    }
                  >
                    {opt.color ? '' : opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
