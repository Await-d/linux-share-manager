import { z } from "zod"
import packageJson from "../../package.json"

const BuildValueSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return undefined
  }

  const normalized = value.trim()
  return normalized.length === 0 ? undefined : normalized
}, z.string().optional())

const BuildEnvironmentSchema = z.object({
  LSM_BUILD_COMMIT: BuildValueSchema,
  LSM_BUILD_TIME: BuildValueSchema,
})

type BuildEnvironment = {
  readonly LSM_BUILD_COMMIT: string | undefined
  readonly LSM_BUILD_TIME: string | undefined
}

export type AppVersionInfo = {
  readonly name: string
  readonly version: string
  readonly build: {
    readonly commit: string | null
    readonly builtAt: string | null
  }
}

export const APP_NAME = packageJson.name
export const APP_VERSION = packageJson.version

export function getAppVersionInfo(
  environment: BuildEnvironment = currentBuildEnvironment(),
): AppVersionInfo {
  const parsed = BuildEnvironmentSchema.parse(environment)

  return {
    name: APP_NAME,
    version: APP_VERSION,
    build: {
      commit: parsed.LSM_BUILD_COMMIT ?? null,
      builtAt: parsed.LSM_BUILD_TIME ?? null,
    },
  }
}

function currentBuildEnvironment(): BuildEnvironment {
  return {
    LSM_BUILD_COMMIT: envValue("LSM_BUILD_COMMIT"),
    LSM_BUILD_TIME: envValue("LSM_BUILD_TIME"),
  }
}

function envValue(name: keyof BuildEnvironment): string | undefined {
  return process.env[name]
}
