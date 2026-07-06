import { z } from "zod"

const ConfigSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.coerce.number().int().min(1).max(65535).default(8080),
  databasePath: z.string().default("./data/linux-share-manager.sqlite"),
  sessionCookieName: z.string().default("lsm_session"),
  sessionTtlSeconds: z.coerce.number().int().positive().default(86_400),
  trustProxy: z.coerce.boolean().default(false),
  secureCookie: z.coerce.boolean().default(false),
  webOrigin: z.url().default("http://127.0.0.1:5173"),
})

export type AppConfig = z.infer<typeof ConfigSchema>

type RuntimeEnvironment = {
  readonly LSM_HOST: string | undefined
  readonly LSM_PORT: string | undefined
  readonly LSM_DATABASE_PATH: string | undefined
  readonly LSM_SESSION_COOKIE_NAME: string | undefined
  readonly LSM_SESSION_TTL_SECONDS: string | undefined
  readonly LSM_TRUST_PROXY: string | undefined
  readonly LSM_SECURE_COOKIE: string | undefined
  readonly LSM_WEB_ORIGIN: string | undefined
}

export function loadConfig(environment: RuntimeEnvironment = currentEnvironment()): AppConfig {
  return ConfigSchema.parse({
    host: environment.LSM_HOST,
    port: environment.LSM_PORT,
    databasePath: environment.LSM_DATABASE_PATH,
    sessionCookieName: environment.LSM_SESSION_COOKIE_NAME,
    sessionTtlSeconds: environment.LSM_SESSION_TTL_SECONDS,
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
    LSM_SESSION_COOKIE_NAME: envValue("LSM_SESSION_COOKIE_NAME"),
    LSM_SESSION_TTL_SECONDS: envValue("LSM_SESSION_TTL_SECONDS"),
    LSM_TRUST_PROXY: envValue("LSM_TRUST_PROXY"),
    LSM_SECURE_COOKIE: envValue("LSM_SECURE_COOKIE"),
    LSM_WEB_ORIGIN: envValue("LSM_WEB_ORIGIN"),
  }
}

function envValue(name: keyof RuntimeEnvironment): string | undefined {
  return process.env[name]
}
