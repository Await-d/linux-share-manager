import type { Database } from "bun:sqlite"

export function migrateDatabase(sqlite: Database): void {
  sqlite.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_login_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL,
      role TEXT NOT NULL,
      os_family TEXT,
      primary_ip TEXT,
      last_probe_status TEXT NOT NULL DEFAULT 'unknown',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      source_path TEXT NOT NULL,
      target_node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      target_path TEXT NOT NULL,
      access_mode TEXT NOT NULL,
      nfs_version TEXT NOT NULL,
      auto_mount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)

  addNodeColumnIfMissing(sqlite, "credential_kind", "TEXT NOT NULL DEFAULT 'missing'")
  addNodeColumnIfMissing(sqlite, "credential_secret", "TEXT")
  addNodeColumnIfMissing(sqlite, "credential_label", "TEXT")
}

type TableColumnRow = {
  readonly name: string
}

function addNodeColumnIfMissing(sqlite: Database, name: string, definition: string): void {
  const columns = sqlite.query<TableColumnRow, []>("PRAGMA table_info(nodes)").all()
  if (columns.some((column) => column.name === name)) {
    return
  }

  sqlite.exec(`ALTER TABLE nodes ADD COLUMN ${name} ${definition}`)
}
