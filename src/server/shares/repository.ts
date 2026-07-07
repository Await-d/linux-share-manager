import { eq } from "drizzle-orm"
import type {
  CreateShareRequest,
  ShareResponse,
  UpdateShareRequest,
} from "../../shared/schemas/shares"
import type { AppDatabase } from "../db/client"
import { nodes, shares } from "../db/schema"
import { AppError, DatabaseInvariantError } from "../errors"
import { logger } from "../logger"

export class ShareRepository {
  constructor(private readonly database: AppDatabase) {}

  create(input: CreateShareRequest): ShareResponse {
    const source = this.findNode(input.sourceNodeId)
    if (source === null) {
      logger.warn({ sourceNodeId: input.sourceNodeId }, "共享创建失败：源节点不存在")
      throw new AppError("SOURCE_NODE_NOT_FOUND", "The source node does not exist.", 404)
    }
    if (!canShareFrom(source.role)) {
      logger.warn(
        { sourceNodeId: input.sourceNodeId, role: source.role },
        "共享创建失败：源节点角色不能发布共享",
      )
      throw new AppError(
        "INVALID_SOURCE_NODE",
        "The source node cannot publish shared directories.",
        422,
      )
    }

    const target = this.findNode(input.targetNodeId)
    if (target === null) {
      logger.warn({ targetNodeId: input.targetNodeId }, "共享创建失败：目标节点不存在")
      throw new AppError("TARGET_NODE_NOT_FOUND", "The target node does not exist.", 404)
    }
    if (!canMountTo(target.role)) {
      logger.warn(
        { targetNodeId: input.targetNodeId, role: target.role },
        "共享创建失败：目标节点角色不能挂载共享",
      )
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

    const share = toShareResponse(row)
    logger.info(
      {
        shareId: share.id,
        shareName: share.name,
        sourceNodeId: share.sourceNodeId,
        sourcePath: share.sourcePath,
        targetNodeId: share.targetNodeId,
        targetPath: share.targetPath,
        accessMode: share.accessMode,
        nfsVersion: share.nfsVersion,
        autoMount: share.autoMount,
        status: share.status,
      },
      "共享已写入仓库",
    )
    return share
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

    const share = toShareResponse(row)
    logger.info(
      {
        shareId: share.id,
        shareName: share.name,
        status: share.status,
        updatedFields: Object.keys(input),
      },
      "共享已更新到仓库",
    )
    return share
  }

  delete(id: string): boolean {
    const result = this.database.db.delete(shares).where(eq(shares.id, id)).returning().all()
    const deleted = result.length > 0
    if (deleted) {
      logger.info({ shareId: id }, "共享已从仓库删除")
    }
    return deleted
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
