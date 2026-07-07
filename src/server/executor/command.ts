/**
 * Structured command execution layer.
 * All remote commands MUST go through this module — never raw string concatenation.
 */

export type CommandSpec = {
  readonly executable: string
  readonly args: readonly string[]
  readonly sudo: boolean
  readonly timeoutMs: number
  readonly preview: string
  readonly sensitive?: boolean
  readonly sudoPasswordRequired?: boolean
  readonly sudoPassword?: string
}

export type CommandLogSummary = {
  readonly commandIndex?: number
  readonly executable: string
  readonly preview: string
  readonly sudo: boolean
  readonly sudoPasswordRequired: boolean
  readonly passwordInjected: boolean
  readonly sudoPasswordMode: "stdin" | "none"
  readonly timeoutMs: number
  readonly sensitive: boolean
}

export type CommandResult = {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number | null
  readonly timedOut: boolean
}

export type ExecutedStep = {
  readonly spec: CommandSpec
  readonly result: CommandResult
  readonly startedAt: Date
  readonly finishedAt: Date
}

/**
 * Escape a single shell argument for safe use in a command.
 * Uses single-quote wrapping with proper escaping.
 */
export function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`
}

/**
 * Build a shell-safe command string from a CommandSpec.
 * Password-backed sudo reads from stdin; passwordless sudo fails fast with `-n`.
 */
export function buildCommand(spec: CommandSpec): string {
  const parts: string[] = []
  if (spec.sudo) {
    if (spec.sudoPassword !== undefined) {
      parts.push("sudo", "-S", "-p", "''")
    } else {
      parts.push("sudo", "-n")
    }
  }
  parts.push(spec.executable)
  for (const arg of spec.args) {
    parts.push(shellEscape(arg))
  }
  return parts.join(" ")
}

/**
 * Build a preview string that is safe to display to users.
 * Sensitive args are replaced with [REDACTED].
 */
export function buildPreview(spec: CommandSpec): string {
  return spec.preview
}

export function shouldAttachSudoPassword(spec: CommandSpec): boolean {
  return spec.sudo || spec.sudoPasswordRequired === true
}

export function summarizeCommandForLog(
  spec: CommandSpec,
  commandIndex?: number,
): CommandLogSummary {
  const sudoPasswordMode: CommandLogSummary["sudoPasswordMode"] =
    spec.sudoPassword !== undefined ? "stdin" : "none"
  const summary: Omit<CommandLogSummary, "commandIndex"> = {
    executable: spec.executable,
    preview: spec.sensitive === true ? "[敏感命令已隐藏]" : spec.preview,
    sudo: spec.sudo,
    sudoPasswordRequired: spec.sudo || spec.sudoPasswordRequired === true,
    passwordInjected: spec.sudoPassword !== undefined,
    sudoPasswordMode,
    timeoutMs: spec.timeoutMs,
    sensitive: spec.sensitive === true,
  }

  return commandIndex === undefined ? summary : { commandIndex, ...summary }
}

/**
 * Sanitize output by truncating to a maximum length and stripping common
 * sensitive patterns (passwords, tokens, private keys).
 */
export function sanitizeOutput(raw: string, maxBytes: number = 16_384): string {
  let cleaned = raw

  // Strip common sensitive patterns
  cleaned = cleaned.replace(
    /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/g,
    "[REDACTED PRIVATE KEY]",
  )
  cleaned = cleaned.replace(/(?:password|passwd|PASSWORD)\s*[=:]\s*\S+/g, "$1=***")
  cleaned = cleaned.replace(/export\s+\w*SECRET\w*\s*=\s*\S+/g, "export $1=***")
  cleaned = cleaned.replace(/Authorization:\s*\S+/gi, "Authorization: ***")

  if (Buffer.byteLength(cleaned, "utf8") > maxBytes) {
    const truncated = Buffer.from(cleaned, "utf8").subarray(0, maxBytes).toString("utf8")
    return `${truncated}\n[... output truncated at ${maxBytes} bytes]`
  }

  return cleaned
}
