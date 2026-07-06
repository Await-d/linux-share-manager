import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import { z } from "zod"
import { CreateNodeRequestSchema, UpdateNodeRequestSchema } from "../../shared/schemas/nodes"
import type { AuthService } from "../auth/service"
import type { AppConfig } from "../config"
import { AppError } from "../errors"
import type { AppEnv } from "../middleware/auth"
import { requireAuth } from "../middleware/auth"
import { testTcpConnection } from "../nodes/connectivity"
import type { NodeRepository } from "../nodes/repository"

type NodeRouteOptions = {
  readonly app: Hono<AppEnv>
  readonly nodes: NodeRepository
  readonly auth: AuthService
  readonly config: AppConfig
}

const NodeParamSchema = z.object({ id: z.uuid() })

export function registerNodeRoutes(options: NodeRouteOptions): void {
  const auth = requireAuth(options)

  options.app.get("/api/nodes", auth, (context) => context.json({ nodes: options.nodes.list() }))

  options.app.get("/api/nodes/:id", auth, zValidator("param", NodeParamSchema), (context) => {
    const { id } = context.req.valid("param")
    const node = options.nodes.find(id)
    if (node === null) {
      throw new AppError("NODE_NOT_FOUND", "The requested node does not exist.", 404)
    }

    return context.json(node)
  })

  options.app.post("/api/nodes", auth, zValidator("json", CreateNodeRequestSchema), (context) => {
    const node = options.nodes.create(context.req.valid("json"))
    return context.json(node, 201)
  })

  options.app.post(
    "/api/nodes/:id/test-connection",
    auth,
    zValidator("param", NodeParamSchema),
    async (context) => {
      const { id } = context.req.valid("param")
      const node = options.nodes.find(id)
      if (node === null) {
        throw new AppError("NODE_NOT_FOUND", "The requested node does not exist.", 404)
      }

      const reachable = await testTcpConnection({
        host: node.host,
        port: node.port,
        timeoutMs: options.config.sshConnectTimeoutMs,
      })
      const tested = options.nodes.updateProbeStatus(id, reachable ? "ok" : "failed")
      if (tested === null) {
        throw new AppError("NODE_NOT_FOUND", "The requested node does not exist.", 404)
      }

      return context.json(tested)
    },
  )

  options.app.patch(
    "/api/nodes/:id",
    auth,
    zValidator("param", NodeParamSchema),
    zValidator("json", UpdateNodeRequestSchema),
    (context) => {
      const { id } = context.req.valid("param")
      const node = options.nodes.update(id, context.req.valid("json"))
      if (node === null) {
        throw new AppError("NODE_NOT_FOUND", "The requested node does not exist.", 404)
      }

      return context.json(node)
    },
  )
}
