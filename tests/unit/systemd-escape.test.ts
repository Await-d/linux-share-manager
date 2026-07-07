import { describe, expect, it } from "bun:test"
import { systemdEscapePath } from "../../src/server/systemd/escape"

describe("systemd path escaping", () => {
  it("matches systemd-escape path semantics for common mount paths", () => {
    expect(`${systemdEscapePath("/home/await/project/00-new-property")}.mount`).toBe(
      "home-await-project-00\\x2dnew\\x2dproperty.mount",
    )
    expect(`${systemdEscapePath("/.hidden")}.mount`).toBe("\\x2ehidden.mount")
    expect(`${systemdEscapePath("/mnt/a b")}.mount`).toBe("mnt-a\\x20b.mount")
    expect(`${systemdEscapePath("/mnt/你好")}.mount`).toBe(
      "mnt-\\xe4\\xbd\\xa0\\xe5\\xa5\\xbd.mount",
    )
    expect(`${systemdEscapePath("/mnt/./bar")}.mount`).toBe("mnt-bar.mount")
    expect(`${systemdEscapePath("/")}.mount`).toBe("-.mount")
  })

  it("rejects parent directory components that systemd-escape rejects", () => {
    expect(() => systemdEscapePath("/mnt/foo/../bar")).toThrow(".. components")
  })
})
