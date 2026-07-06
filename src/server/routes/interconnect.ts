import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import { z } from "zod"
import type { AuthService } from "../auth/service"
import type { AppConfig } from "../config"
import { AppError } from "../errors"
import type { AppEnv } from "../middleware/auth"
import { requireAuth } from "../middleware/auth"
import { testTcpConnection } from "../nodes/connectivity"
import type { NodeRepository } from "../nodes/repository"

type InterconnectRouteOptions = {
  readonly app: Hono<AppEnv>
  readonly nodes: NodeRepository
  readonly auth: AuthService
  readonly config: AppConfig
}

const PairParamSchema = z.object({
  sourceId: z.uuid(),
  targetId: z.uuid(),
})

export function registerInterconnectRoutes(options: InterconnectRouteOptions): void {
  const auth = requireAuth(options)

  options.app.get(
    "/api/interconnect/:sourceId/:targetId",
    auth,
    zValidator("param", PairParamSchema),
    async (context) => {
      const { sourceId, targetId } = context.req.valid("param")

      const source = options.nodes.find(sourceId)
      if (source === null) {
        throw new AppError("NODE_NOT_FOUND", "Source node does not exist.", 404)
      }

      const target = options.nodes.find(targetId)
      if (target === null) {
        throw new AppError("NODE_NOT_FOUND", "Target node does not exist.", 404)
      }

      const timeout = options.config.sshConnectTimeoutMs

      const [sourceReachable, targetReachable, crossReachable] = await Promise.all([
        testTcpConnection({ host: source.host, port: source.port, timeoutMs: timeout }),
        testTcpConnection({ host: target.host, port: target.port, timeoutMs: timeout }),
        // 测试从目标节点能否连接到源节点的 NFS 端口 (2049)
        testTcpConnection({ host: source.host, port: 2049, timeoutMs: timeout }),
      ])

      const toStatus = (r: boolean): "ok" | "failed" => (r ? "ok" : "failed")

      let summary: string
      if (sourceReachable && targetReachable && crossReachable) {
        summary = "两个节点均可达，且源节点 NFS 端口 2049 可访问。"
      } else if (!sourceReachable && !targetReachable) {
        summary = "源节点和目标节点均不可达，请检查网络配置。"
      } else if (!sourceReachable) {
        summary = "源节点不可达，请先在节点页面测试源节点连接。"
      } else if (!targetReachable) {
        summary = "目标节点不可达，请先在节点页面测试目标节点连接。"
      } else {
        summary = "节点可达，但源节点的 NFS 服务端口 2049 无法访问，请确认 NFS 服务已启动。"
      }

      return context.json({
        source: {
          nodeId: source.id,
          nodeName: source.name,
          host: source.host,
          port: source.port,
          reachable: toStatus(sourceReachable),
        },
        target: {
          nodeId: target.id,
          nodeName: target.name,
          host: target.host,
          port: target.port,
          reachable: toStatus(targetReachable),
        },
        crossReachable: toStatus(crossReachable),
        summary,
      })
    },
  )
}
