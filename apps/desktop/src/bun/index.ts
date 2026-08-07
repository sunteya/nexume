import { randomBytes } from "node:crypto"
import { hostname, networkInterfaces } from "node:os"
import { resolve } from "node:path"

import Electrobun, {
  ApplicationMenu,
  BrowserWindow,
  Utils,
} from "electrobun/bun"

import {
  AlmaCollector,
  ClaudeCodeCollector,
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
  new ClaudeCodeCollector({
    projectsPath: process.env.CLAUDE_PROJECTS_PATH,
  }),
]
const accessToken = `nxa_${randomBytes(32).toString("base64url")}`

ApplicationMenu.setApplicationMenu([
  {
    submenu: [
      { role: "about" },
      { type: "separator" },
      { role: "hide" },
      { role: "hideOthers" },
      { role: "showAll" },
      { type: "separator" },
      { role: "quit" },
    ],
  },
  {
    label: "Edit",
    submenu: [
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "pasteAndMatchStyle" },
      { role: "delete" },
      { role: "selectAll" },
    ],
  },
  {
    label: "Window",
    submenu: [
      { role: "minimize" },
      { role: "zoom" },
      { type: "separator" },
      { role: "bringAllToFront" },
    ],
  },
])

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

const bootstrapUrl = runtime.createBootstrapUrl()
const appOrigin = new URL(bootstrapUrl).origin
const window = new BrowserWindow({
  title: "Nexume",
  url: bootstrapUrl,
  frame: {
    width: 980,
    height: 680,
    x: 160,
    y: 120,
  },
})

function showQuitWaiting(): void {
  window.webview?.executeJavascript(
    'window.dispatchEvent(new Event("nexume:quit-waiting"))',
  )
}

let allowingQuit = false
let closing: Promise<void> | undefined
Electrobun.events.on(
  "before-quit",
  (event: { response: { allow: boolean } }) => {
    if (allowingQuit) return
    event.response = { allow: false }
    if (closing) return
    if (runtime.isLocalSyncing()) showQuitWaiting()
    closing = (async () => {
      try {
        await runtime.close()
      } catch (error) {
        console.error("Failed to close the desktop runtime:", error)
      }
      try {
        storage.close()
      } catch (error) {
        console.error("Failed to close desktop storage:", error)
      } finally {
        allowingQuit = true
        Utils.quit()
      }
    })()
  },
)

window.on("close", () => {
  if (runtime.isLocalSyncing()) showQuitWaiting()
})

function openExternalUrl(value: string): void {
  try {
    const url = new URL(value, bootstrapUrl)
    if (
      url.origin !== appOrigin &&
      (url.protocol === "http:" ||
        url.protocol === "https:" ||
        url.protocol === "mailto:")
    ) {
      Utils.openExternal(url.href)
    }
  } catch {
    // Ignore malformed links instead of passing them to the operating system.
  }
}

window.webview.setNavigationRules(["^*", `${appOrigin}/*`])
window.webview.on("will-navigate", (event) => {
  openExternalUrl((event as { data: { detail: string } }).data.detail)
})
Electrobun.events.on(`new-window-open-${window.webview.id}`, (event) => {
  const detail = (
    event as {
      data: { detail: string | { url: string } }
    }
  ).data.detail
  openExternalUrl(typeof detail === "string" ? detail : detail.url)
})

console.log(`Nexume Desktop: http://0.0.0.0:${runtime.server.port ?? port}`)
