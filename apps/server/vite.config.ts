import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"
import ElementPlus from "unplugin-element-plus/vite"

const apiPort = Number(process.env.PORT ?? 3000)

export default defineConfig({
  plugins: [vue(), ElementPlus({})],
  root: "src/web",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      "/api": `http://127.0.0.1:${apiPort}`,
    },
  },
})
