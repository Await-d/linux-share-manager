import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createApp } from "../../src/server/app"
import type { AppConfig } from "../../src/server/config"
import { createTestDatabase } from "../../src/server/db/testing"
import { getAppVersionInfo } from "../../src/shared/version"

const cleanupTasks: Array<() => Promise<void> | void> = []

afterEach(async () => {
  for (const cleanup of cleanupTasks.splice(0)) {
    await cleanup()
  }
})

async function createStaticRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lsm-static-"))
  cleanupTasks.push(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, "assets"))
  await writeFile(join(root, "index.html"), "<!doctype html><title>Linux Share Manager</title>")
  await writeFile(join(root, "assets", "app.js"), "console.log('asset loaded')")
  return root
}

function testConfig(staticRoot: string): AppConfig {
  return {
    host: "127.0.0.1",
    port: 18088,
    databasePath: ":memory:",
    staticRoot,
    sessionCookieName: "lsm_session",
    sessionTtlSeconds: 86_400,
    sshConnectTimeoutMs: 5_000,
    trustProxy: false,
    secureCookie: false,
    webOrigin: "http://127.0.0.1:5173",
  }
}

describe("single-port static serving", () => {
  it("serves the web app and API from the same port", async () => {
    const staticRoot = await createStaticRoot()
    const database = createTestDatabase()
    cleanupTasks.push(() => database.close())
    const app = createApp({ database, config: testConfig(staticRoot) })

    const pageResponse = await app.request("http://linux-share.local:18088/dashboard")
    const apiResponse = await app.request("http://linux-share.local:18088/api/health")

    expect(pageResponse.status).toBe(200)
    expect(pageResponse.headers.get("content-type")).toContain("text/html")
    await expect(pageResponse.text()).resolves.toContain("Linux Share Manager")
    expect(apiResponse.status).toBe(200)
    await expect(apiResponse.json()).resolves.toEqual({
      status: "ok",
      initialized: false,
      version: getAppVersionInfo(),
    })
  })

  it("keeps missing API routes as JSON 404 responses", async () => {
    const staticRoot = await createStaticRoot()
    const database = createTestDatabase()
    cleanupTasks.push(() => database.close())
    const app = createApp({ database, config: testConfig(staticRoot) })

    const response = await app.request("http://linux-share.local:18088/api/missing")

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      error: { code: "NOT_FOUND", message: "Route not found." },
    })
  })
})
