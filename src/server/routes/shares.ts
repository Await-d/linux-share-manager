import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import { z } from "zod"
import { CreateShareRequestSchema, UpdateShareRequestSchema } from "../../shared/schemas/shares"
import type { AuditService } from "../audit/service"
import type { AuthService } from "../auth/service"
import type { AppConfig } from "../config"
import { AppError } from "../errors"
import { executeCommands } from "../executor/ssh-executor"
import type { HealthService } from "../health/service"
import type { AppEnv } from "../middleware/auth"
import { requireAuth } from "../middleware/auth"
import type { NodeRepository } from "../nodes/repository"
import { generateSharePlan, validatePaths } from "../plans/builder"
import type { PlanRepository } from "../plans/repository"
import type { ShareRepository } from "../shares/repository"

type ShareRouteOptions = {
  readonly app: Hono<AppEnv>
  readonly shares: ShareRepository
  readonly auth: AuthService
  readonly config: AppConfig
  readonly nodes: NodeRepository
  readonly plans: PlanRepository
  readonly health: HealthService
  readonly audit: AuditService
}

const ShareParamSchema = z.object({ id: z.uuid() })

export function registerShareRoutes(options: ShareRouteOptions): void {
  const auth = requireAuth(options)

  // List
  options.app.get("/api/shares", auth, (context) => context.json({ shares: options.shares.list() }))

  // Get one
  options.app.get("/api/shares/:id", auth, zValidator("param", ShareParamSchema), (context) => {
    const { id } = context.req.valid("param")
    const share = options.shares.find(id)
    if (share === null) {
      throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
    }
    return context.json(share)
  })

  // Create
  options.app.post("/api/shares", auth, zValidator("json", CreateShareRequestSchema), (context) => {
    const share = options.shares.create(context.req.valid("json"))
    options.audit.log({
      actor: context.get("user")?.username ?? "unknown",
      action: "share.created",
      targetType: "share",
      targetId: share.id,
      summary: `Created share: ${share.name}`,
    })
    return context.json(share, 201)
  })

  // Update
  options.app.patch(
    "/api/shares/:id",
    auth,
    zValidator("param", ShareParamSchema),
    zValidator("json", UpdateShareRequestSchema),
    (context) => {
      const { id } = context.req.valid("param")
      const share = options.shares.update(id, context.req.valid("json"))
      if (share === null) {
        throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
      }
      return context.json(share)
    },
  )

  // Delete
  options.app.delete("/api/shares/:id", auth, zValidator("param", ShareParamSchema), (context) => {
    const { id } = context.req.valid("param")
    const deleted = options.shares.delete(id)
    if (!deleted) {
      throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
    }
    return context.body(null, 204)
  })

  // Generate plan
  options.app.post(
    "/api/shares/:id/plan",
    auth,
    zValidator("param", ShareParamSchema),
    async (context) => {
      const { id } = context.req.valid("param")
      const share = options.shares.find(id)
      if (share === null) {
        throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
      }

      // Validate paths
      const pathErrors = validatePaths(share.sourcePath, share.targetPath)
      if (pathErrors.length > 0) {
        throw new AppError(
          "PLAN_VALIDATION_FAILED",
          pathErrors.map((e) => `${e.path}: ${e.message}`).join("; "),
          422,
        )
      }

      // Get node info
      const sourceCred = options.nodes.findCredential(share.sourceNodeId)
      const targetCred = options.nodes.findCredential(share.targetNodeId)
      if (sourceCred === null || targetCred === null) {
        throw new AppError("NODE_NOT_FOUND", "Source or target node not found.", 404)
      }

      const sourceNode = options.nodes.find(share.sourceNodeId)
      const targetNode = options.nodes.find(share.targetNodeId)
      if (sourceNode === null || targetNode === null) {
        throw new AppError("NODE_NOT_FOUND", "Source or target node not found.", 404)
      }

      // Check previous plan version
      const previousPlan = options.plans.findLatestForShare(id)
      const version = (previousPlan?.version ?? 0) + 1

      const plan = generateSharePlan(
        share,
        {
          id: sourceNode.id,
          name: sourceNode.name,
          host: sourceNode.host,
          osFamily: sourceNode.osFamily,
          primaryIp: sourceNode.primaryIp,
          sudoOk: true,
          nfsServerInstalled: false,
          nfsClientInstalled: false,
        },
        {
          id: targetNode.id,
          name: targetNode.name,
          host: targetNode.host,
          osFamily: targetNode.osFamily,
          primaryIp: targetNode.primaryIp,
          sudoOk: true,
          nfsServerInstalled: false,
          nfsClientInstalled: false,
        },
        version,
      )

      const record = options.plans.create(plan, context.get("user")?.username ?? null)

      // Update share status
      options.shares.update(id, { status: "planned" })

      options.audit.log({
        actor: context.get("user")?.username ?? "unknown",
        action: "share.plan_generated",
        targetType: "share",
        targetId: id,
        summary: `Plan v${version} generated for ${share.name} (risk: ${plan.riskLevel})`,
      })

      return context.json({ plan: record }, 201)
    },
  )

  // Get latest plan
  options.app.get(
    "/api/shares/:id/plan",
    auth,
    zValidator("param", ShareParamSchema),
    (context) => {
      const { id } = context.req.valid("param")
      const plan = options.plans.findLatestForShare(id)
      if (plan === null) {
        throw new AppError("PLAN_NOT_FOUND", "No plan found for this share.", 404)
      }
      return context.json({ plan })
    },
  )

  // Apply plan (confirm and execute)
  options.app.post(
    "/api/shares/:id/apply",
    auth,
    zValidator("param", ShareParamSchema),
    zValidator("json", z.object({ planId: z.string() })),
    async (context) => {
      const { id } = context.req.valid("param")
      const { planId } = context.req.valid("json")
      const share = options.shares.find(id)
      if (share === null) {
        throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
      }

      const planRecord = options.plans.find(planId)
      if (planRecord === null || planRecord.status !== "planned") {
        throw new AppError("PLAN_NOT_READY", "Plan not found or not in planned state.", 422)
      }

      // Confirm plan
      const confirmed = options.plans.confirm(planId)
      if (confirmed === null) {
        throw new AppError("PLAN_CONFIRM_FAILED", "Failed to confirm plan.", 500)
      }

      // Update share status
      options.shares.update(id, { status: "applying" })
      options.plans.updateStatus(planId, "applying")

      // Execute steps (in background — simplified here as sync for MVP)
      const plan = planRecord.plan
      const results: { stepKey: string; status: string; error?: string }[] = []

      for (const step of plan.steps) {
        try {
          const credential =
            step.nodeId === plan.sourceNode.id
              ? options.nodes.findCredential(share.sourceNodeId)
              : options.nodes.findCredential(share.targetNodeId)

          if (credential === null) continue

          await executeCommands(credential, step.commands, {
            connectTimeoutMs: options.config.sshConnectTimeoutMs,
            defaultCommandTimeoutMs: 30_000,
            maxOutputBytes: 16_384,
          })
          results.push({ stepKey: step.key, status: "succeeded" })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          results.push({ stepKey: step.key, status: "failed", error: message })
          // Rollback
          for (const rollbackCmd of step.rollbackCommands) {
            try {
              const credential =
                step.nodeId === plan.sourceNode.id
                  ? options.nodes.findCredential(share.sourceNodeId)
                  : options.nodes.findCredential(share.targetNodeId)
              if (credential !== null) {
                await executeCommands(credential, [rollbackCmd], {
                  connectTimeoutMs: options.config.sshConnectTimeoutMs,
                  defaultCommandTimeoutMs: 30_000,
                  maxOutputBytes: 16_384,
                })
              }
            } catch {
              // Rollback failure is logged but doesn't stop
            }
          }
          options.shares.update(id, { status: "partial_failed" })
          options.plans.updateStatus(planId, "failed")
          break
        }
      }

      const allSucceeded = results.every((r) => r.status === "succeeded")
      if (allSucceeded) {
        options.shares.update(id, { status: "active" })
        options.plans.updateStatus(planId, "applied")
      }

      options.audit.log({
        actor: context.get("user")?.username ?? "unknown",
        action: allSucceeded ? "share.plan_applied" : "share.plan_failed",
        targetType: "share",
        targetId: id,
        summary: `Plan applied: ${allSucceeded ? "success" : "partial failure"}`,
        metadata: { results },
      })

      return context.json({ results, allSucceeded })
    },
  )

  // Health check
  options.app.post(
    "/api/shares/:id/check",
    auth,
    zValidator("param", ShareParamSchema),
    async (context) => {
      const { id } = context.req.valid("param")
      const share = options.shares.find(id)
      if (share === null) {
        throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
      }

      const sourceCred = options.nodes.findCredential(share.sourceNodeId)
      const targetCred = options.nodes.findCredential(share.targetNodeId)
      if (sourceCred === null || targetCred === null) {
        throw new AppError(
          "CREDENTIAL_MISSING",
          "Source or target node credentials not found.",
          422,
        )
      }

      const result = await options.health.check(share, sourceCred, targetCred, share.sourcePath, {
        connectTimeoutMs: options.config.sshConnectTimeoutMs,
        commandTimeoutMs: 30_000,
        maxOutputBytes: 16_384,
      })

      // Update share status based on health
      const newStatus =
        result.status === "healthy"
          ? "active"
          : result.status === "degraded"
            ? "degraded"
            : "failed"
      options.shares.update(id, { status: newStatus })

      options.audit.log({
        actor: context.get("user")?.username ?? "unknown",
        action: "share.health_checked",
        targetType: "share",
        targetId: id,
        summary: result.summary,
      })

      return context.json({ health: result })
    },
  )

  // Get health check history
  options.app.get(
    "/api/shares/:id/health-checks",
    auth,
    zValidator("param", ShareParamSchema),
    (context) => {
      const { id } = context.req.valid("param")
      const checks = options.health.listForShare(id)
      return context.json({ checks })
    },
  )

  // Disable automount
  options.app.post(
    "/api/shares/:id/disable",
    auth,
    zValidator("param", ShareParamSchema),
    async (context) => {
      const { id } = context.req.valid("param")
      const share = options.shares.find(id)
      if (share === null) {
        throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
      }

      const targetCred = options.nodes.findCredential(share.targetNodeId)
      if (targetCred !== null) {
        const automountUnit = systemdEscapeName(`${share.targetPath}.automount`)
        await executeCommands(
          targetCred,
          [
            {
              executable: "systemctl",
              args: ["stop", automountUnit],
              sudo: true,
              timeoutMs: 10_000,
              preview: `systemctl stop ${automountUnit}`,
            },
            {
              executable: "systemctl",
              args: ["disable", automountUnit],
              sudo: true,
              timeoutMs: 5_000,
              preview: `systemctl disable ${automountUnit}`,
            },
          ],
          {
            connectTimeoutMs: options.config.sshConnectTimeoutMs,
            defaultCommandTimeoutMs: 30_000,
            maxOutputBytes: 16_384,
          },
        )
      }

      options.shares.update(id, { status: "disabled" })
      options.audit.log({
        actor: context.get("user")?.username ?? "unknown",
        action: "share.disabled",
        targetType: "share",
        targetId: id,
      })

      return context.json({ status: "disabled" })
    },
  )

  // Enable automount
  options.app.post(
    "/api/shares/:id/enable",
    auth,
    zValidator("param", ShareParamSchema),
    async (context) => {
      const { id } = context.req.valid("param")
      const share = options.shares.find(id)
      if (share === null) {
        throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
      }

      const targetCred = options.nodes.findCredential(share.targetNodeId)
      if (targetCred !== null) {
        const automountUnit = systemdEscapeName(`${share.targetPath}.automount`)
        await executeCommands(
          targetCred,
          [
            {
              executable: "systemctl",
              args: ["enable", automountUnit],
              sudo: true,
              timeoutMs: 5_000,
              preview: `systemctl enable ${automountUnit}`,
            },
            {
              executable: "systemctl",
              args: ["start", automountUnit],
              sudo: true,
              timeoutMs: 10_000,
              preview: `systemctl start ${automountUnit}`,
            },
          ],
          {
            connectTimeoutMs: options.config.sshConnectTimeoutMs,
            defaultCommandTimeoutMs: 30_000,
            maxOutputBytes: 16_384,
          },
        )
      }

      options.shares.update(id, { status: "active" })
      options.audit.log({
        actor: context.get("user")?.username ?? "unknown",
        action: "share.enabled",
        targetType: "share",
        targetId: id,
      })

      return context.json({ status: "active" })
    },
  )

  // Remount
  options.app.post(
    "/api/shares/:id/remount",
    auth,
    zValidator("param", ShareParamSchema),
    async (context) => {
      const { id } = context.req.valid("param")
      const share = options.shares.find(id)
      if (share === null) {
        throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
      }

      const targetCred = options.nodes.findCredential(share.targetNodeId)
      if (targetCred !== null) {
        const mountUnit = systemdEscapeName(`${share.targetPath}.mount`)
        await executeCommands(
          targetCred,
          [
            {
              executable: "systemctl",
              args: ["restart", mountUnit],
              sudo: true,
              timeoutMs: 15_000,
              preview: `systemctl restart ${mountUnit}`,
            },
          ],
          {
            connectTimeoutMs: options.config.sshConnectTimeoutMs,
            defaultCommandTimeoutMs: 30_000,
            maxOutputBytes: 16_384,
          },
        )
      }

      options.audit.log({
        actor: context.get("user")?.username ?? "unknown",
        action: "share.remounted",
        targetType: "share",
        targetId: id,
      })

      return context.json({ status: "remounted" })
    },
  )

  // Audit logs
  options.app.get("/api/audit-logs", auth, (context) => {
    const logs = options.audit.list()
    return context.json({ logs })
  })
}

function systemdEscapeName(path: string): string {
  let result = ""
  for (let i = 0; i < path.length; i++) {
    const ch = path[i]
    if (ch === "-") {
      result += "\\x2d"
    } else if (ch === "/") {
      result += "-"
      if (i + 1 < path.length && path[i + 1] === "/") {
        i++
      }
    } else if (
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9") ||
      ch === "_" ||
      ch === "."
    ) {
      result += ch
    } else {
      result += `\\x${ch.charCodeAt(0).toString(16)}`
    }
  }
  return result.replace(/^-+/, "")
}
