/**
 * Share pre-check service — validates prerequisites before generating or applying a share plan.
 *
 * Checks performed:
 *   1. SSH connectivity to source and target nodes (TCP-level)
 *   2. NFS server package installed on source node (via SSH)
 *   3. NFS client package installed on target node (via SSH)
 *   4. NFS service actual listening port(s) on source node (via SSH: ss -tlnp)
 *   5. NFS service running state on source node (via SSH: systemctl is-active)
 *   6. NFS port reachability — from this service → source, AND from target → source (via SSH)
 *
 * Key design decisions:
 *   - We detect the *actual* NFS listening port(s) instead of assuming 2049.
 *   - When the service listens on a non-default port, we report it so the plan builder
 *     can embed the correct `port=` option in mount units.
 *   - When NFS is not listening at all (stopped/crashed), we distinguish that from
 *     "listening but firewall blocked".
 */

import { executeCommands } from "../executor/ssh-executor"
import { logger } from "../logger"
import { testTcpConnection } from "../nodes/connectivity"
import type { NodeCredential } from "../nodes/repository"
import { isReachableProbeOutput } from "./reachability"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Detected NFS port information from source node. */
export type NfsPortInfo = {
  /** All detected NFS TCP listening ports (may include 2049, 111, mountd, etc.) */
  readonly listeningPorts: readonly number[]
  /** Primary NFS service port (2049 if found, otherwise the first detected port) */
  readonly primaryPort: number | null
  /** Whether the default port 2049 is among the listening ports */
  readonly defaultPortOk: boolean
  /** Whether any NFS port is listening */
  readonly anyPortListening: boolean
  /** Raw `ss -tlnp` line(s) for NFS processes (diagnostic) */
  readonly rawSsOutput: string | null
}

export type NfsProtocolVersion = "3" | "4" | "4.1" | "4.2"

export type NfsVersionInfo = {
  readonly supportedVersions: readonly NfsProtocolVersion[]
  readonly preferredVersion: NfsProtocolVersion | null
  readonly rawVersionsOutput: string | null
}

export type PreCheckResult = {
  /** Overall result — true only when all hard-block checks pass (SSH). */
  readonly passed: boolean
  readonly sourceSshOk: boolean
  readonly targetSshOk: boolean
  readonly sourceSudoOk: boolean
  readonly targetSudoOk: boolean
  /** Deprecated alias kept for backward compatibility — use nfsPortInfo.defaultPortOk instead. */
  readonly nfsPort2049Ok: boolean
  /** Full NFS port detection result. */
  readonly nfsPortInfo: NfsPortInfo
  readonly nfsVersionInfo: NfsVersionInfo
  readonly nfsServerInstalled: boolean
  readonly nfsClientInstalled: boolean
  readonly nfsServerRunning: boolean
  readonly warnings: readonly string[]
  readonly errors: readonly string[]
  readonly summary: string
}

