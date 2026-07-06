import pino from "pino"

const LOG_LEVEL = process.env.LSM_LOG_LEVEL ?? "info"

export const logger = pino({
  name: "lsm",
  level: LOG_LEVEL,
  ...(process.env.NODE_ENV === "development" || process.env.LSM_LOG_PRETTY === "1"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname" },
        },
      }
    : {}),
})

export type Logger = typeof logger
