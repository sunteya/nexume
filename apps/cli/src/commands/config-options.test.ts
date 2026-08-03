import { describe, expect, test } from "bun:test"

import { ConfigUsageError, parseConfigCommand } from "./config-options"

describe("parseConfigCommand", () => {
  test("parses help and show commands", () => {
    expect(parseConfigCommand(["--help"])).toEqual({ type: "help" })
    expect(parseConfigCommand(["show"])).toEqual({ type: "show" })
  })

  test("parses partial and complete settings", () => {
    expect(
      parseConfigCommand([
        "set",
        "--server-url",
        "https://nexume.example.com",
        "--access-token",
        "access-token",
        "--collector-token",
        "collector-token",
      ]),
    ).toEqual({
      type: "set",
      values: {
        serverUrl: "https://nexume.example.com",
        accessToken: "access-token",
        collectorToken: "collector-token",
      },
    })
    expect(
      parseConfigCommand(["set", "--collector-token", "collector-token"]),
    ).toEqual({
      type: "set",
      values: { collectorToken: "collector-token" },
    })
  })

  test("parses selected and complete clearing", () => {
    expect(
      parseConfigCommand(["clear", "--access-token", "--collector-token"]),
    ).toEqual({
      type: "clear",
      keys: ["accessToken", "collectorToken"],
    })
    expect(parseConfigCommand(["clear", "--all"])).toEqual({
      type: "clear",
      keys: ["serverUrl", "accessToken", "collectorToken"],
    })
  })

  test("rejects invalid commands and values", () => {
    expect(() => parseConfigCommand([])).toThrow(ConfigUsageError)
    expect(() => parseConfigCommand(["set"])).toThrow("at least one")
    expect(() =>
      parseConfigCommand(["set", "--server-url", "ws://localhost"]),
    ).toThrow("HTTP or HTTPS")
    expect(() =>
      parseConfigCommand(["clear", "--all", "--access-token"]),
    ).toThrow("cannot be combined")
  })
})
