import { eq } from "drizzle-orm"
import type {
  CreateShareRequest,
  ShareResponse,
  UpdateShareRequest,
} from "../../shared/schemas/shares"
import type { AppDatabase } from "../db/client"
import { nodes, shares } from "../db/schema"
import { AppError, DatabaseInvariantError } from "../errors"

export class ShareRepository {
  constructor(private readonly database: AppDatabase) {}

  create(input: CreateShareRequest): ShareResponse {
    const source = this.findNode(input.sourceNodeId)
    if (source === null) {
      throw new AppError("SOURCE_NODE_NOT_FOUND", "The source node does not exist.", 404)
    }
    if (!canShareFrom(source.role)) {
      throw new AppError(
        "INVALID_SOURCE_NODE",
        "The source node cannot publish shared directories.",
        422,
      )
    }

    const target = this.findNode(input.targetNodeId)
    if (target === null) {
      throw new AppError("TARGET_NODE_NOT_FOUND", "The target node does not exist.", 404)
    }
    if (!canMountTo(target.role)) {
      throw new AppError(
        "INVALID_TARGET_NODE",
        "The target node cannot mount shared directories.",
        422,
      )
    }

    const now = new Date()
    const created = this.database.db
      .insert(shares)
      .values({
        id: crypto.randomUUID(),
        name: input.name,
        sourceNodeId: input.sourceNodeId,
        sourcePath: input.sourcePath,
        targetNodeId: input.targetNodeId,
        targetPath: input.targetPath,
        accessMode: input.accessMode,
        nfsVersion: input.nfsVersion,
        autoMount: input.autoMount,
        status: "draft",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all()

    const row = created.at(0)
    if (row === undefined) {
      throw new DatabaseInvariantError("share insert returned no row")
    }

    return toShareResponse(row)
  }

  list(): readonly ShareResponse[] {
    return this.database.db.select().from(shares).all().map(toShareResponse)
  }

  find(id: string): ShareResponse | null {
    const row = this.database.db.select().from(shares).where(eq(shares.id, id)).limit(1).all().at(0)
    return row === undefined ? null : toShareResponse(row)
  }

  update(id: string, input: UpdateShareRequest): ShareResponse | null {
    const current = this.database.db
      .select()
      .from(shares)
      .where(eq(shares.id, id))
      .limit(1)
      .all()
      .at(0)
    if (current === undefined) {
      return null
    }

    const values: Partial<typeof shares.$inferInsert> = { updatedAt: new Date() }
    if (input.name !== undefined) {
      values.name = input.name
    }
    if (input.sourcePath !== undefined) {
      values.sourcePath = input.sourcePath
    }
    if (input.targetPath !== undefined) {
      values.targetPath = input.targetPath
    }
    if (input.accessMode !== undefined) {
      values.accessMode = input.accessMode
    }
    if (input.nfsVersion !== undefined) {
      values.nfsVersion = input.nfsVersion
    }
    if (input.autoMount !== undefined) {
      values.autoMount = input.autoMount
    }
    if (input.status !== undefined) {
      values.status = input.status
    }

    const updated = this.database.db
      .update(shares)
      .set(values)
      .where(eq(shares.id, id))
      .returning()
      .all()
    const row = updated.at(0)
    if (row === undefined) {
      throw new DatabaseInvariantError("share update returned no row")
    }

    return toShareResponse(row)
  }

  delete(id: string): boolean {
    const result = this.database.db.delete(shares).where(eq(shares.id, id)).returning().all()
    return result.length > 0
  }

  private findNode(id: string): Pick<NodeRow, "id" | "role"> | null {
    const row = this.database.db
      .select({ id: nodes.id, role: nodes.role })
      .from(nodes)
      .where(eq(nodes.id, id))
      .limit(1)
      .all()
      .at(0)

    return row ?? null
  }
}

type ShareRow = typeof shares.$inferSelect
type NodeRow = typeof nodes.$inferSelect
type NodeRole = NodeRow["role"]

function toShareResponse(row: ShareRow): ShareResponse {
  return {
    id: row.id,
    name: row.name,
    sourceNodeId: row.sourceNodeId,
    sourcePath: row.sourcePath,
    targetNodeId: row.targetNodeId,
    targetPath: row.targetPath,
    accessMode: row.accessMode,
    nfsVersion: row.nfsVersion,
    autoMount: row.autoMount,
    status: row.status,
  }
}

function canShareFrom(role: NodeRole): boolean {
  switch (role) {
    case "source":
    case "both":
      return true
    case "target":
      return false
  }
}

function canMountTo(role: NodeRole): boolean {
  switch (role) {
    case "target":
    case "both":
      return true
    case "source":
      return false
  }
}
