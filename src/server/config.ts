import { z } from "zod"

const BooleanEnvironmentSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value, context) => {
    if (value === "true" || value === "1") {
      return true
    }
    if (value === "false" || value === "0") {
      return false
    }

    context.addIssue({
      code: "custom",
      message: "Expected a boolean environment value: true, false, 1, or 0.",
    })
    return z.NEVER
  })

const ConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().min(1).max(65535).default(18_188),
  databasePath: z.string().default("./data/linux-share-manager.sqlite"),
  staticRoot: z.string().default("./dist/web"),
  secretKey: z.string().min(1).optional(),
  sessionCookieName: z.string().default("lsm_session"),
  sessionTtlSeconds: z.coerce.number().int().positive().default(86_400),
  sshConnectTimeoutMs: z.coerce.number().int().positive().default(5_000),
  trustProxy: BooleanEnvironmentSchema.default(false),
  secureCookie: BooleanEnvironmentSchema.default(false),
  webOrigin: z.url().default("http://127.0.0.1:5173"),
})

export type AppConfig = z.infer<typeof ConfigSchema>

type RuntimeEnvironment = {
  readonly LSM_HOST: string | undefined
  readonly LSM_PORT: string | undefined
  readonly LSM_DATABASE_PATH: string | undefined
  readonly LSM_STATIC_ROOT: string | undefined
  readonly LSM_SECRET_KEY: string | undefined
  readonly LSM_SESSION_COOKIE_NAME: string | undefined
  readonly LSM_SESSION_TTL_SECONDS: string | undefined
  readonly LSM_SSH_CONNECT_TIMEOUT_MS: string | undefined
  readonly LSM_TRUST_PROXY: string | undefined
  readonly LSM_SECURE_COOKIE: string | undefined
  readonly LSM_WEB_ORIGIN: string | undefined
}

export function loadConfig(environment: RuntimeEnvironment = currentEnvironment()): AppConfig {
  return ConfigSchema.parse({
    host: environment.LSM_HOST,
    port: environment.LSM_PORT,
    databasePath: environment.LSM_DATABASE_PATH,
    staticRoot: environment.LSM_STATIC_ROOT,
    secretKey: environment.LSM_SECRET_KEY,
    sessionCookieName: environment.LSM_SESSION_COOKIE_NAME,
    sessionTtlSeconds: environment.LSM_SESSION_TTL_SECONDS,
    sshConnectTimeoutMs: environment.LSM_SSH_CONNECT_TIMEOUT_MS,
    trustProxy: environment.LSM_TRUST_PROXY,
    secureCookie: environment.LSM_SECURE_COOKIE,
    webOrigin: environment.LSM_WEB_ORIGIN,
  })
}

function currentEnvironment(): RuntimeEnvironment {
  return {
    LSM_HOST: envValue("LSM_HOST"),
    LSM_PORT: envValue("LSM_PORT"),
    LSM_DATABASE_PATH: envValue("LSM_DATABASE_PATH"),
    LSM_STATIC_ROOT: envValue("LSM_STATIC_ROOT"),
    LSM_SECRET_KEY: envValue("LSM_SECRET_KEY"),
    LSM_SESSION_COOKIE_NAME: envValue("LSM_SESSION_COOKIE_NAME"),
    LSM_SESSION_TTL_SECONDS: envValue("LSM_SESSION_TTL_SECONDS"),
    LSM_SSH_CONNECT_TIMEOUT_MS: envValue("LSM_SSH_CONNECT_TIMEOUT_MS"),
    LSM_TRUST_PROXY: envValue("LSM_TRUST_PROXY"),
    LSM_SECURE_COOKIE: envValue("LSM_SECURE_COOKIE"),
    LSM_WEB_ORIGIN: envValue("LSM_WEB_ORIGIN"),
  }
}

function envValue(name: keyof RuntimeEnvironment): string | undefined {
  return process.env[name]
}
