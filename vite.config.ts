import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const API_TARGET_ENV_NAME = "LSM_API_TARGET"
const apiTarget = process.env[API_TARGET_ENV_NAME] ?? "http://127.0.0.1:18088"

export default defineConfig({
  plugins: [react()],
  build: {
    emptyOutDir: true,
    outDir: "dist/web",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": apiTarget,
    },
  },
})
