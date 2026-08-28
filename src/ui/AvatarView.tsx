/**
 * The trainer avatar — a front-facing SVG portrait composed from the customization slots.
 *
 * This is the signature element of the profile: a player's character, drawn live from their choices, so
 * every slot they change is visible immediately. It is pure vector (no image assets) so it renders crisp
 * at any size — a 32px profile chip or a 240px customizer preview — and every fill is driven by the
 * `Avatar` value, so it is deterministic and needs no per-combination art.
 */

import type { CSSProperties } from 'react';

import { avatarColor } from '../profile/avatar.ts';
import type { Avatar } from '../profile/avatar.ts';

export interface AvatarViewProps {
  avatar: Avatar;
  size?: number;
  /** A ring/background treatment for use as a profile chip. */
  framed?: boolean;
  style?: CSSProperties;
}

/** Darkens a hex colour by a factor, for shading (hair strands, outfit shadow). */
function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export function AvatarView({ avatar, size = 96, framed = false, style }: AvatarViewProps) {
  const skin = avatarColor(avatar, 'skinTone') ?? '#e6b58f';
  const skinShadow = shade(skin, 0.88);
  const hair = avatarColor(avatar, 'hairColor') ?? '#1c1a1a';
  const hairShade = shade(hair, 0.8);
  const eye = avatarColor(avatar, 'eyeColor') ?? '#5a3a22';
  const outfit = avatarColor(avatar, 'outfitColor') ?? '#2e6bb0';
  const outfitShade = shade(outfit, 0.82);

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label="Trainer avatar"
      style={{
        display: 'block',
        borderRadius: framed ? '50%' : 8,
        background: framed ? 'radial-gradient(circle at 50% 35%, #2b323c, #161b22)' : 'transparent',
        ...(framed ? { border: '2px solid var(--border)' } : {}),
        ...style,
      }}
    >
      {/* Shoulders / outfit */}
      <path d="M14 100 V88 Q14 72 34 68 H66 Q86 72 86 88 V100 Z" fill={outfit} />
      <path d="M34 68 H66 Q76 70 80 78 H20 Q24 70 34 68 Z" fill={outfitShade} />
      {renderCollar(avatar.outfit, outfit, outfitShade)}

      {/* Neck */}
      <path d="M42 62 H58 V74 Q50 80 42 74 Z" fill={skinShadow} />

      {/* Long hair sits behind the head for styles that fall past the shoulders */}
      {(avatar.hairStyle === 'long' || avatar.hairStyle === 'curly') && (
        <path d="M26 44 Q22 74 30 86 L36 84 Q30 64 34 44 Z M74 44 Q78 74 70 86 L64 84 Q70 64 66 44 Z" fill={hairShade} />
      )}
      {avatar.hairStyle === 'ponytail' && (
        <path d="M70 40 Q88 46 84 72 Q80 60 68 52 Z" fill={hair} />
      )}

      {/* Head */}
      <ellipse cx="50" cy="46" rx="24" ry="26" fill={skin} />
      <path d="M50 68 Q40 72 34 66 Q42 74 50 72 Q58 74 66 66 Q60 72 50 68 Z" fill={skinShadow} opacity="0.5" />

      {/* Ears */}
      <circle cx="26" cy="48" r="4.5" fill={skin} />
      <circle cx="74" cy="48" r="4.5" fill={skin} />

      {/* Hair (front) — style-dependent */}
      {renderHair(avatar.hairStyle, hair, hairShade)}

      {/* Eyes */}
      <ellipse cx="41" cy="46" rx="4.2" ry="5" fill="#fff" />
      <ellipse cx="59" cy="46" rx="4.2" ry="5" fill="#fff" />
      <circle cx="41.5" cy="47" r="2.6" fill={eye} />
      <circle cx="59.5" cy="47" r="2.6" fill={eye} />
      <circle cx="42.3" cy="46" r="0.9" fill="#fff" />
      <circle cx="60.3" cy="46" r="0.9" fill="#fff" />

      {/* Brows, nose hint, mouth */}
      <path d="M36 39 Q41 37 46 39" stroke={hairShade} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M54 39 Q59 37 64 39" stroke={hairShade} strokeWidth="1.6" fill="none" strokeLinecap="round" />
      <path d="M48 52 Q50 55 52 52" stroke={skinShadow} strokeWidth="1.4" fill="none" strokeLinecap="round" />
      <path d="M44 59 Q50 63 56 59" stroke={shade(skin, 0.7)} strokeWidth="1.8" fill="none" strokeLinecap="round" />

      {/* Accessory (over the face) */}
      {renderAccessory(avatar.accessory, outfit)}

      {/* Hat (on top of everything) */}
      {renderHat(avatar.hat, outfit, outfitShade)}
    </svg>
  );
}

