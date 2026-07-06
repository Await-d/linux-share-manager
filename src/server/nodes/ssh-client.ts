import { Client, type ConnectConfig } from "ssh2"
import { AppError } from "../errors"
import type { NodeCredential } from "./repository"

export type DirectoryEntry = {
  readonly name: string
  readonly path: string
  readonly isDirectory: boolean
}

export type BrowseResult = {
  readonly path: string
  readonly parent: string | null
  readonly entries: readonly DirectoryEntry[]
}

export async function browseDirectory(
  credential: NodeCredential,
  path: string,
  connectTimeoutMs: number,
): Promise<BrowseResult> {
  if (credential.decryptedSecret === null) {
    throw new AppError(
      "CREDENTIAL_MISSING",
      "The node has no stored SSH credential. Save a credential before browsing.",
      422,
    )
  }

  const secret = credential.decryptedSecret
  const normalizedPath = normalizeBrowsePath(path)
  const conn = new Client()

  try {
    await connectSsh(conn, credential, secret, connectTimeoutMs)
    const output = await execCommand(
      conn,
      `ls -1 -F -A -- "${escapedPath(normalizedPath)}" 2>/dev/null || true`,
    )

    const entries = parseLsOutput(output, normalizedPath)
    const parent = parentPath(normalizedPath)

    return { path: normalizedPath, parent, entries }
  } catch (error) {
    if (error instanceof AppError) {
      throw error
    }

    const message = error instanceof Error ? error.message : String(error)
    console.error("[browse] SSH error:", error)
    throw new AppError("SSH_ERROR", message, 502)
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
      reject(new AppError("SSH_CONNECTION_FAILED", error.message, 502))
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

function execCommand(conn: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (error, stream) => {
      if (error !== null && error !== undefined) {
        reject(new AppError("SSH_EXEC_FAILED", error.message, 502))
        return
      }

      if (stream === null || stream === undefined) {
        reject(new AppError("SSH_EXEC_FAILED", "No stream returned.", 502))
        return
      }

      const chunks: Buffer[] = []
      stream.on("data", (data: Buffer) => chunks.push(data))
      stream.stderr.on("data", () => {
        // Ignore stderr; we already redirect errors in the command.
      })
      stream.once("close", () => {
        resolve(Buffer.concat(chunks).toString("utf8"))
      })
    })
  })
}

function normalizeBrowsePath(path: string): string {
  const trimmed = path.trim()
  if (trimmed.length === 0) {
    return "/"
  }

  const resolved = trimmed.replace(/\/+/g, "/").replace(/\/$/, "")
  return resolved.length === 0 ? "/" : resolved
}

function parentPath(path: string): string | null {
  if (path === "/") {
    return null
  }

  const index = path.lastIndexOf("/")
  if (index <= 0) {
    return "/"
  }

  return path.slice(0, index)
}

function escapedPath(path: string): string {
  return path.replace(/"/g, '\\"')
}

function parseLsOutput(output: string, basePath: string): readonly DirectoryEntry[] {
  const lines = output.split("\n").filter((line) => line.length > 0)
  const entries: DirectoryEntry[] = []

  for (const line of lines) {
    const isDirectory = line.endsWith("/")
    const name = isDirectory ? line.slice(0, -1) : line

    if (name.length === 0 || name === "." || name === "..") {
      continue
    }

    const childPath = basePath === "/" ? `/${name}` : `${basePath}/${name}`
    entries.push({ name, path: childPath, isDirectory })
  }

  return entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}
