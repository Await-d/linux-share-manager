import { describe, expect, it } from "bun:test"
import { parseNfsVersions } from "../../src/server/shares/precheck"
import { isReachableProbeOutput } from "../../src/server/shares/reachability"

describe("share pre-check NFS reachability sentinel parsing", () => {
  it("treats unreachable output as a failed probe", () => {
    // Given: the remote /dev/tcp probe emitted the failure sentinel.
    const output = "UNREACHABLE"

    // When: the reachability sentinel is parsed.
    const reachable = isReachableProbeOutput(output)

    // Then: it is not confused with the successful REACHABLE sentinel.
    expect(reachable).toBe(false)
  })
})

describe("share pre-check NFS version detection", () => {
  it("parses enabled kernel NFS versions in preference order", () => {
    // Given: a Linux nfsd versions file with NFS 4 disabled and legacy NFS 3 enabled.
    const rawVersions = "+2 +3 -4 -4.1 -4.2"

    // When: the pre-check parses the source NFS protocol support.
    const info = parseNfsVersions(rawVersions)

    // Then: only mountable supported versions are returned and NFS 3 becomes preferred.
    expect(info.supportedVersions).toEqual(["3"])
    expect(info.preferredVersion).toBe("3")
    expect(info.rawVersionsOutput).toBe(rawVersions)
  })

  it("parses rpcinfo NFS versions when kernel version output is unavailable", () => {
    // Given: rpcinfo output from a source exporting NFS v3 and v4 services.
    const rawVersions = [
      "100003    3   tcp   2049  nfs",
      "100003    4   tcp   2049  nfs",
      "100005    1   udp  53433  mountd",
    ].join("\n")

    // When: the pre-check parses fallback rpcinfo output.
    const info = parseNfsVersions(rawVersions)

    // Then: it prefers NFS 4 over NFS 3 for automatic plan generation.
    expect(info.supportedVersions).toEqual(["4", "3"])
    expect(info.preferredVersion).toBe("4")
  })

  it("returns no supported versions when detection produced no data", () => {
    // Given: neither /proc nor rpcinfo could report NFS versions.
    const rawVersions = "NO_NFS_VERSIONS"

    // When: the output is parsed.
    const info = parseNfsVersions(rawVersions)

    // Then: plan generation can apply its explicit unknown-version fallback.
    expect(info.supportedVersions).toEqual([])
    expect(info.preferredVersion).toBeNull()
    expect(info.rawVersionsOutput).toBeNull()
  })
})
