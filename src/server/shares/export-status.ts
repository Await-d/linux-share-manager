import type { ShareAccessMode } from "../../shared/schemas/shares"

export type ExportStatus = "unknown" | "ok" | "not_exported"

export type MountAccessStatus = "unknown" | "ok" | "failed"

type DeriveExportStatusInput = {
  readonly sourceHosts: readonly string[]
  readonly sourcePath: string
  readonly exportOutput: string
  readonly mountDetail: string | null
  readonly readTest: MountAccessStatus
  readonly writeTest: MountAccessStatus
  readonly accessMode?: ShareAccessMode
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
  if (input.mountDetail === null) {
    return false
  }

  const mountDetail = input.mountDetail
  const writeVerified = input.accessMode === "read_only" || input.writeTest === "ok"
  return (
    input.readTest === "ok" &&
    writeVerified &&
    input.sourceHosts.some((sourceHost) =>
      mountDetailIncludesSource(mountDetail, sourceHost, input.sourcePath),
    )
  )
}

function mountDetailIncludesSource(
  mountDetail: string,
  sourceHost: string,
  sourcePath: string,
): boolean {
  return mountDetail.split("\n").some((line) => {
    const mountSource = mountSourceFromLine(line)
    return mountSource?.host === sourceHost && mountSource.path === sourcePath
  })
}

function mountSourceFromLine(
  line: string,
): { readonly host: string; readonly path: string } | null {
  const detail = line.includes("→") ? (line.split("→").at(1)?.trim() ?? "") : line.trim()
  const source = detail.split(/\s+/).at(0) ?? ""
  const separatorIndex = source.indexOf(":/")
  if (separatorIndex <= 0) {
    return null
  }

  return {
    host: source.slice(0, separatorIndex),
    path: source.slice(separatorIndex + 1),
  }
}
