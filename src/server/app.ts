import { Hono } from "hono"
import { AuthService } from "./auth/service"
import type { AppConfig } from "./config"
import { loadConfig } from "./config"
import type { AppDatabase } from "./db/client"
import { createDatabase } from "./db/client"
import { AppError } from "./errors"
import type { AppEnv } from "./middleware/auth"
import { sameOriginGuard } from "./middleware/security"
import { NodeRepository } from "./nodes/repository"
import { registerAuthRoutes } from "./routes/auth"
import { normalizeError } from "./routes/http"
import { registerNodeRoutes } from "./routes/nodes"

export type CreateAppOptions = {
  readonly config?: AppConfig
  readonly database?: AppDatabase
}

export function createApp(options: CreateAppOptions = {}): Hono<AppEnv> {
  const config = options.config ?? loadConfig()
  const database = options.database ?? createDatabase(config.databasePath)
  const auth = new AuthService({ database, config })
  const nodes = new NodeRepository(database)
  const app = new Hono<AppEnv>()

  app.use("/api/*", sameOriginGuard(config))
  app.get("/api/health", (context) => context.json({ status: "ok", initialized: auth.hasUsers() }))

  registerAuthRoutes({ app, auth, config })
  registerNodeRoutes({ app, auth, config, nodes })

  app.notFound((context) =>
    context.json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404),
  )
  app.onError((error, context) => {
    const normalized = normalizeError(error)
    if (normalized.status === 500 && !(error instanceof AppError)) {
      console.error(error)
    }
    return context.json(
      { error: { code: normalized.code, message: normalized.message } },
      normalized.status,
    )
  })

  return app
}
