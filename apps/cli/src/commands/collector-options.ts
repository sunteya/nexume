import { isHttpServerUrl } from "../server-url"

export interface CollectorOptions {
  serverUrl: string
  collectorToken: string
  databasePath?: string
  almaDatabasePath?: string
  codexDatabasePath?: string
  claudeProjectsPath?: string
}

export interface CollectorOptionDefaults {
  serverUrl?: string
  collectorToken?: string
}

export type CollectorCommand =
  | { type: "help" }
  | { type: "run"; options: CollectorOptions }

const optionNames = new Set([
  "--server-url",
  "--collector-token",
  "--db-path",
  "--alma-db-path",
  "--codex-db-path",
  "--claude-projects-path",
])

export const collectorUsage = `Usage:
  nexume collector [options]

Options:
  --server-url <url>            Override the configured Nexume Server URL.
  --collector-token <token>     Override the configured Collector token.
  --db-path <path>              Path to the OpenCode SQLite database.
  --alma-db-path <path>         Path to the Alma SQLite database.
  --codex-db-path <path>        Path to the Codex SQLite database.
  --claude-projects-path <path> Path to the Claude Code projects directory.
  -h, --help                    Show this help message.`

export class CollectorUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CollectorUsageError"
  }
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index + 1]?.trim()
  if (!value || value.startsWith("--")) {
    throw new CollectorUsageError(
      `${option} requires a non-empty value.\n\n${collectorUsage}`,
    )
  }
  return value
}

export function parseCollectorOptions(
  args: string[],
  defaults: CollectorOptionDefaults = {},
): CollectorOptions {
  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!
    if (!optionNames.has(option)) {
      throw new CollectorUsageError(
        `Unknown option: ${option}\n\n${collectorUsage}`,
      )
    }
    if (values.has(option)) {
      throw new CollectorUsageError(
        `Duplicate option: ${option}\n\n${collectorUsage}`,
      )
    }

    values.set(option, requiredValue(args, index, option))
    index += 1
  }

  const serverUrl = values.get("--server-url") ?? defaults.serverUrl
  const collectorToken =
    values.get("--collector-token") ?? defaults.collectorToken
  if (!serverUrl || !collectorToken) {
    throw new CollectorUsageError(
      `Server URL and Collector token are required. Configure them with "nexume config set" or pass command options.\n\n${collectorUsage}`,
    )
  }

  if (!isHttpServerUrl(serverUrl)) {
    throw new CollectorUsageError(
      `Server URL must be an HTTP or HTTPS URL.\n\n${collectorUsage}`,
    )
  }

  return {
    serverUrl,
    collectorToken,
    databasePath: values.get("--db-path"),
    almaDatabasePath: values.get("--alma-db-path"),
    codexDatabasePath: values.get("--codex-db-path"),
    claudeProjectsPath: values.get("--claude-projects-path"),
  }
}

export function parseCollectorCommand(
  args: string[],
  defaults: CollectorOptionDefaults = {},
): CollectorCommand {
  if (args.includes("--help") || args.includes("-h")) return { type: "help" }
  return { type: "run", options: parseCollectorOptions(args, defaults) }
}
