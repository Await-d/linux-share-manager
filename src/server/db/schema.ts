import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  lastLoginAt: integer("last_login_at", { mode: "timestamp_ms" }),
})

export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const nodes = sqliteTable("nodes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull(),
  username: text("username").notNull(),
  authType: text("auth_type", { enum: ["private_key", "password_session"] }).notNull(),
  credentialKind: text("credential_kind", {
    enum: ["missing", "password_set", "private_key_set"],
  }).notNull(),
  credentialSecret: text("credential_secret"),
  credentialLabel: text("credential_label"),
  role: text("role", { enum: ["source", "target", "both"] }).notNull(),
  osFamily: text("os_family"),
  osVersion: text("os_version"),
  primaryIp: text("primary_ip"),
  lastProbeStatus: text("last_probe_status", {
    enum: ["unknown", "ok", "failed"],
  }).notNull(),
  lastProbeSummary: text("last_probe_summary"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})

export const nodeProbeResults = sqliteTable("node_probe_results", {
  id: text("id").primaryKey(),
  nodeId: text("node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  sshOk: integer("ssh_ok", { mode: "boolean" }).notNull(),
  sudoOk: integer("sudo_ok", { mode: "boolean" }).notNull(),
  systemdOk: integer("systemd_ok", { mode: "boolean" }).notNull(),
  nfsServerInstalled: integer("nfs_server_installed", { mode: "boolean" }).notNull(),
  nfsClientInstalled: integer("nfs_client_installed", { mode: "boolean" }).notNull(),
  firewallType: text("firewall_type"),
  firewallActive: integer("firewall_active", { mode: "boolean" }).notNull(),
  ipAddressesJson: text("ip_addresses_json"),
  diskSummaryJson: text("disk_summary_json"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  rawSummary: text("raw_summary"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const shares = sqliteTable("shares", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sourceNodeId: text("source_node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  sourcePath: text("source_path").notNull(),
  targetNodeId: text("target_node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  targetPath: text("target_path").notNull(),
  accessMode: text("access_mode", { enum: ["read_only", "read_write"] }).notNull(),
  nfsVersion: text("nfs_version").notNull(),
  autoMount: integer("auto_mount", { mode: "boolean" }).notNull(),
  status: text("status", {
    enum: [
      "draft",
      "planned",
      "applying",
      "active",
      "degraded",
      "partial_failed",
      "disabled",
      "unmounted",
      "deleting",
      "deleted",
    ],
  }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})

export const sharePlans = sqliteTable("share_plans", {
  id: text("id").primaryKey(),
  shareId: text("share_id")
    .notNull()
    .references(() => shares.id, { onDelete: "cascade" }),
  version: integer("version").notNull(),
  status: text("status", {
    enum: ["planned", "applying", "applied", "failed", "expired"],
  }).notNull(),
  riskLevel: text("risk_level", { enum: ["low", "medium", "high"] }).notNull(),
  planJson: text("plan_json").notNull(),
  resultsJson: text("results_json"),
  createdBy: text("created_by"),
  confirmedAt: integer("confirmed_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
})

export const commandRuns = sqliteTable("command_runs", {
  id: text("id").primaryKey(),
  planId: text("plan_id").references(() => sharePlans.id, { onDelete: "set null" }),
  shareId: text("share_id").references(() => shares.id, { onDelete: "set null" }),
  nodeId: text("node_id").references(() => nodes.id, { onDelete: "set null" }),
  stepKey: text("step_key").notNull(),
  stepName: text("step_name").notNull(),
  commandPreview: text("command_preview").notNull(),
  status: text("status", {
    enum: ["pending", "running", "succeeded", "failed", "timed_out"],
  }).notNull(),
  stdoutExcerpt: text("stdout_excerpt"),
  stderrExcerpt: text("stderr_excerpt"),
  errorCode: text("error_code"),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const healthChecks = sqliteTable("health_checks", {
  id: text("id").primaryKey(),
  shareId: text("share_id")
    .notNull()
    .references(() => shares.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  sourceOnline: integer("source_online", { mode: "boolean" }).notNull(),
  targetOnline: integer("target_online", { mode: "boolean" }).notNull(),
  nfsServiceOk: integer("nfs_service_ok", { mode: "boolean" }),
  mountpointOk: integer("mountpoint_ok", { mode: "boolean" }),
  readOk: integer("read_ok", { mode: "boolean" }),
  writeOk: integer("write_ok", { mode: "boolean" }),
  latencyMs: integer("latency_ms"),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  summary: text("summary"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})

export const auditLogs = sqliteTable("audit_logs", {
  id: text("id").primaryKey(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  status: text("status").notNull(),
  summary: text("summary"),
  metadataJson: text("metadata_json"),
  ipAddress: text("ip_address"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
})
