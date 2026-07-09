import { describe, expect, it } from "bun:test"
import { loadConfig } from "../../src/server/config"

describe("server config defaults", () => {
  const emptyEnvironment = {
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
  }

  it("uses a development API port that does not conflict with Docker deployment", () => {
    const config = loadConfig(emptyEnvironment)

    expect(config.port).toBe(18_188)
  })

  it("parses explicit false boolean environment values as false", () => {
    const config = loadConfig({
      ...emptyEnvironment,
      LSM_TRUST_PROXY: "false",
      LSM_SECURE_COOKIE: "false",
    })

    expect(config.trustProxy).toBe(false)
    expect(config.secureCookie).toBe(false)
  })

  it("parses true and one boolean environment values as true", () => {
    const config = loadConfig({
      ...emptyEnvironment,
      LSM_TRUST_PROXY: "true",
      LSM_SECURE_COOKIE: "1",
    })

    expect(config.trustProxy).toBe(true)
    expect(config.secureCookie).toBe(true)
  })
})
