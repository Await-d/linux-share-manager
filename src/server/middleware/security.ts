import type { MiddlewareHandler } from "hono/types"
import type { AppConfig } from "../config"

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

export function sameOriginGuard(config: AppConfig): MiddlewareHandler {
  return async (context, next) => {
    if (!MUTATING_METHODS.has(context.req.method)) {
      await next()
      return
    }

    const origin = context.req.header("origin")
    if (origin !== undefined && origin !== config.webOrigin) {
      return context.json(
        { error: { code: "ORIGIN_FORBIDDEN", message: "Request origin is not trusted." } },
        403,
      )
    }

    await next()
  }
}
