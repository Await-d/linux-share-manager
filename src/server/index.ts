import { serve } from "bun"
import { createApp } from "./app"
import { loadConfig } from "./config"

const config = loadConfig()
const app = createApp({ config })

serve({
  hostname: config.host,
  port: config.port,
  fetch: app.fetch,
})

console.info(`Linux Share Manager API listening on http://${config.host}:${config.port}`)