export type PreCheckOptions = {
  readonly connectTimeoutMs: number
  readonly commandTimeoutMs: number
  readonly maxOutputBytes: number
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function runPreCheck(
  sourceCred: NodeCredential,
  targetCred: NodeCredential,
  sourceHost: string,
  options: PreCheckOptions,
): Promise<PreCheckResult> {
  const warnings: string[] = []
  const errors: string[] = []

  logger.info({ sourceHost, targetHost: targetCred.host }, "share pre-check started")

  // 1. SSH connectivity (TCP-level)
  const [sourceSshOk, targetSshOk] = await Promise.all([
    testTcpConnection({
      host: sourceCred.host,
      port: sourceCred.port,
      timeoutMs: options.connectTimeoutMs,
    }),
    testTcpConnection({
      host: targetCred.host,
      port: targetCred.port,
      timeoutMs: options.connectTimeoutMs,
    }),
  ])

  if (!sourceSshOk) {
    errors.push(`源节点 ${sourceCred.host}:${sourceCred.port} SSH 端口不可达`)
    logger.warn({ host: sourceCred.host, port: sourceCred.port }, "source node SSH unreachable")
  }
  if (!targetSshOk) {
    errors.push(`目标节点 ${targetCred.host}:${targetCred.port} SSH 端口不可达`)
    logger.warn({ host: targetCred.host, port: targetCred.port }, "target node SSH unreachable")
  }

  // If either node is unreachable at SSH level, stop here.
  if (!sourceSshOk || !targetSshOk) {
    const emptyPortInfo = emptyNfsPortInfo()
    return buildResult(
      false,
      sourceSshOk,
      targetSshOk,
      false,
      false,
      emptyPortInfo,
      emptyNfsVersionInfo(),
      false,
      false,
      false,
      warnings,
      errors,
    )
  }

  const sshOpts = {
    connectTimeoutMs: options.connectTimeoutMs,
    defaultCommandTimeoutMs: options.commandTimeoutMs,
    maxOutputBytes: options.maxOutputBytes,
  }

  // 2. SSH-level checks: NFS packages, service status, AND actual listening ports
  let nfsServerInstalled = false
  let nfsClientInstalled = false
  let nfsServerRunning = false
  let sourceSudoOk = false
  let targetSudoOk = false
  let portInfo: NfsPortInfo = emptyNfsPortInfo()
  let versionInfo: NfsVersionInfo = emptyNfsVersionInfo()

  try {
    // Run all source-side checks in one SSH session:
    //   [0] sudo -n true              → is passwordless sudo available?
    //   [1] command -v exportfs        → is NFS server package installed?
    //   [2] systemctl is-active ...    → is NFS server running?
    //   [3] ss -tlnp | grep nfs       → what ports is NFS actually listening on?
    //   [4] /proc/fs/nfsd/versions    → which NFS protocol versions are enabled?
    const sourceResults = await executeCommands(
      sourceCred,
      [
        {
          executable: "sudo",
          args: ["-n", "true"],
          sudo: false,
          timeoutMs: 5_000,
          preview: "sudo -n true",
        },
        {
          executable: "command",
          args: ["-v", "exportfs"],
          sudo: false,
          timeoutMs: 5_000,
          preview: "command -v exportfs",
        },
        {
          executable: "sh",
          args: [
            "-c",
            "systemctl is-active nfs-server nfs-kernel-server 2>/dev/null || echo 'inactive'",
          ],
          sudo: false,
          timeoutMs: 5_000,
          preview: "systemctl is-active nfs-server nfs-kernel-server",
        },
        {
          executable: "sh",
          args: ["-c", "ss -tlnp 2>/dev/null | grep -i nfs || echo 'NO_NFS_LISTEN'"],
          sudo: false,
          timeoutMs: 5_000,
          preview: "ss -tlnp | grep nfs (detect actual NFS port)",
        },
        {
          executable: "sh",
          args: [
            "-c",
            "cat /proc/fs/nfsd/versions 2>/dev/null || rpcinfo -p 2>/dev/null | grep nfs || echo 'NO_NFS_VERSIONS'",
          ],
          sudo: false,
          timeoutMs: 5_000,
          preview: "detect supported NFS protocol versions",
        },
      ],
      sshOpts,
    )

    nfsServerInstalled =
      sourceResults.length >= 2 && (sourceResults[1]?.result.stdout.trim().length ?? 0) > 0
    nfsServerRunning = Boolean(
      sourceResults.length >= 3 &&
        sourceResults[2]?.result.stdout.includes("active") &&
        !sourceResults[2]?.result.stdout.includes("inactive"),
    )
    sourceSudoOk = sourceResults.length >= 1 && (sourceResults[0]?.result.exitCode ?? 1) === 0

    // Parse actual listening ports
    const ssOutput = sourceResults.length >= 4 ? (sourceResults[3]?.result.stdout.trim() ?? "") : ""
    portInfo = parseNfsPorts(ssOutput)
    const versionOutput =
      sourceResults.length >= 5 ? (sourceResults[4]?.result.stdout.trim() ?? "") : ""
    versionInfo = parseNfsVersions(versionOutput)

    // If ss didn't find NFS listening but service reports as running, try rpcinfo fallback
    if (!portInfo.anyPortListening && nfsServerRunning) {
      logger.info({ host: sourceCred.host }, "ss didn't find NFS ports; trying rpcinfo fallback")
      try {
        const rpcResults = await executeCommands(
          sourceCred,
          [
            {
              executable: "sh",
              args: ["-c", "rpcinfo -p 2>/dev/null | grep nfs || echo 'NO_RPC_NFS'"],
              sudo: false,
              timeoutMs: 5_000,
              preview: "rpcinfo -p | grep nfs",
            },
          ],
          sshOpts,
        )
        const rpcOutput = rpcResults.length > 0 ? (rpcResults[0]?.result.stdout.trim() ?? "") : ""
        const rpcPorts = parseRpcNfsPorts(rpcOutput)
        if (rpcPorts.length > 0) {
          portInfo = {
            listeningPorts: rpcPorts,
            primaryPort: rpcPorts.includes(2049) ? 2049 : (rpcPorts[0] ?? null),
            defaultPortOk: rpcPorts.includes(2049),
            anyPortListening: true,
            rawSsOutput: `rpcinfo: ${rpcOutput}`,
          }
        }
      } catch {
        logger.warn({ host: sourceCred.host }, "rpcinfo fallback also failed")
      }
    }

    // Build appropriate warnings based on port detection
    if (!nfsServerInstalled) {
      warnings.push("源节点未安装 NFS 服务端 (exportfs 命令不可用) — 执行计划时将自动安装")
      logger.warn({ host: sourceCred.host }, "NFS server not installed")
    } else if (!nfsServerRunning) {
      warnings.push("源节点 NFS 服务未运行 — 执行计划时将自动启动")
      logger.warn({ host: sourceCred.host }, "NFS server installed but not running")
    } else if (!portInfo.anyPortListening) {
      // Service reports "active" but no port is listening — likely a crashed/stuck state
      warnings.push(
        "源节点 NFS 服务状态为 active 但未检测到任何 NFS 监听端口 — 服务可能处于异常状态，建议重启",
      )
      logger.warn({ host: sourceCred.host }, "NFS service reports active but no port listening")
    } else if (!portInfo.defaultPortOk) {
      // Listening but on non-default port(s) — plan needs to use the correct port
      warnings.push(
        `源节点 NFS 服务未使用默认端口 2049，实际监听端口: ${portInfo.listeningPorts.join(", ")} — 挂载配置将使用检测到的端口`,
      )
      logger.warn(
        { host: sourceCred.host, ports: portInfo.listeningPorts },
        "NFS using non-default port(s)",
      )
    } else {
      logger.info({ host: sourceCred.host }, "NFS server installed, running, port 2049 listening")
    }

    if (
      versionInfo.supportedVersions.length > 0 &&
      !versionInfo.supportedVersions.some((version) => version.startsWith("4"))
    ) {
      warnings.push(
        `源节点未启用 NFS 4.x，仅支持 ${versionInfo.supportedVersions.join(", ")} — 自动模式将回退到兼容版本`,
      )
      logger.warn(
        { host: sourceCred.host, versions: versionInfo.supportedVersions },
        "source NFS supports legacy versions only",
      )
    }

    // If NFS is listening on any port, test reachability from THIS service
    if (portInfo.primaryPort !== null) {
      const primaryPortReachable = await testTcpConnection({
        host: sourceHost,
        port: portInfo.primaryPort,
        timeoutMs: options.connectTimeoutMs,
      })
      if (!primaryPortReachable) {
        logger.warn(
          { host: sourceHost, nfsPort: portInfo.primaryPort },
          "NFS port not reachable from management service",
        )
        warnings.push(
          `源节点 NFS 端口 ${portInfo.primaryPort} 从管理服务不可达 — 请检查防火墙规则 (端口: ` +
            `${portInfo.listeningPorts.join(",")})`,
        )
      }
    } else if (nfsServerRunning) {
      // Service running but couldn't detect any port — still check 2049 as fallback
      const nfsPort2049Ok = await testTcpConnection({
        host: sourceHost,
        port: 2049,
        timeoutMs: options.connectTimeoutMs,
      })
      if (!nfsPort2049Ok) {
        logger.warn({ host: sourceHost }, "NFS port 2049 fallback check failed")
        warnings.push("源节点 NFS 服务端口 2049 不可达 — NFS 服务可能未正常监听或防火墙阻止了连接")
      } else {
        // Port 2049 is reachable even though ss didn't show it — update port info
        portInfo = {
          listeningPorts: [2049],
          primaryPort: 2049,
          defaultPortOk: true,
          anyPortListening: true,
          rawSsOutput: portInfo.rawSsOutput,
        }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`源节点 NFS 检测失败: ${msg}`)
    logger.error({ err: msg, host: sourceCred.host }, "NFS server check failed")
  }

  // 3. Check NFS client and sudo on target node
  try {
    const targetResults = await executeCommands(
      targetCred,
      [
        {
          executable: "sudo",
          args: ["-n", "true"],
          sudo: false,
          timeoutMs: 5_000,
          preview: "sudo -n true",
        },
        {
          executable: "command",
          args: ["-v", "mount.nfs"],
          sudo: false,
          timeoutMs: 5_000,
          preview: "command -v mount.nfs",
        },
      ],
      sshOpts,
    )

    targetSudoOk = targetResults.length >= 1 && (targetResults[0]?.result.exitCode ?? 1) === 0
    nfsClientInstalled =
      targetResults.length >= 2 && (targetResults[1]?.result.stdout.trim().length ?? 0) > 0

    if (!targetSudoOk) {
      warnings.push(
        "目标节点 sudo 需要密码 — 部分操作（安装软件包、写入 systemd 单元）可能失败，建议配置 NOPASSWD",
      )
      logger.warn({ host: targetCred.host }, "target node sudo requires password")
    }
    if (!sourceSudoOk) {
      warnings.push(
        "源节点 sudo 需要密码 — 部分操作（安装软件包、写入 /etc/exports）可能失败，建议配置 NOPASSWD",
      )
      logger.warn({ host: sourceCred.host }, "source node sudo requires password")
    }
    if (!nfsClientInstalled) {
      warnings.push("目标节点未安装 NFS 客户端 (mount.nfs 命令不可用) — 执行计划时将自动安装")
      logger.warn({ host: targetCred.host }, "NFS client not installed")
    } else {
      logger.info({ host: targetCred.host }, "NFS client installed")
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    warnings.push(`目标节点 NFS 客户端检测失败: ${msg}`)
    logger.error({ err: msg, host: targetCred.host }, "NFS client check failed")
  }

  // 4. Cross-node NFS reachability: from target → source NFS port (via SSH on target)
  if (portInfo.primaryPort !== null) {
    try {
      const crossResults = await executeCommands(
        targetCred,
        [
          {
            executable: "sh",
            args: [
              "-c",
              `timeout 3 bash -c 'echo >/dev/tcp/${sourceHost}/${portInfo.primaryPort}' 2>/dev/null && echo 'REACHABLE' || echo 'UNREACHABLE'`,
            ],
            sudo: false,
            timeoutMs: 8_000,
            preview: `test TCP ${sourceHost}:${portInfo.primaryPort} from target`,
          },
        ],
        sshOpts,
      )
      const crossOutput =
        crossResults.length > 0 ? (crossResults[0]?.result.stdout.trim() ?? "") : ""
      const targetCanReach = isReachableProbeOutput(crossOutput)

      if (!targetCanReach) {
        warnings.push(
          `目标节点无法连接到源节点 NFS 端口 ${sourceHost}:${portInfo.primaryPort} — ` +
            `请检查源节点防火墙规则，确保允许来自目标节点 ${targetCred.host} 的 NFS 流量`,
        )
        logger.warn(
          { sourceHost, targetHost: targetCred.host, nfsPort: portInfo.primaryPort },
          "target cannot reach source NFS port",
        )
      } else {
        logger.info(
          { sourceHost, targetHost: targetCred.host, nfsPort: portInfo.primaryPort },
          "target can reach source NFS port",
        )
      }
    } catch {
      // Cross-check failure is a warning, not a hard error
      logger.warn(
        { sourceHost, targetHost: targetCred.host },
        "cross-node NFS reachability check failed with exception",
      )
      warnings.push("无法验证目标节点到源节点 NFS 端口的连通性")
    }
  }

  // Determine overall pass/fail — only hard-block on SSH failures.
  const passed = errors.length === 0

  return buildResult(
    passed,
    sourceSshOk,
    targetSshOk,
    sourceSudoOk,
    targetSudoOk,
    portInfo,
    versionInfo,
    nfsServerInstalled,
    nfsClientInstalled,
    nfsServerRunning,
    warnings,
    errors,
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse `ss -tlnp | grep nfs` output to extract listening TCP ports. */
function parseNfsPorts(ssOutput: string): NfsPortInfo {
  if (ssOutput.length === 0 || ssOutput.includes("NO_NFS_LISTEN")) {
    return emptyNfsPortInfo()
  }

  const ports: number[] = []
  for (const line of ssOutput.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue

    // ss output format: "LISTEN 0 128 0.0.0.0:2049 0.0.0.0:* users:(("nfsd",pid=...))"
    // Or: "LISTEN 0 128 *:2049 *:* ..."
    // We match the port after the last colon in the 4th or 5th column
    const match = trimmed.match(/(?:\d+\.\d+\.\d+\.\d+|\*):(\d+)/g)
    if (match !== null) {
      for (const m of match) {
        const port = Number.parseInt(m.split(":")[1] ?? "", 10)
        if (!Number.isNaN(port) && !ports.includes(port)) {
          ports.push(port)
        }
      }
    }
  }

  ports.sort((a, b) => a - b)

  return {
    listeningPorts: ports,
    primaryPort: ports.includes(2049) ? 2049 : (ports[0] ?? null),
    defaultPortOk: ports.includes(2049),
    anyPortListening: ports.length > 0,
    rawSsOutput: ssOutput,
  }
}

/** Parse `rpcinfo -p | grep nfs` fallback output. */
function parseRpcNfsPorts(rpcOutput: string): readonly number[] {
  if (rpcOutput.length === 0 || rpcOutput.includes("NO_RPC_NFS")) {
    return []
  }

  const ports: number[] = []
  for (const line of rpcOutput.split("\n")) {
    // rpcinfo format: "program vers proto   port  service"
    // e.g.: "100003    3   tcp   2049  nfs"
    const match = line.match(/\s+(tcp|udp)\s+(\d+)\s+nfs/i)
    if (match !== null) {
      const port = Number.parseInt(match[2] ?? "", 10)
      if (!Number.isNaN(port) && !ports.includes(port)) {
        ports.push(port)
      }
    }
  }

  return ports
}

export function parseNfsVersions(rawOutput: string): NfsVersionInfo {
  if (rawOutput.length === 0 || rawOutput.includes("NO_NFS_VERSIONS")) {
    return emptyNfsVersionInfo()
  }

  const supported = new Set<NfsProtocolVersion>()
  for (const token of rawOutput.split(/\s+/)) {
    const version = token.replace(/^[+-]/, "")
    if (!token.startsWith("-") && isNfsProtocolVersion(version)) {
      supported.add(version)
    }
  }

  const supportedVersions = nfsVersionPreference().filter((version) => supported.has(version))
  return {
    supportedVersions,
    preferredVersion: supportedVersions.at(0) ?? null,
    rawVersionsOutput: rawOutput,
  }
}

function isNfsProtocolVersion(version: string): version is NfsProtocolVersion {
  switch (version) {
    case "3":
    case "4":
    case "4.1":
    case "4.2":
      return true
    default:
      return false
  }
}

function nfsVersionPreference(): readonly NfsProtocolVersion[] {
  return ["4.2", "4.1", "4", "3"]
}

function emptyNfsPortInfo(): NfsPortInfo {
  return {
    listeningPorts: [],
    primaryPort: null,
    defaultPortOk: false,
    anyPortListening: false,
    rawSsOutput: null,
  }
}

function emptyNfsVersionInfo(): NfsVersionInfo {
  return {
    supportedVersions: [],
    preferredVersion: null,
    rawVersionsOutput: null,
  }
}

function buildResult(
  passed: boolean,
  sourceSshOk: boolean,
  targetSshOk: boolean,
  sourceSudoOk: boolean,
  targetSudoOk: boolean,
  portInfo: NfsPortInfo,
  versionInfo: NfsVersionInfo,
  nfsServerInstalled: boolean,
  nfsClientInstalled: boolean,
  nfsServerRunning: boolean,
  warnings: readonly string[],
  errors: readonly string[],
): PreCheckResult {
  const parts: string[] = []

  if (sourceSshOk && targetSshOk) {
    parts.push("SSH: 两个节点均可达")
  } else if (sourceSshOk) {
    parts.push("SSH: 源节点可达，目标节点不可达")
  } else if (targetSshOk) {
    parts.push("SSH: 目标节点可达，源节点不可达")
  } else {
    parts.push("SSH: 两个节点均不可达")
  }

  // NFS port status summary
  if (portInfo.defaultPortOk) {
    parts.push("NFS 端口 2049: 可达")
  } else if (portInfo.anyPortListening) {
    parts.push(`NFS 端口: ${portInfo.listeningPorts.join(",")} (非默认)`)
  } else {
    parts.push("NFS 端口: 未检测到监听")
  }

  if (versionInfo.preferredVersion !== null) {
    parts.push(
      `NFS 版本: ${versionInfo.supportedVersions.join(",")} (自动: ${versionInfo.preferredVersion})`,
    )
  } else {
    parts.push("NFS 版本: 未检测")
  }

  parts.push(
    `NFS 服务端: ${nfsServerInstalled ? (nfsServerRunning ? "已安装且运行中" : "已安装但未运行") : "未安装"}`,
  )
  parts.push(`NFS 客户端: ${nfsClientInstalled ? "已安装" : "未安装"}`)

  const summary = parts.join(" | ")

  logger.info(
    { passed, summary, warningCount: warnings.length, errorCount: errors.length },
    "share pre-check completed",
  )

  return {
    passed,
    sourceSshOk,
    targetSshOk,
    sourceSudoOk,
    targetSudoOk,
    nfsPort2049Ok: portInfo.defaultPortOk,
    nfsPortInfo: portInfo,
    nfsVersionInfo: versionInfo,
    nfsServerInstalled,
    nfsClientInstalled,
    nfsServerRunning,
    warnings,
    errors,
    summary,
  }
}
