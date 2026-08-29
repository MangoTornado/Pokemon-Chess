/**
 * Server entrypoint. Run with `npm run serve` (after `npm run build`).
 *
 * Reads its configuration from the environment so nothing sensitive is baked into the image:
 *   PORT        — port to listen on (default 8080)
 *   DB_PATH     — SQLite file (default ./data/pokemon-chess.db)
 *   STATIC_DIR  — built client directory (default ./dist)
 *   NODE_ENV    — `production` turns on Secure cookies (put an HTTPS proxy in front)
 *
 * One process, one port, one SQLite file: the whole game on a single Oracle Cloud VM.
 */

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { Db } from './db.ts';
import { Accounts } from './accounts.ts';
import { Matches } from './matches.ts';
import { createServer } from './server.ts';
import { loadDexFromDisk } from './gameDex.ts';
import { createValidator } from './gameValidator.ts';

const PORT = Number(process.env.PORT ?? 8080);
const DB_PATH = resolve(process.env.DB_PATH ?? './data/pokemon-chess.db');
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? './dist');
const PRODUCTION = process.env.NODE_ENV === 'production';

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Db(DB_PATH);

// The dex loads from disk so the server can run the pure engine and validate every online move; ranked
// (matchmaking) games settle both ratings when they end. Private games are friendly and unrated.
const dex = loadDexFromDisk();
const accounts = new Accounts(db, () => new Date(), (species) => dex.getSpecies(species)?.evos ?? []);
const matches = new Matches(undefined, undefined, createValidator(dex), (info) => {
  if (info.ranked) accounts.recordHeadToHead(info.whiteId, info.blackId, info.winner);
});

const server = createServer({ accounts, matches, staticDir: STATIC_DIR, secureCookies: PRODUCTION });

server.listen(PORT, () => {
  console.log(`Pokémon Chess server on http://localhost:${PORT}  (db: ${DB_PATH}, static: ${STATIC_DIR})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
