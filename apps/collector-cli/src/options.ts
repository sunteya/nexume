export interface CollectorCliOptions {
  serverUrl: string
  token: string
  databasePath?: string
  almaDatabasePath?: string
  codexDatabasePath?: string
}

const optionNames = new Set([
  "--server-url",
  "--token",
  "--db-path",
  "--alma-db-path",
  "--codex-db-path",
])

const usage = `Usage:
  nexume-collector --server-url <url> --token <token> [options]

Options:
  --db-path <path>       Path to the OpenCode SQLite database.
  --alma-db-path <path>  Path to the Alma SQLite database.
  --codex-db-path <path> Path to the Codex SQLite database.
  --help                 Show this help message.`

export class CollectorCliUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CollectorCliUsageError"
  }
}

function requiredValue(args: string[], index: number, option: string): string {
  const value = args[index + 1]?.trim()
  if (!value || value.startsWith("--")) {
    throw new CollectorCliUsageError(
      `${option} requires a non-empty value.\n\n${usage}`,
    )
  }
  return value
}

export function parseCollectorCliOptions(args: string[]): CollectorCliOptions {
  if (args.includes("--help")) {
    throw new CollectorCliUsageError(usage)
  }

  const values = new Map<string, string>()
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]!
    if (!optionNames.has(option)) {
      throw new CollectorCliUsageError(`Unknown option: ${option}\n\n${usage}`)
    }
    if (values.has(option)) {
      throw new CollectorCliUsageError(
        `Duplicate option: ${option}\n\n${usage}`,
      )
    }

    values.set(option, requiredValue(args, index, option))
    index += 1
  }

  const serverUrl = values.get("--server-url")
  const token = values.get("--token")
  if (!serverUrl || !token) {
    throw new CollectorCliUsageError(
      `--server-url and --token are required.\n\n${usage}`,
    )
  }

  try {
    const url = new URL(serverUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error()
    }
  } catch {
    throw new CollectorCliUsageError(
      `--server-url must be an HTTP or HTTPS URL.\n\n${usage}`,
    )
  }

  return {
    serverUrl,
    token,
    databasePath: values.get("--db-path"),
    almaDatabasePath: values.get("--alma-db-path"),
    codexDatabasePath: values.get("--codex-db-path"),
  }
}
