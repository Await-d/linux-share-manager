import { describe, expect, it } from "bun:test"
import { buildCommand } from "../../src/server/executor/command"

describe("command builder", () => {
  it("uses sudo stdin password mode when a password is injected", () => {
    // Given: a sudo command that has an execution-time password available.
    const commandSpec = {
      executable: "sh",
      args: ["-c", "cp /tmp/.lsm_exports.tmp /etc/exports"],
      sudo: true,
      sudoPassword: "secret-password",
      timeoutMs: 5_000,
      preview: "copy exports",
    }

    // When: the shell command is assembled for SSH execution.
    const command = buildCommand(commandSpec)

    // Then: sudo reads the injected password from stdin instead of requiring a terminal prompt.
    expect(command).toBe("sudo -S -p '' sh '-c' 'cp /tmp/.lsm_exports.tmp /etc/exports'")
  })
})