function renderHair(style: string, hair: string, hairShade: string) {
  switch (style) {
    case 'shaved':
      return <path d="M28 40 Q34 22 50 21 Q66 22 72 40 Q66 34 50 33 Q34 34 28 40 Z" fill={hair} opacity="0.55" />;
    case 'short':
      return <path d="M26 44 Q26 20 50 19 Q74 20 74 44 Q70 30 58 28 Q54 34 50 28 Q46 34 42 28 Q30 30 26 44 Z" fill={hair} />;
    case 'medium':
      return <path d="M25 50 Q24 20 50 19 Q76 20 75 50 Q72 32 60 29 L58 40 Q50 30 42 40 L40 29 Q28 32 25 50 Z" fill={hair} />;
    case 'long':
      return <path d="M25 52 Q24 19 50 18 Q76 19 75 52 Q71 34 60 30 L58 42 Q50 31 42 42 L40 30 Q29 34 25 52 Z" fill={hair} />;
    case 'ponytail':
      return <path d="M27 44 Q27 20 50 19 Q73 20 73 44 Q69 30 57 28 Q54 33 50 28 Q46 33 43 28 Q31 30 27 44 Z" fill={hair} />;
    case 'buns':
      return (
        <>
          <circle cx="30" cy="26" r="8" fill={hair} />
          <circle cx="70" cy="26" r="8" fill={hair} />
          <path d="M27 42 Q28 22 50 21 Q72 22 73 42 Q68 30 50 29 Q32 30 27 42 Z" fill={hair} />
        </>
      );
    case 'spiky':
      return (
        <path
          d="M26 44 L30 24 L37 36 L42 20 L48 34 L50 18 L52 34 L58 20 L63 36 L70 24 L74 44 Q68 30 50 29 Q32 30 26 44 Z"
          fill={hair}
        />
      );
    case 'curly':
      return (
        <>
          <path d="M26 46 Q24 22 50 20 Q76 22 74 46 Q70 30 50 29 Q30 30 26 46 Z" fill={hair} />
          <circle cx="30" cy="34" r="5" fill={hairShade} />
          <circle cx="70" cy="34" r="5" fill={hairShade} />
          <circle cx="38" cy="26" r="5" fill={hair} />
          <circle cx="62" cy="26" r="5" fill={hair} />
          <circle cx="50" cy="23" r="5" fill={hair} />
        </>
      );
    default:
      return null;
  }
}

function renderHat(hat: string, accent: string, accentShade: string) {
  switch (hat) {
    case 'cap':
      return (
        <>
          <path d="M26 30 Q28 14 50 13 Q72 14 74 30 Q60 24 50 24 Q40 24 26 30 Z" fill={accent} />
          <path d="M24 31 Q36 27 50 27 L50 33 Q34 33 24 35 Z" fill={accentShade} />
          <circle cx="50" cy="16" r="2.4" fill={accentShade} />
        </>
      );
    case 'beanie':
      return (
        <>
          <path d="M26 34 Q26 14 50 13 Q74 14 74 34 Q60 28 50 28 Q40 28 26 34 Z" fill={accent} />
          <rect x="26" y="31" width="48" height="6" rx="3" fill={accentShade} />
        </>
      );
    case 'sunhat':
      return (
        <>
          <ellipse cx="50" cy="30" rx="40" ry="8" fill={accentShade} />
          <path d="M32 30 Q34 14 50 13 Q66 14 68 30 Z" fill={accent} />
        </>
      );
    case 'bandana':
      return (
        <>
          <path d="M27 34 Q28 24 50 23 Q72 24 73 34 Q60 30 50 30 Q40 30 27 34 Z" fill={accent} />
          <path d="M70 32 L82 30 L80 40 L70 36 Z" fill={accentShade} />
        </>
      );
    default:
      return null;
  }
}

function renderAccessory(accessory: string, accent: string) {
  switch (accessory) {
    case 'glasses':
      return (
        <g stroke="#2b2b30" strokeWidth="1.6" fill="none">
          <rect x="35.5" y="41" width="11" height="10" rx="3" />
          <rect x="53.5" y="41" width="11" height="10" rx="3" />
          <path d="M46.5 46 H53.5" />
        </g>
      );
    case 'sunglasses':
      return (
        <g fill="#1c1c22">
          <rect x="35" y="41" width="12" height="9" rx="3" />
          <rect x="53" y="41" width="12" height="9" rx="3" />
          <rect x="46" y="45" width="8" height="1.6" />
        </g>
      );
    case 'scarf':
      return <path d="M40 68 Q50 76 60 68 L62 78 Q50 84 38 78 Z" fill={accent} />;
    case 'bag':
      return <path d="M78 78 l8 -3 l3 10 l-8 3 Z" fill={shade(accent, 0.8)} />;
    default:
      return null;
  }
}

function renderCollar(outfitStyle: string, outfit: string, outfitShade: string) {
  switch (outfitStyle) {
    case 'hoodie':
      return <path d="M40 68 Q50 78 60 68 Q58 74 50 76 Q42 74 40 68 Z" fill={outfitShade} />;
    case 'jacket':
      return (
        <>
          <path d="M42 68 L48 92 L50 74 Z" fill={outfitShade} />
          <path d="M58 68 L52 92 L50 74 Z" fill={outfitShade} />
        </>
      );
    case 'formal':
      return (
        <>
          <path d="M44 68 L50 82 L42 78 Z" fill="#f6f4ef" />
          <path d="M56 68 L50 82 L58 78 Z" fill="#f6f4ef" />
          <path d="M49 76 L51 76 L50 90 Z" fill={shade(outfit, 0.5)} />
        </>
      );
    case 'dress':
      return <path d="M34 68 Q50 66 66 68 L70 82 Q50 76 30 82 Z" fill={outfitShade} />;
    default:
      return null;
  }
}
