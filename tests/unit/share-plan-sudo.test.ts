import { describe, expect, it } from "bun:test"
import type { CommandSpec } from "../../src/server/executor/command"
import {
  generateSharePlan,
  type PlanNodeInfo,
  type SharePlan,
} from "../../src/server/plans/builder"
import type { ShareResponse } from "../../src/shared/schemas/shares"

const share = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Project data",
  sourceNodeId: "22222222-2222-4222-8222-222222222222",
  sourcePath: "/srv/project",
  targetNodeId: "33333333-3333-4333-8333-333333333333",
  targetPath: "/mnt/project",
  accessMode: "read_write",
  nfsVersion: "4.2",
  autoMount: true,
  status: "draft",
} satisfies ShareResponse

const sourceNode = {
  id: share.sourceNodeId,
  name: "Source VM",
  host: "192.168.56.10",
  osFamily: "debian",
  primaryIp: "192.168.56.10",
  sudoOk: false,
  sudoPassword: "source-password",
  nfsServerInstalled: true,
  nfsClientInstalled: false,
} satisfies PlanNodeInfo

const targetNode = {
  id: share.targetNodeId,
  name: "Target VM",
  host: "192.168.56.11",
  osFamily: "debian",
  primaryIp: "192.168.56.11",
  sudoOk: false,
  sudoPassword: "target-password",
  nfsServerInstalled: false,
  nfsClientInstalled: true,
} satisfies PlanNodeInfo

function firstCommandForStep(plan: SharePlan, stepKey: string): CommandSpec {
  const step = plan.steps.find((candidate) => candidate.key === stepKey)
  if (step === undefined) {
    throw new Error(`expected step ${stepKey}`)
  }

  const command = step.commands.at(0)
  if (command === undefined) {
    throw new Error(`expected command for step ${stepKey}`)
  }

  return command
}

describe("share plan sudo commands", () => {
  it("marks shell write commands as sudo so execution can inject password later", () => {
    const plan = generateSharePlan(share, sourceNode, targetNode)
    const commands = [
      firstCommandForStep(plan, "clean-old-exports"),
      firstCommandForStep(plan, "write-exports"),
      firstCommandForStep(plan, "write-systemd-units"),
    ]

    for (const command of commands) {
      expect(command.sudo).toBe(true)
      expect(command.sudoPassword).toBeUndefined()
      expect(command.args.join(" ")).not.toContain("sudo ")
    }
  })
})
