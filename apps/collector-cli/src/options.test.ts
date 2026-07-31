import { describe, expect, test } from "bun:test"

import { CollectorCliUsageError, parseCollectorCliOptions } from "./options"

describe("parseCollectorCliOptions", () => {
  test("parses Collector connection options", () => {
    expect(
      parseCollectorCliOptions([
        "--server-url",
        "https://nexume.example.com",
        "--token",
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
      token: "collector-token",
      databasePath: "/data/opencode.db",
      almaDatabasePath: "/data/alma.db",
      codexDatabasePath: "/data/codex.db",
      claudeProjectsPath: "/data/claude/projects",
    })
  })

  test("requires Server URL and token", () => {
    expect(() => parseCollectorCliOptions([])).toThrow(CollectorCliUsageError)
  })

  test("rejects unknown options", () => {
    expect(() =>
      parseCollectorCliOptions([
        "--server-url",
        "http://localhost:3000",
        "--token",
        "token",
        "--unknown",
      ]),
    ).toThrow("Unknown option")
  })

  test("rejects removed identity options", () => {
    expect(() =>
      parseCollectorCliOptions([
        "--server-url",
        "http://localhost:3000",
        "--token",
        "token",
        "--id",
        "collector-1",
      ]),
    ).toThrow("Unknown option: --id")
    expect(() =>
      parseCollectorCliOptions([
        "--server-url",
        "http://localhost:3000",
        "--token",
        "token",
        "--name",
        "Collector 1",
      ]),
    ).toThrow("Unknown option: --name")
  })
})
