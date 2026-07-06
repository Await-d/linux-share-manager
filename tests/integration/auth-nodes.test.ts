import { afterEach, describe, expect, it } from "bun:test"
import { createApp } from "../../src/server/app"
import type { AppConfig } from "../../src/server/config"
import { createTestDatabase } from "../../src/server/db/testing"

const databases: Array<{ readonly close: () => void }> = []

function rememberDatabase<T extends { readonly close: () => void }>(database: T): T {
  databases.push(database)
  return database
}

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close()
  }
})

function sessionCookie(response: Response): string {
  const cookie = response.headers.get("set-cookie")
  if (cookie === null) {
    throw new Error("expected a session cookie")
  }
  return cookie.split(";")[0] ?? ""
}

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: "127.0.0.1",
    port: 8080,
    databasePath: ":memory:",
    sessionCookieName: "lsm_session",
    sessionTtlSeconds: 86_400,
    trustProxy: false,
    secureCookie: false,
    webOrigin: "http://127.0.0.1:5173",
    ...overrides,
  }
}

describe("auth and node API", () => {
  it("initializes an admin session when the instance has no users", async () => {
    const database = rememberDatabase(createTestDatabase())
    const app = createApp({ database })

    const response = await app.request("/api/auth/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "StrongPass123!" }),
    })

    expect(response.status).toBe(201)
    expect(response.headers.get("set-cookie")).toContain("lsm_session=")
    await expect(response.json()).resolves.toEqual({
      user: { id: expect.any(String), username: "admin" },
    })
  })

  it("rejects protected node routes without a session", async () => {
    const database = rememberDatabase(createTestDatabase())
    const app = createApp({ database })

    const response = await app.request("/api/nodes")

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: { code: "UNAUTHORIZED", message: "Authentication is required." },
    })
  })

  it("creates and lists nodes for an authenticated admin", async () => {
    const database = rememberDatabase(createTestDatabase())
    const app = createApp({ database })
    const initResponse = await app.request("/api/auth/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "StrongPass123!" }),
    })
    const cookie = sessionCookie(initResponse)

    const createResponse = await app.request("/api/nodes", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
      },
      body: JSON.stringify({
        name: "Source VM",
        host: "192.168.56.10",
        port: 22,
        username: "deploy",
        authType: "private_key",
        role: "source",
      }),
    })

    expect(createResponse.status).toBe(201)
    const listResponse = await app.request("/api/nodes", {
      headers: { cookie },
    })

    expect(listResponse.status).toBe(200)
    await expect(listResponse.json()).resolves.toEqual({
      nodes: [
        {
          id: expect.any(String),
          name: "Source VM",
          host: "192.168.56.10",
          port: 22,
          username: "deploy",
          authType: "private_key",
          role: "source",
          osFamily: null,
          primaryIp: null,
          lastProbeStatus: "unknown",
        },
      ],
    })
  })

  it("invalidates the configured session cookie on logout", async () => {
    const database = rememberDatabase(createTestDatabase())
    const app = createApp({
      database,
      config: testConfig({ sessionCookieName: "custom_session" }),
    })
    const initResponse = await app.request("/api/auth/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "StrongPass123!" }),
    })
    const cookie = sessionCookie(initResponse)

    const logoutResponse = await app.request("/api/auth/logout", {
      method: "POST",
      headers: { cookie },
    })

    expect(logoutResponse.status).toBe(200)
    const meResponse = await app.request("/api/auth/me", {
      headers: { cookie },
    })
    expect(meResponse.status).toBe(401)
  })
})
