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
      os_version TEXT,
      primary_ip TEXT,
      last_probe_status TEXT NOT NULL DEFAULT 'unknown',
      last_probe_summary TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS node_probe_results (
      id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      ssh_ok INTEGER NOT NULL,
      sudo_ok INTEGER NOT NULL,
      systemd_ok INTEGER NOT NULL,
      nfs_server_installed INTEGER NOT NULL,
      nfs_client_installed INTEGER NOT NULL,
      firewall_type TEXT,
      firewall_active INTEGER NOT NULL,
      ip_addresses_json TEXT,
      disk_summary_json TEXT,
      error_code TEXT,
      error_message TEXT,
      raw_summary TEXT,
      created_at INTEGER NOT NULL
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

    CREATE TABLE IF NOT EXISTS share_plans (
      id TEXT PRIMARY KEY,
      share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
      version INTEGER NOT NULL,
      status TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      plan_json TEXT NOT NULL,
      created_by TEXT,
      confirmed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS command_runs (
      id TEXT PRIMARY KEY,
      plan_id TEXT REFERENCES share_plans(id) ON DELETE SET NULL,
      share_id TEXT REFERENCES shares(id) ON DELETE SET NULL,
      node_id TEXT REFERENCES nodes(id) ON DELETE SET NULL,
      step_key TEXT NOT NULL,
      step_name TEXT NOT NULL,
      command_preview TEXT NOT NULL,
      status TEXT NOT NULL,
      stdout_excerpt TEXT,
      stderr_excerpt TEXT,
      error_code TEXT,
      started_at INTEGER,
      finished_at INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS health_checks (
      id TEXT PRIMARY KEY,
      share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      source_online INTEGER NOT NULL,
      target_online INTEGER NOT NULL,
      nfs_service_ok INTEGER,
      mountpoint_ok INTEGER,
      read_ok INTEGER,
      write_ok INTEGER,
      latency_ms INTEGER,
      error_code TEXT,
      error_message TEXT,
      summary TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      status TEXT NOT NULL,
      summary TEXT,
      metadata_json TEXT,
      ip_address TEXT,
      created_at INTEGER NOT NULL
    );
  `)

  addNodeColumnIfMissing(sqlite, "credential_kind", "TEXT NOT NULL DEFAULT 'missing'")
  addNodeColumnIfMissing(sqlite, "credential_secret", "TEXT")
  addNodeColumnIfMissing(sqlite, "credential_label", "TEXT")
  addNodeColumnIfMissing(sqlite, "os_version", "TEXT")
  addNodeColumnIfMissing(sqlite, "last_probe_summary", "TEXT")
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
