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

const PORT = Number(process.env.PORT ?? 8080);
const DB_PATH = resolve(process.env.DB_PATH ?? './data/pokemon-chess.db');
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? './dist');
const PRODUCTION = process.env.NODE_ENV === 'production';

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Db(DB_PATH);
const accounts = new Accounts(db);
const matches = new Matches();
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
