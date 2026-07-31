import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  CollectorConnection,
  SessionTitleConflictError,
  type SessionDetailDataSource,
  type WritableCollectorDataSource,
} from "@nexume/collector-core"
import { openStorage } from "@nexume/storage"

import { startServerRuntime } from "./runtime"

const cleanups: Array<() => void | Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("等待 runtime 状态超时。")
    await Bun.sleep(10)
  }
}

describe("startServerRuntime", () => {
  test("serves Web, API and Collector Socket.IO on one port", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "nexume-runtime-data-"))
    const webRoot = mkdtempSync(join(tmpdir(), "nexume-runtime-web-"))
    writeFileSync(join(webRoot, "index.html"), "<h1>Nexume Runtime</h1>")
    const storage = await openStorage({ dataDir })
    const runtime = startServerRuntime({
      accessToken: "access-token",
      storage,
      hostname: "127.0.0.1",
      port: 0,
      webRoot,
      localSources: [
        {
          agent: "opencode",
          checkpointFormat: "opencode/test/v1",
          available: false,
          readSessionPage: () => ({ items: [], hasMore: false }),
        },
      ],
      localMetadata: {
        hostname: "runtime.local",
        version: "0.0.1",
        agents: ["opencode"],
      },
      defaultLocalCollectorName: "Runtime Local",
    })
    cleanups.push(() => rmSync(webRoot, { recursive: true, force: true }))
    cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }))
    cleanups.push(() => storage.close())
    cleanups.push(() => void runtime.close())

    const actualPort = runtime.server.port!
    const origin = `http://127.0.0.1:${actualPort}`
    const page = await fetch(origin)
    expect(await page.text()).toContain("Nexume Runtime")
    expect(page.headers.get("cache-control")).toBe("no-cache")
    expect((await fetch(`${origin}/assets/missing.js`)).status).toBe(404)
    expect(await (await fetch(`${origin}/api/health`)).json()).toEqual({
      status: "ok",
    })

    const bootstrapUrl = new URL(runtime.createBootstrapUrl())
    expect(
      new URLSearchParams(bootstrapUrl.hash.slice(1)).get("accessToken"),
    ).toBe("access-token")

    const authorization = { Authorization: "Bearer access-token" }
    const initialized = await fetch(`${origin}/api/setup/complete`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ initializeLocalCollector: false }),
    })
    expect(initialized.status).toBe(200)
    const created = await fetch(`${origin}/api/collectors`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Remote", connectionType: "remote" }),
    })
    const credential = (await created.json()) as {
      token: string
      collector: { id: string }
    }

    let syncError: unknown
    let sessionTitle = "Remote Session"
    const source: WritableCollectorDataSource & SessionDetailDataSource = {
      agent: "opencode",
      checkpointFormat: "opencode/test/v1",
      available: true,
      readSessionPage: () => ({
        items: [
          {
            id: "session-1",
            agent: "opencode",
            title: sessionTitle,
            directory: "/workspace/remote",
            createdAt: 100,
            updatedAt: 100,
          },
        ],
        checkpoint: { format: "opencode/test/v1", value: "complete" },
        hasMore: false,
      }),
      readSessionDetail: () => ({
        session: {
          id: "session-1",
          agent: "opencode",
          title: sessionTitle,
          directory: "/workspace/remote",
          createdAt: 100,
          updatedAt: 100,
        },
        items: [
          {
            id: "message-1",
            role: "assistant",
            createdAt: 100,
            parts: [{ id: "part-1", type: "text", text: "Remote detail" }],
          },
        ],
        hasMore: false,
      }),
      updateSessionTitle(input) {
        if (
          input.expectedTitle !== sessionTitle ||
          input.expectedUpdatedAt !== 100
        ) {
          throw new SessionTitleConflictError()
        }
        sessionTitle = input.title
        return {
          id: "session-1",
          agent: "opencode",
          title: sessionTitle,
          directory: "/workspace/remote",
          createdAt: 100,
          updatedAt: 100,
        }
      },
    }
    const connection = new CollectorConnection({
      serverUrl: origin,
      token: credential.token,
      metadata: {
        hostname: "remote.local",
        version: "0.0.1",
        agents: ["opencode"],
      },
      sources: [source],
      onSyncError(_agent, error) {
        syncError = error
      },
    })
    cleanups.push(() => connection.disconnect())
    connection.connect()
    await waitFor(() => runtime.core.listCollectors().length === 1)
    expect(runtime.core.listCollectors()[0]?.name).toBe("Remote")
    await waitFor(() => {
      if (syncError) throw syncError
      const state = storage.sessionSync.get(credential.collector.id, "opencode")
      return state?.activeRunId === null
    })

    const detail = await fetch(
      `${origin}/api/sessions/${credential.collector.id}/opencode/session-1?limit=20`,
      { headers: authorization },
    )
    expect(detail.status).toBe(200)
    expect(detail.headers.get("cache-control")).toBe("no-store")
    expect(await detail.json()).toEqual(
      expect.objectContaining({
        items: [
          expect.objectContaining({
            parts: [expect.objectContaining({ text: "Remote detail" })],
          }),
        ],
      }),
    )

    const renamed = await fetch(
      `${origin}/api/sessions/${credential.collector.id}/opencode/session-1`,
      {
        method: "PATCH",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Renamed Session",
          expectedTitle: "Remote Session",
          expectedUpdatedAt: 100,
        }),
      },
    )
    expect(renamed.status).toBe(200)
    expect(await renamed.json()).toEqual(
      expect.objectContaining({ title: "Renamed Session" }),
    )
    expect(sessionTitle).toBe("Renamed Session")

    const conflict = await fetch(
      `${origin}/api/sessions/${credential.collector.id}/opencode/session-1`,
      {
        method: "PATCH",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Stale Session",
          expectedTitle: "Remote Session",
          expectedUpdatedAt: 100,
        }),
      },
    )
    expect(conflict.status).toBe(409)

    connection.disconnect()
    await waitFor(() => runtime.core.listCollectors().length === 0)
    const offline = await fetch(
      `${origin}/api/sessions/${credential.collector.id}/opencode/session-1`,
      {
        method: "PATCH",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Offline Session",
          expectedTitle: "Renamed Session",
          expectedUpdatedAt: 100,
        }),
      },
    )
    expect(offline.status).toBe(503)
    await runtime.close()
    await runtime.close()
    const replacement = Bun.serve({
      hostname: "127.0.0.1",
      port: actualPort,
      fetch: () => new Response("replacement"),
    })
    expect(await (await fetch(origin)).text()).toBe("replacement")
    void replacement.stop(true)
  }, 15_000)
})
