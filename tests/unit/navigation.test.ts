import { describe, expect, it } from "bun:test"
import { viewFromPathname } from "../../src/web/navigation"

describe("console navigation", () => {
  it("maps dashboard, nodes, and shares paths to different views", () => {
    expect(viewFromPathname("/dashboard")).toBe("dashboard")
    expect(viewFromPathname("/nodes")).toBe("nodes")
    expect(viewFromPathname("/shares")).toBe("shares")
  })

  it("falls back to dashboard for the root and unknown paths", () => {
    expect(viewFromPathname("/")).toBe("dashboard")
    expect(viewFromPathname("/unexpected")).toBe("dashboard")
  })
})
