import { afterEach, describe, expect, it } from "bun:test"
import { createApp } from "../../src/server/app"
import type { AppConfig } from "../../src/server/config"
import { createTestDatabase } from "../../src/server/db/testing"
import { type NodeResponse, NodeResponseSchema } from "../../src/shared/schemas/nodes"

const databases: Array<{ readonly close: () => void }> = []
const servers: Array<{ readonly stop: () => void }> = []

afterEach(() => {
  for (const server of servers.splice(0)) {
    server.stop()
  }
  for (const database of databases.splice(0)) {
    database.close()
  }
})

function rememberDatabase<T extends { readonly close: () => void }>(database: T): T {
  databases.push(database)
  return database
}

function rememberServer<T extends { readonly stop: () => void }>(server: T): T {
  servers.push(server)
  return server
}

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
    port: 18088,
    databasePath: ":memory:",
    staticRoot: "./dist/web",
    sessionCookieName: "lsm_session",
    sessionTtlSeconds: 86_400,
    sshConnectTimeoutMs: 100,
    trustProxy: false,
    secureCookie: false,
    webOrigin: "http://127.0.0.1:5173",
    ...overrides,
  }
}

async function createNode(
  app: ReturnType<typeof createApp>,
  cookie: string,
  port: number,
): Promise<NodeResponse> {
  const response = await app.request("/api/nodes", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: "Reachable VM",
      host: "127.0.0.1",
      port,
      username: "deploy",
      authType: "private_key",
      role: "source",
    }),
  })
  return NodeResponseSchema.parse(await response.json())
}

function stoppedLocalPort(): number {
  const listener = Bun.serve({
    port: 0,
    fetch: () => new Response("ok"),
  })
  const port = listener.port
  if (port === undefined) {
    listener.stop()
    throw new Error("expected listener port")
  }

  listener.stop()
  return port
}

describe("node connection test API", () => {
  it("marks a node as reachable when its SSH port accepts TCP connections", async () => {
    const listener = rememberServer(
      Bun.serve({
        port: 0,
        fetch: () => new Response("ok"),
      }),
    )
    const database = rememberDatabase(createTestDatabase())
    const app = createApp({ database })
    const port = listener.port
    if (port === undefined) {
      throw new Error("expected listener port")
    }
    const initResponse = await app.request("/api/auth/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "StrongPass123!" }),
    })
    const cookie = sessionCookie(initResponse)
    const created = await createNode(app, cookie, port)

    const response = await app.request(`/api/nodes/${created.id}/test-connection`, {
      method: "POST",
      headers: { cookie },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: created.id,
      lastProbeStatus: "ok",
    })
  })

  it("marks a node as failed when the SSH port does not accept TCP connections", async () => {
    const port = stoppedLocalPort()
    const database = rememberDatabase(createTestDatabase())
    const app = createApp({ database, config: testConfig() })
    const initResponse = await app.request("/api/auth/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "StrongPass123!" }),
    })
    const cookie = sessionCookie(initResponse)
    const created = await createNode(app, cookie, port)

    const response = await app.request(`/api/nodes/${created.id}/test-connection`, {
      method: "POST",
      headers: { cookie },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      id: created.id,
      lastProbeStatus: "failed",
    })
  })
})
