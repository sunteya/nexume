import { randomUUID } from "node:crypto"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { dirname, posix, win32 } from "node:path"

import { isHttpServerUrl } from "./server-url"

export interface NexumeConfig {
  version: 1
  serverUrl?: string
  accessToken?: string
  collectorToken?: string
}

export type NexumeConfigKey =
  | "serverUrl"
  | "accessToken"
  | "collectorToken"

export interface NexumeConfigPathOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  homeDir?: string
}

export class NexumeConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "NexumeConfigError"
  }
}

export function getNexumeConfigPath(
  options: NexumeConfigPathOptions = {},
): string {
  const platform = options.platform ?? process.platform
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? homedir()

  if (platform === "win32") {
    const configRoot = env.APPDATA?.trim() ||
      win32.join(homeDir, "AppData", "Roaming")
    return win32.join(configRoot, "Nexume", "config.json")
  }
  if (platform === "darwin") {
    return posix.join(
      homeDir,
      "Library",
      "Application Support",
      "Nexume",
      "config.json",
    )
  }

  const configRoot = env.XDG_CONFIG_HOME?.trim() ||
    posix.join(homeDir, ".config")
  return posix.join(configRoot, "nexume", "config.json")
}

function optionalString(
  value: Record<string, unknown>,
  key: NexumeConfigKey,
): string | undefined {
  const field = value[key]
  if (field === undefined) return undefined
  if (typeof field !== "string" || !field.trim()) {
    throw new NexumeConfigError(`Invalid ${key} in the Nexume configuration.`)
  }
  return field.trim()
}

export function readNexumeConfig(
  path = getNexumeConfigPath(),
): NexumeConfig {
  if (!existsSync(path)) return { version: 1 }

  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, "utf8"))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new NexumeConfigError(
      `Unable to read Nexume configuration at ${path}: ${message}`,
    )
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NexumeConfigError(`Invalid Nexume configuration at ${path}.`)
  }

  const record = value as Record<string, unknown>
  if (record.version !== 1) {
    throw new NexumeConfigError(
      `Unsupported Nexume configuration version at ${path}.`,
    )
  }

  const serverUrl = optionalString(record, "serverUrl")
  if (serverUrl && !isHttpServerUrl(serverUrl)) {
    throw new NexumeConfigError(
      `Invalid serverUrl in the Nexume configuration.`,
    )
  }

  return {
    version: 1,
    serverUrl,
    accessToken: optionalString(record, "accessToken"),
    collectorToken: optionalString(record, "collectorToken"),
  }
}

export function writeNexumeConfig(
  config: NexumeConfig,
  path = getNexumeConfigPath(),
): void {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== "win32") chmodSync(directory, 0o700)

  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    })
    renameSync(temporaryPath, path)
    if (process.platform !== "win32") chmodSync(path, 0o600)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

export function updateNexumeConfig(
  patch: Partial<Omit<NexumeConfig, "version">>,
  path = getNexumeConfigPath(),
): NexumeConfig {
  const config = { ...readNexumeConfig(path), ...patch }
  writeNexumeConfig(config, path)
  return config
}

export function clearNexumeConfig(
  keys: NexumeConfigKey[],
  path = getNexumeConfigPath(),
): NexumeConfig {
  const config = readNexumeConfig(path)
  for (const key of keys) delete config[key]

  if (!config.serverUrl && !config.accessToken && !config.collectorToken) {
    rmSync(path, { force: true })
  } else {
    writeNexumeConfig(config, path)
  }
  return config
}
