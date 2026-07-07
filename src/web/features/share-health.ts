import type { InterconnectivityResponse } from "../../shared/schemas/connectivity"
import type { ShareAccessMode, ShareStatus } from "../../shared/schemas/shares"

export type StatusTone = "success" | "warning" | "error" | "info" | "neutral"

export type ApplyHealthMessageInput = {
  readonly healthStatus: string
  readonly summary: string
  readonly errorMessage: string | null
}

export function shareStatusFromHealth(healthStatus: string): ShareStatus {
  switch (healthStatus) {
    case "healthy":
      return "active"
    case "degraded":
      return "degraded"
    case "unhealthy":
      return "partial_failed"
    default:
      return "degraded"
  }
}

export function formatApplyHealthMessage(input: ApplyHealthMessageInput): string {
  if (input.healthStatus === "healthy") {
    return "执行完成并通过健康检查，共享已生效。"
  }

  const errorSuffix =
    input.errorMessage === null || input.errorMessage.length === 0
      ? ""
      : `；错误：${input.errorMessage}`
  return `执行命令已完成，但健康检查未通过：${input.summary}${errorSuffix}`
}

export function interconnectivityPassed(
  result: InterconnectivityResponse,
  accessMode: ShareAccessMode,
): boolean {
  return (
    result.crossReachable === "ok" &&
    result.mountStatus === "mounted" &&
    result.readTest !== "failed" &&
    (accessMode === "read_only" || result.writeTest !== "failed") &&
    result.exportStatus !== "not_exported"
  )
}

export function interconnectivityTone(
  result: InterconnectivityResponse,
  accessMode: ShareAccessMode,
): StatusTone {
  if (interconnectivityPassed(result, accessMode)) {
    return "success"
  }

  return result.crossReachable === "ok" ? "warning" : "error"
}

export function writeTestBadge(
  writeTest: InterconnectivityResponse["writeTest"],
  accessMode: ShareAccessMode,
): { readonly tone: StatusTone; readonly label: string } {
  if (writeTest === "ok") {
    return { tone: "success", label: "通过" }
  }
  if (writeTest === "failed" && accessMode === "read_only") {
    return { tone: "neutral", label: "只读预期失败" }
  }

  return { tone: "error", label: "失败" }
}

export function formatInterconnectivitySuccessMessage(accessMode: ShareAccessMode): string {
  return accessMode === "read_only"
    ? "检查通过：NFS 连通、已挂载、读取正常。"
    : "检查通过：NFS 连通、已挂载、读写正常。"
}
