import { describe, expect, it } from "bun:test"
import { determineHealthStatus } from "../../src/server/health/status"

describe("health status", () => {
  it("marks a mounted share unhealthy when the read test fails", () => {
    const status = determineHealthStatus({
      sourceOnline: true,
      targetOnline: true,
      nfsServiceOk: true,
      mountpointOk: true,
      readOk: false,
    })

    expect(status).toBe("unhealthy")
  })
})
