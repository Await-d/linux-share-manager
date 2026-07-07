import { createConnection } from "node:net"
import { logger } from "../logger"

type ConnectionTarget = {
  readonly host: string
  readonly port: number
  readonly timeoutMs: number
}

export async function testTcpConnection(target: ConnectionTarget): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: target.host, port: target.port })
    let settled = false

    function finish(reachable: boolean): void {
      if (settled) {
        return
      }
      settled = true
      socket.destroy()
      if (reachable) {
        logger.debug({ host: target.host, port: target.port }, "tcp connection test: reachable")
      } else {
        logger.warn({ host: target.host, port: target.port }, "tcp connection test: unreachable")
      }
      resolve(reachable)
    }

    socket.setTimeout(target.timeoutMs)
    socket.once("connect", () => finish(true))
    socket.once("timeout", () => finish(false))
    socket.once("error", () => finish(false))
  })
}
