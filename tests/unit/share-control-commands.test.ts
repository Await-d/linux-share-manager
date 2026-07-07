import { describe, expect, it } from "bun:test"
import { buildShareControlCommands } from "../../src/server/routes/shares"

describe("share control commands", () => {
  it("controls automount units when automatic mount config is enabled", () => {
    // Given: a share managed through systemd automount.
    const share = { targetPath: "/mnt/project", autoMount: true }

    // When: disable and enable commands are built.
    const disableCommands = buildShareControlCommands(share, "disable")
    const enableCommands = buildShareControlCommands(share, "enable")

    // Then: the commands operate on the automount unit and include boot enablement changes.
    expect(disableCommands.map((command) => command.args)).toEqual([
      ["stop", "mnt-project.automount"],
      ["disable", "mnt-project.automount"],
    ])
    expect(enableCommands.map((command) => command.args)).toEqual([
      ["enable", "mnt-project.automount"],
      ["start", "mnt-project.automount"],
    ])
  })

  it("controls only mount units when automatic mount config is disabled", () => {
    // Given: a share that should mount now without boot-time automount.
    const share = { targetPath: "/mnt/project", autoMount: false }

    // When: disable and enable commands are built.
    const disableCommands = buildShareControlCommands(share, "disable")
    const enableCommands = buildShareControlCommands(share, "enable")

    // Then: no automount unit is touched.
    expect(disableCommands.map((command) => command.args)).toEqual([["stop", "mnt-project.mount"]])
    expect(enableCommands.map((command) => command.args)).toEqual([["start", "mnt-project.mount"]])
  })
})
