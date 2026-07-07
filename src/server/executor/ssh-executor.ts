import { Client, type ConnectConfig } from "ssh2"
import { AppError } from "../errors"
import { logger } from "../logger"
import type { NodeCredential } from "../nodes/repository"
import {
  buildCommand,
  type CommandResult,
  type CommandSpec,
  type ExecutedStep,
  sanitizeOutput,
  summarizeCommandForLog,
} from "./command"

export type SshExecutorOptions = {
  readonly connectTimeoutMs: number
  readonly defaultCommandTimeoutMs: number
  readonly maxOutputBytes: number
}

const DEFAULT_OPTIONS: SshExecutorOptions = {
  connectTimeoutMs: 5_000,
  defaultCommandTimeoutMs: 30_000,
  maxOutputBytes: 16_384,
}

/**
 * Execute a single structured command on a remote node via SSH.
 * Handles connection, authentication, sudo, timeout, and output sanitization.
 */
export async function executeCommand(
  credential: NodeCredential,
  spec: CommandSpec,
  options: SshExecutorOptions = DEFAULT_OPTIONS,
): Promise<ExecutedStep> {
  if (credential.decryptedSecret === null) {
    throw new AppError("CREDENTIAL_MISSING", "The node has no stored SSH credential.", 422)
  }

  const conn = new Client()
  const startedAt = new Date()

  logger.info(
    {
      host: credential.host,
      port: credential.port,
      username: credential.username,
      authType: credential.authType,
      command: summarizeCommandForLog(spec),
      connectTimeoutMs: options.connectTimeoutMs,
    },
    "SSH 命令开始执行",
  )

  try {
    await connectSsh(conn, credential, credential.decryptedSecret, options.connectTimeoutMs)
    const result = await runCommand(conn, spec, options)
    const finishedAt = new Date()

    logger.info(
      {
        host: credential.host,
        command: summarizeCommandForLog(spec),
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        stdoutBytes: Buffer.byteLength(result.stdout, "utf8"),
        stderrBytes: Buffer.byteLength(result.stderr, "utf8"),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
      },
      "SSH 命令执行完成",
    )

    return {
      spec,
      result: {
        stdout: sanitizeOutput(result.stdout, options.maxOutputBytes),
        stderr: sanitizeOutput(result.stderr, options.maxOutputBytes),
        exitCode: result.exitCode,
        timedOut: result.timedOut,
      },
      startedAt,
      finishedAt,
    }
  } finally {
    conn.end()
  }
}

/**
 * Execute multiple commands sequentially on the same SSH connection.
 * Each command reuses the same authenticated session.
 */
export async function executeCommands(
  credential: NodeCredential,
  specs: readonly CommandSpec[],
  options: SshExecutorOptions = DEFAULT_OPTIONS,
): Promise<readonly ExecutedStep[]> {
  if (credential.decryptedSecret === null) {
    throw new AppError("CREDENTIAL_MISSING", "The node has no stored SSH credential.", 422)
  }

  const conn = new Client()
  const results: ExecutedStep[] = []

  logger.info(
    {
      host: credential.host,
      port: credential.port,
      username: credential.username,
      authType: credential.authType,
      commandCount: specs.length,
      sudoCommandCount: specs.filter((spec) => spec.sudo).length,
      passwordInjectedCount: specs.filter((spec) => spec.sudoPassword !== undefined).length,
      connectTimeoutMs: options.connectTimeoutMs,
      defaultCommandTimeoutMs: options.defaultCommandTimeoutMs,
      maxOutputBytes: options.maxOutputBytes,
    },
    "SSH 批量命令开始执行",
  )

  try {
    await connectSsh(conn, credential, credential.decryptedSecret, options.connectTimeoutMs)

    logger.info(
      { host: credential.host, commandCount: specs.length },
      "SSH 连接已建立，开始按顺序执行命令",
    )

    for (const [index, spec] of specs.entries()) {
      const startedAt = new Date()
      const commandIndex = index + 1
      const commandSummary = summarizeCommandForLog(spec, commandIndex)
      logger.info(
        { host: credential.host, totalCommands: specs.length, command: commandSummary },
        "SSH 子命令开始执行",
      )
      try {
        const result = await runCommand(conn, spec, options)
        const finishedAt = new Date()
        results.push({
          spec,
          result: {
            stdout: sanitizeOutput(result.stdout, options.maxOutputBytes),
            stderr: sanitizeOutput(result.stderr, options.maxOutputBytes),
            exitCode: result.exitCode,
            timedOut: result.timedOut,
          },
          startedAt,
          finishedAt,
        })
        logger.info(
          {
            host: credential.host,
            totalCommands: specs.length,
            command: commandSummary,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            stdoutBytes: Buffer.byteLength(result.stdout, "utf8"),
            stderrBytes: Buffer.byteLength(result.stderr, "utf8"),
            durationMs: finishedAt.getTime() - startedAt.getTime(),
          },
          "SSH 子命令执行完成",
        )
      } catch (error) {
        const finishedAt = new Date()
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(
          {
            host: credential.host,
            totalCommands: specs.length,
            command: commandSummary,
            error: message,
            durationMs: finishedAt.getTime() - startedAt.getTime(),
          },
          "SSH 子命令执行异常，批量执行已停止",
        )
        results.push({
          spec,
          result: {
            stdout: "",
            stderr: message,
            exitCode: null,
            timedOut: false,
          },
          startedAt,
          finishedAt,
        })
        break
      }
    }
  } finally {
    conn.end()
  }

  logger.info(
    {
      host: credential.host,
      completedCount: results.length,
      totalCommands: specs.length,
      failedCount: results.filter((step) => step.result.exitCode !== 0 || step.result.timedOut)
        .length,
    },
    "SSH 批量命令执行结束",
  )

  return results
}

