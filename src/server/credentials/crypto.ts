import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto"

export function encryptCredentialSecret(secret: string, secretKey: string): string {
  const key = createHash("sha256").update(secretKey).digest()
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key, iv)
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()])
  const authTag = cipher.getAuthTag()

  return `v1:${iv.toString("base64url")}:${authTag.toString("base64url")}:${encrypted.toString("base64url")}`
}

export function decryptCredentialSecret(stored: string, secretKey: string): string {
  const parts = stored.split(":")
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("Unsupported credential format")
  }

  const ivPart = parts[1]
  const authTagPart = parts[2]
  const encryptedPart = parts[3]
  if (ivPart === undefined || authTagPart === undefined || encryptedPart === undefined) {
    throw new Error("Unsupported credential format")
  }

  const iv = Buffer.from(ivPart, "base64url")
  const authTag = Buffer.from(authTagPart, "base64url")
  const encrypted = Buffer.from(encryptedPart, "base64url")

  const key = createHash("sha256").update(secretKey).digest()
  const decipher = createDecipheriv("aes-256-gcm", key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8")
}
