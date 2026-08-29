/**
 * The database — SQLite via Node's built-in `node:sqlite`, so the server has zero native dependencies
 * and deploys to any Node 24 host (an Oracle Cloud Always-Free ARM VM, in particular) with no
 * compilation step. A single file on disk holds everything; backing it up is copying that file.
 *
 * The schema is created idempotently on open, so first boot needs no migration tool. If the schema ever
 * changes shape, add a versioned migration keyed on `PRAGMA user_version`.
 */

import { DatabaseSync } from 'node:sqlite';

export interface AccountRow {
  id: number;
  username: string;
  username_lower: string;
  password_hash: string;
  created_at: string;
}

export interface ProfileRow {
  account_id: number;
  display_name: string;
  bio: string;
  status: string;
  avatar: string; // JSON
  badge: string | null;
  rating: number;
  /** Rated games played, for the provisional K-factor. */
  games: number;
  /** JSON array of earned gym badge ids — the badge case (SPEC §17.8). */
  badges: string; // JSON
  /** ISO timestamp of the account's last authenticated request, or null if never. */
  last_seen: string | null;
  updated_at: string;
}

export interface TradeRow {
  id: number;
  from_account: number;
  to_account: number;
  offer: string; // JSON number[]
  request: string; // JSON number[]
  status: string;
  created_at: string;
}

/** A thin typed wrapper over the connection. Synchronous, which node:sqlite is by design. */
export class Db {
  readonly raw: DatabaseSync;

  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    // WAL keeps reads and writes from blocking each other; foreign keys must be enabled per-connection.
    this.raw.exec('PRAGMA journal_mode = WAL');
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.migrate();
  }

  private migrate(): void {
    this.raw.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL,
        username_lower TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profiles (
        account_id  INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        display_name TEXT NOT NULL,
        bio         TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT '',
        avatar      TEXT NOT NULL,
        badge       TEXT,
        rating      INTEGER NOT NULL DEFAULT 1500,
        games       INTEGER NOT NULL DEFAULT 0,
        badges      TEXT NOT NULL DEFAULT '[]',
        updated_at  TEXT NOT NULL
      );

      -- The collection / Pokédex: one row per owned individual, so duplicates are first-class and a
      -- trade or an evolution moves a row rather than a count. Distinct species is a GROUP BY.
      CREATE TABLE IF NOT EXISTS collection (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        species_id  TEXT NOT NULL,
        declared_type TEXT,
        nickname    TEXT,
        xp          INTEGER NOT NULL DEFAULT 0,
        acquired_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_collection_account ON collection(account_id);

      CREATE TABLE IF NOT EXISTS sessions (
        token       TEXT PRIMARY KEY,
        account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at  TEXT NOT NULL,
        expires_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);

      -- Player-to-player trades. offer/request are JSON arrays of collection row ids; on accept the rows
      -- change owner. Collection has no competitive weight, so a trade is a completionist exchange, but
      -- ownership is still validated at accept time so nothing is duplicated or stolen.
      CREATE TABLE IF NOT EXISTS trades (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        from_account INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        to_account   INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        offer        TEXT NOT NULL,
        request      TEXT NOT NULL,
        status       TEXT NOT NULL DEFAULT 'pending',
        created_at   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_trades_to ON trades(to_account, status);
      CREATE INDEX IF NOT EXISTS idx_trades_from ON trades(from_account, status);

      -- Friendships. One row per direction-agnostic pair, stored with the requester first so a pending
      -- request knows who asked. status: pending | accepted | blocked.
      CREATE TABLE IF NOT EXISTS friendships (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        requester    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        addressee    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        status       TEXT NOT NULL DEFAULT 'pending',
        created_at   TEXT NOT NULL,
        UNIQUE(requester, addressee)
      );
      CREATE INDEX IF NOT EXISTS idx_friend_req ON friendships(requester, status);
      CREATE INDEX IF NOT EXISTS idx_friend_addr ON friendships(addressee, status);
    `);

    // Columns added after the first schema shipped: `CREATE TABLE IF NOT EXISTS` will not add them to an
    // existing database, so add them here if absent. Cheap and idempotent on every boot.
    this.addColumnIfMissing('profiles', 'games', 'INTEGER NOT NULL DEFAULT 0');
    this.addColumnIfMissing('profiles', 'badges', "TEXT NOT NULL DEFAULT '[]'");
    // Training progress toward evolution, per owned individual (SPEC §17.8 "evolving through play").
    this.addColumnIfMissing('collection', 'xp', 'INTEGER NOT NULL DEFAULT 0');
    // Presence: when this account was last seen, so a friend list can show who is around.
    this.addColumnIfMissing('profiles', 'last_seen', 'TEXT');
  }

  /** Adds a column to a table if it is not already present. */
  private addColumnIfMissing(table: string, column: string, definition: string): void {
    const cols = this.raw.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) {
      this.raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  close(): void {
    this.raw.close();
  }
}
