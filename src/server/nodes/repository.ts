import { eq } from "drizzle-orm"
import type { CreateNodeRequest, NodeResponse, UpdateNodeRequest } from "../../shared/schemas/nodes"
import { decryptCredentialSecret, encryptCredentialSecret } from "../credentials/crypto"
import type { AppDatabase } from "../db/client"
import { nodes } from "../db/schema"
import { AppError, DatabaseInvariantError } from "../errors"

export type NodeCredential = {
  readonly id: string
  readonly host: string
  readonly port: number
  readonly username: string
  readonly authType: "private_key" | "password_session"
  readonly credentialKind: "missing" | "password_set" | "private_key_set"
  readonly decryptedSecret: string | null
}

export class NodeRepository {
  constructor(
    private readonly database: AppDatabase,
    private readonly secretKey: string | undefined,
  ) {}

  create(input: CreateNodeRequest): NodeResponse {
    const now = new Date()
    const credential = credentialFromCreate(input, this.secretKey)
    const created = this.database.db
      .insert(nodes)
      .values({
        id: crypto.randomUUID(),
        name: input.name,
        host: input.host,
        port: input.port,
        username: input.username,
        authType: input.authType,
        credentialKind: credential.kind,
        credentialSecret: credential.secret,
        credentialLabel: credential.label,
        role: input.role,
        lastProbeStatus: "unknown",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .all()

    const row = created.at(0)
    if (row === undefined) {
      throw new DatabaseInvariantError("node insert returned no row")
    }

    return toNodeResponse(row)
  }

  update(id: string, input: UpdateNodeRequest): NodeResponse | null {
    const current = this.database.db
      .select()
      .from(nodes)
      .where(eq(nodes.id, id))
      .limit(1)
      .all()
      .at(0)
    if (current === undefined) {
      return null
    }

    const values: Partial<typeof nodes.$inferInsert> = { updatedAt: new Date() }
    if (input.name !== undefined) {
      values.name = input.name
    }
    if (input.host !== undefined) {
      values.host = input.host
    }
    if (input.port !== undefined) {
      values.port = input.port
    }
    if (input.username !== undefined) {
      values.username = input.username
    }
    if (input.role !== undefined) {
      values.role = input.role
    }

    const credential = credentialFromUpdate(input, current.authType, this.secretKey)
    if (credential !== null) {
      values.authType = credential.authType
      values.credentialKind = credential.kind
      values.credentialSecret = credential.secret
      values.credentialLabel = credential.label
    } else if (input.authType !== undefined) {
      values.authType = input.authType
    }

    const updated = this.database.db
      .update(nodes)
      .set(values)
      .where(eq(nodes.id, id))
      .returning()
      .all()
    const row = updated.at(0)
    if (row === undefined) {
      throw new DatabaseInvariantError("node update returned no row")
    }

    return toNodeResponse(row)
  }

  list(): readonly NodeResponse[] {
    return this.database.db.select().from(nodes).all().map(toNodeResponse)
  }

  find(id: string): NodeResponse | null {
    const row = this.database.db.select().from(nodes).where(eq(nodes.id, id)).limit(1).all().at(0)
    return row === undefined ? null : toNodeResponse(row)
  }

  updateProbeStatus(id: string, status: NodeResponse["lastProbeStatus"]): NodeResponse | null {
    const updated = this.database.db
      .update(nodes)
      .set({ lastProbeStatus: status, updatedAt: new Date() })
      .where(eq(nodes.id, id))
      .returning()
      .all()
      .at(0)

    return updated === undefined ? null : toNodeResponse(updated)
  }

  findCredential(id: string): NodeCredential | null {
    const row = this.database.db.select().from(nodes).where(eq(nodes.id, id)).limit(1).all().at(0)
    if (row === undefined) {
      return null
    }

    return {
      id: row.id,
      host: row.host,
      port: row.port,
      username: row.username,
      authType: row.authType,
      credentialKind: row.credentialKind,
      decryptedSecret: resolveDecryptedSecret(row, this.secretKey),
    }
  }
}

type NodeRow = typeof nodes.$inferSelect

function toNodeResponse(row: NodeRow): NodeResponse {
  return {
    id: row.id,
    name: row.name,
    host: row.host,
    port: row.port,
    username: row.username,
    authType: row.authType,
    credentialStatus: row.credentialKind,
    credentialLabel: row.credentialLabel,
    role: row.role,
    osFamily: row.osFamily,
    primaryIp: row.primaryIp,
    lastProbeStatus: row.lastProbeStatus,
  }
}

type CredentialWrite = {
  readonly kind: NodeRow["credentialKind"]
  readonly secret: string | null
  readonly label: string | null
}

type CredentialUpdate = CredentialWrite & {
  readonly authType: NodeRow["authType"]
}

function credentialFromCreate(
  input: CreateNodeRequest,
  secretKey: string | undefined,
): CredentialWrite {
  switch (input.authType) {
    case "password_session":
      return input.password === undefined
        ? missingCredential()
        : { kind: "password_set", secret: encryptedSecret(input.password, secretKey), label: null }
    case "private_key":
      return input.privateKey === undefined
        ? missingCredential()
        : {
            kind: "private_key_set",
            secret: encryptedSecret(input.privateKey, secretKey),
            label: input.privateKeyName ?? "uploaded private key",
          }
  }
}

function credentialFromUpdate(
  input: UpdateNodeRequest,
  currentAuthType: NodeRow["authType"],
  secretKey: string | undefined,
): CredentialUpdate | null {
  if (input.password !== undefined) {
    return {
      authType: "password_session",
      kind: "password_set",
      secret: encryptedSecret(input.password, secretKey),
      label: null,
    }
  }

  if (input.privateKey !== undefined) {
    return {
      authType: "private_key",
      kind: "private_key_set",
      secret: encryptedSecret(input.privateKey, secretKey),
      label: input.privateKeyName ?? "uploaded private key",
    }
  }

  if (input.authType !== undefined && input.authType !== currentAuthType) {
    return { authType: input.authType, ...missingCredential() }
  }

  return null
}

function missingCredential(): CredentialWrite {
  return { kind: "missing", secret: null, label: null }
}

function encryptedSecret(secret: string, secretKey: string | undefined): string {
  if (secretKey === undefined) {
    throw new AppError(
      "CREDENTIAL_KEY_REQUIRED",
      "LSM_SECRET_KEY is required to save SSH credentials.",
      422,
    )
  }

  return encryptCredentialSecret(secret, secretKey)
}

function resolveDecryptedSecret(row: NodeRow, secretKey: string | undefined): string | null {
  if (row.credentialSecret === null) {
    return null
  }

  // 旧数据可能是明文（在引入 LSM_SECRET_KEY 之前保存的），直接返回
  if (!row.credentialSecret.startsWith("v1:")) {
    return row.credentialSecret
  }

  if (secretKey === undefined) {
    throw new AppError(
      "CREDENTIAL_KEY_REQUIRED",
      "LSM_SECRET_KEY is required to decrypt SSH credentials.",
      500,
    )
  }

  return decryptCredentialSecret(row.credentialSecret, secretKey)
}
