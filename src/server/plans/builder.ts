/**
 * Share Plan Builder — validates inputs, generates execution plans,
 * checks path conflicts, and produces a frozen plan for confirmation.
 */

import type { NodeResponse } from "../../shared/schemas/nodes"
import type { ShareResponse } from "../../shared/schemas/shares"
import type { CommandSpec } from "../executor/command"

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
}

export type PlanConfig = {
  readonly sourcePath: string
  readonly targetPath: string
  readonly accessMode: "read_only" | "read_write"
  readonly nfsVersion: string
  readonly autoMount: boolean
  readonly clientAllowRule: string
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

// --- Plan generation ---

export function generateSharePlan(
  share: ShareResponse,
  sourceNode: PlanNodeInfo,
  targetNode: PlanNodeInfo,
  version: number = 1,
): SharePlan {
  const warnings: string[] = []
  let riskLevel: PlanRiskLevel = "low"

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

  const steps = buildPlanSteps(
    share,
    sourceNode,
    targetNode,
    sourceNode.sudoOk && targetNode.sudoOk,
  )

  return {
    shareId: share.id,
    shareName: share.name,
    version,
    riskLevel,
    warnings,
    sourceNode,
    targetNode,
    config: {
      sourcePath: share.sourcePath,
      targetPath: share.targetPath,
      accessMode: share.accessMode,
      nfsVersion: share.nfsVersion,
      autoMount: share.autoMount,
      clientAllowRule: targetNode.primaryIp ?? targetNode.host,
    },
    steps,
    generatedAt: new Date().toISOString(),
  }
}

function buildPlanSteps(
  share: ShareResponse,
  sourceNode: PlanNodeInfo,
  targetNode: PlanNodeInfo,
  sudoAvailable: boolean,
): readonly PlanStep[] {
  const steps: PlanStep[] = []
  const accessOpts = share.accessMode === "read_only" ? "ro" : "rw"
  const exportOptions = `${accessOpts},sync,no_subtree_check,root_squash`
  const mountOptions = `vers=${share.nfsVersion},_netdev,nofail,hard,timeo=50,retrans=2`

  // Step 1: Install NFS server on source
  if (!sourceNode.nfsServerInstalled) {
    steps.push({
      key: "install-nfs-server",
      name: "安装 NFS Server",
      description: `在源节点 ${sourceNode.name} 上安装 NFS 服务端软件包`,
      nodeId: sourceNode.id,
      nodeName: sourceNode.name,
      commands: nfsServerInstallCommands(sourceNode.osFamily, sudoAvailable),
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
    commands: [
      {
        executable: "mkdir",
        args: ["-p", share.sourcePath],
        sudo: sudoAvailable,
        timeoutMs: 5_000,
        preview: `mkdir -p ${share.sourcePath}`,
      },
    ],
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
      {
        executable: "cp",
        args: ["/etc/exports", `/etc/exports.lsm-backup-${share.id}`],
        sudo: sudoAvailable,
        timeoutMs: 5_000,
        preview: `cp /etc/exports /etc/exports.lsm-backup-${share.id}`,
      },
    ],
    rollbackCommands: [],
    sensitive: false,
    reversible: true,
  })

  // Step 4: Write exports managed block
  steps.push({
    key: "write-exports",
    name: "配置 NFS exports",
    description: `在源节点 ${sourceNode.name} 的 /etc/exports 中添加托管配置块`,
    nodeId: sourceNode.id,
    nodeName: sourceNode.name,
    commands: [
      {
        executable: "tee",
        args: ["-a", "/etc/exports"],
        sudo: sudoAvailable,
        timeoutMs: 5_000,
        preview: buildExportsBlock(share, sourceNode, exportOptions),
        sensitive: false,
      },
    ],
    rollbackCommands: [
      {
        executable: "cp",
        args: [`/etc/exports.lsm-backup-${share.id}`, "/etc/exports"],
        sudo: sudoAvailable,
        timeoutMs: 5_000,
        preview: "Restore /etc/exports from backup",
      },
    ],
    sensitive: false,
    reversible: true,
  })

  // Step 5: Enable and start NFS server
  steps.push({
    key: "enable-nfs-server",
    name: "启用 NFS 服务",
    description: `在源节点 ${sourceNode.name} 上启用并启动 NFS 服务`,
    nodeId: sourceNode.id,
    nodeName: sourceNode.name,
    commands: nfsServerEnableCommands(sourceNode.osFamily, sudoAvailable),
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
    commands: [
      {
        executable: "exportfs",
        args: ["-ra"],
        sudo: sudoAvailable,
        timeoutMs: 10_000,
        preview: "exportfs -ra",
      },
    ],
    rollbackCommands: [],
    sensitive: false,
    reversible: true,
  })

  // Step 7: Install NFS client on target
  if (!targetNode.nfsClientInstalled) {
    steps.push({
      key: "install-nfs-client",
      name: "安装 NFS Client",
      description: `在目标节点 ${targetNode.name} 上安装 NFS 客户端软件包`,
      nodeId: targetNode.id,
      nodeName: targetNode.name,
      commands: nfsClientInstallCommands(targetNode.osFamily, sudoAvailable),
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
    commands: [
      {
        executable: "mkdir",
        args: ["-p", share.targetPath],
        sudo: sudoAvailable,
        timeoutMs: 5_000,
        preview: `mkdir -p ${share.targetPath}`,
      },
    ],
    rollbackCommands: [],
    sensitive: false,
    reversible: false,
  })

  // Step 9: Write systemd mount unit
  const mountUnitName = systemdEscapePath(`${share.targetPath}.mount`)
  const automountUnitName = systemdEscapePath(`${share.targetPath}.automount`)
  const nfsSource = `${sourceNode.primaryIp ?? sourceNode.host}:${share.sourcePath}`

  steps.push({
    key: "write-systemd-units",
    name: "写入 systemd 单元",
    description: `在目标节点 ${targetNode.name} 上创建 .mount 和 .automount 单元`,
    nodeId: targetNode.id,
    nodeName: targetNode.name,
    commands: [
      {
        executable: "tee",
        args: [`/etc/systemd/system/${mountUnitName}`],
        sudo: sudoAvailable,
        timeoutMs: 5_000,
        preview: buildMountUnit(mountUnitName, share, nfsSource, mountOptions),
        sensitive: false,
      },
      {
        executable: "tee",
        args: [`/etc/systemd/system/${automountUnitName}`],
        sudo: sudoAvailable,
        timeoutMs: 5_000,
        preview: buildAutomountUnit(automountUnitName, share),
        sensitive: false,
      },
    ],
    rollbackCommands: [
      {
        executable: "rm",
        args: [
          "-f",
          `/etc/systemd/system/${mountUnitName}`,
          `/etc/systemd/system/${automountUnitName}`,
        ],
        sudo: sudoAvailable,
        timeoutMs: 3_000,
        preview: "Remove systemd units",
      },
    ],
    sensitive: false,
    reversible: true,
  })

  // Step 10: Enable and start automount
  steps.push({
    key: "enable-automount",
    name: "启用自动挂载",
    description: `在目标节点 ${targetNode.name} 上启用并启动 automount`,
    nodeId: targetNode.id,
    nodeName: targetNode.name,
    commands: [
      {
        executable: "systemctl",
        args: ["daemon-reload"],
        sudo: sudoAvailable,
        timeoutMs: 5_000,
        preview: "systemctl daemon-reload",
      },
      {
        executable: "systemctl",
        args: ["enable", automountUnitName],
        sudo: sudoAvailable,
        timeoutMs: 10_000,
        preview: `systemctl enable ${automountUnitName}`,
      },
      {
        executable: "systemctl",
        args: ["start", automountUnitName],
        sudo: sudoAvailable,
        timeoutMs: 15_000,
        preview: `systemctl start ${automountUnitName}`,
      },
    ],
    rollbackCommands: [
      {
        executable: "systemctl",
        args: ["stop", automountUnitName],
        sudo: sudoAvailable,
        timeoutMs: 10_000,
        preview: `systemctl stop ${automountUnitName}`,
      },
      {
        executable: "systemctl",
        args: ["disable", automountUnitName],
        sudo: sudoAvailable,
        timeoutMs: 5_000,
        preview: `systemctl disable ${automountUnitName}`,
      },
    ],
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

function buildExportsBlock(
  share: ShareResponse,
  sourceNode: PlanNodeInfo,
  exportOptions: string,
): string {
  const block = [
    `# BEGIN LINUX_SHARE_MANAGER share_id=${share.id}`,
    `${share.sourcePath} ${sourceNode.primaryIp ?? sourceNode.host}(${exportOptions})`,
    `# END LINUX_SHARE_MANAGER share_id=${share.id}`,
  ].join("\\n")
  return `echo -e "${block}" | tee -a /etc/exports`
}

function buildMountUnit(
  unitName: string,
  share: ShareResponse,
  nfsSource: string,
  mountOptions: string,
): string {
  const content = [
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
  ].join("\\n")
  return `echo -e "${content}" | tee /etc/systemd/system/${unitName}`
}

function buildAutomountUnit(unitName: string, share: ShareResponse): string {
  const content = [
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
  ].join("\\n")
  return `echo -e "${content}" | tee /etc/systemd/system/${unitName}`
}

// --- systemd path escaping ---

function systemdEscapePath(suffix: string): string {
  let result = ""
  let skip = false
  for (const ch of suffix) {
    if (skip) {
      skip = false
      continue
    }
    if (ch === "-") {
      result += "\\x2d"
    } else if (ch === "/") {
      result += "-"
      if (suffix.indexOf("/", suffix.indexOf(ch) + 1) === suffix.indexOf(ch) + 1) {
        skip = true
      }
    } else if (
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9") ||
      ch === "_" ||
      ch === "."
    ) {
      result += ch
    } else {
      result += `\\x${ch.charCodeAt(0).toString(16)}`
    }
  }
  // Trim leading dashes
  return result.replace(/^-+/, "")
}
