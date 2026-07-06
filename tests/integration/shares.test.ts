import { afterEach, describe, expect, it } from "bun:test"
import { createApp } from "../../src/server/app"
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

function sessionCookie(response: Response): string {
  const cookie = response.headers.get("set-cookie")
  if (cookie === null) {
    throw new Error("expected a session cookie")
  }
  return cookie.split(";")[0] ?? ""
}

async function createNode(app: ReturnType<typeof createApp>, cookie: string, name: string) {
  const response = await app.request("/api/nodes", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name,
      host: name === "Source VM" ? "192.168.56.10" : "192.168.56.11",
      port: 22,
      username: "deploy",
      authType: "private_key",
      role: name === "Source VM" ? "source" : "target",
    }),
  })
  const payload = await response.json()
  return payload.id as string
}

describe("share API", () => {
  it("creates and lists a draft NFS share between two nodes", async () => {
    const database = rememberDatabase(createTestDatabase())
    const app = createApp({ database })
    const initResponse = await app.request("/api/auth/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin", password: "StrongPass123!" }),
    })
    const cookie = sessionCookie(initResponse)
    const sourceNodeId = await createNode(app, cookie, "Source VM")
    const targetNodeId = await createNode(app, cookie, "Target VM")

    const createResponse = await app.request("/api/shares", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        name: "Project preview",
        sourceNodeId,
        sourcePath: "/data/www/project",
        targetNodeId,
        targetPath: "/mnt/project",
        accessMode: "read_write",
        nfsVersion: "4.2",
        autoMount: true,
      }),
    })

    expect(createResponse.status).toBe(201)
    await expect(createResponse.json()).resolves.toEqual({
      id: expect.any(String),
      name: "Project preview",
      sourceNodeId,
      sourcePath: "/data/www/project",
      targetNodeId,
      targetPath: "/mnt/project",
      accessMode: "read_write",
      nfsVersion: "4.2",
      autoMount: true,
      status: "draft",
    })

    const listResponse = await app.request("/api/shares", { headers: { cookie } })
    expect(listResponse.status).toBe(200)
    const listed = await listResponse.json()
    expect(listed.shares).toHaveLength(1)
    expect(listed.shares[0].sourcePath).toBe("/data/www/project")
  })
})
