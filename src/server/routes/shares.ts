import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import { z } from "zod"
import { CreateShareRequestSchema, UpdateShareRequestSchema } from "../../shared/schemas/shares"
import type { AuthService } from "../auth/service"
import type { AppConfig } from "../config"
import { AppError } from "../errors"
import type { AppEnv } from "../middleware/auth"
import { requireAuth } from "../middleware/auth"
import type { ShareRepository } from "../shares/repository"

type ShareRouteOptions = {
  readonly app: Hono<AppEnv>
  readonly shares: ShareRepository
  readonly auth: AuthService
  readonly config: AppConfig
}

const ShareParamSchema = z.object({ id: z.uuid() })

export function registerShareRoutes(options: ShareRouteOptions): void {
  const auth = requireAuth(options)

  options.app.get("/api/shares", auth, (context) => context.json({ shares: options.shares.list() }))

  options.app.get("/api/shares/:id", auth, zValidator("param", ShareParamSchema), (context) => {
    const { id } = context.req.valid("param")
    const share = options.shares.find(id)
    if (share === null) {
      throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
    }

    return context.json(share)
  })

  options.app.post("/api/shares", auth, zValidator("json", CreateShareRequestSchema), (context) => {
    const share = options.shares.create(context.req.valid("json"))
    return context.json(share, 201)
  })

  options.app.patch(
    "/api/shares/:id",
    auth,
    zValidator("param", ShareParamSchema),
    zValidator("json", UpdateShareRequestSchema),
    (context) => {
      const { id } = context.req.valid("param")
      const share = options.shares.update(id, context.req.valid("json"))
      if (share === null) {
        throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
      }

      return context.json(share)
    },
  )

  options.app.delete("/api/shares/:id", auth, zValidator("param", ShareParamSchema), (context) => {
    const { id } = context.req.valid("param")
    const deleted = options.shares.delete(id)
    if (!deleted) {
      throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
    }

    return context.body(null, 204)
  })
}
