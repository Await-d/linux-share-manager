/**
 * Share Plan Builder — validates inputs, generates execution plans,
 * checks path conflicts, and produces a frozen plan for confirmation.
 */

import type { ShareResponse } from "../../shared/schemas/shares"
import { type CommandSpec, shellEscape } from "../executor/command"
import { logger } from "../logger"

// --- Types ---

export type PlanRiskLevel = "low" | "medium" | "high"

export type PlanStep = {
  readonly key: string
  readonly name: string
  readonly description: string
  readonly nodeId: string
  readonly nodeName: string
  readonly commands: readonly CommandSpec[]
  readonly rollbackCommands: readonly CommandSpec[]
  readonly sensitive: boolean
  readonly reversible: boolean
}

export type SharePlan = {
  readonly shareId: string
  readonly shareName: string
  readonly version: number
  readonly riskLevel: PlanRiskLevel
  readonly warnings: readonly string[]
  readonly sourceNode: PlanNodeInfo
  readonly targetNode: PlanNodeInfo
  readonly config: PlanConfig
  readonly steps: readonly PlanStep[]
  readonly generatedAt: string
}

export type PlanNodeInfo = {
  readonly id: string
  readonly name: string
  readonly host: string
  readonly osFamily: string | null
  readonly primaryIp: string | null
  readonly sudoOk: boolean
  readonly nfsServerInstalled: boolean
  readonly nfsClientInstalled: boolean
  /** SSH password for sudo -S when NOPASSWD is unavailable (null for key-based auth). */
  readonly sudoPassword: string | null
}

export type PlanConfig = {
  readonly sourcePath: string
  readonly targetPath: string
  readonly accessMode: "read_only" | "read_write"
  readonly nfsVersion: string
  readonly requestedNfsVersion: string
  readonly autoMount: boolean
  readonly clientAllowRule: string
  /** Optional NFS server port override (when not using default 2049). */
  readonly nfsPort?: number | undefined
}

export type SupportedNfsVersion = "3" | "4" | "4.1" | "4.2"

export type SharePlanOptions = {
  readonly version?: number
  readonly nfsPort?: number | undefined
  readonly supportedNfsVersions?: readonly SupportedNfsVersion[]
}

export type PlanValidationError = {
  readonly code: string
  readonly message: string
  readonly path: string
}

// --- Forbidden paths ---

const FORBIDDEN_PATHS = [
  "/bin",
  "/boot",
  "/dev",
  "/etc",
  "/lib",
  "/lib64",
  "/proc",
  "/root",
  "/run",
  "/sbin",
  "/sys",
  "/usr",
  "/var/lib/mysql",
  "/var/lib/postgresql",
  "/var/lib/redis",
  "/var/lib/docker",
]

const NFS_VERSION_PREFERENCE: readonly SupportedNfsVersion[] = ["4.2", "4.1", "4", "3"]

// --- Path validation ---

export function validatePaths(
  sourcePath: string,
  targetPath: string,
): readonly PlanValidationError[] {
  const errors: PlanValidationError[] = []

  if (!sourcePath.startsWith("/")) {
    errors.push({
      code: "INVALID_SOURCE_PATH",
      message: "源目录必须是绝对路径。",
      path: "sourcePath",
    })
  }
  if (sourcePath === "/") {
    errors.push({
      code: "INVALID_SOURCE_PATH",
      message: "源目录不能是根目录 /。",
      path: "sourcePath",
    })
  }
  if (FORBIDDEN_PATHS.includes(sourcePath)) {
    errors.push({
      code: "INVALID_SOURCE_PATH",
      message: `源目录 ${sourcePath} 是受保护的系统路径。`,
      path: "sourcePath",
    })
  }
  if (!targetPath.startsWith("/")) {
    errors.push({
      code: "INVALID_TARGET_PATH",
      message: "目标目录必须是绝对路径。",
      path: "targetPath",
    })
  }
  if (FORBIDDEN_PATHS.includes(targetPath)) {
    errors.push({
      code: "INVALID_TARGET_PATH",
      message: `目标目录 ${targetPath} 是受保护的系统路径。`,
      path: "targetPath",
    })
  }
  if (sourcePath === targetPath) {
    errors.push({
      code: "PATH_CONFLICT",
      message: "源目录和目标目录不能相同。",
      path: "targetPath",
    })
  }

  return errors
}

