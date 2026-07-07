export function systemdEscapePath(path: string): string {
  const normalized = normalizeAbsolutePath(path)
  if (normalized === "/") {
    return "-"
  }

  const withoutLeadingSlash = normalized.slice(1)
  let escaped = ""
  for (const byte of Buffer.from(withoutLeadingSlash, "utf8")) {
    escaped += escapeSystemdPathByte(byte, escaped.length === 0)
  }
  return escaped
}

function normalizeAbsolutePath(path: string): string {
  const parts = path.split("/").filter((part) => part.length > 0)
  if (parts.some((part) => part === "..")) {
    throw new Error("systemd path cannot contain .. components")
  }
  const normalizedParts = parts.filter((part) => part !== ".")
  return normalizedParts.length === 0 ? "/" : `/${normalizedParts.join("/")}`
}

function escapeSystemdPathByte(byte: number, firstByte: boolean): string {
  const char = String.fromCharCode(byte)
  if (firstByte && char === ".") {
    return `\\x${byte.toString(16).padStart(2, "0")}`
  }
  if (
    (char >= "A" && char <= "Z") ||
    (char >= "a" && char <= "z") ||
    (char >= "0" && char <= "9") ||
    char === "_" ||
    char === "." ||
    char === ":"
  ) {
    return char
  }
  if (char === "/") {
    return "-"
  }
  return `\\x${byte.toString(16).padStart(2, "0")}`
}
