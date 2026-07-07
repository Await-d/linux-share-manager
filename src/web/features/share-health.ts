import type { ShareStatus } from "../../shared/schemas/shares"

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