export function resolveNfsVersion(
  requestedVersion: string,
  supportedVersions: readonly SupportedNfsVersion[] | undefined,
): SupportedNfsVersion {
  if (requestedVersion !== "auto") {
    return isSupportedNfsVersion(requestedVersion) ? requestedVersion : "4.2"
  }

  if (supportedVersions === undefined || supportedVersions.length === 0) {
    return "4.2"
  }

  return NFS_VERSION_PREFERENCE.find((version) => supportedVersions.includes(version)) ?? "4.2"
}

function isSupportedNfsVersion(version: string): version is SupportedNfsVersion {
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

// --- Plan generation ---

export function generateSharePlan(
  share: ShareResponse,
  sourceNode: PlanNodeInfo,
  targetNode: PlanNodeInfo,
  options: SharePlanOptions = {},
): SharePlan {
  const version = options.version ?? 1
  const nfsPort = options.nfsPort
  const warnings: string[] = []
  let riskLevel: PlanRiskLevel = "low"
  const effectiveNfsVersion = resolveNfsVersion(share.nfsVersion, options.supportedNfsVersions)

  if (!sourceNode.sudoOk) {
    warnings.push("源节点 sudo 不可用 — 可能无法安装或配置 NFS 服务。")
    riskLevel = "high"
  }
  if (!targetNode.sudoOk) {
    warnings.push("目标节点 sudo 不可用 — 可能无法写入 systemd 单元或执行挂载。")
    riskLevel = "high"
  }
  if (sourceNode.osFamily === null) {
    warnings.push("源节点操作系统未探测 — 包安装命令可能不准确。")
    riskLevel = riskLevel === "low" ? "medium" : riskLevel
  }
  if (targetNode.osFamily === null) {
    warnings.push("目标节点操作系统未探测 — 包安装命令可能不准确。")
    riskLevel = riskLevel === "low" ? "medium" : riskLevel
  }
  if (sourceNode.primaryIp === null) {
    warnings.push("源节点未检测到 IP 地址 — 目标节点可能无法访问 NFS 服务。")
    riskLevel = "high"
  }
  if (nfsPort !== undefined && nfsPort !== 2049) {
    warnings.push(`源节点 NFS 服务使用非默认端口 ${nfsPort} — 挂载配置将使用该端口。`)
    riskLevel = riskLevel === "low" ? "medium" : riskLevel
  }
  if (share.nfsVersion === "auto") {
    warnings.push(`NFS 版本已自动选择为 ${effectiveNfsVersion}。`)
  }

  const steps = buildPlanSteps(share, sourceNode, targetNode, effectiveNfsVersion, nfsPort)

  // Strip sudoPassword from steps before returning — passwords are injected at execution time
  const safeSteps = steps.map((step) => ({
    ...step,
    commands: step.commands.map((cmd) => {
      const { sudoPassword: _pw, ...rest } = cmd
      return rest
    }),
    rollbackCommands: step.rollbackCommands.map((cmd) => {
      const { sudoPassword: _pw, ...rest } = cmd
      return rest
    }),
  }))

  // Strip sudoPassword from node info
  const safeSourceNode = { ...sourceNode, sudoPassword: null }
  const safeTargetNode = { ...targetNode, sudoPassword: null }

  logger.info(
    {
      shareId: share.id,
      shareName: share.name,
      version,
      riskLevel,
      stepCount: steps.length,
      warningCount: warnings.length,
      nfsPort: nfsPort ?? 2049,
    },
    "share plan generated",
  )

  return {
    shareId: share.id,
    shareName: share.name,
    version,
    riskLevel,
    warnings,
    sourceNode: safeSourceNode,
    targetNode: safeTargetNode,
    config: {
      sourcePath: share.sourcePath,
      targetPath: share.targetPath,
      accessMode: share.accessMode,
      nfsVersion: effectiveNfsVersion,
      requestedNfsVersion: share.nfsVersion,
      autoMount: share.autoMount,
      clientAllowRule: targetNode.primaryIp ?? targetNode.host,
      nfsPort,
    },
    steps: safeSteps,
    generatedAt: new Date().toISOString(),
  }
}

function buildPlanSteps(
  share: ShareResponse,
  sourceNode: PlanNodeInfo,
  targetNode: PlanNodeInfo,
  nfsVersion: SupportedNfsVersion,
  nfsPort?: number | undefined,
): readonly PlanStep[] {
  const steps: PlanStep[] = []
  const accessOpts = share.accessMode === "read_only" ? "ro" : "rw"
  const exportOptions = `${accessOpts},sync,no_subtree_check,root_squash`
  const portOption = nfsPort !== undefined && nfsPort !== 2049 ? `,port=${nfsPort}` : ""
  const nfsVersionOptions =
    nfsVersion === "3" ? "vers=3,proto=tcp,mountproto=tcp" : `vers=${nfsVersion}`
  const mountOptions = `${nfsVersionOptions},_netdev,nofail,hard,timeo=50,retrans=2${portOption}`

  // Determine sudo strategy for each node:
  // - sudoOk=true → use sudo -n (NOPASSWD)
  // - sudoOk=false but password available → use sudo -S (password via stdin)
  // - sudoOk=false and no password → no sudo
  const sourceSudo = sourceNode.sudoOk || sourceNode.sudoPassword !== null
  const sourceSudoPassword = sourceNode.sudoOk ? undefined : (sourceNode.sudoPassword ?? undefined)
  const targetSudo = targetNode.sudoOk || targetNode.sudoPassword !== null
  const targetSudoPassword = targetNode.sudoOk ? undefined : (targetNode.sudoPassword ?? undefined)

  // Helper: create a sudo-aware command spec for the source node
  const srcCmd = (
    exec: string,
    args: readonly string[],
    timeoutMs: number,
    preview: string,
    sensitive = false,
  ): CommandSpec =>
    sourceSudoPassword !== undefined
      ? {
          executable: exec,
          args,
          sudo: sourceSudo,
          sudoPassword: sourceSudoPassword,
          timeoutMs,
          preview,
          sensitive,
        }
      : { executable: exec, args, sudo: sourceSudo, timeoutMs, preview, sensitive }

  // Helper: create a sudo-aware command spec for the target node
  const tgtCmd = (
    exec: string,
    args: readonly string[],
    timeoutMs: number,
    preview: string,
    sensitive = false,
  ): CommandSpec =>
    targetSudoPassword !== undefined
      ? {
          executable: exec,
          args,
          sudo: targetSudo,
          sudoPassword: targetSudoPassword,
          timeoutMs,
          preview,
          sensitive,
        }
      : { executable: exec, args, sudo: targetSudo, timeoutMs, preview, sensitive }

  // Step 1: Install NFS server on source
  if (!sourceNode.nfsServerInstalled) {
    const installCmds = nfsServerInstallCommands(sourceNode.osFamily, sourceSudo)
    steps.push({
      key: "install-nfs-server",
      name: "安装 NFS Server",
      description: `在源节点 ${sourceNode.name} 上安装 NFS 服务端软件包`,
      nodeId: sourceNode.id,
      nodeName: sourceNode.name,
      commands: installCmds.map((c) =>
        sourceSudoPassword !== undefined ? { ...c, sudoPassword: sourceSudoPassword } : c,
      ),
      rollbackCommands: [],
      sensitive: false,
      reversible: false,
    })
  }

  // Step 2: Create source directory
  steps.push({
    key: "create-source-dir",
    name: "创建源目录",
    description: `在源节点 ${sourceNode.name} 上创建共享目录 ${share.sourcePath}`,
    nodeId: sourceNode.id,
    nodeName: sourceNode.name,
    commands: [srcCmd("mkdir", ["-p", share.sourcePath], 5_000, `mkdir -p ${share.sourcePath}`)],
    rollbackCommands: [],
    sensitive: false,
    reversible: false,
  })

  // Step 3: Backup /etc/exports
  steps.push({
    key: "backup-exports",
    name: "备份 /etc/exports",
    description: `备份源节点 ${sourceNode.name} 的 /etc/exports 文件`,
    nodeId: sourceNode.id,
    nodeName: sourceNode.name,
    commands: [
      srcCmd(
        "cp",
        ["/etc/exports", `/etc/exports.lsm-backup-${share.id}`],
        5_000,
        `cp /etc/exports /etc/exports.lsm-backup-${share.id}`,
      ),
    ],
    rollbackCommands: [],
    sensitive: false,
    reversible: true,
  })

  // Step 3.5: Remove old managed block (avoid duplicate exports on re-execution)
  const cleanOldExportsScript = [
    "share_id=$1",
    "tmp=$(mktemp /tmp/.lsm_exports.XXXXXX)",
    'awk -v share_id="$share_id" \'$0 == "# BEGIN LINUX_SHARE_MANAGER share_id=" share_id { skip = 1; next } $0 == "# END LINUX_SHARE_MANAGER share_id=" share_id { skip = 0; next } skip != 1 { print }\' /etc/exports > "$tmp" && cp "$tmp" /etc/exports',
    "status=$?",
    'rm -f "$tmp"',
    'exit "$status"',
  ].join("; ")
  steps.push({
    key: "clean-old-exports",
    name: "清理旧导出配置",
    description: `移除源节点 ${sourceNode.name} 上该路径的旧导出条目`,
    nodeId: sourceNode.id,
    nodeName: sourceNode.name,
    commands: [
      sudoShellCmd(
        ["-c", cleanOldExportsScript, "sh", share.id],
        5_000,
        `clean old exports for ${share.sourcePath}`,
        sourceSudo,
        sourceSudoPassword,
      ),
    ],
    rollbackCommands: [],
    sensitive: false,
    reversible: false,
  })

  // Step 4: Write exports managed block
  const exportsContent = buildExportsContent(share, targetNode, exportOptions)
  steps.push({
    key: "write-exports",
    name: "配置 NFS exports",
    description: `在源节点 ${sourceNode.name} 的 /etc/exports 中添加托管配置块`,
    nodeId: sourceNode.id,
    nodeName: sourceNode.name,
    commands: [
      sudoShellCmd(
        [
          "-c",
          `printf '%s\\n' ${shellQuoteLines(exportsContent)} | tee -a /etc/exports > /dev/null`,
        ],
        5_000,
        `append exports config to /etc/exports`,
        sourceSudo,
        sourceSudoPassword,
      ),
    ],
    rollbackCommands: [
      srcCmd(
        "cp",
        [`/etc/exports.lsm-backup-${share.id}`, "/etc/exports"],
        5_000,
        "Restore /etc/exports from backup",
      ),
    ],
    sensitive: false,
    reversible: true,
  })

  // Step 5: Enable and start NFS server
  const enableCmds = nfsServerEnableCommands(sourceNode.osFamily, sourceSudo)
  steps.push({
    key: "enable-nfs-server",
    name: "启用 NFS 服务",
    description: `在源节点 ${sourceNode.name} 上启用并启动 NFS 服务`,
    nodeId: sourceNode.id,
    nodeName: sourceNode.name,
    commands: enableCmds.map((c) =>
      sourceSudoPassword !== undefined ? { ...c, sudoPassword: sourceSudoPassword } : c,
    ),
    rollbackCommands: [],
    sensitive: false,
    reversible: true,
  })

  // Step 6: Export filesystems
  steps.push({
    key: "exportfs",
    name: "导出文件系统",
    description: `在源节点 ${sourceNode.name} 上执行 exportfs -ra`,
    nodeId: sourceNode.id,
    nodeName: sourceNode.name,
    commands: [srcCmd("exportfs", ["-ra"], 10_000, "exportfs -ra")],
    rollbackCommands: [],
    sensitive: false,
    reversible: true,
  })

  // Step 7: Install NFS client on target
  if (!targetNode.nfsClientInstalled) {
    const installCmds = nfsClientInstallCommands(targetNode.osFamily, targetSudo)
    steps.push({
      key: "install-nfs-client",
      name: "安装 NFS Client",
      description: `在目标节点 ${targetNode.name} 上安装 NFS 客户端软件包`,
      nodeId: targetNode.id,
      nodeName: targetNode.name,
      commands: installCmds.map((c) =>
        targetSudoPassword !== undefined ? { ...c, sudoPassword: targetSudoPassword } : c,
      ),
      rollbackCommands: [],
      sensitive: false,
      reversible: false,
    })
  }

  // Step 8: Create target mount directory
  steps.push({
    key: "create-target-dir",
    name: "创建挂载目录",
    description: `在目标节点 ${targetNode.name} 上创建挂载点 ${share.targetPath}`,
    nodeId: targetNode.id,
    nodeName: targetNode.name,
    commands: [tgtCmd("mkdir", ["-p", share.targetPath], 5_000, `mkdir -p ${share.targetPath}`)],
    rollbackCommands: [],
    sensitive: false,
    reversible: false,
  })

  // Step 9: Write systemd mount unit
  const mountUnitName = systemdEscapePath(`${share.targetPath}.mount`)
  const automountUnitName = systemdEscapePath(`${share.targetPath}.automount`)
  const mountUnitPath = shellEscape(`/etc/systemd/system/${mountUnitName}`)
  const automountUnitPath = shellEscape(`/etc/systemd/system/${automountUnitName}`)
  const nfsSource = `${sourceNode.primaryIp ?? sourceNode.host}:${share.sourcePath}`
  const mountUnitContent = buildMountUnitContent(share, nfsSource, mountOptions)
  const automountUnitContent = buildAutomountUnitContent(share)
  const disableAutomountScript = [
    "automount_unit=$1",
    "automount_path=$2",
    'systemctl stop "$automount_unit" >/dev/null 2>&1 || true',
    'systemctl disable "$automount_unit" >/dev/null 2>&1 || true',
    'rm -f "$automount_path"',
  ].join("; ")
  const systemdUnitCommands = [
    sudoShellCmd(
      [
        "-c",
        `printf '%s\\n' ${shellQuoteLines(mountUnitContent)} | tee ${mountUnitPath} > /dev/null`,
      ],
      5_000,
      `write ${mountUnitName}`,
      targetSudo,
      targetSudoPassword,
    ),
    ...(share.autoMount
      ? [
          sudoShellCmd(
            [
              "-c",
              `printf '%s\\n' ${shellQuoteLines(automountUnitContent)} | tee ${automountUnitPath} > /dev/null`,
            ],
            5_000,
            `write ${automountUnitName}`,
            targetSudo,
            targetSudoPassword,
          ),
        ]
      : []),
    tgtCmd("systemctl", ["daemon-reload"], 5_000, "systemctl daemon-reload"),
    ...(share.autoMount
      ? [
          tgtCmd(
            "systemctl",
            ["enable", automountUnitName],
            10_000,
            `systemctl enable ${automountUnitName}`,
          ),
          tgtCmd(
            "systemctl",
            ["start", automountUnitName],
            15_000,
            `systemctl start ${automountUnitName}`,
          ),
        ]
      : [
          sudoShellCmd(
            [
              "-c",
              disableAutomountScript,
              "sh",
              automountUnitName,
              `/etc/systemd/system/${automountUnitName}`,
            ],
            10_000,
            `disable stale ${automountUnitName}`,
            targetSudo,
            targetSudoPassword,
          ),
          tgtCmd("systemctl", ["daemon-reload"], 5_000, "systemctl daemon-reload"),
          tgtCmd("systemctl", ["start", mountUnitName], 15_000, `systemctl start ${mountUnitName}`),
        ]),
  ] satisfies readonly CommandSpec[]
  const rollbackUnitCommands = [
    ...(share.autoMount
      ? [
          tgtCmd(
            "systemctl",
            ["stop", automountUnitName],
            10_000,
            `systemctl stop ${automountUnitName}`,
          ),
          tgtCmd(
            "systemctl",
            ["disable", automountUnitName],
            5_000,
            `systemctl disable ${automountUnitName}`,
          ),
        ]
      : [tgtCmd("systemctl", ["stop", mountUnitName], 10_000, `systemctl stop ${mountUnitName}`)]),
    tgtCmd(
      "rm",
      ["-f", `/etc/systemd/system/${mountUnitName}`, `/etc/systemd/system/${automountUnitName}`],
      3_000,
      "Remove systemd units",
    ),
  ] satisfies readonly CommandSpec[]

  steps.push({
    key: "write-systemd-units",
    name: "写入 systemd 单元",
    description: share.autoMount
      ? `在目标节点 ${targetNode.name} 上创建 .mount 和 .automount 单元`
      : `在目标节点 ${targetNode.name} 上创建 .mount 单元并立即挂载`,
    nodeId: targetNode.id,
    nodeName: targetNode.name,
    commands: systemdUnitCommands,
    rollbackCommands: rollbackUnitCommands,
    sensitive: false,
    reversible: true,
  })

  return steps
}

// --- OS-specific commands ---

function nfsServerInstallCommands(osFamily: string | null, sudo: boolean): readonly CommandSpec[] {
  switch (osFamily) {
    case "debian":
      return [
        {
          executable: "apt-get",
          args: ["update", "-qq"],
          sudo,
          timeoutMs: 30_000,
          preview: "apt-get update -qq",
        },
        {
          executable: "apt-get",
          args: ["install", "-y", "-qq", "nfs-kernel-server"],
          sudo,
          timeoutMs: 60_000,
          preview: "apt-get install -y -qq nfs-kernel-server",
        },
      ]
    case "rhel":
      return [
        {
          executable: "dnf",
          args: ["install", "-y", "-q", "nfs-utils"],
          sudo,
          timeoutMs: 60_000,
          preview: "dnf install -y -q nfs-utils",
        },
      ]
    default:
      return [
        {
          executable: "echo",
          args: [
            "WARNING: Unknown OS, please install NFS server manually (nfs-kernel-server or nfs-utils)",
          ],
          sudo: false,
          timeoutMs: 1_000,
          preview: "Unknown OS — manual NFS server install required",
        },
      ]
  }
}

function nfsServerEnableCommands(osFamily: string | null, sudo: boolean): readonly CommandSpec[] {
  const serviceName = osFamily === "debian" ? "nfs-kernel-server" : "nfs-server"
  return [
    {
      executable: "systemctl",
      args: ["enable", serviceName],
      sudo,
      timeoutMs: 10_000,
      preview: `systemctl enable ${serviceName}`,
    },
    {
      executable: "systemctl",
      args: ["start", serviceName],
      sudo,
      timeoutMs: 15_000,
      preview: `systemctl start ${serviceName}`,
    },
  ]
}

function nfsClientInstallCommands(osFamily: string | null, sudo: boolean): readonly CommandSpec[] {
  switch (osFamily) {
    case "debian":
      return [
        {
          executable: "apt-get",
          args: ["update", "-qq"],
          sudo,
          timeoutMs: 30_000,
          preview: "apt-get update -qq",
        },
        {
          executable: "apt-get",
          args: ["install", "-y", "-qq", "nfs-common"],
          sudo,
          timeoutMs: 60_000,
          preview: "apt-get install -y -qq nfs-common",
        },
      ]
    case "rhel":
      return [
        {
          executable: "dnf",
          args: ["install", "-y", "-q", "nfs-utils"],
          sudo,
          timeoutMs: 60_000,
          preview: "dnf install -y -q nfs-utils",
        },
      ]
    default:
      return [
        {
          executable: "echo",
          args: [
            "WARNING: Unknown OS, please install NFS client manually (nfs-common or nfs-utils)",
          ],
          sudo: false,
          timeoutMs: 1_000,
          preview: "Unknown OS — manual NFS client install required",
        },
      ]
  }
}

// --- Unit file builders ---

function buildExportsContent(
  share: ShareResponse,
  targetNode: PlanNodeInfo,
  exportOptions: string,
): string {
  return [
    `# BEGIN LINUX_SHARE_MANAGER share_id=${share.id}`,
    `${share.sourcePath} ${targetNode.primaryIp ?? targetNode.host}(${exportOptions})`,
    `# END LINUX_SHARE_MANAGER share_id=${share.id}`,
  ].join("\n")
}

function buildMountUnitContent(
  share: ShareResponse,
  nfsSource: string,
  mountOptions: string,
): string {
  return [
    "[Unit]",
    `Description=Linux Share Manager mount for ${share.targetPath}`,
    `Documentation=Linux Share Manager share_id=${share.id}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Mount]",
    `What=${nfsSource}`,
    `Where=${share.targetPath}`,
    "Type=nfs",
    `Options=${mountOptions}`,
    "TimeoutSec=30",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ].join("\n")
}

function buildAutomountUnitContent(share: ShareResponse): string {
  return [
    "[Unit]",
    `Description=Linux Share Manager automount for ${share.targetPath}`,
    `Documentation=Linux Share Manager share_id=${share.id}`,
    "",
    "[Automount]",
    `Where=${share.targetPath}`,
    "TimeoutIdleSec=60",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ].join("\n")
}

// --- systemd path escaping ---

/** Quote each line of a multi-line string as a separate shell argument for printf '%s\n'.
 *  Each line is single-quote-escaped, then joined with spaces. */
function shellQuoteLines(content: string): string {
  return content
    .split("\n")
    .map((line) => `'${line.replace(/'/g, "'\\''")}'`)
    .join(" ")
}

function sudoShellCmd(
  args: readonly string[],
  timeoutMs: number,
  preview: string,
  sudo: boolean,
  sudoPassword: string | undefined,
): CommandSpec {
  return sudo && sudoPassword !== undefined
    ? { executable: "sh", args, sudo, sudoPassword, timeoutMs, preview }
    : { executable: "sh", args, sudo, timeoutMs, preview }
}

/** Escape a filesystem path into a systemd unit name suffix.
 *  Rules: '/' → '-', leading '-' trimmed, '-' → '\\x2d', other special chars → '\\xHH'. */
function systemdEscapePath(path: string): string {
  let result = ""
  for (const ch of path) {
    if (ch === "/") {
      result += "-"
    } else if (ch === "-") {
      result += "\\x2d"
    } else if (
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9") ||
      ch === "_" ||
      ch === "."
    ) {
      result += ch
    } else {
      result += `\\x${ch.charCodeAt(0).toString(16).padStart(2, "0")}`
    }
  }
  // Trim leading dashes (from leading slashes)
  return result.replace(/^-+/, "")
}
