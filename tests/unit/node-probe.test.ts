import { describe, expect, it } from "bun:test"
import type { CommandSpec, ExecutedStep } from "../../src/server/executor/command"
import { buildNodeProbeResult } from "../../src/server/nodes/probe"
import type { NodeCredential } from "../../src/server/nodes/repository"

const credential = {
  id: "107f4a27-9ad8-4837-b8f7-821680754b68",
  host: "192.168.123.5",
  port: 22,
  username: "await",
  authType: "password_session",
  credentialKind: "password_set",
  decryptedSecret: "secret-password",
} satisfies NodeCredential

function command(preview: string): CommandSpec {
  return {
    executable: "sh",
    args: ["-c", preview],
    sudo: false,
    timeoutMs: 5_000,
    preview,
  }
}

function executedStep(
  preview: string,
  stdout: string,
  stderr: string,
  exitCode: number,
): ExecutedStep {
  const now = new Date("2026-07-07T00:00:00.000Z")
  return {
    spec: command(preview),
    result: {
      stdout,
      stderr,
      exitCode,
      timedOut: false,
    },
    startedAt: now,
    finishedAt: now,
  }
}

describe("node probe result builder", () => {
  it("keeps sshOk true when SSH ran probe commands but some probes failed", () => {
    const result = buildNodeProbeResult({
      credential,
      probedAt: "2026-07-07T00:00:00.000Z",
      results: [
        executedStep("cat /etc/os-release", "", "cat: /etc/os-release: No such file", 1),
        executedStep("id -u", "1000\n", "", 0),
        executedStep("sudo -n true", "", "sudo: a password is required", 1),
        executedStep("command -v systemctl", "/usr/bin/systemctl\n", "", 0),
        executedStep("systemctl is-system-running", "degraded\n", "", 1),
        executedStep("command -v exportfs", "/usr/sbin/exportfs\n", "", 0),
        executedStep("command -v mount.nfs", "/usr/sbin/mount.nfs\n", "", 0),
        executedStep(
          "ip -o addr show",
          "2: eth0 inet 192.168.123.5/24 brd 192.168.123.255 scope global eth0\n",
          "",
          0,
        ),
        executedStep(
          "df -P -h",
          "Filesystem Size Used Avail Use% Mounted on\n/dev/sda1 40G 10G 30G 25% /\n",
          "",
          0,
        ),
        executedStep("firewall detection", "none\n", "", 0),
      ],
    })

    expect(result.sshOk).toBe(true)
    expect(result.sshError).toBeNull()
    expect(result.osFamily).toBeNull()
    expect(result.sudoOk).toBe(false)
    expect(result.nfsServerInstalled).toBe(true)
    expect(result.nfsClientInstalled).toBe(true)
    expect(result.primaryIp).toBe("192.168.123.5")
  })
})
