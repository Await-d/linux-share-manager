import { eq } from "drizzle-orm"
import type { CreateNodeRequest, NodeResponse } from "../../shared/schemas/nodes"
import type { AppDatabase } from "../db/client"
import { nodes } from "../db/schema"
import { DatabaseInvariantError } from "../errors"

export class NodeRepository {
  constructor(private readonly database: AppDatabase) {}

  create(input: CreateNodeRequest): NodeResponse {
    const now = new Date()
    const created = this.database.db
      .insert(nodes)
      .values({
        id: crypto.randomUUID(),
        name: input.name,
        host: input.host,
        port: input.port,
        username: input.username,
        authType: input.authType,
        role: input.role,
        lastProbeStatus: "unknown",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all()

    const row = created.at(0)
    if (row === undefined) {
      throw new DatabaseInvariantError("node insert returned no row")
    }

    return toNodeResponse(row)
  }

  list(): readonly NodeResponse[] {
    return this.database.db.select().from(nodes).all().map(toNodeResponse)
  }

  find(id: string): NodeResponse | null {
    const row = this.database.db.select().from(nodes).where(eq(nodes.id, id)).limit(1).all().at(0)
    return row === undefined ? null : toNodeResponse(row)
  }
}

type NodeRow = typeof nodes.$inferSelect

function toNodeResponse(row: NodeRow): NodeResponse {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.authType,
    role: row.role,
    osFamily: row.osFamily,
    primaryIp: row.primaryIp,
    lastProbeStatus: row.lastProbeStatus,
  }
}
