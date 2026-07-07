import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import { z } from "zod"
import { CreateShareRequestSchema, UpdateShareRequestSchema } from "../../shared/schemas/shares"
import type { AuditService } from "../audit/service"
import type { AuthService } from "../auth/service"
import type { AppConfig } from "../config"
import { AppError } from "../errors"
import {
  type CommandSpec,
  shouldAttachSudoPassword,
  summarizeCommandForLog,
} from "../executor/command"
import { executeCommands } from "../executor/ssh-executor"
import type { HealthService } from "../health/service"
import { logger } from "../logger"
import type { AppEnv } from "../middleware/auth"
import { requireAuth } from "../middleware/auth"
import type { NodeRepository } from "../nodes/repository"
import { generateSharePlan, validatePaths } from "../plans/builder"
import type { PlanRepository, PlanStepResult } from "../plans/repository"
import { runPreCheck } from "../shares/precheck"
import type { ShareRepository } from "../shares/repository"
import { systemdEscapePath } from "../systemd/escape"

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
    logger.info({ shareId: share.id, shareName: share.name }, "share created")
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
        logger.warn({ shareId: id }, "share not found (update)")
        throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
      }
      logger.info({ shareId: id, shareName: share.name, status: share.status }, "share updated")
      return context.json(share)
    },
  )

  // Delete
  options.app.delete("/api/shares/:id", auth, zValidator("param", ShareParamSchema), (context) => {
    const { id } = context.req.valid("param")
    const deleted = options.shares.delete(id)
    if (!deleted) {
      logger.warn({ shareId: id }, "share not found (delete)")
      throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
    }
    logger.info({ shareId: id }, "share deleted")
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
        logger.warn({ shareId: id }, "share not found (generate plan)")
        throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
      }

      // Validate paths
      const pathErrors = validatePaths(share.sourcePath, share.targetPath)
      if (pathErrors.length > 0) {
        const errorSummary = pathErrors.map((e) => `${e.path}: ${e.message}`).join("; ")
        logger.warn({ shareId: id, errors: errorSummary }, "plan validation failed")
        throw new AppError("PLAN_VALIDATION_FAILED", errorSummary, 422)
      }

      // Get node info
      const sourceCred = options.nodes.findCredential(share.sourceNodeId)
      const targetCred = options.nodes.findCredential(share.targetNodeId)
      if (sourceCred === null || targetCred === null) {
        logger.warn(
          {
            shareId: id,
            sourceNodeId: share.sourceNodeId,
            targetNodeId: share.targetNodeId,
            sourceCredOk: sourceCred !== null,
            targetCredOk: targetCred !== null,
          },
          "plan generation: node credential not found",
        )
        throw new AppError("NODE_NOT_FOUND", "Source or target node not found.", 404)
      }

      const sourceNode = options.nodes.find(share.sourceNodeId)
      const targetNode = options.nodes.find(share.targetNodeId)
      if (sourceNode === null || targetNode === null) {
        logger.warn(
          { shareId: id, sourceNodeId: share.sourceNodeId, targetNodeId: share.targetNodeId },
          "plan generation: node not found",
        )
        throw new AppError("NODE_NOT_FOUND", "Source or target node not found.", 404)
      }

      // --- Pre-check: SSH, NFS port, NFS packages, NFS service ---
      logger.info(
        { shareId: id, shareName: share.name },
        "running pre-check before plan generation",
      )
      const preCheck = await runPreCheck(sourceCred, targetCred, sourceNode.host, {
        connectTimeoutMs: options.config.sshConnectTimeoutMs,
        commandTimeoutMs: 15_000,
        maxOutputBytes: 16_384,
      })

      // Hard block: SSH must be reachable
      if (!preCheck.passed) {
        throw new AppError("PRECHECK_FAILED", preCheck.errors.join("; "), 422)
      }

      // Read probe results from DB to get actual NFS install status
      const sourceProbeResults = options.nodes.listProbeResults(share.sourceNodeId)
      const targetProbeResults = options.nodes.listProbeResults(share.targetNodeId)
      const latestSourceProbe = sourceProbeResults.at(0)
      const latestTargetProbe = targetProbeResults.at(0)

      // Use real-time SSH check results if available, fall back to DB probe results
      const nfsServerInstalled =
        preCheck.nfsServerInstalled || (latestSourceProbe?.nfsServerInstalled ?? false)
      const nfsClientInstalled =
        preCheck.nfsClientInstalled || (latestTargetProbe?.nfsClientInstalled ?? false)

      // Determine sudo password for each node (only for password-based SSH auth)
      const sourceSudoPassword =
        sourceCred.authType === "password_session" && sourceCred.decryptedSecret !== null
          ? sourceCred.decryptedSecret
          : null
      const targetSudoPassword =
        targetCred.authType === "password_session" && targetCred.decryptedSecret !== null
          ? targetCred.decryptedSecret
          : null

      // Detect actual NFS port — use precheck result if NFS is listening on non-default port
      const nfsPort = preCheck.nfsPortInfo.defaultPortOk
        ? undefined // default 2049, no need to specify
        : (preCheck.nfsPortInfo.primaryPort ?? undefined)

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
          sudoOk: preCheck.sourceSudoOk,
          sudoPassword: sourceSudoPassword,
          nfsServerInstalled,
          nfsClientInstalled: false, // source doesn't need client
        },
        {
          id: targetNode.id,
          name: targetNode.name,
          host: targetNode.host,
          osFamily: targetNode.osFamily,
          primaryIp: targetNode.primaryIp,
          sudoOk: preCheck.targetSudoOk,
          sudoPassword: targetSudoPassword,
          nfsServerInstalled: false, // target doesn't need server
          nfsClientInstalled,
        },
        {
          version,
          nfsPort,
          supportedNfsVersions: preCheck.nfsVersionInfo.supportedVersions,
        },
      )

      // Attach pre-check warnings to the plan
      const enrichedPlan = {
        ...plan,
        warnings: [...plan.warnings, ...preCheck.warnings],
      }

      const record = options.plans.create(enrichedPlan, context.get("user")?.username ?? null)

      // Update share status
      options.shares.update(id, { status: "planned" })

      options.audit.log({
        actor: context.get("user")?.username ?? "unknown",
        action: "share.plan_generated",
        targetType: "share",
        targetId: id,
        summary: `Plan v${version} generated for ${share.name} (risk: ${plan.riskLevel}, precheck: ${preCheck.summary})`,
      })

      logger.info({ shareId: id, version, preCheckSummary: preCheck.summary }, "plan generated")

      return context.json({ plan: record, preCheck: preCheck }, 201)
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
        logger.warn({ shareId: id }, "share not found (apply plan)")
        throw new AppError("SHARE_NOT_FOUND", "The requested share does not exist.", 404)
      }

      const planRecord = options.plans.find(planId)
      if (planRecord === null) {
        logger.warn({ shareId: id, planId }, "plan not found for apply")
        throw new AppError("PLAN_NOT_READY", "Plan not found.", 422)
      }
      if (planRecord.status !== "planned" && planRecord.status !== "failed") {
        logger.warn({ shareId: id, planId, status: planRecord.status }, "plan not ready for apply")
        throw new AppError("PLAN_NOT_READY", "Plan not found or not in a retryable state.", 422)
      }

      // --- Pre-check before execution: SSH must be reachable ---
      const sourceNode = options.nodes.find(share.sourceNodeId)
      const sourceCred = options.nodes.findCredential(share.sourceNodeId)
      const targetCred = options.nodes.findCredential(share.targetNodeId)

      if (sourceNode !== null && sourceCred !== null && targetCred !== null) {
        logger.info({ shareId: id }, "running pre-check before plan execution")
        const preCheck = await runPreCheck(sourceCred, targetCred, sourceNode.host, {
          connectTimeoutMs: options.config.sshConnectTimeoutMs,
          commandTimeoutMs: 15_000,
          maxOutputBytes: 16_384,
        })

        if (!preCheck.passed) {
          logger.warn(
            { shareId: id, errors: preCheck.errors },
            "pre-check failed before plan execution",
          )
          throw new AppError(
            "PRECHECK_FAILED",
            `执行前检查失败: ${preCheck.errors.join("; ")}`,
            422,
          )
        }

        logger.info(
          { shareId: id, preCheckSummary: preCheck.summary },
          "pre-check passed, proceeding with execution",
        )
      } else {
        logger.warn(
          {
            shareId: id,
            sourceNodeOk: sourceNode !== null,
            sourceCredOk: sourceCred !== null,
            targetCredOk: targetCred !== null,
          },
          "apply plan: node/credential missing, skipping pre-check",
        )
      }

      // Confirm or re-confirm plan
      const confirmed =
        planRecord.status === "failed"
          ? options.plans.reconfirm(planId)
          : options.plans.confirm(planId)
      if (confirmed === null) {
        logger.error({ shareId: id, planId, previousStatus: planRecord.status }, "计划确认失败")
        throw new AppError("PLAN_CONFIRM_FAILED", "Failed to confirm plan.", 500)
      }

      // Update share status
      options.shares.update(id, { status: "applying" })
      options.plans.updateStatus(planId, "applying")

      logger.info(
        {
          shareId: id,
          shareName: share.name,
          planId,
          version: planRecord.version,
          riskLevel: planRecord.riskLevel,
          stepCount: planRecord.plan.steps.length,
          sourceNodeId: planRecord.plan.sourceNode.id,
          sourceNodeName: planRecord.plan.sourceNode.name,
          targetNodeId: planRecord.plan.targetNode.id,
          targetNodeName: planRecord.plan.targetNode.name,
        },
        "共享计划开始执行",
      )

      // Execute steps
      const plan = planRecord.plan
      const results: PlanStepResult[] = []

      for (const [stepIndex, step] of plan.steps.entries()) {
        const stepNumber = stepIndex + 1
        const credential =
          step.nodeId === plan.sourceNode.id
            ? options.nodes.findCredential(share.sourceNodeId)
            : options.nodes.findCredential(share.targetNodeId)

        if (credential === null) {
          logger.warn(
            {
              shareId: id,
              planId,
              stepKey: step.key,
              stepName: step.name,
              stepNumber,
              totalSteps: plan.steps.length,
              nodeId: step.nodeId,
              nodeName: step.nodeName,
            },
            "计划步骤失败：节点凭据缺失",
          )
          results.push({
            stepKey: step.key,
            status: "failed",
            error: "节点凭据缺失，无法执行 SSH 命令。",
          })
          options.shares.update(id, { status: "partial_failed" })
          options.plans.updateStatus(planId, "failed")
          break
        }

        const sudoPassword =
          credential.authType === "password_session" && credential.decryptedSecret !== null
            ? credential.decryptedSecret
            : undefined
        const commandsWithPassword = step.commands.map((cmd) =>
          shouldAttachSudoPassword(cmd) && sudoPassword !== undefined
            ? { ...cmd, sudoPassword }
            : cmd,
        )
        const rollbackWithPassword = step.rollbackCommands.map((cmd) =>
          shouldAttachSudoPassword(cmd) && sudoPassword !== undefined
            ? { ...cmd, sudoPassword }
            : cmd,
        )

        try {
          logger.info(
            {
              shareId: id,
              shareName: share.name,
              planId,
              stepKey: step.key,
              authType: credential.authType,
              stepName: step.name,
              stepNumber,
              totalSteps: plan.steps.length,
              nodeId: step.nodeId,
              nodeName: step.nodeName,
              host: credential.host,
              username: credential.username,
              hasSshPassword: sudoPassword !== undefined,
              commandCount: commandsWithPassword.length,
              rollbackCommandCount: rollbackWithPassword.length,
              passwordInjectedCount: commandsWithPassword.filter(
                (cmd) => cmd.sudoPassword !== undefined,
              ).length,
              commands: commandsWithPassword.map((cmd, index) =>
                summarizeCommandForLog(cmd, index + 1),
              ),
            },
            "计划步骤开始执行：已完成 sudo 密码策略计算",
          )

          const execResults = await executeCommands(credential, commandsWithPassword, {
            connectTimeoutMs: options.config.sshConnectTimeoutMs,
            defaultCommandTimeoutMs: 30_000,
            maxOutputBytes: 16_384,
          })

          // Check each command's exit code — non-zero means failure
          const failedCommandIndex = execResults.findIndex(
            (r) => r.result.exitCode !== 0 || r.result.timedOut,
          )
          const failedCmd =
            failedCommandIndex === -1 ? undefined : execResults.at(failedCommandIndex)
          if (failedCmd !== undefined) {
            const errMsg = failedCmd.result.timedOut
              ? `命令超时: ${failedCmd.spec.preview}`
              : `命令失败 (exit=${failedCmd.result.exitCode}): ${[failedCmd.result.stderr.trim(), failedCmd.result.stdout.trim()].filter(Boolean).join(" || ") || failedCmd.spec.preview}`
            results.push({ stepKey: step.key, status: "failed", error: errMsg })
            logger.error(
              {
                shareId: id,
                shareName: share.name,
                planId,
                stepKey: step.key,
                stepName: step.name,
                stepNumber,
                totalSteps: plan.steps.length,
                command: summarizeCommandForLog(failedCmd.spec, failedCommandIndex + 1),
                exitCode: failedCmd.result.exitCode,
                timedOut: failedCmd.result.timedOut,
                stdout: truncateForLog(failedCmd.result.stdout),
                stderr: truncateForLog(failedCmd.result.stderr),
              },
              "计划步骤失败：命令返回非零退出码或超时",
            )

            // Rollback
            if (rollbackWithPassword.length > 0) {
              logger.warn(
                {
                  shareId: id,
                  planId,
                  stepKey: step.key,
                  stepName: step.name,
                  rollbackCommandCount: rollbackWithPassword.length,
                  rollbackCommands: rollbackWithPassword.map((cmd, index) =>
                    summarizeCommandForLog(cmd, index + 1),
                  ),
                },
                "计划步骤失败，开始执行回滚命令",
              )
            }
            for (const [rollbackIndex, rollbackCmd] of rollbackWithPassword.entries()) {
              try {
                await executeCommands(credential, [rollbackCmd], {
                  connectTimeoutMs: options.config.sshConnectTimeoutMs,
                  defaultCommandTimeoutMs: 30_000,
                  maxOutputBytes: 16_384,
                })
              } catch (rollbackError) {
                const rollbackMessage =
                  rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
                logger.warn(
                  {
                    shareId: id,
                    planId,
                    stepKey: step.key,
                    stepName: step.name,
                    command: summarizeCommandForLog(rollbackCmd, rollbackIndex + 1),
                    error: rollbackMessage,
                  },
                  "回滚命令执行异常，已忽略并继续记录原始失败",
                )
              }
            }
            options.shares.update(id, { status: "partial_failed" })
            options.plans.updateStatus(planId, "failed")
            break
          }

          results.push({ stepKey: step.key, status: "succeeded" })
          logger.info(
            {
              shareId: id,
              planId,
              stepKey: step.key,
              stepName: step.name,
              stepNumber,
              totalSteps: plan.steps.length,
              commandCount: execResults.length,
            },
            "计划步骤执行成功",
          )
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          results.push({ stepKey: step.key, status: "failed", error: message })
          logger.error(
            {
              shareId: id,
              shareName: share.name,
              planId,
              stepKey: step.key,
              stepName: step.name,
              stepNumber,
              totalSteps: plan.steps.length,
              error: message,
            },
            "计划步骤执行异常，开始回滚",
          )
          // Rollback
          for (const [rollbackIndex, rollbackCmd] of rollbackWithPassword.entries()) {
            try {
              await executeCommands(credential, [rollbackCmd], {
                connectTimeoutMs: options.config.sshConnectTimeoutMs,
                defaultCommandTimeoutMs: 30_000,
                maxOutputBytes: 16_384,
              })
            } catch (rollbackError) {
              const rollbackMessage =
                rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
              logger.warn(
                {
                  shareId: id,
                  planId,
                  stepKey: step.key,
                  stepName: step.name,
                  command: summarizeCommandForLog(rollbackCmd, rollbackIndex + 1),
                  error: rollbackMessage,
                },
                "回滚命令执行异常，已忽略并继续记录原始失败",
              )
            }
          }
          options.shares.update(id, { status: "partial_failed" })
          options.plans.updateStatus(planId, "failed")
          break
        }
      }

      const allSucceeded = results.length > 0 && results.every((r) => r.status === "succeeded")
      options.plans.updateResults(planId, results)
      if (allSucceeded) {
        options.shares.update(id, { status: "active" })
        options.plans.updateStatus(planId, "applied")
        logger.info(
          {
            shareId: id,
            shareName: share.name,
            planId,
            succeededCount: results.filter((r) => r.status === "succeeded").length,
            failedCount: 0,
            resultCount: results.length,
          },
          "共享计划执行完成：全部成功",
        )
      } else {
        logger.warn(
          {
            shareId: id,
            shareName: share.name,
            planId,
            succeededCount: results.filter((r) => r.status === "succeeded").length,
            failedCount: results.filter((r) => r.status === "failed").length,
            resultCount: results.length,
            results,
          },
          "共享计划执行完成：存在失败步骤",
        )
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

      logger.info({ shareId: id, shareName: share.name }, "health check requested")
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
        defaultCommandTimeoutMs: 30_000,
        maxOutputBytes: 16_384,
      })

      // Update share status based on health
      const newStatus =
        result.status === "healthy"
          ? "active"
          : result.status === "degraded"
            ? "degraded"
            : "partial_failed"
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

      logger.info(
        { shareId: id, shareName: share.name, autoMount: share.autoMount },
        "disabling share",
      )
      const targetCred = options.nodes.findCredential(share.targetNodeId)
      if (targetCred !== null) {
        await executeCommands(
          targetCred,
          withSudoPassword(buildShareControlCommands(share, "disable"), targetCred),
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

      logger.info(
        { shareId: id, shareName: share.name, autoMount: share.autoMount },
        "enabling share",
      )
      const targetCred = options.nodes.findCredential(share.targetNodeId)
      if (targetCred !== null) {
        await executeCommands(
          targetCred,
          withSudoPassword(buildShareControlCommands(share, "enable"), targetCred),
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

      logger.info({ shareId: id, shareName: share.name }, "remounting share")
      const targetCred = options.nodes.findCredential(share.targetNodeId)
      if (targetCred !== null) {
        const mountUnit = `${systemdEscapePath(share.targetPath)}.mount`
        await executeCommands(
          targetCred,
          withSudoPassword(
            [
              {
                executable: "systemctl",
                args: ["restart", mountUnit],
                sudo: true,
                timeoutMs: 15_000,
                preview: `systemctl restart ${mountUnit}`,
              },
            ],
            targetCred,
          ),
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

export function buildShareControlCommands(
  share: { readonly targetPath: string; readonly autoMount: boolean },
  action: "disable" | "enable",
): readonly CommandSpec[] {
  const unit = `${systemdEscapePath(share.targetPath)}.${share.autoMount ? "automount" : "mount"}`
  if (action === "disable") {
    return [
      {
        executable: "systemctl",
        args: ["stop", unit],
        sudo: true,
        timeoutMs: 10_000,
        preview: `systemctl stop ${unit}`,
      },
      ...(share.autoMount
        ? [
            {
              executable: "systemctl",
              args: ["disable", unit],
              sudo: true,
              timeoutMs: 5_000,
              preview: `systemctl disable ${unit}`,
            },
          ]
        : []),
    ]
  }

  return [
    ...(share.autoMount
      ? [
          {
            executable: "systemctl",
            args: ["enable", unit],
            sudo: true,
            timeoutMs: 5_000,
            preview: `systemctl enable ${unit}`,
          },
        ]
      : []),
    {
      executable: "systemctl",
      args: ["start", unit],
      sudo: true,
      timeoutMs: 10_000,
      preview: `systemctl start ${unit}`,
    },
  ]
}

/** Inject sudo password into commands that need it, based on the credential's auth type. */
function withSudoPassword(
  commands: readonly CommandSpec[],
  credential: { authType: "private_key" | "password_session"; decryptedSecret: string | null },
): CommandSpec[] {
  const password =
    credential.authType === "password_session" && credential.decryptedSecret !== null
      ? credential.decryptedSecret
      : undefined
  if (password === undefined) {
    return [...commands]
  }
  return commands.map((cmd) =>
    shouldAttachSudoPassword(cmd) ? { ...cmd, sudoPassword: password } : cmd,
  )
}

function truncateForLog(value: string, maxChars: number = 2_000): string {
  const trimmed = value.trim()
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars)}...`
}