/**
 * Test full SSH authentication — not just TCP reachability.
 * Returns true if the SSH handshake + authentication succeeds.
 */
export async function testSshAuthentication(
  credential: NodeCredential,
  connectTimeoutMs: number,
): Promise<{ success: boolean; error?: string }> {
  if (credential.decryptedSecret === null) {
    logger.warn({ host: credential.host }, "SSH 认证测试失败：节点未保存凭据")
    return { success: false, error: "No SSH credential stored." }
  }

  const conn = new Client()

  try {
    await connectSsh(conn, credential, credential.decryptedSecret, connectTimeoutMs)
    logger.info({ host: credential.host, username: credential.username }, "SSH 认证测试成功")
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(
      { host: credential.host, username: credential.username, error: message },
      "SSH 认证测试失败",
    )
    return { success: false, error: message }
  } finally {
    conn.end()
  }
}

function connectSsh(
  conn: Client,
  credential: NodeCredential,
  secret: string,
  connectTimeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      conn.end()
      logger.warn({ host: credential.host, timeoutMs: connectTimeoutMs }, "SSH 连接超时")
      reject(new AppError("SSH_TIMEOUT", "SSH connection timed out.", 504))
    }, connectTimeoutMs)

    conn.once("ready", () => {
      clearTimeout(timer)
      logger.info(
        { host: credential.host, port: credential.port, username: credential.username },
        "SSH 认证成功，连接就绪",
      )
      resolve()
    })

    conn.once("error", (error) => {
      clearTimeout(timer)
      const message = error.message.toLowerCase()
      if (
        message.includes("authentication") ||
        message.includes("auth fail") ||
        message.includes("permission denied") ||
        message.includes("all configured authentication methods failed")
      ) {
        logger.warn(
          { host: credential.host, username: credential.username, error: error.message },
          "SSH 认证失败",
        )
        reject(new AppError("SSH_AUTH_FAILED", error.message, 502))
      } else if (message.includes("timed out") || message.includes("timeout")) {
        logger.warn({ host: credential.host, error: error.message }, "SSH 连接超时")
        reject(new AppError("SSH_TIMEOUT", error.message, 504))
      } else if (
        message.includes("connect") ||
        message.includes("refused") ||
        message.includes("unreachable") ||
        message.includes("econnrefused") ||
        message.includes("enotfound")
      ) {
        logger.warn({ host: credential.host, error: error.message }, "SSH 连接失败")
        reject(new AppError("SSH_CONNECT_FAILED", error.message, 502))
      } else {
        logger.error({ host: credential.host, error: error.message }, "SSH 连接发生未预期错误")
        reject(new AppError("SSH_ERROR", error.message, 502))
      }
    })

    const connectOptions: ConnectConfig = {
      host: credential.host,
      port: credential.port,
      username: credential.username,
      readyTimeout: connectTimeoutMs,
    }

    switch (credential.authType) {
      case "password_session":
        connectOptions.password = secret
        break
      case "private_key":
        connectOptions.privateKey = secret
        break
    }

    conn.connect(connectOptions)
  })
}

function runCommand(
  conn: Client,
  spec: CommandSpec,
  options: SshExecutorOptions,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const command = buildCommand(spec)
    const timeoutMs = spec.timeoutMs || options.defaultCommandTimeoutMs

    conn.exec(command, (error, stream) => {
      if (error !== null && error !== undefined) {
        reject(new AppError("SSH_EXEC_FAILED", error.message, 502))
        return
      }

      if (stream === null || stream === undefined) {
        reject(new AppError("SSH_EXEC_FAILED", "No stream returned.", 502))
        return
      }

      const stdoutChunks: Buffer[] = []
      const stderrChunks: Buffer[] = []
      let timedOut = false

      const timer = setTimeout(() => {
        timedOut = true
        stream.close()
      }, timeoutMs)

      if (spec.sudoPassword !== undefined) {
        stream.write(`${spec.sudoPassword}\n`)
      }

      stream.on("data", (data: Buffer) => stdoutChunks.push(data))
      stream.stderr.on("data", (data: Buffer) => stderrChunks.push(data))

      stream.once("close", (code: number | null) => {
        clearTimeout(timer)
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString("utf8"),
          stderr: Buffer.concat(stderrChunks).toString("utf8"),
          exitCode: code,
          timedOut,
        })
      })

      stream.once("error", (err: Error) => {
        clearTimeout(timer)
        reject(new AppError("SSH_EXEC_FAILED", err.message, 502))
      })
    })
  })
}
