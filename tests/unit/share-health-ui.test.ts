import { describe, expect, it } from "bun:test"
import type { InterconnectivityResponse } from "../../src/shared/schemas/connectivity"
import {
  formatApplyHealthMessage,
  formatInterconnectivitySuccessMessage,
  interconnectivityPassed,
  interconnectivityTone,
  shareStatusFromHealth,
  writeTestBadge,
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

  it("uses success detail tone for read-only shares when only the write probe fails", () => {
    // Given: the main interconnect check passes because the share is read-only.
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

    // When: the detail panel derives its status tone and write badge.
    const tone = interconnectivityTone(result, "read_only")
    const writeBadge = writeTestBadge(result.writeTest, "read_only")

    // Then: the details match the success decision instead of showing an error.
    expect(tone).toBe("success")
    expect(writeBadge).toEqual({ tone: "neutral", label: "只读预期失败" })
  })
})
