import { getCookie } from "hono/cookie"
import type { MiddlewareHandler } from "hono/types"
import type { AuthService } from "../auth/service"
import type { AuthenticatedUser } from "../auth/types"
import type { AppConfig } from "../config"
import { logger } from "../logger"

export type AppEnv = {
  readonly Variables: {
    readonly user: AuthenticatedUser
  }
}

type AuthMiddlewareOptions = {
  readonly auth: AuthService
  readonly config: AppConfig
}

export function requireAuth(options: AuthMiddlewareOptions): MiddlewareHandler<AppEnv> {
  return async (context, next) => {
    const sessionId = getCookie(context, options.config.sessionCookieName)
    if (sessionId === undefined) {
      logger.warn({ path: context.req.path }, "auth middleware: no session cookie")
      return context.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication is required." } },
        401,
      )
    }

    const session = options.auth.findSession(sessionId)
    if (session === null) {
      logger.warn(
        { sessionId: sessionId.slice(0, 8), path: context.req.path },
        "auth middleware: invalid/expired session",
      )
      return context.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication is required." } },
        401,
      )
    }

    context.set("user", session.user)
    await next()
  }
}
