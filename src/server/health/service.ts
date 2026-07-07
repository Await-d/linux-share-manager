import { desc, eq } from "drizzle-orm"
import type { ShareResponse } from "../../shared/schemas/shares"
import type { AppDatabase } from "../db/client"
import { healthChecks } from "../db/schema"
import { executeCommands, type SshExecutorOptions } from "../executor/ssh-executor"
import { logger } from "../logger"
import type { NodeCredential } from "../nodes/repository"
import { buildReadHealthState } from "./read-state"
import { buildSourceHealthState } from "./source-state"
import { determineHealthStatus, type HealthStatus } from "./status"

export type HealthCheckResult = {
  readonly id: string
  readonly shareId: string
  readonly status: HealthStatus
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
    _sourceHost: string,
    options: SshExecutorOptions,
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

    logger.info({ shareId: share.id, shareName: share.name }, "health check started")

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
      const sourceHealth = buildSourceHealthState(sourceResults)
      sourceOnline = sourceHealth.sourceOnline
      nfsServiceOk = sourceHealth.nfsServiceOk
      if (!sourceOnline) {
        logger.warn({ shareId: share.id }, "health check: source node offline or SSH failed")
      }
      if (nfsServiceOk === false) {
        logger.warn({ shareId: share.id }, "health check: NFS service not active on source")
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
      if (targetOnline && (targetResults[0]?.result.exitCode ?? 1) === 0) {
        mountpointOk = (targetResults[0]?.result.stdout ?? "").trim().length > 0
      } else {
        logger.warn({ shareId: share.id }, "health check: target node offline or SSH failed")
      }
      if (mountpointOk === false) {
        logger.warn(
          { shareId: share.id, targetPath: share.targetPath },
          "health check: mountpoint not found",
        )
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
        const readHealth = buildReadHealthState(readResults)
        readOk = readHealth.readOk
        errorMessage = readHealth.errorMessage
        if (readOk === false) {
          logger.warn(
            { shareId: share.id, targetPath: share.targetPath, error: errorMessage },
            "health check: read test failed",
          )
        }
      }
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err)
      logger.error({ shareId: share.id, error: errorMessage }, "health check failed with exception")
    }

    const status = determineHealthStatus({
      sourceOnline,
      targetOnline,
      nfsServiceOk,
      mountpointOk,
      readOk,
    })
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

    logger.info(
      { shareId: share.id, status, sourceOnline, targetOnline, nfsServiceOk, mountpointOk, readOk },
      "health check completed",
    )

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
