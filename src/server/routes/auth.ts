import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import { deleteCookie, getCookie, setCookie } from "hono/cookie"
import { InitAdminRequestSchema, LoginRequestSchema } from "../../shared/schemas/auth"
import type { AuthService } from "../auth/service"
import type { AppConfig } from "../config"
import type { AppEnv } from "../middleware/auth"
import { requireAuth } from "../middleware/auth"
import { errorPayload } from "./http"

type AuthRouteOptions = {
  readonly app: Hono<AppEnv>
  readonly auth: AuthService
  readonly config: AppConfig
}

export function registerAuthRoutes(options: AuthRouteOptions): void {
  options.app.get("/api/auth/status", (context) =>
    context.json({ initialized: options.auth.hasUsers() }),
  )

  options.app.post(
    "/api/auth/init",
    zValidator("json", InitAdminRequestSchema),
    async (context) => {
      const body = context.req.valid("json")
      const session = await options.auth.initializeAdmin(body.username, body.password)
      setSessionCookie({
        config: options.config,
        context,
        sessionId: session.id,
        expiresAt: session.expiresAt,
      })

      return context.json({ user: session.user }, 201)
    },
  )

  options.app.post("/api/auth/login", zValidator("json", LoginRequestSchema), async (context) => {
    const body = context.req.valid("json")
    const session = await options.auth.login(body.username, body.password)
    setSessionCookie({
      config: options.config,
      context,
      sessionId: session.id,
      expiresAt: session.expiresAt,
    })

    return context.json({ user: session.user })
  })

  options.app.post("/api/auth/logout", requireAuth(options), (context) => {
    const sessionId = getCookie(context, options.config.sessionCookieName)
    if (sessionId !== undefined) {
      options.auth.logout(sessionId)
    }
    deleteCookie(context, options.config.sessionCookieName, { path: "/" })
    return context.json({ ok: true })
  })

  options.app.get("/api/auth/me", requireAuth(options), (context) => {
    const user = context.get("user")
    if (user === undefined) {
      return context.json(errorPayload("UNAUTHORIZED", "Authentication is required."), 401)
    }
    return context.json({ user })
  })
}

type SessionCookieOptions = {
  readonly config: AppConfig
  readonly context: Parameters<typeof setCookie>[0]
  readonly sessionId: string
  readonly expiresAt: Date
}

function setSessionCookie(options: SessionCookieOptions): void {
  setCookie(options.context, options.config.sessionCookieName, options.sessionId, {
    httpOnly: true,
    sameSite: "Lax",
    secure: options.config.secureCookie,
    path: "/",
    expires: options.expiresAt,
  })
}
