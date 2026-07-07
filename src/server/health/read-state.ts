import type { ExecutedStep } from "../executor/command"

export type ReadHealthState = {
  readonly readOk: boolean | null
  readonly errorMessage: string | null
}

export function buildReadHealthState(results: readonly ExecutedStep[]): ReadHealthState {
  const readResult = results[0]?.result
  if (readResult === undefined) {
    return {
      readOk: false,
      errorMessage: "Read command did not return a result.",
    }
  }

  if ((readResult.exitCode ?? 1) === 0 && !readResult.timedOut) {
    return {
      readOk: true,
      errorMessage: null,
    }
  }

  const output = [readResult.stderr.trim(), readResult.stdout.trim()].filter(Boolean).join(" || ")
  return {
    readOk: false,
    errorMessage: output.length > 0 ? output : "Read command failed.",
  }
}
