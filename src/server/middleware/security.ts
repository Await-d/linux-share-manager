import type { MiddlewareHandler } from "hono/types"
import type { AppConfig } from "../config"

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

/**
 * Normalize an origin URL string so that loopback addresses are treated as
 * equivalent.  `http://localhost:5173` and `http://127.0.0.1:5173` resolve to
 * the same canonical form, preventing spurious CSRF rejections in development
 * where the browser and Vite proxy may use different hostnames.
 */
function normalizeOrigin(origin: string): string {
  return origin.replace("://127.0.0.1", "://localhost")
}

/**
 * Vite dev server uses port 5173 by default but auto-increments to 5174, 5175…
 * when the port is already in use.  In development mode (non-production
 * `webOrigin` on a loopback address) we accept any loopback origin whose port
 * falls within the Vite range, so the developer never has to configure
 * `LSM_WEB_ORIGIN` manually.
 */
const VITE_PORT_RANGE = new Set([5173, 5174, 5175, 5176])

function isLoopbackDevOrigin(normalized: string): boolean {
  try {
    const url = new URL(normalized)
    return (
      url.hostname === "localhost" &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      VITE_PORT_RANGE.has(url.port ? Number.parseInt(url.port, 10) : 0)
    )
  } catch {
    return false
  }
}

export function sameOriginGuard(config: AppConfig): MiddlewareHandler {
  return async (context, next) => {
    if (!MUTATING_METHODS.has(context.req.method)) {
      await next()
      return
    }

    const origin = context.req.header("origin")
    if (origin === undefined) {
      await next()
      return
    }

    // Build the served origin from the request, respecting proxy headers when configured
    const protocol = config.trustProxy
      ? (context.req.header("x-forwarded-proto") ??
        new URL(context.req.url).protocol.replace(":", ""))
      : new URL(context.req.url).protocol.replace(":", "")
    const host = config.trustProxy
      ? (context.req.header("x-forwarded-host") ??
        context.req.header("host") ??
        new URL(context.req.url).host)
      : (context.req.header("host") ?? new URL(context.req.url).host)
    const servedOrigin = `${protocol}://${host}`

    const normalizedOrigin = normalizeOrigin(origin)
    const normalizedWeb = normalizeOrigin(config.webOrigin)
    const normalizedServed = normalizeOrigin(servedOrigin)

    const isTrusted =
      normalizedOrigin === normalizedWeb ||
      normalizedOrigin === normalizedServed ||
      isLoopbackDevOrigin(normalizedOrigin)

    if (!isTrusted) {
      return context.json(
        { error: { code: "ORIGIN_FORBIDDEN", message: "Request origin is not trusted." } },
        403,
      )
    }

    await next()
  }
}
