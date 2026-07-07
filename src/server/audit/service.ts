import { desc } from "drizzle-orm"
import type { AppDatabase } from "../db/client"
import { auditLogs } from "../db/schema"
import { logger } from "../logger"

export type AuditAction =
  | "node.created"
  | "node.updated"
  | "node.deleted"
  | "node.probed"
  | "node.tested"
  | "share.created"
  | "share.updated"
  | "share.deleted"
  | "share.plan_generated"
  | "share.plan_applied"
  | "share.plan_failed"
  | "share.health_checked"
  | "share.remounted"
  | "share.disabled"
  | "share.enabled"
  | "auth.login"
  | "auth.logout"
  | "auth.init"

export type AuditRecord = {
  readonly id: string
  readonly actor: string
  readonly action: string
  readonly targetType: string | null
  readonly targetId: string | null
  readonly status: string
  readonly summary: string | null
  readonly metadataJson: string | null
  readonly ipAddress: string | null
  readonly createdAt: string
}

export class AuditService {
  constructor(private readonly database: AppDatabase) {}

  log(params: {
    readonly actor: string
    readonly action: AuditAction
    readonly targetType?: string
    readonly targetId?: string
    readonly status?: string
    readonly summary?: string
    readonly metadata?: Record<string, unknown>
    readonly ipAddress?: string
  }): void {
    const now = new Date()
    try {
      this.database.db
        .insert(auditLogs)
        .values({
          id: crypto.randomUUID(),
          actor: params.actor,
          action: params.action,
          targetType: params.targetType ?? null,
          targetId: params.targetId ?? null,
          status: params.status ?? "ok",
          summary: params.summary ?? null,
          metadataJson: params.metadata ? JSON.stringify(params.metadata) : null,
          ipAddress: params.ipAddress ?? null,
          createdAt: now,
        })
        .run()
    } catch (err) {
      logger.error(
        { actor: params.actor, action: params.action, error: String(err) },
        "audit log write failed",
      )
    }
  }

  list(limit: number = 50, offset: number = 0): readonly AuditRecord[] {
    const rows = this.database.db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit)
      .offset(offset)
      .all()

    return rows.map((row) => ({
      id: row.id,
      actor: row.actor,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      status: row.status,
      summary: row.summary,
      metadataJson: row.metadataJson,
      ipAddress: row.ipAddress,
      createdAt:
        row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    }))
  }
}
