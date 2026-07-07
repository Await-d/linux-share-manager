import { describe, expect, it } from "bun:test"
import { deriveExportStatus } from "../../src/server/shares/export-status"

describe("NFS export status derivation", () => {
  it("reports exportfs misses as not exported before target evidence is available", () => {
    // Given: exportfs cannot list the path and no target-side verification has completed.
    const result = deriveExportStatus({
      sourceHosts: ["192.168.123.5"],
      sourcePath: "/volume2/4t_1/1.Project",
      exportOutput: "__NOT_EXPORTED__",
      mountDetail: null,
      readTest: "unknown",
      writeTest: "unknown",
    })

    // When/Then: the direct export probe remains a not-exported signal.
    expect(result.status).toBe("not_exported")
  })

  it("trusts a mounted source with passing read and write tests when exportfs misses the path", () => {
    // Given: exportfs cannot list the path, but the target is mounted from that exact source.
    const mountDetail = [
      "/home/await/project/00-new-property -> systemd-1 autofs rw,relatime",
      "192.168.123.5:/volume2/4t_1/1.Project nfs rw,relatime,vers=3",
    ].join("\n")

    // When: the export status is derived from all available probe evidence.
    const result = deriveExportStatus({
      sourceHosts: ["source-node.local", "192.168.123.5"],
      sourcePath: "/volume2/4t_1/1.Project",
      exportOutput: "__NOT_EXPORTED__",
      mountDetail,
      readTest: "ok",
      writeTest: "ok",
    })

    // Then: the health check reports the effective export as healthy.
    expect(result.status).toBe("ok")
    expect(result.detail).toContain("已通过目标端挂载与读写测试验证")
  })

  it("trusts read-only mounted sources without write access when exportfs misses the path", () => {
    // Given: a read-only NFS mount can be read but rejects the write probe.
    const mountDetail = "192.168.123.5:/volume2/4t_1/1.Project nfs ro,relatime,vers=3"

    // When: the export status is derived for a read-only share.
    const result = deriveExportStatus({
      sourceHosts: ["192.168.123.5"],
      sourcePath: "/volume2/4t_1/1.Project",
      exportOutput: "__NOT_EXPORTED__",
      mountDetail,
      readTest: "ok",
      writeTest: "failed",
      accessMode: "read_only",
    })

    // Then: expected write denial does not hide the verified export.
    expect(result.status).toBe("ok")
  })

  it("does not trust a mounted source whose path only shares a prefix", () => {
    // Given: the target is mounted from a different export with the same text prefix.
    const mountDetail = "192.168.123.5:/srv/share-old nfs rw,relatime,vers=3"

    // When: the checked source path is shorter than the mounted export path.
    const result = deriveExportStatus({
      sourceHosts: ["192.168.123.5"],
      sourcePath: "/srv/share",
      exportOutput: "__NOT_EXPORTED__",
      mountDetail,
      readTest: "ok",
      writeTest: "ok",
    })

    // Then: the prefix match is rejected as the wrong export.
    expect(result.status).toBe("not_exported")
  })
})
