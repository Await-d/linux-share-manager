import type { CommandSpec } from "../executor/command"
import { executeCommands } from "../executor/ssh-executor"
import type { NodeCredential } from "./repository"

export type ProbeOptions = {
  readonly connectTimeoutMs: number
  readonly commandTimeoutMs: number
  readonly maxOutputBytes: number
}

export type NodeProbeResult = {
  readonly nodeId: string
  readonly sshOk: boolean
  readonly sshError: string | null
  readonly osFamily: string | null
  readonly osVersion: string | null
  readonly osPrettyName: string | null
  readonly sudoOk: boolean
  readonly sudoError: string | null
  readonly systemdOk: boolean
  readonly systemdState: string | null
  readonly nfsServerInstalled: boolean
  readonly nfsClientInstalled: boolean
  readonly firewallType: string | null
  readonly firewallActive: boolean
  readonly ipAddresses: readonly string[]
  readonly primaryIp: string | null
  readonly diskSummary: readonly DiskInfo[]
  readonly packageManager: string | null
  readonly probedAt: string
}

export type DiskInfo = {
  readonly filesystem: string
  readonly mountPoint: string
  readonly total: string
  readonly used: string
  readonly available: string
  readonly usePercent: string
}

function buildProbeCommands(): readonly CommandSpec[] {
  return [
    {
      executable: "cat",
      args: ["/etc/os-release"],
      sudo: false,
      timeoutMs: 5_000,
      preview: "cat /etc/os-release",
    },
    {
      executable: "id",
      args: ["-u"],
      sudo: false,
      timeoutMs: 3_000,
      preview: "id -u",
    },
    {
      executable: "sudo",
      args: ["-n", "true"],
      sudo: false,
      timeoutMs: 5_000,
      preview: "sudo -n true",
    },
    {
      executable: "command",
      args: ["-v", "systemctl"],
      sudo: false,
      timeoutMs: 3_000,
      preview: "command -v systemctl",
    },
    {
      executable: "systemctl",
      args: ["is-system-running"],
      sudo: false,
      timeoutMs: 5_000,
      preview: "systemctl is-system-running",
    },
    {
      executable: "command",
      args: ["-v", "exportfs"],
      sudo: false,
      timeoutMs: 3_000,
      preview: "command -v exportfs",
    },
    {
      executable: "command",
      args: ["-v", "mount.nfs"],
      sudo: false,
      timeoutMs: 3_000,
      preview: "command -v mount.nfs",
    },
    {
      executable: "ip",
      args: ["-o", "addr", "show"],
      sudo: false,
      timeoutMs: 5_000,
      preview: "ip -o addr show",
    },
    {
      executable: "df",
      args: ["-P", "-h"],
      sudo: false,
      timeoutMs: 5_000,
      preview: "df -P -h",
    },
    {
      executable: "sh",
      args: [
        "-c",
        "command -v ufw && ufw status 2>/dev/null || command -v firewall-cmd && firewall-cmd --state 2>/dev/null || echo 'none'",
      ],
      sudo: false,
      timeoutMs: 5_000,
      preview: "firewall detection",
    },
  ]
}

