export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown"

export type HealthStatusInput = {
  readonly sourceOnline: boolean
  readonly targetOnline: boolean
  readonly nfsServiceOk: boolean | null
  readonly mountpointOk: boolean | null
  readonly readOk: boolean | null
}

export function determineHealthStatus(input: HealthStatusInput): HealthStatus {
  if (!input.sourceOnline || !input.targetOnline) return "unhealthy"
  if (input.nfsServiceOk === false || input.mountpointOk === false || input.readOk === false) {
    return "unhealthy"
  }
  if (input.nfsServiceOk === true && input.mountpointOk === true && input.readOk === true) {
    return "healthy"
  }
  return "unknown"
}
