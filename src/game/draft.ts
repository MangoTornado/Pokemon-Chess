/**
 * Draft data model.
 *
 * The draft is a strategic phase in the shipped game, not a dice roll. Both players fill 16 slots — one
 * per starting square — from a pool of species, choosing exactly one type for each pick from that
 * species' real typing. The pool is parameterised by the SOURCE: `full-dex` for sandbox and casual
 * play, `collection` for progression and ranked. The match rules layer is blind to which.
 *
 * This module holds the state machine and the validity checks. The visible interface for a draft is a
 * React component; the CPU's picking policy lives in `src/game/autodraft.ts`; both consume this
 * module rather than duplicating its rules.
 */

import type { Dex } from '../data/dex.ts';
import type { BattleType, SpeciesEntry } from '../data/schema.ts';
import type { PieceClass, Side } from '../engine/board.ts';
import { PIECE_CLASSES, STARTING_SQUARES } from '../engine/board.ts';
import { Position } from '../engine/position.ts';
import type { Loadout, PokemonLoadout } from '../engine/variant.ts';

/** A single slot the draft is filling. */
export interface DraftSlot {
  readonly side: Side;
  readonly cls: PieceClass;
  /** Board square this slot's Pokémon will occupy at kickoff. */
  readonly square: number;
  readonly picked: PokemonLoadout | null;
}

/** A confirmed pick, ready to become a match. */
export interface DraftedPiece {
  readonly side: Side;
  readonly cls: PieceClass;
  readonly square: number;
  readonly species: SpeciesEntry;
  readonly type: BattleType;
}

/** Draft-time errors, kept typed so the UI can display each one directly. */
export type DraftError =
  | { readonly kind: 'already-taken'; readonly species: string }
  | { readonly kind: 'wrong-type'; readonly species: string; readonly type: BattleType }
  | { readonly kind: 'not-in-pool'; readonly species: string };

/** The draft configuration. */
export interface DraftConfig {
  /**
   * Which pool the draft picks from.
   *
   * `full-dex` is the sandbox mode's every-Pokémon pool, and it is what the current game defaults to
   * before a collection layer exists. `collection` will be the mode used by progression once accounts
   * ship — the match rules are blind to which is in play, so the seam is here.
   */
  readonly source: 'full-dex' | 'collection';
  /** Species ids the pool admits. Absent for `full-dex` (the whole dex is admitted). */
  readonly pool?: readonly string[];
  /**
   * Whether a species may appear on both armies at once.
   *
   * `false` produces mirror-free games, which is a common competitive default. `true` produces "cheer
   * for your own Charizard, cheer for their Charizard too" games, which is a valid casual default.
   */
  readonly allowDuplicateSpecies: boolean;
  /**
   * Whether the same species may appear more than once ON THE SAME side.
   *
   * Nearly always `false`. Turning it on is the toy mode that produces sixteen Magikarp; it exists so
   * a tutorial can demonstrate absurd matchups on a whim.
   */
  readonly allowIntraSideDuplicates: boolean;
}

export const DEFAULT_DRAFT_CONFIG: DraftConfig = {
  source: 'full-dex',
  allowDuplicateSpecies: true,
  allowIntraSideDuplicates: false,
};

/** The full list of slots to be filled, in board-position order. */
export function buildSlots(): DraftSlot[] {
  const slots: DraftSlot[] = [];
  for (const side of ['white', 'black'] as const) {
    for (const cls of PIECE_CLASSES) {
      for (const square of STARTING_SQUARES[side][cls]) {
        slots.push({ side, cls, square, picked: null });
      }
    }
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Whether the given species and type can fill the given slot, and if not, why.
 *
 * Returns `null` on success, mirroring TypeScript's convention that a validation error is a value.
 */
export function checkPick(
  dex: Dex,
  slots: readonly DraftSlot[],
  slotIndex: number,
  species: SpeciesEntry,
  type: BattleType,
  config: DraftConfig,
): DraftError | null {
  if (!species.types.includes(type)) {
    return { kind: 'wrong-type', species: species.id, type };
  }
  if (config.pool && !config.pool.includes(species.id)) {
    return { kind: 'not-in-pool', species: species.id };
  }
  void dex;

  const target = slots[slotIndex];
  if (!target) return { kind: 'not-in-pool', species: species.id };

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]!;
    if (i === slotIndex || !slot.picked || slot.picked.species !== species.id) continue;

    if (!config.allowIntraSideDuplicates && slot.side === target.side) {
      return { kind: 'already-taken', species: species.id };
    }
    if (!config.allowDuplicateSpecies) {
      return { kind: 'already-taken', species: species.id };
    }
  }

  return null;
}

/** Applies a pick to the slot list, returning a new list. */
export function applyPick(
  slots: readonly DraftSlot[],
  slotIndex: number,
  pick: PokemonLoadout,
): DraftSlot[] {
  return slots.map((slot, i) => (i === slotIndex ? { ...slot, picked: pick } : slot));
}

/** Clears a slot. */
export function clearSlot(slots: readonly DraftSlot[], slotIndex: number): DraftSlot[] {
  return slots.map((slot, i) => (i === slotIndex ? { ...slot, picked: null } : slot));
}

/** Whether every slot is filled. */
export function isDraftComplete(slots: readonly DraftSlot[]): boolean {
  return slots.every((slot) => slot.picked !== null);
}

// ---------------------------------------------------------------------------
// Finalization
// ---------------------------------------------------------------------------

/**
 * Turns a completed draft into the pair of things a match needs: a starting `Position` (ids assigned)
 * and the `Loadout` map keying Pokémon to those ids.
 *
 * Throws if the draft is not complete, because a match with a hole in it is nonsense. Callers should
 * check {@link isDraftComplete} first.
 */
export function finalizeDraft(
  dex: Dex,
  slots: readonly DraftSlot[],
): { position: Position; loadout: Loadout; drafted: DraftedPiece[] } {
  if (!isDraftComplete(slots)) {
    throw new Error('cannot finalize a draft with empty slots');
  }

  const position = Position.fromStartingPosition();
  const loadout = new Map<number, PokemonLoadout>();
  const drafted: DraftedPiece[] = [];

  for (const slot of slots) {
    const piece = position.pieceAt(slot.square);
    if (!piece) {
      throw new Error(
        `starting position has no piece on ${slot.square} — draft-slot construction is out of sync`,
      );
    }
    const pick = slot.picked!;
    loadout.set(piece.id, pick);

    const species = dex.getSpecies(pick.species);
    if (!species) throw new Error(`unknown species ${pick.species} in a completed draft`);
    drafted.push({ ...slot, species, type: pick.type });
  }

  return { position, loadout, drafted };
}
