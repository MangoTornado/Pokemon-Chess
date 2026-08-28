/**
 * Loading the dex server-side, from disk.
 *
 * The client's {@link Dex.load} reads the baked bundles with dynamic `import('*.json')`, which Vite serves
 * fine but Node's strip-only runtime rejects without an import attribute. So the server reads the same
 * generated JSON files with `fs` instead and hands them to the same `Dex` — one dex, two loaders. This is
 * what lets the server run the pure engine and validate online moves authoritatively.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Dex } from '../src/data/dex.ts';
import type { AbilityEntry, ItemEntry, LearnsetBundle, MoveEntry, SpeciesEntry } from '../src/data/schema.ts';

const GENERATED_DIR = fileURLToPath(new URL('../src/data/generated/', import.meta.url));

function read<T>(name: string): T {
  return JSON.parse(readFileSync(GENERATED_DIR + name, 'utf8')) as T;
}

let cached: Dex | null = null;

/** The dex, read from the baked bundles on disk and cached for the process's lifetime. */
export function loadDexFromDisk(): Dex {
  if (cached) return cached;
  cached = new Dex({
    species: read<SpeciesEntry[]>('species.json'),
    moves: read<MoveEntry[]>('moves.json'),
    abilities: read<AbilityEntry[]>('abilities.json'),
    items: read<ItemEntry[]>('items.json'),
    learnsets: read<LearnsetBundle>('learnsets.json'),
  });
  return cached;
}
