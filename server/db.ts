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
  updated_at: string;
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
    `);
  }

  close(): void {
    this.raw.close();
  }
}
