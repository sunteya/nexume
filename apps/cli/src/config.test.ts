import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  clearNexumeConfig,
  getNexumeConfigPath,
  NexumeConfigError,
  readNexumeConfig,
  updateNexumeConfig,
} from "./config"

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

function createConfigPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "nexume-cli-config-"))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  return join(directory, "config.json")
}

describe("getNexumeConfigPath", () => {
  test("uses platform configuration directories", () => {
    expect(
      getNexumeConfigPath({
        platform: "darwin",
        homeDir: "/Users/test",
        env: {},
      }),
    ).toBe("/Users/test/Library/Application Support/Nexume/config.json")
    expect(
      getNexumeConfigPath({
        platform: "linux",
        homeDir: "/home/test",
        env: { XDG_CONFIG_HOME: "/config" },
      }),
    ).toBe("/config/nexume/config.json")
    expect(
      getNexumeConfigPath({
        platform: "win32",
        homeDir: "C:\\Users\\test",
        env: { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
      }),
    ).toBe("C:\\Users\\test\\AppData\\Roaming\\Nexume\\config.json")
  })
})

describe("Nexume configuration", () => {
  test("writes, merges and reads configuration", () => {
    const path = createConfigPath()
    updateNexumeConfig(
      {
        serverUrl: "https://nexume.example.com",
        accessToken: "access-token",
      },
      path,
    )
    updateNexumeConfig({ collectorToken: "collector-token" }, path)

    expect(readNexumeConfig(path)).toEqual({
      version: 1,
      serverUrl: "https://nexume.example.com",
      accessToken: "access-token",
      collectorToken: "collector-token",
    })
    if (process.platform !== "win32") {
      expect(statSync(path).mode & 0o777).toBe(0o600)
    }
  })

  test("clears selected fields and removes an empty configuration", () => {
    const path = createConfigPath()
    updateNexumeConfig(
      {
        serverUrl: "https://nexume.example.com",
        accessToken: "access-token",
      },
      path,
    )

    expect(clearNexumeConfig(["accessToken"], path)).toEqual({
      version: 1,
      serverUrl: "https://nexume.example.com",
    })
    clearNexumeConfig(["serverUrl"], path)
    expect(readNexumeConfig(path)).toEqual({ version: 1 })
  })

  test("rejects malformed and unsupported configuration", () => {
    const path = createConfigPath()
    writeFileSync(path, "not json")
    expect(() => readNexumeConfig(path)).toThrow(NexumeConfigError)

    writeFileSync(path, JSON.stringify({ version: 2 }))
    expect(() => readNexumeConfig(path)).toThrow("Unsupported")
  })
})
