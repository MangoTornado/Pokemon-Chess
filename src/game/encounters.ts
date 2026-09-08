/**
 * Post-match encounters — the way a collection grows.
 *
 * After a game you meet a few wild Pokémon and keep one. What you are offered depends on how the game went,
 * which is the point: winning should feel like it paid.
 *
 *   | Outcome | Choices | Odds                                             |
 *   |---------|---------|--------------------------------------------------|
 *   | win     | 4       | shifted toward rare, with a real legendary chance |
 *   | draw    | 3       | neutral                                          |
 *   | loss    | 2       | shifted toward common — but never nothing         |
 *
 * A loser still gets an encounter, deliberately. A collection loop that pays only winners punishes the people
 * who most need a better team, and the fix for a losing streak should be *more* Pokémon to try, not fewer.
 *
 * A **pity counter** guarantees the long tail stays reachable: after enough encounters with nothing rare or
 * better, the next one is forced to include something rare, so an unlucky run cannot stall a Pokédex forever
 * (SPEC §17.8 asks for exactly this).
 *
 * Pure and seeded, so the server can roll an encounter reproducibly and a test can pin the distribution.
 */

import type { Dex } from '../data/dex.ts';
import type { SpeciesEntry } from '../data/schema.ts';
import { Rng } from '../engine/rng.ts';
import { RARITIES, isCollectable, rarityOf } from './rarity.ts';
import type { Rarity } from './rarity.ts';

export type MatchOutcome = 'win' | 'draw' | 'loss';

/** How many Pokémon each outcome offers. */
export const CHOICE_COUNT: Readonly<Record<MatchOutcome, number>> = { win: 4, draw: 3, loss: 2 };

/**
 * Relative weight per rarity band, by outcome.
 *
 * Deliberately gentle: a win roughly doubles the chance of something rare and opens a small legendary
 * window, rather than making wins the only way to progress. A loss still reaches `rare` occasionally, so a
 * losing streak is slow progress rather than none.
 */
const WEIGHTS: Readonly<Record<MatchOutcome, Readonly<Record<Rarity, number>>>> = {
  win:  { common: 40, uncommon: 32, rare: 20, legendary: 7, mythical: 1 },
  draw: { common: 55, uncommon: 30, rare: 13, legendary: 2, mythical: 0 },
  loss: { common: 70, uncommon: 24, rare: 6, legendary: 0, mythical: 0 },
};

/** Encounters without a rare-or-better before the next one is guaranteed to hold one. */
export const PITY_THRESHOLD = 8;

/** Bands that count as "rare or better" for the pity counter. */
const PITY_SATISFYING: readonly Rarity[] = ['rare', 'legendary', 'mythical'];

export interface Encounter {
  readonly outcome: MatchOutcome;
  /** The species offered, as ids — the client resolves names and sprites from the dex. */
  readonly choices: readonly string[];
  /** True when the pity counter forced a rare into this encounter, so the UI can say so. */
  readonly pity: boolean;
}

/** Species grouped by rarity, built once per dex because it scans all 1025 base formes. */
let poolCache: { dex: Dex; pools: Record<Rarity, SpeciesEntry[]> } | null = null;

function poolsFor(dex: Dex): Record<Rarity, SpeciesEntry[]> {
  if (poolCache?.dex === dex) return poolCache.pools;
  const pools = { common: [], uncommon: [], rare: [], legendary: [], mythical: [] } as Record<Rarity, SpeciesEntry[]>;
  for (const species of dex.baseFormes) {
    if (!isCollectable(species)) continue;
    pools[rarityOf(species)].push(species);
  }
  poolCache = { dex, pools };
  return pools;
}

/** Picks a rarity band by the outcome's weights, skipping bands with no species available. */
function pickBand(rng: Rng, outcome: MatchOutcome, pools: Record<Rarity, SpeciesEntry[]>): Rarity {
  const weights = WEIGHTS[outcome];
  const available = RARITIES.filter((r) => pools[r].length > 0 && weights[r] > 0);
  const total = available.reduce((sum, r) => sum + weights[r], 0);
  if (total === 0) return 'common';
  let roll = rng.below(total);
  for (const band of available) {
    roll -= weights[band];
    if (roll < 0) return band;
  }
  return available[available.length - 1]!;
}

/**
 * Rolls an encounter.
 *
 * `pityCount` is how many encounters the account has had without anything rare or better; at the threshold
 * one rare slot is guaranteed. The roll is seeded so the server can reproduce it.
 */
export function rollEncounter(
  dex: Dex,
  outcome: MatchOutcome,
  seed: string,
  pityCount = 0,
): Encounter {
  const pools = poolsFor(dex);
  const rng = new Rng(`encounter:${seed}`);
  const count = CHOICE_COUNT[outcome];
  const chosen: SpeciesEntry[] = [];
  const taken = new Set<string>();

  const takeFrom = (band: Rarity): void => {
    const pool = pools[band];
    if (pool.length === 0) return;
    // A few attempts to avoid a duplicate within one encounter, then accept whatever comes.
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = rng.pick(pool);
      if (!taken.has(candidate.id)) {
        taken.add(candidate.id);
        chosen.push(candidate);
        return;
      }
    }
  };

  // The pity slot first, so it is never crowded out by the ordinary rolls.
  const pity = pityCount >= PITY_THRESHOLD;
  if (pity) takeFrom('rare');

  while (chosen.length < count) {
    const before = chosen.length;
    takeFrom(pickBand(rng, outcome, pools));
    // Guard against a pathological pool that cannot yield anything new.
    if (chosen.length === before) break;
  }

  return { outcome, choices: chosen.map((s) => s.id), pity };
}

/** Whether an encounter's offer resets the pity counter (it held something rare or better). */
export function satisfiesPity(dex: Dex, choices: readonly string[]): boolean {
  return choices.some((id) => {
    const species = dex.getSpecies(id);
    return species !== undefined && PITY_SATISFYING.includes(rarityOf(species));
  });
}
