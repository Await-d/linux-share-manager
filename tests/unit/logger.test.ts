import { describe, expect, it } from "bun:test"
import type { LogEnvironment } from "../../src/server/logger"
import { resolveLogFormat, resolveLogLevel } from "../../src/server/logger"

function environment(overrides: Partial<LogEnvironment> = {}): LogEnvironment {
  return {
    LSM_LOG_LEVEL: undefined,
    LSM_LOG_FORMAT: undefined,
    LSM_LOG_PRETTY: undefined,
    NODE_ENV: undefined,
    ...overrides,
  }
}

describe("logger configuration", () => {
  it("uses pretty logs by default outside production", () => {
    // Given: no explicit log format in a local runtime.
    const env = environment()

    // When: the logger format is resolved.
    const format = resolveLogFormat(env)

    // Then: human-readable logs are selected.
    expect(format).toBe("pretty")
  })

  it("uses json logs by default in production", () => {
    // Given: a production runtime with no explicit format.
    const env = environment({ NODE_ENV: "production" })

    // When: the logger format is resolved.
    const format = resolveLogFormat(env)

    // Then: structured JSON logs are selected for collectors.
    expect(format).toBe("json")
  })

  it("uses json logs by default while tests are running", () => {
    // Given: a test runtime with no explicit format.
    const env = environment({ NODE_ENV: "test" })

    // When: the logger format is resolved.
    const format = resolveLogFormat(env)

    // Then: test output stays compact and machine-readable.
    expect(format).toBe("json")
  })

  it("lets the explicit log format override legacy pretty flags", () => {
    // Given: both the new format switch and the legacy pretty flag are set.
    const env = environment({ LSM_LOG_FORMAT: "json", LSM_LOG_PRETTY: "1" })

    // When: the logger format is resolved.
    const format = resolveLogFormat(env)

    // Then: the explicit format switch wins.
    expect(format).toBe("json")
  })

  it("uses the configured log level when present", () => {
    // Given: an explicit log level.
    const env = environment({ LSM_LOG_LEVEL: "debug" })

    // When: the logger level is resolved.
    const level = resolveLogLevel(env)

    // Then: that level is used.
    expect(level).toBe("debug")
  })
})
