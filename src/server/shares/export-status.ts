export type ExportStatus = "unknown" | "ok" | "not_exported"

export type MountAccessStatus = "unknown" | "ok" | "failed"

type DeriveExportStatusInput = {
  readonly sourceHosts: readonly string[]
  readonly sourcePath: string
  readonly exportOutput: string
  readonly mountDetail: string | null
  readonly readTest: MountAccessStatus
  readonly writeTest: MountAccessStatus
}

type DerivedExportStatus = {
  readonly status: ExportStatus
  readonly detail: string | null
}

export function deriveExportStatus(input: DeriveExportStatusInput): DerivedExportStatus {
  const exportOutput = input.exportOutput.trim()
  if (exportOutput.length > 0 && !exportOutput.includes("__NOT_EXPORTED__")) {
    return { status: "ok", detail: exportOutput }
  }

  if (isVerifiedMountedExport(input)) {
    return {
      status: "ok",
      detail: `源路径 ${input.sourcePath} 已通过目标端挂载与读写测试验证。`,
    }
  }

  return {
    status: "not_exported",
    detail: `源路径 ${input.sourcePath} 未在 /etc/exports 中导出。`,
  }
}

function isVerifiedMountedExport(input: DeriveExportStatusInput): boolean {
  return (
    input.readTest === "ok" &&
    input.writeTest === "ok" &&
    input.mountDetail !== null &&
    input.sourceHosts.some((sourceHost) =>
      input.mountDetail?.includes(`${sourceHost}:${input.sourcePath}`),
    )
  )
}
