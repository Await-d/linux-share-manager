import { getCookie } from "hono/cookie"
import type { MiddlewareHandler } from "hono/types"
import type { AuthService } from "../auth/service"
import type { AuthenticatedUser } from "../auth/types"
import type { AppConfig } from "../config"

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
      return context.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication is required." } },
        401,
      )
    }

    const session = options.auth.findSession(sessionId)
    if (session === null) {
      return context.json(
        { error: { code: "UNAUTHORIZED", message: "Authentication is required." } },
        401,
      )
    }

    context.set("user", session.user)
    await next()
  }
}
