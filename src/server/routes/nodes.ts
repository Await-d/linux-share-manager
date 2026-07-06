import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import { CreateNodeRequestSchema } from "../../shared/schemas/nodes"
import type { AuthService } from "../auth/service"
import type { AppConfig } from "../config"
import type { AppEnv } from "../middleware/auth"
import { requireAuth } from "../middleware/auth"
import type { NodeRepository } from "../nodes/repository"

type NodeRouteOptions = {
  readonly app: Hono<AppEnv>
  readonly nodes: NodeRepository
  readonly auth: AuthService
  readonly config: AppConfig
}

export function registerNodeRoutes(options: NodeRouteOptions): void {
  const auth = requireAuth(options)

  options.app.get("/api/nodes", auth, (context) => context.json({ nodes: options.nodes.list() }))

  options.app.post("/api/nodes", auth, zValidator("json", CreateNodeRequestSchema), (context) => {
    const node = options.nodes.create(context.req.valid("json"))
    return context.json(node, 201)
  })
}
