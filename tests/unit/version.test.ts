import { describe, expect, it } from "bun:test"
import packageJson from "../../package.json"
import { getAppVersionInfo } from "../../src/shared/version"

describe("application version metadata", () => {
  it("uses package.json as the canonical version source", () => {
    const version = getAppVersionInfo({
      LSM_BUILD_COMMIT: undefined,
      LSM_BUILD_TIME: undefined,
    })

    expect(version).toEqual({
      name: packageJson.name,
      version: packageJson.version,
      build: {
        commit: null,
        builtAt: null,
      },
    })
  })

  it("normalizes optional build metadata from the runtime environment", () => {
    const version = getAppVersionInfo({
      LSM_BUILD_COMMIT: " 350ffdd ",
      LSM_BUILD_TIME: " 2026-07-07T12:00:00.000Z ",
    })

    expect(version.build).toEqual({
      commit: "350ffdd",
      builtAt: "2026-07-07T12:00:00.000Z",
    })
  })
})
