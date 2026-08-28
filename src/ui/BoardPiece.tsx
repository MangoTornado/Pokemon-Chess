/**
 * A drafted Pokémon standing on a board square.
 *
 * Solves the three-channel identity problem described in `pieceRoles.ts`: role via a chess glyph badge
 * plus a size hierarchy, type via the ring colour, owner via the badge's own light/dark treatment.
 *
 * Sizing is expressed in container-query units (`cqmin`) against the square, so a piece scales correctly
 * from a 40px mobile square to a 96px desktop one without a media query or a hard-coded pixel size.
 */

import type { SpeciesEntry } from '../data/schema.ts';
import type { BattleType } from '../data/schema.ts';
import type { PieceClass, Side } from '../engine/board.ts';
import type { PieceStatus } from '../engine/variant.ts';
import { PokemonIcon } from './PokemonIcon.tsx';
import { GLYPH_FONT_STACK, ROLE_GLYPH, ROLE_RING_WEIGHT, ROLE_SPRITE_SCALE } from './pieceRoles.ts';
import { TYPE_COLORS } from './typeColors.ts';

export interface BoardPieceProps {
  species: SpeciesEntry;
  /** The single type this piece fights as, chosen at draft time from the species' real typing. */
  type: BattleType;
  cls: PieceClass;
  side: Side;
  /** Current hit points, for the HP bar. Omit to hide the bar (e.g. in a draft preview). */
  hp?: number;
  maxHp?: number;
  /** Status condition, for the rotation and counter-pip markers. */
  status?: PieceStatus;
}

/** How far the sprite tilts for each rotation-class status — the TCG's rotate-the-card marking. */
const ROTATION_DEGREES: Record<string, number> = { asleep: -20, paralyzed: 20, confused: 180 };

/** Colour of each counter-class status pip. */
const PIP_COLOR: Record<'poisoned' | 'burned', string> = { poisoned: '#a33ea1', burned: '#ee8130' };

/** Green when healthy, amber when bloodied, red when nearly gone — the standard HP-bar reading. */
function hpColor(fraction: number): string {
  if (fraction > 0.5) return '#3fb950';
  if (fraction > 0.2) return '#e3a008';
  return '#f85149';
}

export function BoardPiece({ species, type, cls, side, hp, maxHp, status }: BoardPieceProps) {
  const typeColor = TYPE_COLORS[type];
  const isWhite = side === 'white';
  const showHp = hp !== undefined && maxHp !== undefined && maxHp > 0;
  const fraction = showHp ? Math.max(0, Math.min(1, hp / maxHp)) : 1;
  const tilt = status?.rotation ? ROTATION_DEGREES[status.rotation.kind] ?? 0 : 0;
  const pips: ('poisoned' | 'burned')[] = [];
  if (status?.poisoned) for (let i = 0; i < status.poisoned.count; i++) pips.push('poisoned');
  if (status?.burned) pips.push('burned');

  return (
    <>
      {/* A ring rather than a filled disc: at any opacity high enough to identify the type, a solid
          fill swallows the sprite and muddies the whole board. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          inset: '8%',
          borderRadius: '50%',
          background: `${typeColor}30`,
          boxShadow: `inset 0 0 0 ${ROLE_RING_WEIGHT[cls]}cqmin ${typeColor}`,
        }}
      />

      {/* A tilted (or upside-down) sprite is the TCG's rotate-the-card marking for a rotation-class
          status. The rotation is on a wrapper so it composes with the icon's own scale and flip. */}
      <span
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'inline-flex',
          transform: tilt ? `rotate(${tilt}deg)` : undefined,
          transition: 'transform 200ms ease',
        }}
      >
        <PokemonIcon
          species={species}
          scale={ROLE_SPRITE_SCALE[cls]}
          flipped={!isWhite}
          style={{ filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))' }}
        />
      </span>

      {/* The role badge is the primary role cue, so it sits above the sprite and never overlaps the
          ring's colour. Its own light/dark treatment is what identifies the owning army. */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: '2%',
          bottom: '2%',
          zIndex: 2,
          width: '38cqmin',
          height: '38cqmin',
          display: 'grid',
          placeItems: 'center',
          borderRadius: '24%',
          fontSize: '26cqmin',
          lineHeight: 1,
          fontFamily: GLYPH_FONT_STACK,
          // Belt-and-braces with the U+FE0E in the glyph itself: without text presentation, macOS draws
          // these code points as colour emoji that ignore `color` and render dark on dark.
          fontVariantEmoji: 'text',
          background: isWhite ? '#f6f4ef' : '#15171c',
          color: isWhite ? '#15171c' : '#f6f4ef',
          border: `1.5cqmin solid ${isWhite ? '#15171c' : '#f6f4ef'}`,
          boxShadow: '0 1px 3px rgba(0,0,0,0.45)',
          // The glyph's own vertical metrics sit low in most symbol fonts.
          paddingBottom: '3cqmin',
          boxSizing: 'border-box',
        }}
      >
        {ROLE_GLYPH[cls]}
      </span>

      {/* HP bar across the top of the square, hidden at full health to keep a fresh board uncluttered. */}
      {showHp && fraction < 1 && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: '4%',
            left: '12%',
            right: '12%',
            height: '7cqmin',
            borderRadius: '3cqmin',
            background: 'rgba(0,0,0,0.55)',
            zIndex: 2,
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              display: 'block',
              height: '100%',
              width: `${fraction * 100}%`,
              background: hpColor(fraction),
              transition: 'width 220ms ease, background 220ms ease',
            }}
          />
        </span>
      )}

      {/* Counter-class status pips (poison purple, burn orange) — the TCG's stackable markers. */}
      {pips.length > 0 && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            bottom: '3%',
            right: '4%',
            display: 'flex',
            gap: '2cqmin',
            zIndex: 2,
          }}
        >
          {pips.map((kind, i) => (
            <span
              key={`${kind}-${i}`}
              style={{
                width: '9cqmin',
                height: '9cqmin',
                borderRadius: '50%',
                background: PIP_COLOR[kind],
                boxShadow: '0 0 0 1cqmin rgba(0,0,0,0.5)',
              }}
            />
          ))}
        </span>
      )}
    </>
  );
}
