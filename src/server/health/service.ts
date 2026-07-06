import { desc, eq } from "drizzle-orm"
import type { ShareResponse } from "../../shared/schemas/shares"
import type { AppDatabase } from "../db/client"
import { healthChecks, shares } from "../db/schema"
import type { CommandSpec } from "../executor/command"
import { executeCommands } from "../executor/ssh-executor"
import type { NodeCredential } from "../nodes/repository"

export type HealthCheckResult = {
  readonly id: string
  readonly shareId: string
  readonly status: "healthy" | "degraded" | "unhealthy" | "unknown"
  readonly sourceOnline: boolean
  readonly targetOnline: boolean
  readonly nfsServiceOk: boolean | null
  readonly mountpointOk: boolean | null
  readonly readOk: boolean | null
  readonly writeOk: boolean | null
  readonly latencyMs: number | null
  readonly errorCode: string | null
  readonly errorMessage: string | null
  readonly summary: string
  readonly createdAt: string
}

export class HealthService {
  constructor(private readonly database: AppDatabase) {}

  async check(
    share: ShareResponse,
    sourceCredential: NodeCredential,
    targetCredential: NodeCredential,
    sourceHost: string,
    options: { connectTimeoutMs: number; commandTimeoutMs: number; maxOutputBytes: number },
  ): Promise<HealthCheckResult> {
    const now = new Date()
    let sourceOnline = false
    let targetOnline = false
    let nfsServiceOk: boolean | null = null
    let mountpointOk: boolean | null = null
    let readOk: boolean | null = null
    const writeOk: boolean | null = null
    let latencyMs: number | null = null
    const errorCode: string | null = null
    let errorMessage: string | null = null

    try {
      // Check source node
      const sourceStart = Date.now()
      const sourceResults = await executeCommands(
        sourceCredential,
        [
          {
            executable: "systemctl",
            args: ["is-active", "nfs-server", "nfs-kernel-server"],
            sudo: false,
            timeoutMs: 5_000,
            preview: "systemctl is-active nfs-server",
          },
        ],
        options,
      )
      sourceOnline = sourceResults.length > 0 && sourceResults[0].result.exitCode === 0
      if (sourceOnline) {
        nfsServiceOk = sourceResults[0].result.stdout.includes("active")
      }
      latencyMs = Date.now() - sourceStart

      // Check target node
      const targetResults = await executeCommands(
        targetCredential,
        [
          {
            executable: "findmnt",
            args: ["-n", "-o", "SOURCE", share.targetPath],
            sudo: false,
            timeoutMs: 5_000,
            preview: `findmnt ${share.targetPath}`,
          },
        ],
        options,
      )
      targetOnline = targetResults.length > 0
      if (targetOnline && targetResults[0].result.exitCode === 0) {
        mountpointOk = targetResults[0].result.stdout.trim().length > 0
      }

      // Read test
      if (mountpointOk) {
        const readResults = await executeCommands(
          targetCredential,
          [
            {
              executable: "ls",
              args: [share.targetPath],
              sudo: false,
              timeoutMs: 5_000,
              preview: `ls ${share.targetPath}`,
            },
          ],
          options,
        )
        readOk = readResults.length > 0 && readResults[0].result.exitCode === 0
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err)
    }

    const status = determineStatus(sourceOnline, targetOnline, nfsServiceOk, mountpointOk, readOk)
    const summary = buildSummary(
      share,
      status,
      sourceOnline,
      targetOnline,
      nfsServiceOk,
      mountpointOk,
      readOk,
    )

    // Save to database
    const id = crypto.randomUUID()
    this.database.db
      .insert(healthChecks)
      .values({
        id,
        shareId: share.id,
        status,
        sourceOnline,
        targetOnline,
        nfsServiceOk,
        mountpointOk,
        readOk,
        writeOk,
        latencyMs,
        errorCode,
        errorMessage,
        summary,
        createdAt: now,
      })
      .run()

    return {
      id,
      shareId: share.id,
      status,
      sourceOnline,
      targetOnline,
      nfsServiceOk,
      mountpointOk,
      readOk,
      writeOk,
      latencyMs,
      errorCode,
      errorMessage,
      summary,
      createdAt: now.toISOString(),
    }
  }

  listForShare(shareId: string, limit: number = 20): readonly HealthCheckResult[] {
    const rows = this.database.db
      .select()
      .from(healthChecks)
      .where(eq(healthChecks.shareId, shareId))
      .orderBy(desc(healthChecks.createdAt))
      .limit(limit)
      .all()

    return rows.map(toHealthResult)
  }

  latest(shareId: string): HealthCheckResult | null {
    const row = this.database.db
      .select()
      .from(healthChecks)
      .where(eq(healthChecks.shareId, shareId))
      .orderBy(desc(healthChecks.createdAt))
      .limit(1)
      .all()
      .at(0)

    return row === undefined ? null : toHealthResult(row)
  }
}

type HealthRow = typeof healthChecks.$inferSelect

function toHealthResult(row: HealthRow): HealthCheckResult {
  return {
    id: row.id,
    shareId: row.shareId,
    status: row.status as HealthCheckResult["status"],
    sourceOnline: row.sourceOnline,
    targetOnline: row.targetOnline,
    nfsServiceOk: row.nfsServiceOk,
    mountpointOk: row.mountpointOk,
    readOk: row.readOk,
    writeOk: row.writeOk,
    latencyMs: row.latencyMs,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    summary: row.summary ?? "",
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  }
}

function determineStatus(
  sourceOnline: boolean,
  targetOnline: boolean,
  nfsServiceOk: boolean | null,
  mountpointOk: boolean | null,
  readOk: boolean | null,
): HealthCheckResult["status"] {
  if (!sourceOnline || !targetOnline) return "unhealthy"
  if (nfsServiceOk === false || mountpointOk === false) return "degraded"
  if (readOk === false) return "degraded"
  if (nfsServiceOk === true && mountpointOk === true && readOk === true) return "healthy"
  return "unknown"
}

function buildSummary(
  share: ShareResponse,
  status: string,
  sourceOnline: boolean,
  targetOnline: boolean,
  nfsServiceOk: boolean | null,
  mountpointOk: boolean | null,
  readOk: boolean | null,
): string {
  const parts: string[] = []
  parts.push(`Source(${share.sourceNodeId.slice(0, 8)}): ${sourceOnline ? "online" : "offline"}`)
  parts.push(`Target(${share.targetNodeId.slice(0, 8)}): ${targetOnline ? "online" : "offline"}`)
  if (nfsServiceOk !== null) parts.push(`NFS: ${nfsServiceOk ? "ok" : "fail"}`)
  if (mountpointOk !== null) parts.push(`Mount: ${mountpointOk ? "ok" : "fail"}`)
  if (readOk !== null) parts.push(`Read: ${readOk ? "ok" : "fail"}`)
  parts.push(`Status: ${status}`)
  return parts.join("; ")
}
