import { describe, expect, it } from "bun:test"
import { CreateShareRequestSchema, UpdateShareRequestSchema } from "../../src/shared/schemas/shares"

const SHARE_INPUT = {
  name: "legacy-nfs",
  sourceNodeId: "11111111-1111-4111-8111-111111111111",
  sourcePath: "/srv/share",
  targetNodeId: "22222222-2222-4222-8222-222222222222",
  targetPath: "/mnt/share",
  accessMode: "read_write",
  autoMount: true,
} as const

describe("share schemas", () => {
  it("accepts NFS 3 for legacy servers that do not support NFS 4", () => {
    expect(CreateShareRequestSchema.parse({ ...SHARE_INPUT, nfsVersion: "3" }).nfsVersion).toBe("3")
    expect(UpdateShareRequestSchema.parse({ nfsVersion: "3" }).nfsVersion).toBe("3")
  })

  it("accepts automatic NFS version selection", () => {
    expect(CreateShareRequestSchema.parse({ ...SHARE_INPUT, nfsVersion: "auto" }).nfsVersion).toBe(
      "auto",
    )
    expect(UpdateShareRequestSchema.parse({ nfsVersion: "auto" }).nfsVersion).toBe("auto")
  })

  it("rejects paths with dot or parent directory components", () => {
    expect(() =>
      CreateShareRequestSchema.parse({ ...SHARE_INPUT, sourcePath: "/srv/./share" }),
    ).toThrow()
    expect(() =>
      CreateShareRequestSchema.parse({ ...SHARE_INPUT, targetPath: "/mnt/foo/../share" }),
    ).toThrow()
    expect(() => UpdateShareRequestSchema.parse({ sourcePath: "/srv/../share" })).toThrow()
  })
})
