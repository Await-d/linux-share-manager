import type { Hono } from "hono"
import { serveStatic } from "hono/bun"
import type { AppEnv } from "./middleware/auth"

type StaticRouteOptions = {
  readonly app: Hono<AppEnv>
  readonly staticRoot: string
}

export function registerStaticRoutes(options: StaticRouteOptions): void {
  const assetHandler = serveStatic({ root: options.staticRoot })
  const indexHandler = serveStatic({ root: options.staticRoot, path: "index.html" })

  options.app.get("/assets/*", assetHandler)
  options.app.get("*", async (context, next) => {
    if (context.req.path.startsWith("/api/")) {
      await next()
      return
    }

    return indexHandler(context, next)
  })
}
