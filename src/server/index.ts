import { serve } from "bun"
import { createApp } from "./app"
import { loadConfig } from "./config"
import { logger } from "./logger"

const config = loadConfig()
const app = createApp({ config })

serve({
  hostname: config.host,
  port: config.port,
  fetch: app.fetch,
})

logger.info({ host: config.host, port: config.port }, "Linux Share Manager API server started")
