import type { NexumeConfigKey } from "../config"
import { isHttpServerUrl } from "../server-url"

export type ConfigCommand =
  | { type: "help" }
  | { type: "show" }
  | {
      type: "set"
      values: {
        serverUrl?: string
        accessToken?: string
        collectorToken?: string
      }
    }
  | { type: "clear"; keys: NexumeConfigKey[] }

const setOptions = new Map<string, NexumeConfigKey>([
  ["--server-url", "serverUrl"],
  ["--access-token", "accessToken"],
  ["--collector-token", "collectorToken"],
])

const clearOptions = new Map<string, NexumeConfigKey>([
  ["--server-url", "serverUrl"],
  ["--access-token", "accessToken"],
  ["--collector-token", "collectorToken"],
])

export const configUsage = `Usage:
  nexume config set [options]
  nexume config show
  nexume config clear <options>

Set options:
  --server-url <url>        Nexume Server URL.
  --access-token <token>    Token for API commands such as session list.
  --collector-token <token> Token for the remote Collector connection.

Clear options:
  --server-url              Clear the configured Server URL.
  --access-token            Clear the API access token.
  --collector-token         Clear the Collector token.
  --all                     Clear the entire configuration.

Options:
  -h, --help                Show this help message.`

export class ConfigUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ConfigUsageError"
  }
}

function usageError(message: string): ConfigUsageError {
  return new ConfigUsageError(`${message}\n\n${configUsage}`)
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index + 1]?.trim()
  if (!value || value.startsWith("--")) {
    throw usageError(`${option} requires a non-empty value.`)
  }
  return value
}

function parseSet(args: string[]): ConfigCommand {
  const values: Partial<Record<NexumeConfigKey, string>> = {}
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!
    const key = setOptions.get(option)
    if (!key) throw usageError(`Unknown config set option: ${option}`)
    if (key in values) throw usageError(`Duplicate option: ${option}`)
    values[key] = requiredValue(args, index, option)
    index += 1
  }
  if (Object.keys(values).length === 0) {
    throw usageError("config set requires at least one option.")
  }
  if (values.serverUrl && !isHttpServerUrl(values.serverUrl)) {
    throw usageError("--server-url must be an HTTP or HTTPS URL.")
  }
  return { type: "set", values }
}

function parseClear(args: string[]): ConfigCommand {
  if (args.length === 0) {
    throw usageError("config clear requires a field option or --all.")
  }
  if (args.includes("--all")) {
    if (args.length !== 1) {
      throw usageError("--all cannot be combined with other options.")
    }
    return {
      type: "clear",
      keys: ["serverUrl", "accessToken", "collectorToken"],
    }
  }

  const keys: NexumeConfigKey[] = []
  for (const option of args) {
    const key = clearOptions.get(option)
    if (!key) throw usageError(`Unknown config clear option: ${option}`)
    if (keys.includes(key)) throw usageError(`Duplicate option: ${option}`)
    keys.push(key)
  }
  return { type: "clear", keys }
}

export function parseConfigCommand(args: string[]): ConfigCommand {
  if (args.includes("--help") || args.includes("-h")) return { type: "help" }

  const [command, ...commandArgs] = args
  if (command === "show") {
    if (commandArgs.length) {
      throw usageError("config show does not accept options.")
    }
    return { type: "show" }
  }
  if (command === "set") return parseSet(commandArgs)
  if (command === "clear") return parseClear(commandArgs)
  if (!command) throw usageError("A config command is required.")
  throw usageError(`Unknown config command: ${command}`)
}
