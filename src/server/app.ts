import { Hono } from "hono"
import { getAppVersionInfo } from "../shared/version"
import { AuditService } from "./audit/service"
import { AuthService } from "./auth/service"
import type { AppConfig } from "./config"
import { loadConfig } from "./config"
import type { AppDatabase } from "./db/client"
import { createDatabase } from "./db/client"
import { AppError } from "./errors"
import { HealthService } from "./health/service"
import { logger } from "./logger"
import type { AppEnv } from "./middleware/auth"
import { sameOriginGuard } from "./middleware/security"
import { NodeRepository } from "./nodes/repository"
import { PlanRepository } from "./plans/repository"
import { registerAuthRoutes } from "./routes/auth"
import { registerBrowseRoutes } from "./routes/browse"
import { normalizeError } from "./routes/http"
import { registerInterconnectRoutes } from "./routes/interconnect"
import { registerNodeRoutes } from "./routes/nodes"
import { registerShareRoutes } from "./routes/shares"
import { ShareRepository } from "./shares/repository"
import { registerStaticRoutes } from "./static"

export type CreateAppOptions = {
  readonly config?: AppConfig
  readonly database?: AppDatabase
}

export function createApp(options: CreateAppOptions = {}): Hono<AppEnv> {
  const config = options.config ?? loadConfig()
  const database = options.database ?? createDatabase(config.databasePath)
  const auth = new AuthService({ database, config })
  const nodes = new NodeRepository(database, config.secretKey)
  const shares = new ShareRepository(database)
  const plans = new PlanRepository(database)
  const health = new HealthService(database)
  const audit = new AuditService(database)
  const app = new Hono<AppEnv>()

  app.use("/api/*", sameOriginGuard(config))
  app.get("/api/health", (context) =>
    context.json({ status: "ok", initialized: auth.hasUsers(), version: getAppVersionInfo() }),
  )

  registerAuthRoutes({ app, auth, config })
  registerNodeRoutes({ app, auth, config, nodes })
  registerShareRoutes({ app, auth, config, shares, nodes, plans, health, audit })
  registerBrowseRoutes({ app, auth, config, nodes })
  registerInterconnectRoutes({ app, auth, config, nodes })
  registerStaticRoutes({ app, staticRoot: config.staticRoot })

  app.notFound((context) =>
    context.json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404),
  )
  app.onError((error, context) => {
    const normalized = normalizeError(error)
    if (normalized.status === 500) {
      if (error instanceof AppError) {
        logger.error(
          { code: normalized.code, message: normalized.message, path: context.req.path },
          "app error (500)",
        )
      } else {
        logger.error({ err: error, path: context.req.path }, "unhandled exception (500)")
      }
    }
    return context.json(
      { error: { code: normalized.code, message: normalized.message } },
      normalized.status,
    )
  })

  return app
}
