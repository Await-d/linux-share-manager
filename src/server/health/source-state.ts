import type { ExecutedStep } from "../executor/command"

export type SourceHealthState = {
  readonly sourceOnline: boolean
  readonly nfsServiceOk: boolean | null
}

export function buildSourceHealthState(results: readonly ExecutedStep[]): SourceHealthState {
  const serviceResult = results[0]?.result
  if (serviceResult === undefined) {
    return {
      sourceOnline: false,
      nfsServiceOk: null,
    }
  }

  return {
    sourceOnline: true,
    nfsServiceOk: hasActiveSystemdState(serviceResult.stdout),
  }
}

function hasActiveSystemdState(stdout: string): boolean {
  return stdout.split(/\r?\n/).some((line) => line.trim() === "active")
}
