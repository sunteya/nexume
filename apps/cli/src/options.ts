export type NexumeCliCommand =
  | { type: "help" }
  | { type: "version" }
  | { type: "config"; args: string[] }
  | { type: "collector"; args: string[] }

export const nexumeCliUsage = `Usage:
  nexume <command> [options]

Commands:
  config     Manage the Server URL and authentication tokens.
  collector  Start the remote session collector.

Options:
  -h, --help     Show this help message.
  -v, --version  Show the version.

Run "nexume <command> --help" for command-specific options.`

export class NexumeCliUsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NexumeCliUsageError"
  }
}

export function parseNexumeCliCommand(args: string[]): NexumeCliCommand {
  const [command, ...commandArgs] = args
  if (!command) {
    throw new NexumeCliUsageError(`A command is required.\n\n${nexumeCliUsage}`)
  }
  if (command === "--help" || command === "-h" || command === "help") {
    return { type: "help" }
  }
  if (command === "--version" || command === "-v") {
    return { type: "version" }
  }
  if (command === "collector") {
    return { type: "collector", args: commandArgs }
  }
  if (command === "config") {
    return { type: "config", args: commandArgs }
  }
  throw new NexumeCliUsageError(
    `Unknown command: ${command}\n\n${nexumeCliUsage}`,
  )
}
