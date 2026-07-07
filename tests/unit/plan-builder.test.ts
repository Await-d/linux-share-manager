import { describe, expect, it } from "bun:test"
import { type CommandSpec, shouldAttachSudoPassword } from "../../src/server/executor/command"
import type { PlanNodeInfo } from "../../src/server/plans/builder"
import { generateSharePlan } from "../../src/server/plans/builder"
import type { ShareResponse } from "../../src/shared/schemas/shares"

const SHARE: ShareResponse = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Project data",
  sourceNodeId: "22222222-2222-4222-8222-222222222222",
  sourcePath: "/data/project",
  targetNodeId: "33333333-3333-4333-8333-333333333333",
  targetPath: "/mnt/project",
  accessMode: "read_write",
  nfsVersion: "4.2",
  autoMount: true,
  status: "draft",
}

const SOURCE_NODE_WITH_PASSWORD_SUDO: PlanNodeInfo = {
  id: SHARE.sourceNodeId,
  name: "source",
  host: "192.168.56.10",
  osFamily: "debian",
  primaryIp: "192.168.56.10",
  sudoOk: false,
  nfsServerInstalled: true,
  nfsClientInstalled: false,
  sudoPassword: "secret-password",
}

const TARGET_NODE: PlanNodeInfo = {
  id: SHARE.targetNodeId,
  name: "target",
  host: "192.168.56.11",
  osFamily: "debian",
  primaryIp: "192.168.56.11",
  sudoOk: true,
  nfsServerInstalled: false,
  nfsClientInstalled: true,
  sudoPassword: null,
}

function firstCommandForStep(
  plan: ReturnType<typeof generateSharePlan>,
  stepKey: string,
): CommandSpec {
  const commands = commandsForStep(plan, stepKey)
  const command = commands.at(0)
  expect(command).toBeDefined()
  if (command === undefined) {
    throw new Error(`expected ${stepKey} command`)
  }

  return command
}

function commandsForStep(
  plan: ReturnType<typeof generateSharePlan>,
  stepKey: string,
): readonly CommandSpec[] {
  const step = plan.steps.find((candidate) => candidate.key === stepKey)
  expect(step).toBeDefined()
  if (step === undefined) {
    throw new Error(`expected ${stepKey} step`)
  }

  return step.commands
}

