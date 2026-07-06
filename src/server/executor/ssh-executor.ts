import { Client, type ConnectConfig } from "ssh2"
import { AppError } from "../errors"
import type { NodeCredential } from "../nodes/repository"
import {
  buildCommand,
  type CommandResult,
  type CommandSpec,
  type ExecutedStep,
  sanitizeOutput,
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

  try {
    await connectSsh(conn, credential, credential.decryptedSecret, options.connectTimeoutMs)
    const result = await runCommand(conn, spec, options)
    const finishedAt = new Date()

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

  try {
    await connectSsh(conn, credential, credential.decryptedSecret, options.connectTimeoutMs)

    for (const spec of specs) {
      const startedAt = new Date()
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
      } catch (error) {
        const finishedAt = new Date()
        const message = error instanceof Error ? error.message : String(error)
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
        // Stop on first failure
        break
      }
    }
  } finally {
    conn.end()
  }

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
    return { success: false, error: "No SSH credential stored." }
  }

  const conn = new Client()

  try {
    await connectSsh(conn, credential, credential.decryptedSecret, connectTimeoutMs)
    return { success: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
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
      reject(new AppError("SSH_TIMEOUT", "SSH connection timed out.", 504))
    }, connectTimeoutMs)

    conn.once("ready", () => {
      clearTimeout(timer)
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
        reject(new AppError("SSH_AUTH_FAILED", error.message, 502))
      } else if (message.includes("timed out") || message.includes("timeout")) {
        reject(new AppError("SSH_TIMEOUT", error.message, 504))
      } else if (
        message.includes("connect") ||
        message.includes("refused") ||
        message.includes("unreachable") ||
        message.includes("econnrefused") ||
        message.includes("enotfound")
      ) {
        reject(new AppError("SSH_CONNECT_FAILED", error.message, 502))
      } else {
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
