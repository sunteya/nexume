import { hostname } from "node:os"

import {
  AlmaCollector,
  ClaudeCodeCollector,
  CodexCollector,
  CollectorConnection,
  OpenCodeCollector,
} from "@nexume/collector-core"
import { version } from "../../package.json"

import { readNexumeConfig } from "../config"
import {
  collectorUsage,
  parseCollectorCommand,
} from "./collector-options"

export function runCollector(args: string[]): void {
  const helpRequested = args.includes("--help") || args.includes("-h")
  const config = helpRequested ? undefined : readNexumeConfig()
  const command = parseCollectorCommand(args, {
    serverUrl: config?.serverUrl,
    collectorToken: config?.collectorToken,
  })
  if (command.type === "help") {
    console.log(collectorUsage)
    return
  }

  const { options } = command
  const sources = [
    new OpenCodeCollector({ databasePath: options.databasePath }),
    new AlmaCollector({ databasePath: options.almaDatabasePath }),
    new CodexCollector({ databasePath: options.codexDatabasePath }),
    new ClaudeCodeCollector({ projectsPath: options.claudeProjectsPath }),
  ]
  const connection = new CollectorConnection({
    serverUrl: options.serverUrl,
    token: options.collectorToken,
    metadata: {
      hostname: hostname(),
      version,
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
    process.exitCode = 0
  }

  process.once("SIGINT", stop)
  process.once("SIGTERM", stop)
}
