import { version } from "../package.json"

import { CollectorUsageError } from "./commands/collector-options"
import { runCollector } from "./commands/collector"
import { ConfigUsageError } from "./commands/config-options"
import { runConfig } from "./commands/config"
import {
  nexumeCliUsage,
  NexumeCliUsageError,
  parseNexumeCliCommand,
} from "./options"

function main(): void {
  const command = parseNexumeCliCommand(process.argv.slice(2))
  if (command.type === "help") {
    console.log(nexumeCliUsage)
    return
  }
  if (command.type === "version") {
    console.log(version)
    return
  }
  if (command.type === "config") {
    runConfig(command.args)
  } else {
    runCollector(command.args)
  }
}

try {
  main()
} catch (error) {
  if (
    error instanceof NexumeCliUsageError ||
    error instanceof ConfigUsageError ||
    error instanceof CollectorUsageError
  ) {
    console.error(error.message)
    process.exitCode = 2
  } else {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[nexume] failed: ${message}`)
    process.exitCode = 1
  }
}