export async function probeNode(
  credential: NodeCredential,
  options: ProbeOptions,
): Promise<NodeProbeResult> {
  const specs = buildProbeCommands()
  const results = await executeCommands(credential, specs, {
    connectTimeoutMs: options.connectTimeoutMs,
    defaultCommandTimeoutMs: options.commandTimeoutMs,
    maxOutputBytes: options.maxOutputBytes,
  })

  // Extract results by index
  const osRelease = results[0]?.result.stdout ?? ""
  const idOutput = results[1]?.result.stdout.trim() ?? ""
  const sudoResult = results[2]
  const systemctlPath = results[3]?.result.stdout.trim() ?? ""
  const systemRunning = results[4]?.result.stdout.trim() ?? ""
  const exportfsPath = results[5]?.result.stdout.trim() ?? ""
  const mountNfsPath = results[6]?.result.stdout.trim() ?? ""
  const ipOutput = results[7]?.result.stdout ?? ""
  const dfOutput = results[8]?.result.stdout ?? ""
  const firewallOutput = results[9]?.result.stdout.trim() ?? ""

  const osInfo = parseOsRelease(osRelease)
  const ipAddresses = parseIpAddresses(ipOutput)
  const primaryIp = ipAddresses.length > 0 ? ipAddresses[0] : null
  const diskSummary = parseDfOutput(dfOutput)
  const firewallInfo = parseFirewall(firewallOutput)
  const packageManager = detectPackageManager(osInfo.family)

  const sshOk = results.length > 0 && results[0].result.exitCode === 0
  const sshError =
    results.length === 0 ? "No probe results — SSH connection may have failed." : null

  const sudoOk = sudoResult?.result.exitCode === 0
  const sudoError = sudoOk ? null : sudoResult?.result.stderr.trim() || "sudo not available"

  const systemdOk = systemctlPath.length > 0 && !systemRunning.includes("unknown")

  return {
    nodeId: credential.id,
    sshOk,
    sshError,
    osFamily: osInfo.family,
    osVersion: osInfo.version,
    osPrettyName: osInfo.prettyName,
    sudoOk,
    sudoError,
    systemdOk,
    systemdState: systemRunning || null,
    nfsServerInstalled: exportfsPath.length > 0,
    nfsClientInstalled: mountNfsPath.length > 0,
    firewallType: firewallInfo.type,
    firewallActive: firewallInfo.active,
    ipAddresses,
    primaryIp,
    diskSummary,
    packageManager,
    probedAt: new Date().toISOString(),
  }
}

type OsInfo = { family: string | null; version: string | null; prettyName: string | null }

function parseOsRelease(raw: string): OsInfo {
  const lines = raw.split("\n")
  let id = ""
  let versionId = ""
  let prettyName = ""

  for (const line of lines) {
    const match = line.match(/^(\w+)="?([^"]*)"?$/)
    if (match === null) continue
    const [, key, value] = match
    switch (key) {
      case "ID":
        id = value
        break
      case "VERSION_ID":
        versionId = value
        break
      case "PRETTY_NAME":
        prettyName = value
        break
    }
  }

  const family = mapOsFamily(id)
  return {
    family,
    version: versionId || null,
    prettyName: prettyName || null,
  }
}

function mapOsFamily(id: string): string | null {
  switch (id.toLowerCase()) {
    case "ubuntu":
    case "debian":
    case "linuxmint":
    case "pop":
      return "debian"
    case "rhel":
    case "centos":
    case "rocky":
    case "almalinux":
    case "fedora":
    case "amzn":
      return "rhel"
    case "arch":
    case "manjaro":
      return "arch"
    case "opensuse":
    case "sles":
    case "opensuse-leap":
    case "opensuse-tumbleweed":
      return "suse"
    default:
      return id || null
  }
}

function detectPackageManager(family: string | null): string | null {
  switch (family) {
    case "debian":
      return "apt"
    case "rhel":
      return "dnf"
    case "arch":
      return "pacman"
    case "suse":
      return "zypper"
    default:
      return null
  }
}

function parseIpAddresses(raw: string): readonly string[] {
  const addresses: string[] = []
  const lines = raw.split("\n")
  for (const line of lines) {
    // ip -o addr show format: <num>: <iface> inet <ip>/<prefix> ...
    const match = line.match(/inet\s+([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)/)
    if (match !== null && match[1] !== "127.0.0.1") {
      addresses.push(match[1])
    }
  }
  return addresses
}

function parseDfOutput(raw: string): readonly DiskInfo[] {
  const disks: DiskInfo[] = []
  const lines = raw.split("\n")
  // Skip header line
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.length === 0) continue
    const parts = line.split(/\s+/)
    if (parts.length >= 6) {
      disks.push({
        filesystem: parts[0],
        mountPoint: parts[5],
        total: parts[1],
        used: parts[2],
        available: parts[3],
        usePercent: parts[4],
      })
    }
  }
  return disks
}

function parseFirewall(raw: string): { type: string | null; active: boolean } {
  const lower = raw.toLowerCase()
  if (lower.includes("ufw")) {
    return { type: "ufw", active: lower.includes("active") && !lower.includes("inactive") }
  }
  if (lower.includes("firewalld") || lower.includes("running")) {
    return { type: "firewalld", active: lower.includes("running") }
  }
  if (lower.includes("none") || lower.length === 0) {
    return { type: null, active: false }
  }
  return { type: "unknown", active: false }
}
