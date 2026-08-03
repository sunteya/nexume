import { describe, expect, test } from "bun:test"

import {
  NexumeCliUsageError,
  parseNexumeCliCommand,
} from "./options"

describe("parseNexumeCliCommand", () => {
  test("parses global help and version commands", () => {
    expect(parseNexumeCliCommand(["--help"])).toEqual({ type: "help" })
    expect(parseNexumeCliCommand(["-h"])).toEqual({ type: "help" })
    expect(parseNexumeCliCommand(["help"])).toEqual({ type: "help" })
    expect(parseNexumeCliCommand(["--version"])).toEqual({ type: "version" })
    expect(parseNexumeCliCommand(["-v"])).toEqual({ type: "version" })
  })

  test("forwards Collector arguments", () => {
    expect(
      parseNexumeCliCommand([
        "collector",
        "--server-url",
        "https://nexume.example.com",
        "--collector-token",
        "token",
      ]),
    ).toEqual({
      type: "collector",
      args: [
        "--server-url",
        "https://nexume.example.com",
        "--collector-token",
        "token",
      ],
    })
  })

  test("forwards config arguments", () => {
    expect(
      parseNexumeCliCommand(["config", "set", "--access-token", "token"]),
    ).toEqual({
      type: "config",
      args: ["set", "--access-token", "token"],
    })
  })

  test("requires a known command", () => {
    expect(() => parseNexumeCliCommand([])).toThrow(NexumeCliUsageError)
    expect(() => parseNexumeCliCommand(["unknown"])).toThrow(
      "Unknown command: unknown",
    )
  })
})
