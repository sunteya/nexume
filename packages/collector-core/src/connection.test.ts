import { describe, expect, test } from "bun:test"

import { CollectorConnection } from "./connection"

describe("CollectorConnection", () => {
  test("connects to the default namespace with runtime metadata auth", () => {
    const metadata = {
      hostname: "host.local",
      version: "0.0.1",
      agents: ["opencode" as const],
    }
    const connection = new CollectorConnection({
      serverUrl: "http://localhost:3000/",
      token: "collector-token",
      metadata,
      sources: [
        {
          agent: "opencode",
          checkpointFormat: "opencode/test/v1",
          available: true,
          readSessionPage: () => ({ items: [], hasMore: false }),
        },
      ],
    })

    expect((connection.socket as unknown as { nsp: string }).nsp).toBe(
      "/collector",
    )
    expect(connection.socket.io.opts.path).toBe("/socket.io")
    expect(connection.socket.auth).toEqual({
      token: "collector-token",
      metadata,
    })
  })
})
