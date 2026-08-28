/**
 * Shared account and profile shapes, and the validation rules for their user-entered fields.
 *
 * These types cross the wire, so they live in `src/` where both the client and the Node server import
 * them — the server validates with the exact rules the client enforces, and neither trusts the other.
 *
 * The free-text fields (bio, status) are the one place a player can type arbitrary content that other
 * players will see. Because the audience includes children, they are length-capped, control-character
 * stripped, and (for the username) restricted to a safe character class; a real deployment should add
 * server-side moderation on top, which `validateBio`/`validateStatus` leave room for. See
 * `docs/design/BRIEF-METAGAME.md` §17.
 */

import type { Avatar } from './avatar.ts';

/** The public, shareable view of a player — safe to send to anyone. */
export interface PublicProfile {
  readonly username: string;
  readonly displayName: string;
  readonly bio: string;
  readonly status: string;
  readonly avatar: Avatar;
  /** ISO timestamp of account creation. */
  readonly joinedAt: string;
  /** Distinct Pokémon species owned — the Pokédex count, shown on the profile. */
  readonly dexCount: number;
  /** Ladder badge tier, or null if unranked. */
  readonly badge: string | null;
}

/** A validation outcome: the cleaned value, or an error message for the field. */
export type FieldResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string };

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const DISPLAY_NAME_MAX = 30;
export const BIO_MAX = 280;
export const STATUS_MAX = 80;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/** Strips control characters (including newlines) and collapses runs of whitespace. */
function clean(input: string): string {
  return input
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[ \t\r\n]+/g, ' ')
    .trim();
}

/**
 * Usernames are the account's public handle and part of URLs, so they are the strictest field: a safe
 * character class only, case-insensitively unique (the caller enforces uniqueness against storage).
 */
export function validateUsername(input: unknown): FieldResult {
  if (typeof input !== 'string') return { ok: false, error: 'Username is required.' };
  const value = input.trim();
  if (value.length < USERNAME_MIN) return { ok: false, error: `At least ${USERNAME_MIN} characters.` };
  if (value.length > USERNAME_MAX) return { ok: false, error: `At most ${USERNAME_MAX} characters.` };
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    return { ok: false, error: 'Letters, numbers, underscore and hyphen only.' };
  }
  return { ok: true, value };
}

export function validateDisplayName(input: unknown): FieldResult {
  const value = clean(typeof input === 'string' ? input : '');
  if (value.length === 0) return { ok: false, error: 'A display name is required.' };
  if (value.length > DISPLAY_NAME_MAX) return { ok: false, error: `At most ${DISPLAY_NAME_MAX} characters.` };
  return { ok: true, value };
}

export function validateBio(input: unknown): FieldResult {
  const value = clean(typeof input === 'string' ? input : '');
  if (value.length > BIO_MAX) return { ok: false, error: `At most ${BIO_MAX} characters.` };
  return { ok: true, value };
}

export function validateStatus(input: unknown): FieldResult {
  const value = clean(typeof input === 'string' ? input : '');
  if (value.length > STATUS_MAX) return { ok: false, error: `At most ${STATUS_MAX} characters.` };
  return { ok: true, value };
}

/**
 * Passwords are length-bounded only: no composition rules, per current guidance (they push users toward
 * predictable patterns), but a floor that rules out trivially guessable secrets and a ceiling that caps
 * the hashing work an attacker can force.
 */
export function validatePassword(input: unknown): FieldResult {
  if (typeof input !== 'string') return { ok: false, error: 'A password is required.' };
  if (input.length < PASSWORD_MIN) return { ok: false, error: `At least ${PASSWORD_MIN} characters.` };
  if (input.length > PASSWORD_MAX) return { ok: false, error: `At most ${PASSWORD_MAX} characters.` };
  return { ok: true, value: input };
}
