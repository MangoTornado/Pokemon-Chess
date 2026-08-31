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
import { GymMatches } from './gymMatches.ts';
import { createGymEngine } from './gymEngine.ts';
import { AiPool } from './aiPool.ts';
import { createServer } from './server.ts';
import { loadDexFromDisk } from './gameDex.ts';
import { createEngineOps } from './gameValidator.ts';
import { rollEncounter, satisfiesPity } from '../src/game/encounters.ts';

const PORT = Number(process.env.PORT ?? 8080);
const DB_PATH = resolve(process.env.DB_PATH ?? './data/pokemon-chess.db');
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? './dist');
const PRODUCTION = process.env.NODE_ENV === 'production';

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Db(DB_PATH);

// The dex loads from disk so the server can run the pure engine and validate every online move; ranked
// (matchmaking) games settle both ratings when they end. Private games are friendly and unrated.
const dex = loadDexFromDisk();
const accounts = new Accounts(
  db,
  () => new Date(),
  (species) => dex.getSpecies(species)?.evos ?? [],
  {
    roll: (outcome, seed, pity) => rollEncounter(dex, outcome, seed, pity),
    satisfiesPity: (choices) => satisfiesPity(dex, choices),
  },
);
const matches = new Matches(undefined, undefined, createEngineOps(dex), (info) => {
  if (info.ranked) accounts.recordHeadToHead(info.whiteId, info.blackId, info.winner);
});

// The gym leader is played by the server, so a badge cannot be claimed without a game the server refereed.
//
// The leader's search runs on a worker pool rather than inline. That is not an optimisation: at the deepest gyms
// one reply is seconds of solid CPU, and Node has a single thread, so an inline search would make one Giovanni
// challenger freeze every other request on the site — including other people's sign-ins.
const aiPool = new AiPool();
const gyms = new GymMatches(dex, {
  standing: (accountId) => accounts.standing(accountId),
  record: (accountId, gymId, score) => ({ ok: accounts.recordGymResult(accountId, gymId, score).ok }),
}, { engine: createGymEngine(dex, aiPool.search) });

const server = createServer({ accounts, matches, gyms, staticDir: STATIC_DIR, secureCookies: PRODUCTION });

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
