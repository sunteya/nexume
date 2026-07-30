import { randomBytes } from "node:crypto"
import { hostname, networkInterfaces } from "node:os"
import { resolve } from "node:path"

import Electrobun, { BrowserWindow, Utils } from "electrobun/bun"

import {
  AlmaCollector,
  CodexCollector,
  OpenCodeCollector,
} from "@nexume/collector-core"
import { startServerRuntime } from "@nexume/server-runtime"
import { openStorage } from "@nexume/storage"
import packageJson from "../../package.json"

const port = 0
const storage = await openStorage({ dataDir: Utils.paths.userData })
const sources = [
  new OpenCodeCollector({ databasePath: process.env.OPENCODE_DB_PATH }),
  new AlmaCollector({ databasePath: process.env.ALMA_DB_PATH }),
  new CodexCollector({ databasePath: process.env.CODEX_DB_PATH }),
]
const accessToken = `nxa_${randomBytes(32).toString("base64url")}`

if (
  storage.initialization.getStatus().initialized &&
  storage.collectors.get("local")?.name === "Server Local"
) {
  storage.collectors.updateName("local", "Desktop Local")
}

function desktopUrls(actualPort: number): string[] {
  const addresses = new Set(["127.0.0.1"])
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal)
        addresses.add(entry.address)
    }
  }
  return [...addresses].map((address) => `http://${address}:${actualPort}`)
}

const runtime = startServerRuntime({
  accessToken,
  storage,
  hostname: "0.0.0.0",
  port,
  webRoot: resolve(import.meta.dir, "../web"),
  localSources: sources,
  localMetadata: {
    hostname: hostname(),
    version: packageJson.version,
    agents: sources.map((source) => source.agent),
  },
  defaultLocalCollectorName: "Desktop Local",
  getRuntimeInfo: (actualPort) => ({
    kind: "desktop",
    port: actualPort,
    urls: desktopUrls(actualPort),
  }),
  onError: (error) => console.error(error),
})

let allowingQuit = false
Electrobun.events.on(
  "before-quit",
  (event: { response: { allow: boolean } }) => {
    if (allowingQuit) return
    event.response = { allow: false }
    void runtime.close().finally(() => {
      storage.close()
      allowingQuit = true
      Utils.quit()
    })
  },
)

new BrowserWindow({
  title: "Nexume",
  url: runtime.createBootstrapUrl(),
  frame: {
    width: 980,
    height: 680,
    x: 160,
    y: 120,
  },
})

console.log(`Nexume Desktop: http://0.0.0.0:${runtime.server.port ?? port}`)
