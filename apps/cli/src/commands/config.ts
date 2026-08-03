import {
  clearNexumeConfig,
  getNexumeConfigPath,
  readNexumeConfig,
  updateNexumeConfig,
} from "../config"
import { configUsage, parseConfigCommand } from "./config-options"

function configured(value: string | undefined): string {
  return value ? "configured" : "not configured"
}

export function runConfig(args: string[]): void {
  const command = parseConfigCommand(args)
  if (command.type === "help") {
    console.log(configUsage)
    return
  }

  const path = getNexumeConfigPath()
  if (command.type === "show") {
    const config = readNexumeConfig(path)
    console.log(`Config file:     ${path}`)
    console.log(`Server URL:      ${config.serverUrl ?? "not configured"}`)
    console.log(`Access token:    ${configured(config.accessToken)}`)
    console.log(`Collector token: ${configured(config.collectorToken)}`)
    return
  }
  if (command.type === "set") {
    updateNexumeConfig(command.values, path)
    console.log(`Configuration saved to ${path}`)
    return
  }

  clearNexumeConfig(command.keys, path)
  console.log(`Configuration cleared at ${path}`)
}
