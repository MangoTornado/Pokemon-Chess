/**
 * Presentation of the chess role a Pokémon has been drafted into.
 *
 * Every piece on the board has to communicate three things at once: its **chess role**, its **Pokémon
 * type**, and **which army owns it**. Role comes first, because role is what governs legal movement — a
 * player who cannot tell a bishop from a pawn cannot play at all, however beautiful the sprite is.
 *
 * The type is carried by the ring colour (see `typeColors.ts`) and the owner by the badge's own colour, so
 * the three channels never compete for the same visual cue.
 */

import type { PieceClass } from '../engine/board.ts';

/**
 * Solid Unicode chess glyphs for every role, regardless of side.
 *
 * The outline set (`♔♕♖♗♘♙`) is conventionally "white", but outline glyphs render thin and inconsistently
 * across platform fonts and disintegrate at board sizes. Using the solid set for both armies and letting
 * the badge background carry the side is legible at every size and in every font.
 *
 * Each glyph carries **U+FE0E, the text variation selector**, which is load-bearing rather than
 * decorative. U+265A–265F have emoji presentations, so macOS renders them from Apple Color Emoji as
 * colour bitmaps that ignore `color` entirely — every badge came out dark on dark regardless of the CSS.
 * U+FE0E forces the monochrome text glyph, which then honours `color` and lets the badge distinguish the
 * two armies. Pair it with `font-variant-emoji: text` for browsers that support it.
 */
export const ROLE_GLYPH: Record<PieceClass, string> = {
  king: '♚︎',
  queen: '♛︎',
  rook: '♜︎',
  bishop: '♝︎',
  knight: '♞︎',
  pawn: '♟︎',
};

/**
 * Font stack for the role glyphs.
 *
 * Ordered to prefer fonts whose chess symbols are monochrome outlines drawn for text, and to keep any
 * colour-emoji font out of the running entirely.
 */
export const GLYPH_FONT_STACK =
  '"Apple Symbols", "Segoe UI Symbol", "Noto Sans Symbols 2", "DejaVu Sans", "FreeSerif", serif';

export const ROLE_LABEL: Record<PieceClass, string> = {
  king: 'King',
  queen: 'Queen',
  rook: 'Rook',
  bishop: 'Bishop',
  knight: 'Knight',
  pawn: 'Pawn',
};

/**
 * Sprite scale per role, giving the board a size hierarchy.
 *
 * A second, redundant channel for role: royalty reads as physically bigger, which is legible in
 * peripheral vision and survives both colour-blindness and a badge too small to resolve.
 */
export const ROLE_SPRITE_SCALE: Record<PieceClass, number> = {
  pawn: 1.25,
  knight: 1.45,
  bishop: 1.45,
  rook: 1.45,
  queen: 1.7,
  king: 1.7,
};

/** Ring thickness in `cqmin` units, so more valuable pieces look more substantial. */
export const ROLE_RING_WEIGHT: Record<PieceClass, number> = {
  pawn: 3,
  knight: 3.5,
  bishop: 3.5,
  rook: 3.5,
  queen: 5,
  king: 5,
};
