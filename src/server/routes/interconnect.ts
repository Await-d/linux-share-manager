import { zValidator } from "@hono/zod-validator"
import type { Hono } from "hono"
import { z } from "zod"
import type { AuthService } from "../auth/service"
import type { AppConfig } from "../config"
import { AppError } from "../errors"
import { executeCommands } from "../executor/ssh-executor"
import { logger } from "../logger"
import type { AppEnv } from "../middleware/auth"
import { requireAuth } from "../middleware/auth"
import { testTcpConnection } from "../nodes/connectivity"
import type { NodeRepository } from "../nodes/repository"
import { deriveExportStatus } from "../shares/export-status"
import { isReachableProbeOutput } from "../shares/reachability"

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

const QuerySchema = z.object({
  sourcePath: z.string().optional(),
  targetPath: z.string().optional(),
})

export function registerInterconnectRoutes(options: InterconnectRouteOptions): void {
  const auth = requireAuth(options)

  options.app.get(
    "/api/interconnect/:sourceId/:targetId",
    auth,
    zValidator("param", PairParamSchema),
    zValidator("query", QuerySchema),
    async (context) => {
      const { sourceId, targetId } = context.req.valid("param")
      const query = context.req.valid("query")

      const source = options.nodes.find(sourceId)
      if (source === null) {
        throw new AppError("NODE_NOT_FOUND", "Source node does not exist.", 404)
      }

      const target = options.nodes.find(targetId)
      if (target === null) {
        throw new AppError("NODE_NOT_FOUND", "Target node does not exist.", 404)
      }

      const timeout = options.config.sshConnectTimeoutMs

      logger.info({ sourceId, targetId }, "interconnect check started")
      const [sourceReachable, targetReachable] = await Promise.all([
        testTcpConnection({ host: source.host, port: source.port, timeoutMs: timeout }),
        testTcpConnection({ host: target.host, port: target.port, timeoutMs: timeout }),
      ])

      const toStatus = (r: boolean): "ok" | "failed" => (r ? "ok" : "failed")

      // If either node is unreachable at SSH level, stop early
      if (!sourceReachable || !targetReachable) {
        let summary: string
        if (!sourceReachable && !targetReachable) {
          summary = "源节点和目标节点均不可达，请检查网络配置。"
        } else if (!sourceReachable) {
          summary = "源节点不可达，请先在节点页面测试源节点连接。"
        } else {
          summary = "目标节点不可达，请先在节点页面测试目标节点连接。"
        }

        logger.warn(
          { sourceId, targetId, sourceReachable, targetReachable },
          "interconnect: node(s) unreachable",
        )
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
          crossReachable: "failed" as const,
          nfsPort: null,
          mountStatus: "unknown" as const,
          readTest: "unknown" as const,
          writeTest: "unknown" as const,
          mountDetail: null,
          exportStatus: "unknown" as const,
          exportDetail: null,
          summary,
        })
      }

      // Both nodes reachable — detect actual NFS port on source via SSH
      const sourceCred = options.nodes.findCredential(sourceId)
      let nfsPort: number | null = null
      let crossReachable: "ok" | "failed" = "failed"
      let mountStatus: "unknown" | "mounted" | "not_mounted" = "unknown"
      let readTest: "unknown" | "ok" | "failed" = "unknown"
      let writeTest: "unknown" | "ok" | "failed" = "unknown"
      let mountDetail: string | null = null
      let exportStatus: "unknown" | "ok" | "not_exported" = "unknown"
      let exportDetail: string | null = null
      let exportProbeOutput: string | null = null

      if (sourceCred !== null) {
        try {
          // Detect NFS listening port on source
          const ssResults = await executeCommands(
            sourceCred,
            [
              {
                executable: "sh",
                args: [
                  "-c",
                  "ss -tlnp 2>/dev/null | grep -i nfs | grep -oP ':(\\d+)' | grep -oP '\\d+' | head -1 || rpcinfo -p 2>/dev/null | grep nfs | awk '{print $4}' | head -1 || echo '2049'",
                ],
                sudo: false,
                timeoutMs: 5_000,
                preview: "detect NFS port",
              },
            ],
            {
              connectTimeoutMs: timeout,
              defaultCommandTimeoutMs: 8_000,
              maxOutputBytes: 16_384,
            },
          )
          const portStr = (ssResults.length > 0 ? ssResults[0]?.result.stdout.trim() : "") || "2049"
          const parsed = Number.parseInt(portStr, 10)
          nfsPort = Number.isNaN(parsed) ? 2049 : parsed
          logger.info({ sourceId, targetId, nfsPort }, "interconnect: detected NFS port on source")

          // Test cross-node NFS reachability from target → source
          const targetCred = options.nodes.findCredential(targetId)
          if (targetCred !== null) {
            const crossResults = await executeCommands(
              targetCred,
              [
                {
                  executable: "sh",
                  args: [
                    "-c",
                    `timeout 3 bash -c 'echo >/dev/tcp/${source.host}/${nfsPort}' 2>/dev/null && echo 'REACHABLE' || echo 'UNREACHABLE'`,
                  ],
                  sudo: false,
                  timeoutMs: 8_000,
                  preview: `test NFS ${source.host}:${nfsPort} from target`,
                },
              ],
              {
                connectTimeoutMs: timeout,
                defaultCommandTimeoutMs: 8_000,
                maxOutputBytes: 16_384,
              },
            )
            const crossOutput =
              crossResults.length > 0 ? (crossResults[0]?.result.stdout.trim() ?? "") : ""
            crossReachable = isReachableProbeOutput(crossOutput) ? "ok" : "failed"

            // Check NFS export on source node — is sourcePath actually exported?
            if (query.sourcePath) {
              try {
                const exportResults = await executeCommands(
                  sourceCred,
                  [
                    {
                      executable: "sh",
                      args: [
                        "-c",
                        "exportfs -v 2>/dev/null | grep -F -- \"$1\" || echo '__NOT_EXPORTED__'",
                        "sh",
                        query.sourcePath,
                      ],
                      sudo: false,
                      timeoutMs: 5_000,
                      preview: `exportfs -v | grep ${query.sourcePath}`,
                    },
                  ],
                  {
                    connectTimeoutMs: timeout,
                    defaultCommandTimeoutMs: 8_000,
                    maxOutputBytes: 16_384,
                  },
                )
                const exportOutput =
                  exportResults.length > 0 ? (exportResults[0]?.result.stdout.trim() ?? "") : ""
                exportProbeOutput = exportOutput
              } catch (err) {
                logger.warn({ err, sourceId }, "interconnect: exportfs check failed")
                exportStatus = "unknown"
                exportDetail = `导出状态检测失败: ${err instanceof Error ? err.message : String(err)}`
              }
            }

            // Check NFS mount status on target node — use targetPath for precise check
            const checkPath = query.targetPath ?? null
            try {
              if (checkPath !== null) {
                // Precise check: is this specific path an NFS or autofs mount?
                // For systemd automount, the path may need to be accessed first to trigger mount.
                // Step 1: try to access the path to trigger automount
                try {
                  await executeCommands(
                    targetCred,
                    [
                      {
                        executable: "sh",
                        args: ["-c", 'ls -- "$1" >/dev/null 2>&1; true', "sh", checkPath],
                        sudo: false,
                        timeoutMs: 5_000,
                        preview: `ls ${checkPath} (trigger automount)`,
                      },
                    ],
                    {
                      connectTimeoutMs: timeout,
                      defaultCommandTimeoutMs: 8_000,
                      maxOutputBytes: 16_384,
                    },
                  )
                } catch {
                  // Ignore — the findmnt check below will determine status
                }

                // Step 2: check if the path is now mounted (nfs, nfs4, or autofs)
                const mountResults = await executeCommands(
                  targetCred,
                  [
                    {
                      executable: "sh",
                      args: [
                        "-c",
                        'findmnt -n -o SOURCE,FSTYPE,OPTIONS -- "$1" 2>/dev/null || findmnt -n -o SOURCE,TARGET,FSTYPE -t nfs,nfs4,autofs 2>/dev/null | grep -F -- "$1" || echo \'__NOT_MOUNTED__\'',
                        "sh",
                        checkPath,
                      ],
                      sudo: false,
                      timeoutMs: 5_000,
                      preview: `findmnt ${checkPath}`,
                    },
                  ],
                  {
                    connectTimeoutMs: timeout,
                    defaultCommandTimeoutMs: 8_000,
                    maxOutputBytes: 16_384,
                  },
                )
                const mountOutput =
                  mountResults.length > 0 ? (mountResults[0]?.result.stdout.trim() ?? "") : ""
                if (mountOutput.length === 0 || mountOutput.includes("__NOT_MOUNTED__")) {
                  mountStatus = "not_mounted"
                  mountDetail = `目标路径 ${checkPath} 未挂载 NFS。\n可能原因：共享计划未执行、挂载步骤失败、或 NFS 服务未正确配置。`
                } else {
                  mountStatus = "mounted"
                  mountDetail = `${checkPath} → ${mountOutput}`

                  // Read test on the specific mount path
                  try {
                    const readResults = await executeCommands(
                      targetCred,
                      [
                        {
                          executable: "sh",
                          args: [
                            "-c",
                            "ls -la -- \"$1\" >/dev/null 2>&1 && echo 'READ_OK' || echo 'READ_FAIL'",
                            "sh",
                            checkPath,
                          ],
                          sudo: false,
                          timeoutMs: 5_000,
                          preview: `ls ${checkPath}`,
                        },
                      ],
                      {
                        connectTimeoutMs: timeout,
                        defaultCommandTimeoutMs: 8_000,
                        maxOutputBytes: 16_384,
                      },
                    )
                    const readOutput =
                      readResults.length > 0 ? (readResults[0]?.result.stdout.trim() ?? "") : ""
                    readTest = readOutput.includes("READ_OK") ? "ok" : "failed"
                  } catch (err) {
                    logger.warn({ err, targetId }, "interconnect: read test failed")
                    readTest = "failed"
                  }

                  // Write test on the specific mount path
                  try {
                    const writeResults = await executeCommands(
                      targetCred,
                      [
                        {
                          executable: "sh",
                          args: [
                            "-c",
                            "test_file=$1/.lsm_write_test; touch -- \"$test_file\" 2>/dev/null && rm -f -- \"$test_file\" && echo 'WRITE_OK' || echo 'WRITE_FAIL'",
                            "sh",
                            checkPath,
                          ],
                          sudo: false,
                          timeoutMs: 5_000,
                          preview: `write test on ${checkPath}`,
                        },
                      ],
                      {
                        connectTimeoutMs: timeout,
                        defaultCommandTimeoutMs: 8_000,
                        maxOutputBytes: 16_384,
                      },
                    )
                    const writeOutput =
                      writeResults.length > 0 ? (writeResults[0]?.result.stdout.trim() ?? "") : ""
                    writeTest = writeOutput.includes("WRITE_OK") ? "ok" : "failed"
                  } catch (err) {
                    logger.warn({ err, targetId }, "interconnect: write test failed")
                    writeTest = "failed"
                  }
                }
              } else {
                // No targetPath — list all NFS/autofs mounts as a fallback
                const mountResults = await executeCommands(
                  targetCred,
                  [
                    {
                      executable: "sh",
                      args: [
                        "-c",
                        "findmnt -n -o SOURCE,TARGET,FSTYPE,OPTIONS -t nfs,nfs4,autofs 2>/dev/null || echo '__NO_NFS_MOUNT__'",
                      ],
                      sudo: false,
                      timeoutMs: 5_000,
                      preview: "findmnt -t nfs,nfs4,autofs",
                    },
                  ],
                  {
                    connectTimeoutMs: timeout,
                    defaultCommandTimeoutMs: 8_000,
                    maxOutputBytes: 16_384,
                  },
                )
                const mountOutput =
                  mountResults.length > 0 ? (mountResults[0]?.result.stdout.trim() ?? "") : ""
                if (mountOutput.length === 0 || mountOutput.includes("__NO_NFS_MOUNT__")) {
                  mountStatus = "not_mounted"
                  mountDetail = "目标节点上未检测到任何 NFS 挂载。"
                } else {
                  mountStatus = "mounted"
                  mountDetail = mountOutput
                }
              }
            } catch (err) {
              logger.warn({ err, targetId }, "interconnect: mount status check failed")
              mountStatus = "unknown"
              mountDetail = `挂载状态检测失败: ${err instanceof Error ? err.message : String(err)}`
            }
          } else {
            // Fallback: test from this service
            const reachable = await testTcpConnection({
              host: source.host,
              port: nfsPort,
              timeoutMs: timeout,
            })
            crossReachable = reachable ? "ok" : "failed"
          }
        } catch (err) {
          logger.warn(
            { err, sourceId, targetId },
            "interconnect NFS port detection failed, using default 2049",
          )
          nfsPort = 2049
          const reachable = await testTcpConnection({
            host: source.host,
            port: 2049,
            timeoutMs: timeout,
          })
          crossReachable = reachable ? "ok" : "failed"
          logger.info(
            { sourceId, targetId, nfsPort, crossReachable },
            "interconnect: cross-node NFS reachability result",
          )
        }
      } else {
        // No SSH credential — fallback to TCP test from this service
        logger.warn(
          { sourceId },
          "interconnect: no source SSH credential, falling back to TCP test",
        )
        nfsPort = 2049
        const reachable = await testTcpConnection({
          host: source.host,
          port: 2049,
          timeoutMs: timeout,
        })
        crossReachable = reachable ? "ok" : "failed"
      }

      if (query.sourcePath !== undefined && exportProbeOutput !== null) {
        const sourceHosts =
          source.primaryIp === null || source.primaryIp === source.host
            ? [source.host]
            : [source.host, source.primaryIp]
        const derivedExport = deriveExportStatus({
          sourceHosts,
          sourcePath: query.sourcePath,
          exportOutput: exportProbeOutput,
          mountDetail,
          readTest,
          writeTest,
        })
        exportStatus = derivedExport.status
        exportDetail = derivedExport.detail
      }

      // Build summary
      const parts: string[] = []
      if (crossReachable === "ok") {
        const portNote = nfsPort !== 2049 ? ` (非默认端口 ${nfsPort})` : ""
        parts.push(`NFS 端口 ${nfsPort}${portNote} 可访问`)
      } else {
        const portNote = nfsPort !== 2049 ? ` (检测到端口 ${nfsPort})` : ""
        parts.push(`NFS 服务端口 ${nfsPort}${portNote} 不可访问`)
      }
      if (exportStatus === "ok") {
        parts.push("源路径已导出")
      } else if (exportStatus === "not_exported") {
        parts.push("源路径未导出")
      }
      if (mountStatus === "mounted") {
        parts.push("目标路径已挂载")
      } else if (mountStatus === "not_mounted") {
        parts.push("目标路径未挂载")
      }
      if (readTest === "ok") {
        parts.push("读取测试通过")
      } else if (readTest === "failed") {
        parts.push("读取测试失败")
      }
      if (writeTest === "ok") {
        parts.push("写入测试通过")
      } else if (writeTest === "failed") {
        parts.push("写入测试失败")
      }

      const summary = parts.join("；")

      logger.info(
        {
          sourceId,
          targetId,
          nfsPort,
          crossReachable,
          mountStatus,
          readTest,
          writeTest,
          exportStatus,
        },
        "interconnect check completed",
      )
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
        crossReachable,
        nfsPort,
        mountStatus,
        readTest,
        writeTest,
        mountDetail,
        exportStatus,
        exportDetail,
        summary,
      })
    },
  )
}
