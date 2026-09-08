/**
 * The trainer avatar — a real Pokémon trainer sprite the player chooses as their character.
 *
 * Rather than composite a made-up figure, the avatar is one of the games' own trainer sprites, so a
 * player's character actually looks like a Pokémon character. The roster is the player-protagonists of
 * each generation (the customizable heroes) plus a handful of iconic Champions, drawn from the Pokémon
 * Showdown sprite library. It is a closed allowlist by design: the stored value is just a sprite id, so
 * a profile can only ever show a sprite from this set — safe to render for strangers, with no way to
 * point the avatar at an arbitrary URL.
 *
 * Shared by the client (the picker) and the server (which validates the chosen id against this list).
 */

export interface TrainerOption {
  /** Showdown trainer sprite id, e.g. `red`, `dawn`. */
  readonly id: string;
  readonly label: string;
  /** A grouping for the picker UI. */
  readonly group: 'Kanto' | 'Johto' | 'Hoenn' | 'Sinnoh' | 'Unova' | 'Kalos' | 'Alola' | 'Galar' | 'Champions';
}

/**
 * The selectable trainers. Ids are Showdown sprite ids, verified to resolve. Extend by appending; never
 * rename an id, because ids are stored on profiles.
 */
export const TRAINERS: readonly TrainerOption[] = [
  { id: 'red', label: 'Red', group: 'Kanto' },
  { id: 'blue', label: 'Blue', group: 'Kanto' },
  { id: 'ethan', label: 'Ethan', group: 'Johto' },
  { id: 'lyra', label: 'Lyra', group: 'Johto' },
  { id: 'brendan', label: 'Brendan', group: 'Hoenn' },
  { id: 'may', label: 'May', group: 'Hoenn' },
  { id: 'lucas', label: 'Lucas', group: 'Sinnoh' },
  { id: 'dawn', label: 'Dawn', group: 'Sinnoh' },
  { id: 'hilbert', label: 'Hilbert', group: 'Unova' },
  { id: 'hilda', label: 'Hilda', group: 'Unova' },
  { id: 'nate', label: 'Nate', group: 'Unova' },
  { id: 'rosa', label: 'Rosa', group: 'Unova' },
  { id: 'calem', label: 'Calem', group: 'Kalos' },
  { id: 'serena', label: 'Serena', group: 'Kalos' },
  { id: 'elio', label: 'Elio', group: 'Alola' },
  { id: 'selene', label: 'Selene', group: 'Alola' },
  { id: 'victor', label: 'Victor', group: 'Galar' },
  { id: 'gloria', label: 'Gloria', group: 'Galar' },
  { id: 'cynthia', label: 'Cynthia', group: 'Champions' },
  { id: 'lance', label: 'Lance', group: 'Champions' },
  { id: 'steven', label: 'Steven', group: 'Champions' },
  { id: 'leon', label: 'Leon', group: 'Champions' },
  { id: 'ash', label: 'Ash', group: 'Champions' },
];

const TRAINER_IDS = new Set(TRAINERS.map((t) => t.id));

/**
 * The avatar stored on a profile.
 *
 * An object rather than a bare string so it can grow later (a title, a frame, a shiny toggle) without a
 * schema migration.
 */
export interface Avatar {
  readonly trainer: string;
}

export const DEFAULT_AVATAR: Avatar = { trainer: 'red' };

/** Where a trainer sprite lives. One 80×80 PNG from the Showdown sprite CDN. */
export function trainerSpriteUrl(id: string): string {
  return `https://play.pokemonshowdown.com/sprites/trainers/${id}.png`;
}

/** Whether an avatar is valid — its trainer is one of the allowed ids. */
export function isValidAvatar(input: unknown): boolean {
  return (
    !!input &&
    typeof input === 'object' &&
    typeof (input as { trainer?: unknown }).trainer === 'string' &&
    TRAINER_IDS.has((input as { trainer: string }).trainer)
  );
}

/**
 * Normalises untrusted input to a valid avatar, never trusting the client: an unrecognised trainer falls
 * back to the default, so whatever a request sends, the result always names a sprite from the allowlist.
 */
export function normalizeAvatar(input: unknown): Avatar {
  const trainer = (input as { trainer?: unknown })?.trainer;
  return typeof trainer === 'string' && TRAINER_IDS.has(trainer) ? { trainer } : { ...DEFAULT_AVATAR };
}

/** The display label for a trainer id. */
export function trainerLabel(id: string): string {
  return TRAINERS.find((t) => t.id === id)?.label ?? id;
}
