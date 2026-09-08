/**
 * Canonical Pokémon type colours.
 *
 * These are the community-standard hex values players already recognise, and recognition is the point:
 * the premise of the game is that type knowledge is your edge, so a Fire piece has to read as Fire at a
 * glance without anyone consulting a legend.
 */

import type { BattleType } from '../data/schema.ts';

export const TYPE_COLORS: Record<BattleType, string> = {
  Normal: '#a8a77a',
  Fire: '#ee8130',
  Water: '#6390f0',
  Electric: '#f7d02c',
  Grass: '#7ac74c',
  Ice: '#96d9d6',
  Fighting: '#c22e28',
  Poison: '#a33ea1',
  Ground: '#e2bf65',
  Flying: '#a98ff3',
  Psychic: '#f95587',
  Bug: '#a6b91a',
  Rock: '#b6a136',
  Ghost: '#735797',
  Dragon: '#6f35fc',
  Dark: '#705746',
  Steel: '#b7b7ce',
  Fairy: '#d685ad',
};

/**
 * Whether dark or light text reads better on a type's colour.
 *
 * Computed from relative luminance rather than eyeballed, because several types (Electric, Ice, Steel,
 * Ground) sit close enough to the threshold that guessing produces unreadable labels.
 */
export function textColorOn(type: BattleType): '#111' | '#fff' {
  const hex = TYPE_COLORS[type].slice(1);
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.4 ? '#111' : '#fff';
}
