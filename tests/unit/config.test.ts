import { describe, expect, it } from "bun:test"
import { loadConfig } from "../../src/server/config"

describe("server config defaults", () => {
  it("uses a development API port that does not conflict with Docker deployment", () => {
    const config = loadConfig({
      LSM_HOST: undefined,
      LSM_PORT: undefined,
      LSM_DATABASE_PATH: undefined,
      LSM_STATIC_ROOT: undefined,
      LSM_SECRET_KEY: undefined,
      LSM_SESSION_COOKIE_NAME: undefined,
      LSM_SESSION_TTL_SECONDS: undefined,
      LSM_SSH_CONNECT_TIMEOUT_MS: undefined,
      LSM_TRUST_PROXY: undefined,
      LSM_SECURE_COOKIE: undefined,
      LSM_WEB_ORIGIN: undefined,
    })

    expect(config.port).toBe(18_188)
  })
})
