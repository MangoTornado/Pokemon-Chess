/**
 * A Pokémon rendered from the shared icon spritesheet.
 *
 * Every species is one 383 KB sheet away, so a full board costs a single network request no matter
 * which of the 1025 Pokémon were drafted. The offsets come baked into `species.json` at build time,
 * which is why nothing here needs a sprite-resolution library.
 */

import type { CSSProperties } from 'react';

import type { SpeciesEntry } from '../data/schema.ts';

/** Native size of one cell in the spritesheet. */
export const ICON_WIDTH = 40;
export const ICON_HEIGHT = 30;

const SHEET_URL = 'https://play.pokemonshowdown.com/sprites/pokemonicons-sheet.png';

export interface PokemonIconProps {
  species: SpeciesEntry;
  /** Uniform scale factor applied to the native 40×30 icon. */
  scale?: number;
  /** Mirrors the sprite, so the two armies face each other. */
  flipped?: boolean;
  style?: CSSProperties;
  className?: string;
}

export function PokemonIcon({
  species,
  scale = 1,
  flipped = false,
  style,
  className,
}: PokemonIconProps) {
  const [left, top] = species.icon;

  return (
    <span
      className={className}
      role="img"
      aria-label={species.name}
      style={{
        display: 'inline-block',
        width: ICON_WIDTH,
        height: ICON_HEIGHT,
        backgroundImage: `url(${SHEET_URL})`,
        backgroundPosition: `${left}px ${top}px`,
        backgroundRepeat: 'no-repeat',
        // Nearest-neighbour keeps the pixel art crisp; smoothing turns it to mush when scaled up.
        imageRendering: 'pixelated',
        transform: `scale(${scale})${flipped ? ' scaleX(-1)' : ''}`,
        transformOrigin: 'center',
        ...style,
      }}
    />
  );
}
