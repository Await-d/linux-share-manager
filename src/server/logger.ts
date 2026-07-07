import pino from "pino"

export type LogFormat = "json" | "pretty"

export type LogEnvironment = {
  readonly LSM_LOG_LEVEL: string | undefined
  readonly LSM_LOG_FORMAT: string | undefined
  readonly LSM_LOG_PRETTY: string | undefined
  readonly NODE_ENV: string | undefined
}

const LOG_MESSAGE_FORMAT = [
  "{msg}",
  "{if shareName} | 共享:{shareName}{end}",
  "{if shareId} | share:{shareId}{end}",
  "{if planId} | plan:{planId}{end}",
  "{if stepKey} | step:{stepKey}{end}",
  "{if host} | host:{host}{end}",
  "{if command.preview} | cmd[{command.commandIndex}]: {command.preview}{end}",
  "{if command.sudoPasswordMode} | sudo:{command.sudoPasswordMode}{end}",
].join("")

const PRETTY_LOG_OPTIONS = {
  colorize: process.stdout.isTTY === true,
  colorizeObjects: false,
  translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
  levelFirst: true,
  messageFormat: LOG_MESSAGE_FORMAT,
  ignore: "pid,hostname,name",
} as const

const { LSM_LOG_LEVEL, LSM_LOG_FORMAT, LSM_LOG_PRETTY, NODE_ENV } = process.env

const LOG_ENVIRONMENT: LogEnvironment = {
  LSM_LOG_LEVEL,
  LSM_LOG_FORMAT,
  LSM_LOG_PRETTY,
  NODE_ENV,
}

const LOG_LEVEL = resolveLogLevel(LOG_ENVIRONMENT)
const LOG_FORMAT = resolveLogFormat(LOG_ENVIRONMENT)

export function resolveLogLevel(environment: LogEnvironment): string {
  return environment.LSM_LOG_LEVEL ?? "info"
}

export function resolveLogFormat(environment: LogEnvironment): LogFormat {
  switch (environment.LSM_LOG_FORMAT) {
    case "json":
      return "json"
    case "pretty":
      return "pretty"
    case undefined:
      break
    default:
      return environment.NODE_ENV === "production" || environment.NODE_ENV === "test"
        ? "json"
        : "pretty"
  }

  if (environment.LSM_LOG_PRETTY === "1") {
    return "pretty"
  }
  if (environment.LSM_LOG_PRETTY === "0") {
    return "json"
  }
  return environment.NODE_ENV === "production" || environment.NODE_ENV === "test"
    ? "json"
    : "pretty"
}

export const logger = pino({
  name: "lsm",
  level: LOG_LEVEL,
  ...(LOG_FORMAT === "pretty"
    ? {
        transport: {
          target: "pino-pretty",
          options: PRETTY_LOG_OPTIONS,
        },
      }
    : {}),
})

export type Logger = typeof logger
