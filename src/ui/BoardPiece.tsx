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
import { PokemonIcon } from './PokemonIcon.tsx';
import { GLYPH_FONT_STACK, ROLE_GLYPH, ROLE_RING_WEIGHT, ROLE_SPRITE_SCALE } from './pieceRoles.ts';
import { TYPE_COLORS } from './typeColors.ts';

export interface BoardPieceProps {
  species: SpeciesEntry;
  /** The single type this piece fights as, chosen at draft time from the species' real typing. */
  type: BattleType;
  cls: PieceClass;
  side: Side;
}

export function BoardPiece({ species, type, cls, side }: BoardPieceProps) {
  const typeColor = TYPE_COLORS[type];
  const isWhite = side === 'white';

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

      <PokemonIcon
        species={species}
        scale={ROLE_SPRITE_SCALE[cls]}
        flipped={!isWhite}
        style={{
          position: 'relative',
          zIndex: 1,
          filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
        }}
      />

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
    </>
  );
}
