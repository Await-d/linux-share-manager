import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import { z } from "zod"
import { CreateNodeRequestSchema, UpdateNodeRequestSchema } from "../../shared/schemas/nodes"
import type { AuthService } from "../auth/service"
import type { AppConfig } from "../config"
import { AppError } from "../errors"
import { testSshAuthentication } from "../executor/ssh-executor"
import { logger } from "../logger"
import type { AppEnv } from "../middleware/auth"
import { requireAuth } from "../middleware/auth"
import { testTcpConnection } from "../nodes/connectivity"
import { probeNode } from "../nodes/probe"
import type { NodeRepository } from "../nodes/repository"

type NodeRouteOptions = {
  readonly app: Hono<AppEnv>
  readonly nodes: NodeRepository
  readonly auth: AuthService
  readonly config: AppConfig
}

const NodeParamSchema = z.object({ id: z.uuid() })

export function registerNodeRoutes(options: NodeRouteOptions): void {
  const auth = requireAuth(options)

  options.app.get("/api/nodes", auth, (context) => context.json({ nodes: options.nodes.list() }))

  options.app.get("/api/nodes/:id", auth, zValidator("param", NodeParamSchema), (context) => {
    const { id } = context.req.valid("param")
    const node = options.nodes.find(id)
    if (node === null) {
      logger.warn({ nodeId: id }, "node not found (get by id)")
      throw new AppError("NODE_NOT_FOUND", "The requested node does not exist.", 404)
    }

    return context.json(node)
  })

  options.app.post("/api/nodes", auth, zValidator("json", CreateNodeRequestSchema), (context) => {
    const node = options.nodes.create(context.req.valid("json"))
    logger.info({ nodeId: node.id, nodeName: node.name, host: node.host }, "node created")
    return context.json(node, 201)
  })

  // TCP connectivity test (fast, port-level only)
  options.app.post(
    "/api/nodes/:id/test-connection",
    auth,
    zValidator("param", NodeParamSchema),
    async (context) => {
      const { id } = context.req.valid("param")
      const node = options.nodes.find(id)
      if (node === null) {
        logger.warn({ nodeId: id }, "node not found (test-connection)")
        throw new AppError("NODE_NOT_FOUND", "The requested node does not exist.", 404)
      }

      logger.info({ nodeId: id, host: node.host, port: node.port }, "testing node TCP connection")
      const reachable = await testTcpConnection({
        host: node.host,
        port: node.port,
        timeoutMs: options.config.sshConnectTimeoutMs,
      })
      logger.info({ nodeId: id, reachable }, "node TCP connection test result")
      if (!reachable) {
        logger.warn(
          { nodeId: id, host: node.host, port: node.port },
          "node TCP connection test: unreachable",
        )
      }
      const tested = options.nodes.updateProbeStatus(id, reachable ? "ok" : "failed")
      if (tested === null) {
        throw new AppError("NODE_NOT_FOUND", "The requested node does not exist.", 404)
      }

      return context.json(tested)
    },
  )

  // Full SSH authentication test (login + credential verification)
  options.app.post(
    "/api/nodes/:id/test-auth",
    auth,
    zValidator("param", NodeParamSchema),
    async (context) => {
      const { id } = context.req.valid("param")
      const node = options.nodes.find(id)
      if (node === null) {
        logger.warn({ nodeId: id }, "node not found (test-auth)")
        throw new AppError("NODE_NOT_FOUND", "The requested node does not exist.", 404)
      }

      const credential = options.nodes.findCredential(id)
      if (credential === null) {
        logger.warn({ nodeId: id }, "node credential not found (test-auth)")
        throw new AppError("NODE_NOT_FOUND", "The requested node does not exist.", 404)
      }

      logger.info({ nodeId: id, host: node.host }, "testing node SSH auth")
      const result = await testSshAuthentication(credential, options.config.sshConnectTimeoutMs)
      logger.info({ nodeId: id, authenticated: result.success }, "node SSH auth test result")
      if (!result.success) {
        logger.warn(
          { nodeId: id, host: node.host, error: result.error },
          "node SSH auth test failed",
        )
      }

      options.nodes.updateProbeStatus(id, result.success ? "ok" : "failed")

      return context.json({
        nodeId: id,
        authenticated: result.success,
        error: result.error ?? null,
      })
    },
  )

  // Full node probe (OS, sudo, systemd, NFS, firewall, IP, disk)
  options.app.post(
    "/api/nodes/:id/probe",
    auth,
    zValidator("param", NodeParamSchema),
    async (context) => {
      const { id } = context.req.valid("param")
      const node = options.nodes.find(id)
      if (node === null) {
        logger.warn({ nodeId: id }, "node not found (probe)")
        throw new AppError("NODE_NOT_FOUND", "The requested node does not exist.", 404)
      }

      const credential = options.nodes.findCredential(id)
      if (credential === null) {
        logger.warn({ nodeId: id }, "node credential not found (probe)")
        throw new AppError("NODE_NOT_FOUND", "The requested node does not exist.", 404)
      }

      logger.info({ nodeId: id, host: node.host }, "node probe started")
      const probeResult = await probeNode(credential, {
        connectTimeoutMs: options.config.sshConnectTimeoutMs,
        commandTimeoutMs: 30_000,
        maxOutputBytes: 16_384,
      })
      logger.info(
        {
          nodeId: id,
          osFamily: probeResult.osFamily,
          sshOk: probeResult.sshOk,
          sudoOk: probeResult.sudoOk,
        },
        "node probe completed",
      )

      // Save probe results to node
      const updated = options.nodes.saveProbeResult(id, probeResult)
      if (updated === null) {
        throw new AppError("NODE_NOT_FOUND", "The requested node does not exist.", 404)
      }

      return context.json({
        node: updated,
        probe: probeResult,
      })
    },
  )

  // Get probe history
  options.app.get(
    "/api/nodes/:id/probe-results",
    auth,
    zValidator("param", NodeParamSchema),
    (context) => {
      const { id } = context.req.valid("param")
      const results = options.nodes.listProbeResults(id)
      return context.json({ results })
    },
  )

  options.app.patch(
    "/api/nodes/:id",
    auth,
    zValidator("param", NodeParamSchema),
    zValidator("json", UpdateNodeRequestSchema),
    (context) => {
      const { id } = context.req.valid("param")
      const node = options.nodes.update(id, context.req.valid("json"))
      if (node === null) {
        throw new AppError("NODE_NOT_FOUND", "The requested node does not exist.", 404)
      }

      logger.info({ nodeId: id, nodeName: node.name }, "node updated")
      return context.json(node)
    },
  )
}
