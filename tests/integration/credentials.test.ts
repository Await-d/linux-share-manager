import { afterEach, describe, expect, it } from "bun:test"
import { createApp } from "../../src/server/app"
import type { AppConfig } from "../../src/server/config"
import { createTestDatabase } from "../../src/server/db/testing"

const databases: Array<{ readonly close: () => void }> = []

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close()
  }
})

function rememberDatabase<T extends { readonly close: () => void }>(database: T): T {
  databases.push(database)
  return database
}

function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: "127.0.0.1",
    port: 18088,
    databasePath: ":memory:",
    staticRoot: "./dist/web",
    sessionCookieName: "lsm_session",
    sessionTtlSeconds: 86_400,
    sshConnectTimeoutMs: 5_000,
    trustProxy: false,
    secureCookie: false,
    webOrigin: "http://127.0.0.1:5173",
    ...overrides,
  }
}

function sessionCookie(response: Response): string {
  const cookie = response.headers.get("set-cookie")
  if (cookie === null) {
    throw new Error("expected a session cookie")
  }
  return cookie.split(";")[0] ?? ""
}

type CredentialRow = {
  readonly credentialSecret: string | null
}

describe("node credential storage", () => {
  it("encrypts SSH credentials at rest when a secret key is configured", async () => {
    const database = rememberDatabase(createTestDatabase())
    const app = createApp({
      database,
      config: testConfig({ secretKey: "test-secret-key-at-least-32-bytes" }),
    })
    const initResponse = await app.request("/api/auth/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "StrongPass123!" }),
    })
    const cookie = sessionCookie(initResponse)

    const response = await app.request("/api/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Encrypted VM",
        host: "192.168.56.12",
        port: 22,
        username: "deploy",
        authType: "password_session",
        password: "SshPassword123!",
        role: "target",
      }),
    })

    expect(response.status).toBe(201)
    const row = database.sqlite
      .query<CredentialRow, [string]>(
        "SELECT credential_secret as credentialSecret FROM nodes WHERE name = ?",
      )
      .get("Encrypted VM")
    if (row === null) {
      throw new Error("expected credential row")
    }
    expect(row.credentialSecret).toStartWith("v1:")
    expect(row.credentialSecret).not.toContain("SshPassword123!")
  })

  it("rejects SSH credential persistence without a configured secret key", async () => {
    const database = rememberDatabase(createTestDatabase())
    const app = createApp({ database, config: testConfig() })
    const initResponse = await app.request("/api/auth/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "StrongPass123!" }),
    })
    const cookie = sessionCookie(initResponse)

    const response = await app.request("/api/nodes", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Rejected VM",
        host: "192.168.56.13",
        port: 22,
        username: "deploy",
        authType: "password_session",
        password: "SshPassword123!",
        role: "target",
      }),
    })

    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "CREDENTIAL_KEY_REQUIRED",
        message: "LSM_SECRET_KEY is required to save SSH credentials.",
      },
    })
  })
})
