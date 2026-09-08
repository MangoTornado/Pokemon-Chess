/**
 * The trainer avatar — the player's chosen trainer sprite, from the games' own art.
 *
 * A single 80×80 Showdown trainer sprite, rendered crisp (nearest-neighbour) so it keeps its pixel-art
 * character at any size, framed as a round chip on profiles. Because the avatar stores only an allowlisted
 * sprite id, the URL here can only ever point at a known trainer.
 */

import type { CSSProperties } from 'react';

import { trainerSpriteUrl, trainerLabel } from '../profile/avatar.ts';
import type { Avatar } from '../profile/avatar.ts';

export interface AvatarViewProps {
  avatar: Avatar;
  size?: number;
  framed?: boolean;
  style?: CSSProperties;
}

export function AvatarView({ avatar, size = 96, framed = false, style }: AvatarViewProps) {
  // A framed chip is a round background with the sprite as an <img> on top, so the sprite's own size and
  // position are simple and correct — layering it as a second CSS background made `background-size` apply
  // to the frame instead, leaving the sprite invisible.
  return (
    <span
      role="img"
      aria-label={`${trainerLabel(avatar.trainer)} trainer`}
      style={{
        display: 'inline-flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: framed ? '50%' : 8,
        background: framed ? 'radial-gradient(circle at 50% 30%, #2b323c, #12161c)' : 'transparent',
        border: framed ? '2px solid var(--border)' : 'none',
        overflow: 'hidden',
        ...style,
      }}
    >
      <img
        src={trainerSpriteUrl(avatar.trainer)}
        alt=""
        width={Math.round(size * 0.86)}
        height={Math.round(size * 0.86)}
        style={{ imageRendering: 'pixelated', objectFit: 'contain', marginBottom: framed ? '-4%' : 0 }}
      />
    </span>
  );
}
