import { and, desc, eq } from "drizzle-orm"
import type { AppDatabase } from "../db/client"
import { sharePlans } from "../db/schema"
import { DatabaseInvariantError } from "../errors"
import type { SharePlan } from "./builder"

export type PlanRecord = {
  readonly id: string
  readonly shareId: string
  readonly version: number
  readonly status: "planned" | "applying" | "applied" | "failed" | "expired"
  readonly riskLevel: "low" | "medium" | "high"
  readonly plan: SharePlan
  readonly createdBy: string | null
  readonly confirmedAt: string | null
  readonly createdAt: string
  readonly updatedAt: string
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

    return toPlanRecord(row)
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

    return updated === undefined ? null : toPlanRecord(updated)
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

    return updated === undefined ? null : toPlanRecord(updated)
  }
}

type PlanRow = typeof sharePlans.$inferSelect

function toPlanRecord(row: PlanRow): PlanRecord {
  return {
    id: row.id,
    shareId: row.shareId,
    version: row.version,
    status: row.status as PlanRecord["status"],
    riskLevel: row.riskLevel as PlanRecord["riskLevel"],
    plan: JSON.parse(row.planJson) as SharePlan,
    createdBy: row.createdBy,
    confirmedAt: row.confirmedAt instanceof Date ? row.confirmedAt.toISOString() : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  }
}
