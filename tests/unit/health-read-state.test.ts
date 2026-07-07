import { describe, expect, it } from "bun:test"
import type { CommandSpec, ExecutedStep } from "../../src/server/executor/command"
import { buildReadHealthState } from "../../src/server/health/read-state"

function command(preview: string): CommandSpec {
  return {
    executable: "ls",
    args: ["/home/await/project/00-new-property"],
    sudo: false,
    timeoutMs: 5_000,
    preview,
  }
}

function executedStep(stderr: string, exitCode: number): ExecutedStep {
  const now = new Date("2026-07-07T00:00:00.000Z")
  return {
    spec: command("ls /home/await/project/00-new-property"),
    result: {
      stdout: "",
      stderr,
      exitCode,
      timedOut: false,
    },
    startedAt: now,
    finishedAt: now,
  }
}

describe("health service read state", () => {
  it("keeps the remote read error when a mounted NFS path cannot be read", () => {
    const result = buildReadHealthState([
      executedStep("ls: cannot access '/home/await/project/00-new-property': Host is down\n", 1),
    ])

    expect(result.readOk).toBe(false)
    expect(result.errorMessage).toContain("Host is down")
  })
})
