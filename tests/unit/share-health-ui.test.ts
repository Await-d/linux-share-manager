import { describe, expect, it } from "bun:test"
import {
  formatApplyHealthMessage,
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
})
