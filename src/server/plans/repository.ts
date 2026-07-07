import { and, desc, eq } from "drizzle-orm"
import type { AppDatabase } from "../db/client"
import { sharePlans } from "../db/schema"
import { DatabaseInvariantError } from "../errors"
import { logger } from "../logger"
import type { SharePlan } from "./builder"

export type PlanRecord = {
  readonly id: string
  readonly shareId: string
  readonly version: number
  readonly status: "planned" | "applying" | "applied" | "failed" | "expired"
  readonly riskLevel: "low" | "medium" | "high"
  readonly plan: SharePlan
  readonly results: readonly PlanStepResult[]
  readonly createdBy: string | null
  readonly confirmedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export type PlanStepResult = {
  readonly stepKey: string
  readonly status: "succeeded" | "failed"
  readonly error?: string
}

export class PlanRepository {
  constructor(private readonly database: AppDatabase) {}

  create(plan: SharePlan, createdBy: string | null = null): PlanRecord {
    const now = new Date()
    const created = this.database.db
      .insert(sharePlans)
      .values({
        id: crypto.randomUUID(),
        shareId: plan.shareId,
        version: plan.version,
        status: "planned",
        riskLevel: plan.riskLevel,
        planJson: JSON.stringify(plan),
        resultsJson: JSON.stringify([]),
        createdBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all()

    const row = created.at(0)
    if (row === undefined) {
      throw new DatabaseInvariantError("plan insert returned no row")
    }

    const record = toPlanRecord(row)
    logger.info(
      {
        planId: record.id,
        shareId: record.shareId,
        version: record.version,
        riskLevel: record.riskLevel,
        stepCount: record.plan.steps.length,
      },
      "计划已写入仓库",
    )
    return record
  }

  find(id: string): PlanRecord | null {
    const row = this.database.db
      .select()
      .from(sharePlans)
      .where(eq(sharePlans.id, id))
      .limit(1)
      .all()
      .at(0)
    return row === undefined ? null : toPlanRecord(row)
  }

  findLatestForShare(shareId: string): PlanRecord | null {
    const row = this.database.db
      .select()
      .from(sharePlans)
      .where(eq(sharePlans.shareId, shareId))
      .orderBy(desc(sharePlans.version))
      .limit(1)
      .all()
      .at(0)
    return row === undefined ? null : toPlanRecord(row)
  }

  listForShare(shareId: string): readonly PlanRecord[] {
    return this.database.db
      .select()
      .from(sharePlans)
      .where(eq(sharePlans.shareId, shareId))
      .orderBy(desc(sharePlans.createdAt))
      .all()
      .map(toPlanRecord)
  }

  confirm(id: string): PlanRecord | null {
    const now = new Date()
    const updated = this.database.db
      .update(sharePlans)
      .set({ confirmedAt: now, updatedAt: now })
      .where(and(eq(sharePlans.id, id), eq(sharePlans.status, "planned")))
      .returning()
      .all()
      .at(0)

    if (updated === undefined) {
      logger.warn({ planId: id }, "计划确认失败：计划不存在或状态不是 planned")
      return null
    }
    const record = toPlanRecord(updated)
    logger.info(
      { planId: record.id, shareId: record.shareId, version: record.version },
      "计划已确认",
    )
    return record
  }

  /** Re-confirm a previously failed plan so it can be retried. */
  reconfirm(id: string): PlanRecord | null {
    const now = new Date()
    const updated = this.database.db
      .update(sharePlans)
      .set({ status: "planned", confirmedAt: now, updatedAt: now })
      .where(and(eq(sharePlans.id, id), eq(sharePlans.status, "failed")))
      .returning()
      .all()
      .at(0)

    if (updated === undefined) {
      logger.warn({ planId: id }, "计划重试确认失败：计划不存在或状态不是 failed")
      return null
    }
    const record = toPlanRecord(updated)
    logger.info(
      { planId: record.id, shareId: record.shareId, version: record.version },
      "失败计划已重新确认，准备重试",
    )
    return record
  }

  updateResults(id: string, results: readonly PlanStepResult[]): PlanRecord | null {
    const now = new Date()
    const updated = this.database.db
      .update(sharePlans)
      .set({ resultsJson: JSON.stringify(results), updatedAt: now })
      .where(eq(sharePlans.id, id))
      .returning()
      .all()
      .at(0)

    if (updated === undefined) {
      logger.warn({ planId: id }, "计划结果更新失败：计划不存在")
      return null
    }
    const record = toPlanRecord(updated)
    logger.info(
      {
        planId: record.id,
        shareId: record.shareId,
        resultCount: results.length,
        succeededCount: results.filter((result) => result.status === "succeeded").length,
        failedCount: results.filter((result) => result.status === "failed").length,
        failedStepKeys: results
          .filter((result) => result.status === "failed")
          .map((result) => result.stepKey),
      },
      "计划步骤结果已更新",
    )
    return record
  }

  updateStatus(id: string, status: PlanRecord["status"]): PlanRecord | null {
    const now = new Date()
    const updated = this.database.db
      .update(sharePlans)
      .set({ status, updatedAt: now })
      .where(eq(sharePlans.id, id))
      .returning()
      .all()
      .at(0)

    if (updated === undefined) {
      logger.warn({ planId: id, newStatus: status }, "计划状态更新失败：计划不存在")
      return null
    }
    const record = toPlanRecord(updated)
    logger.info(
      { planId: record.id, shareId: record.shareId, version: record.version, status },
      "计划状态已更新",
    )
    return record
  }
}

type PlanRow = typeof sharePlans.$inferSelect

function toPlanRecord(row: PlanRow): PlanRecord {
  const results = parseResultsJson(row.resultsJson)
  return {
    id: row.id,
    shareId: row.shareId,
    version: row.version,
    status: row.status as PlanRecord["status"],
    riskLevel: row.riskLevel as PlanRecord["riskLevel"],
    plan: JSON.parse(row.planJson) as SharePlan,
    results,
    createdBy: row.createdBy,
    confirmedAt: row.confirmedAt instanceof Date ? row.confirmedAt.toISOString() : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  }
}

function parseResultsJson(value: string | null): readonly PlanStepResult[] {
  if (value === null || value.length === 0) {
    return []
  }
  try {
    const parsed = JSON.parse(value) as unknown
    if (Array.isArray(parsed)) {
      return parsed as PlanStepResult[]
    }
  } catch {
    logger.warn({ raw: value }, "计划结果 JSON 解析失败")
  }
  return []
}
