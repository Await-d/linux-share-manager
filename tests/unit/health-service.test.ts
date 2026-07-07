import { describe, expect, it } from "bun:test"
import type { CommandSpec, ExecutedStep } from "../../src/server/executor/command"
import { buildSourceHealthState } from "../../src/server/health/source-state"

function command(preview: string): CommandSpec {
  return {
    executable: "systemctl",
    args: ["is-active", "nfs-server", "nfs-kernel-server"],
    sudo: false,
    timeoutMs: 5_000,
    preview,
  }
}

function executedStep(stdout: string, exitCode: number): ExecutedStep {
  const now = new Date("2026-07-07T00:00:00.000Z")
  return {
    spec: command("systemctl is-active nfs-server"),
    result: {
      stdout,
      stderr: "",
      exitCode,
      timedOut: false,
    },
    startedAt: now,
    finishedAt: now,
  }
}

describe("health service source state", () => {
  it("keeps source online when SSH ran systemctl but NFS is inactive", () => {
    const result = buildSourceHealthState([executedStep("inactive\n", 3)])

    expect(result.sourceOnline).toBe(true)
    expect(result.nfsServiceOk).toBe(false)
  })
})
