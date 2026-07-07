import { describe, expect, it } from "bun:test"
import type { InterconnectivityResponse } from "../../src/shared/schemas/connectivity"
import {
  formatApplyHealthMessage,
  formatInterconnectivitySuccessMessage,
  interconnectivityPassed,
  shareStatusFromHealth,
} from "../../src/web/features/share-health"

describe("share health UI helpers", () => {
  it("maps degraded post-apply health to a degraded share status", () => {
    expect(shareStatusFromHealth("degraded")).toBe("degraded")
  })

  it("includes the read error when post-apply health is not healthy", () => {
    const message = formatApplyHealthMessage({
      healthStatus: "degraded",
      summary: "Source: online; Read: fail; Status: degraded",
      errorMessage: "ls: Host is down",
    })

    expect(message).toContain("健康检查未通过")
    expect(message).toContain("Host is down")
  })

  it("ignores failed write probes for read-only shares", () => {
    // Given: a healthy read-only mount rejects the write probe.
    const result: InterconnectivityResponse = {
      source: {
        nodeId: "11111111-1111-4111-8111-111111111111",
        nodeName: "Source",
        host: "192.168.56.10",
        port: 22,
        reachable: "ok",
      },
      target: {
        nodeId: "22222222-2222-4222-8222-222222222222",
        nodeName: "Target",
        host: "192.168.56.11",
        port: 22,
        reachable: "ok",
      },
      crossReachable: "ok",
      nfsPort: 2049,
      mountStatus: "mounted",
      readTest: "ok",
      writeTest: "failed",
      mountDetail: null,
      exportStatus: "ok",
      exportDetail: null,
      summary: "Write: fail",
    }

    // When: the interconnectivity result is evaluated for a read-only share.
    const passed = interconnectivityPassed(result, "read_only")

    // Then: the expected write failure does not make the whole check fail.
    expect(passed).toBe(true)
    expect(formatInterconnectivitySuccessMessage("read_only")).toContain("读取正常")
  })
})