describe("share plan builder", () => {
  it("strips stored sudo passwords while keeping commands eligible for password injection", () => {
    // Given: a source node that can only sudo by entering the SSH session password.
    const sourceNode = SOURCE_NODE_WITH_PASSWORD_SUDO

    // When: the plan is generated and persisted-safe secrets are stripped from commands.
    const plan = generateSharePlan(SHARE, sourceNode, TARGET_NODE)

    // Then: commands keep sudo intent but do not persist the secret value.
    const cleanOldExportsCommand = firstCommandForStep(plan, "clean-old-exports")

    expect(cleanOldExportsCommand.sudo).toBe(true)
    expect(cleanOldExportsCommand.sudoPassword).toBeUndefined()
    expect(shouldAttachSudoPassword(cleanOldExportsCommand)).toBe(true)
    expect(cleanOldExportsCommand.args.join(" ")).not.toContain("sudo ")
  })

  it("cleans only this share export block without interpolating the source path", () => {
    // Given: a share path containing a shell quote and other managed shares may exist.
    const share = { ...SHARE, sourcePath: "/data/project's data" }

    // When: the plan generates its old-export cleanup command.
    const plan = generateSharePlan(share, SOURCE_NODE_WITH_PASSWORD_SUDO, TARGET_NODE)
    const cleanOldExportsCommand = firstCommandForStep(plan, "clean-old-exports")
    const script = cleanOldExportsCommand.args.join("\n")

    // Then: cleanup targets the current share_id block instead of broad markers or the path string.
    expect(cleanOldExportsCommand.args).toContain(share.id)
    expect(script).toContain("awk -v share_id")
    expect(script).toContain("BEGIN LINUX_SHARE_MANAGER share_id=")
    expect(script).not.toContain(share.sourcePath)
    expect(script).not.toContain("grep -v 'LINUX_SHARE_MANAGER'")
  })

  it("writes exports for the target node address instead of the source node address", () => {
    // Given: source and target nodes are on different addresses.
    const plan = generateSharePlan(SHARE, SOURCE_NODE_WITH_PASSWORD_SUDO, TARGET_NODE)

    // When: the exports write command is generated.
    const writeExportsCommand = firstCommandForStep(plan, "write-exports")
    const script = writeExportsCommand.args.join("\n")

    // Then: the NFS server allows the client address, not its own source address.
    expect(script).toContain(`${SHARE.sourcePath} ${TARGET_NODE.primaryIp}(`)
    expect(script).not.toContain(`${SHARE.sourcePath} ${SOURCE_NODE_WITH_PASSWORD_SUDO.primaryIp}(`)
  })

  it("pins NFS 3 systemd mounts to TCP protocols", () => {
    // Given: a legacy source only supports NFS 3.
    const share = { ...SHARE, nfsVersion: "3" }

    // When: the target mount unit is generated.
    const plan = generateSharePlan(share, SOURCE_NODE_WITH_PASSWORD_SUDO, TARGET_NODE)
    const mountCommand = firstCommandForStep(plan, "write-systemd-units")
    const script = mountCommand.args.join("\n")

    // Then: both NFS and mountd negotiation stay on TCP.
    expect(script).toContain("Options=vers=3,proto=tcp,mountproto=tcp,_netdev")
  })

  it("resolves automatic NFS version to the best supported source version", () => {
    // Given: the share asks the plan builder to detect the NFS version.
    const share = { ...SHARE, nfsVersion: "auto" }

    // When: the source reports NFS 4.1 and NFS 3 support.
    const plan = generateSharePlan(share, SOURCE_NODE_WITH_PASSWORD_SUDO, TARGET_NODE, {
      supportedNfsVersions: ["3", "4.1"],
    })
    const mountCommand = firstCommandForStep(plan, "write-systemd-units")
    const script = mountCommand.args.join("\n")

    // Then: the plan chooses the highest compatible version and records what happened.
    expect(plan.config.nfsVersion).toBe("4.1")
    expect(plan.config.requestedNfsVersion).toBe("auto")
    expect(script).toContain("Options=vers=4.1,_netdev")
  })

  it("resolves automatic NFS version to NFS 3 when only legacy support is available", () => {
    // Given: the share asks for automatic detection against a legacy source.
    const share = { ...SHARE, nfsVersion: "auto" }

    // When: the source reports only NFS 3 support.
    const plan = generateSharePlan(share, SOURCE_NODE_WITH_PASSWORD_SUDO, TARGET_NODE, {
      supportedNfsVersions: ["3"],
    })
    const mountCommand = firstCommandForStep(plan, "write-systemd-units")
    const script = mountCommand.args.join("\n")

    // Then: the generated mount unit uses the NFS 3 TCP-safe options.
    expect(plan.config.nfsVersion).toBe("3")
    expect(script).toContain("Options=vers=3,proto=tcp,mountproto=tcp,_netdev")
  })

  it("quotes escaped systemd unit paths when writing unit files", () => {
    const share = { ...SHARE, targetPath: "/home/await/project/00-new-property" }
    const plan = generateSharePlan(share, SOURCE_NODE_WITH_PASSWORD_SUDO, TARGET_NODE)
    const [mountCommand, automountCommand] = commandsForStep(plan, "write-systemd-units")
    if (mountCommand === undefined || automountCommand === undefined) {
      throw new Error("expected systemd unit write commands")
    }

    const mountScript = mountCommand.args.join(" ")
    const automountScript = automountCommand.args.join(" ")

    expect(mountScript).toContain(
      "tee '/etc/systemd/system/home-await-project-00\\x2dnew\\x2dproperty.mount'",
    )
    expect(automountScript).toContain(
      "tee '/etc/systemd/system/home-await-project-00\\x2dnew\\x2dproperty.automount'",
    )
  })

  it("mounts and removes stale automount when automatic mount config is disabled", () => {
    // Given: a share should be mounted now, but should not install boot-time automount config.
    const share = { ...SHARE, autoMount: false }

    // When: the target systemd step is generated.
    const plan = generateSharePlan(share, SOURCE_NODE_WITH_PASSWORD_SUDO, TARGET_NODE)
    const step = plan.steps.find((candidate) => candidate.key === "write-systemd-units")
    expect(step).toBeDefined()
    if (step === undefined) {
      throw new Error("expected write-systemd-units step")
    }
    const commands = step.commands
    const combinedScript = commands.map((command) => command.args.join(" ")).join("\n")
    const rollbackArgs = step.rollbackCommands.map((command) => command.args.join(" ")).join("\n")

    // Then: the mount unit is written and started while stale automount config is only cleaned.
    expect(combinedScript).toContain("tee '/etc/systemd/system/mnt-project.mount'")
    expect(combinedScript).not.toContain("tee '/etc/systemd/system/mnt-project.automount'")
    expect(combinedScript).not.toContain("enable' 'mnt-project.automount")
    expect(combinedScript).not.toContain("start' 'mnt-project.automount")
    expect(combinedScript).toContain('grep -Fq "share_id=$share_id"')
    expect(combinedScript).toContain(share.id)
    expect(combinedScript).toContain('disable "$automount_unit"')
    expect(combinedScript).toContain('rm -f "$automount_path"')
    expect(commands.some((command) => command.args.includes("start"))).toBe(true)
    expect(commands.some((command) => command.args.includes("mnt-project.mount"))).toBe(true)
    expect(rollbackArgs).toContain("/etc/systemd/system/mnt-project.mount")
    expect(rollbackArgs).not.toContain("/etc/systemd/system/mnt-project.automount")
  })
})
