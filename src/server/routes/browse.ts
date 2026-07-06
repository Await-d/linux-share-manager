import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import { z } from "zod"
import { BrowseQuerySchema } from "../../shared/schemas/browse"
import type { AuthService } from "../auth/service"
import type { AppConfig } from "../config"
import { AppError } from "../errors"
import type { AppEnv } from "../middleware/auth"
import { requireAuth } from "../middleware/auth"
import type { NodeRepository } from "../nodes/repository"
import { browseDirectory } from "../nodes/ssh-client"

type BrowseRouteOptions = {
  readonly app: Hono<AppEnv>
  readonly auth: AuthService
  readonly config: AppConfig
  readonly nodes: NodeRepository
}

const NodeParamSchema = z.object({ id: z.uuid() })

export function registerBrowseRoutes(options: BrowseRouteOptions): void {
  const auth = requireAuth(options)

  options.app.get(
    "/api/nodes/:id/browse",
    auth,
    zValidator("param", NodeParamSchema),
    zValidator("query", BrowseQuerySchema),
    async (context) => {
      const { id } = context.req.valid("param")
      const { path } = context.req.valid("query")

      const credential = options.nodes.findCredential(id)
      if (credential === null) {
        throw new AppError("NODE_NOT_FOUND", "The requested node does not exist.", 404)
      }

      const result = await browseDirectory(
        credential,
        path ?? "/",
        options.config.sshConnectTimeoutMs,
      )
      return context.json(result)
    },
  )
}
