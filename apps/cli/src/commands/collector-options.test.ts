import { describe, expect, test } from "bun:test"

import {
  CollectorUsageError,
  parseCollectorCommand,
  parseCollectorOptions,
} from "./collector-options"

describe("parseCollectorCommand", () => {
  test("parses help commands", () => {
    expect(parseCollectorCommand(["--help"])).toEqual({ type: "help" })
    expect(parseCollectorCommand(["-h"])).toEqual({ type: "help" })
  })
})

describe("parseCollectorOptions", () => {
  test("parses Collector connection options", () => {
    expect(
      parseCollectorOptions([
        "--server-url",
        "https://nexume.example.com",
        "--collector-token",
        "collector-token",
        "--db-path",
        "/data/opencode.db",
        "--alma-db-path",
        "/data/alma.db",
        "--codex-db-path",
        "/data/codex.db",
        "--claude-projects-path",
        "/data/claude/projects",
      ]),
    ).toEqual({
      serverUrl: "https://nexume.example.com",
      collectorToken: "collector-token",
      databasePath: "/data/opencode.db",
      almaDatabasePath: "/data/alma.db",
      codexDatabasePath: "/data/codex.db",
      claudeProjectsPath: "/data/claude/projects",
    })
  })

  test("requires Server URL and token", () => {
    expect(() => parseCollectorOptions([])).toThrow(CollectorUsageError)
  })

  test("uses configured defaults and allows command overrides", () => {
    expect(
      parseCollectorOptions([], {
        serverUrl: "https://configured.example.com",
        collectorToken: "configured-token",
      }),
    ).toEqual({
      serverUrl: "https://configured.example.com",
      collectorToken: "configured-token",
      databasePath: undefined,
      almaDatabasePath: undefined,
      codexDatabasePath: undefined,
      claudeProjectsPath: undefined,
    })
    expect(
      parseCollectorOptions(
        ["--server-url", "https://override.example.com"],
        {
          serverUrl: "https://configured.example.com",
          collectorToken: "configured-token",
        },
      ),
    ).toEqual(
      expect.objectContaining({
        serverUrl: "https://override.example.com",
        collectorToken: "configured-token",
      }),
    )
  })

  test("rejects unknown and removed identity options", () => {
    expect(() =>
      parseCollectorOptions([
        "--server-url",
        "http://localhost:3000",
        "--collector-token",
        "token",
        "--unknown",
      ]),
    ).toThrow("Unknown option: --unknown")
    expect(() =>
      parseCollectorOptions([
        "--server-url",
        "http://localhost:3000",
        "--collector-token",
        "token",
        "--id",
        "collector-1",
      ]),
    ).toThrow("Unknown option: --id")
    expect(() =>
      parseCollectorOptions([
        "--server-url",
        "http://localhost:3000",
        "--collector-token",
        "token",
        "--name",
        "Collector 1",
      ]),
    ).toThrow("Unknown option: --name")
    expect(() =>
      parseCollectorOptions(["--token", "legacy-token"], {
        serverUrl: "http://localhost:3000",
        collectorToken: "collector-token",
      }),
    ).toThrow("Unknown option: --token")
  })

  test("rejects duplicate options and invalid Server URLs", () => {
    expect(() =>
      parseCollectorOptions([
        "--server-url",
        "http://localhost:3000",
        "--server-url",
        "http://localhost:4000",
        "--collector-token",
        "token",
      ]),
    ).toThrow("Duplicate option: --server-url")
    expect(() =>
      parseCollectorOptions([
        "--server-url",
        "ws://localhost:3000",
        "--collector-token",
        "token",
      ]),
    ).toThrow("must be an HTTP or HTTPS URL")
  })
})
