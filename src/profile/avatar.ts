/**
 * Trainer character customization — the avatar a player builds for their profile.
 *
 * Modelled on the mainline games' character customization (Gen 6 onward: X/Y through Scarlet/Violet),
 * where a trainer picks skin tone, hair, eyes, and outfit pieces from a fixed set of options. The set
 * here is a faithful, self-contained superset of those slots; it is deliberately a closed enumeration
 * rather than free input, so it is safe to render for strangers on a public profile with no moderation
 * surface and no way to smuggle in arbitrary content.
 *
 * Shared by the client (the customizer UI) and the server (which validates every saved avatar against
 * this same definition), so an avatar that renders is an avatar the server accepted.
 */

/** One customizable slot and the options it admits. */
export interface AvatarSlot {
  readonly key: AvatarSlotKey;
  readonly label: string;
  /** Option ids in display order. The first is the default. */
  readonly options: readonly AvatarOption[];
}

export interface AvatarOption {
  readonly id: string;
  readonly label: string;
  /** A hex colour for colour slots, used to render the swatch and the avatar. */
  readonly color?: string;
}

export type AvatarSlotKey =
  | 'skinTone'
  | 'hairStyle'
  | 'hairColor'
  | 'eyeColor'
  | 'outfit'
  | 'outfitColor'
  | 'hat'
  | 'accessory';

/** The canonical customization options. Extend by adding options, never by renaming ids (they persist). */
export const AVATAR_SLOTS: readonly AvatarSlot[] = [
  {
    key: 'skinTone',
    label: 'Skin tone',
    options: [
      { id: 'pale', label: 'Pale', color: '#f2d3b8' },
      { id: 'light', label: 'Light', color: '#e6b58f' },
      { id: 'medium', label: 'Medium', color: '#c68642' },
      { id: 'tan', label: 'Tan', color: '#a5673f' },
      { id: 'dark', label: 'Dark', color: '#7a4a2b' },
      { id: 'deep', label: 'Deep', color: '#4a2f1c' },
    ],
  },
  {
    key: 'hairStyle',
    label: 'Hair',
    options: [
      { id: 'short', label: 'Short' },
      { id: 'medium', label: 'Medium' },
      { id: 'long', label: 'Long' },
      { id: 'ponytail', label: 'Ponytail' },
      { id: 'buns', label: 'Buns' },
      { id: 'spiky', label: 'Spiky' },
      { id: 'curly', label: 'Curly' },
      { id: 'shaved', label: 'Shaved' },
    ],
  },
  {
    key: 'hairColor',
    label: 'Hair colour',
    options: [
      { id: 'black', label: 'Black', color: '#1c1a1a' },
      { id: 'brown', label: 'Brown', color: '#5a3a22' },
      { id: 'blonde', label: 'Blonde', color: '#e0c068' },
      { id: 'red', label: 'Red', color: '#b3402f' },
      { id: 'blue', label: 'Blue', color: '#3a5ba0' },
      { id: 'green', label: 'Green', color: '#4a8a5a' },
      { id: 'pink', label: 'Pink', color: '#d685ad' },
      { id: 'white', label: 'White', color: '#e8e8e8' },
    ],
  },
  {
    key: 'eyeColor',
    label: 'Eyes',
    options: [
      { id: 'brown', label: 'Brown', color: '#5a3a22' },
      { id: 'blue', label: 'Blue', color: '#3a5ba0' },
      { id: 'green', label: 'Green', color: '#4a8a5a' },
      { id: 'grey', label: 'Grey', color: '#8b949e' },
      { id: 'amber', label: 'Amber', color: '#c8871f' },
      { id: 'violet', label: 'Violet', color: '#7a4fb0' },
    ],
  },
  {
    key: 'outfit',
    label: 'Outfit',
    options: [
      { id: 'tee', label: 'Tee & jeans' },
      { id: 'hoodie', label: 'Hoodie' },
      { id: 'jacket', label: 'Trainer jacket' },
      { id: 'dress', label: 'Dress' },
      { id: 'overalls', label: 'Overalls' },
      { id: 'formal', label: 'Formal' },
      { id: 'sporty', label: 'Sporty' },
    ],
  },
  {
    key: 'outfitColor',
    label: 'Outfit colour',
    options: [
      { id: 'red', label: 'Red', color: '#c0392b' },
      { id: 'blue', label: 'Blue', color: '#2e6bb0' },
      { id: 'green', label: 'Green', color: '#3a9a5a' },
      { id: 'yellow', label: 'Yellow', color: '#e0b020' },
      { id: 'purple', label: 'Purple', color: '#7a4fb0' },
      { id: 'black', label: 'Black', color: '#2b2b30' },
      { id: 'white', label: 'White', color: '#e8e8e8' },
      { id: 'pink', label: 'Pink', color: '#d685ad' },
    ],
  },
  {
    key: 'hat',
    label: 'Hat',
    options: [
      { id: 'none', label: 'None' },
      { id: 'cap', label: 'Cap' },
      { id: 'beanie', label: 'Beanie' },
      { id: 'sunhat', label: 'Sun hat' },
      { id: 'bandana', label: 'Bandana' },
    ],
  },
  {
    key: 'accessory',
    label: 'Accessory',
    options: [
      { id: 'none', label: 'None' },
      { id: 'glasses', label: 'Glasses' },
      { id: 'sunglasses', label: 'Sunglasses' },
      { id: 'bag', label: 'Satchel' },
      { id: 'scarf', label: 'Scarf' },
    ],
  },
];

const SLOT_BY_KEY = new Map(AVATAR_SLOTS.map((s) => [s.key, s]));

/** A saved avatar: one chosen option id per slot. */
export type Avatar = Record<AvatarSlotKey, string>;

/** The default avatar — the first option of every slot. */
export const DEFAULT_AVATAR: Avatar = Object.fromEntries(
  AVATAR_SLOTS.map((s) => [s.key, s.options[0]!.id]),
) as Avatar;

/**
 * Validates and normalises an untrusted avatar into a known-good one.
 *
 * Never throws and never trusts the input: any missing or unrecognised slot falls back to that slot's
 * default, and any extra keys are dropped. So whatever a client (or a tampered request) sends, the
 * result is always a fully-populated avatar drawn entirely from the closed option set — which is what
 * makes it safe to store and to show to other players. Returns a fresh object.
 */
export function normalizeAvatar(input: unknown): Avatar {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const out = {} as Avatar;
  for (const slot of AVATAR_SLOTS) {
    const chosen = source[slot.key];
    const valid = typeof chosen === 'string' && slot.options.some((o) => o.id === chosen);
    out[slot.key] = valid ? (chosen as string) : slot.options[0]!.id;
  }
  return out;
}

/** Whether an avatar is already valid (every slot present and a known option). */
export function isValidAvatar(input: unknown): boolean {
  if (!input || typeof input !== 'object') return false;
  const source = input as Record<string, unknown>;
  return AVATAR_SLOTS.every((slot) => {
    const chosen = source[slot.key];
    return typeof chosen === 'string' && slot.options.some((o) => o.id === chosen);
  });
}

/** The colour of a chosen option in a colour slot, for rendering. */
export function avatarColor(avatar: Avatar, key: AvatarSlotKey): string | undefined {
  const slot = SLOT_BY_KEY.get(key);
  return slot?.options.find((o) => o.id === avatar[key])?.color;
}

/** The human label of a chosen option, for display. */
export function avatarLabel(avatar: Avatar, key: AvatarSlotKey): string {
  const slot = SLOT_BY_KEY.get(key);
  return slot?.options.find((o) => o.id === avatar[key])?.label ?? avatar[key];
}
