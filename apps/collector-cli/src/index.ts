import { hostname } from "node:os"

import {
  AlmaCollector,
  ClaudeCodeCollector,
  CodexCollector,
  CollectorConnection,
  OpenCodeCollector,
} from "@nexume/collector-core"
import packageJson from "../package.json"

import {
  CollectorCliUsageError,
  parseCollectorCliOptions,
  type CollectorCliOptions,
} from "./options"

let options: CollectorCliOptions
try {
  options = parseCollectorCliOptions(process.argv.slice(2))
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(error instanceof CollectorCliUsageError ? 2 : 1)
}

const sources = [
  new OpenCodeCollector({ databasePath: options.databasePath }),
  new AlmaCollector({ databasePath: options.almaDatabasePath }),
  new CodexCollector({ databasePath: options.codexDatabasePath }),
  new ClaudeCodeCollector({ projectsPath: options.claudeProjectsPath }),
]
const connection = new CollectorConnection({
  serverUrl: options.serverUrl,
  token: options.token,
  metadata: {
    hostname: hostname(),
    version: packageJson.version,
    agents: sources.map((source) => source.agent),
  },
  sources,
  onStateChange(state, detail) {
    console.log(`[collector] ${state}${detail ? `: ${detail}` : ""}`)
  },
  onSyncError(agent, error) {
    console.error(`[collector] ${agent} sync failed:`, error)
  },
})

for (const source of sources) {
  console.log(
    source.available
      ? `[collector] ${source.agent}: ${source.dataPath}`
      : `[collector] ${source.agent} data is unavailable: ${source.dataPath}`,
  )
}
connection.connect()

function stop(): void {
  connection.disconnect()
  process.exit(0)
}

process.once("SIGINT", stop)
process.once("SIGTERM", stop)
