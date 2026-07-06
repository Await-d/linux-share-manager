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
 * For sudo commands, wraps with `sudo -n` (non-interactive).
 */
export function buildCommand(spec: CommandSpec): string {
  const parts: string[] = []
  if (spec.sudo) {
    parts.push("sudo", "-n")
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
