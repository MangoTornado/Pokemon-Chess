/**
 * The trainer picker — choose your character from the games' protagonists and champions.
 *
 * A gallery grouped by region, with a large live preview of the chosen trainer. The roster is the shared
 * `TRAINERS` allowlist — the same set the server validates against — so any trainer shown is one a profile
 * may actually store.
 */

import { TRAINERS, trainerLabel, trainerSpriteUrl } from '../profile/avatar.ts';
import type { Avatar, TrainerOption } from '../profile/avatar.ts';
import { AvatarView } from './AvatarView.tsx';

export interface AvatarCustomizerProps {
  avatar: Avatar;
  onChange: (avatar: Avatar) => void;
}

export function AvatarCustomizer({ avatar, onChange }: AvatarCustomizerProps) {
  const groups = [...new Set(TRAINERS.map((t) => t.group))];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: '1.25rem', alignItems: 'start' }}>
      <div style={{ position: 'sticky', top: '1rem', display: 'grid', gap: '0.5rem', justifyItems: 'center' }}>
        <AvatarView avatar={avatar} size={168} framed />
        <strong style={{ fontSize: '0.95rem' }}>{trainerLabel(avatar.trainer)}</strong>
        <span style={{ color: 'var(--text-dim)', fontSize: '0.72rem' }}>Your trainer</span>
      </div>

      <div style={{ display: 'grid', gap: '0.9rem' }}>
        {groups.map((group) => (
          <div key={group} style={{ display: 'grid', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-dim)' }}>
              {group}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {TRAINERS.filter((t) => t.group === group).map((t) => (
                <TrainerButton
                  key={t.id}
                  trainer={t}
                  selected={avatar.trainer === t.id}
                  onSelect={() => onChange({ ...avatar, trainer: t.id })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrainerButton({ trainer, selected, onSelect }: { trainer: TrainerOption; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={trainer.label}
      aria-pressed={selected}
      style={{
        width: 56,
        height: 56,
        borderRadius: 10,
        border: selected ? '3px solid #58a6ff' : '1px solid var(--border)',
        background: `#0b0e13 url(${trainerSpriteUrl(trainer.id)}) no-repeat center 60%`,
        backgroundSize: '46px auto',
        imageRendering: 'pixelated',
        cursor: 'pointer',
        padding: 0,
      }}
    />
  );
}
