import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  CollectorConnection,
  type CollectorDataSource,
} from "@nexume/collector-core"
import { createServerCore } from "@nexume/server-core"
import { openStorage, type AppStorage } from "@nexume/storage"
import { io } from "socket.io-client"

import { createCollectorSocketServer } from "./collector-socket"
import { SessionSyncService } from "./session-sync"

const cleanups: Array<() => void | Promise<void>> = []

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 3_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("等待连接状态超时。")
    await Bun.sleep(10)
  }
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function createStorage(): Promise<AppStorage> {
  const dataDir = mkdtempSync(join(tmpdir(), "nexume-socket-"))
  const storage = await openStorage({ dataDir })
  cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }))
  cleanups.push(() => storage.close())
  return storage
}

function createCore(storage: AppStorage) {
  return createServerCore({
    sessions: {
      list(options) {
        const result = storage.sessions.list(options)
        return {
          ...result,
          items: result.items.map((item) => ({
            ...item,
            collectorName:
              storage.collectors.get(item.collectorId)?.name ??
              item.collectorId,
          })),
        }
      },
    },
  })
}

function sourceWithOneSession(onRead?: () => void): CollectorDataSource {
  return {
    agent: "opencode",
    checkpointFormat: "opencode/test/v1",
    available: true,
    readSessionPage: () => {
      onRead?.()
      return {
        items: [
          {
            id: "session-1",
            agent: "opencode",
            title: "Remote Session",
            directory: "/workspace/remote",
            createdAt: 100,
            updatedAt: 100,
          },
        ],
        checkpoint: { format: "opencode/test/v1", value: "complete" },
        hasMore: false,
      }
    },
  }
}

describe("Collector Socket.IO transport", () => {
  test("rejects Collectors before initialization", async () => {
    const storage = await createStorage()
    const core = createCore(storage)
    const transport = createCollectorSocketServer({
      core,
      sessionSync: new SessionSyncService(storage.sessionSync),
      accessToken: "server-token",
      authenticate: () => ({ id: "blocked-test", name: "Blocked Test" }),
      getCollector: () => ({ id: "blocked-test", name: "Blocked Test" }),
      listCollectors: () => [],
      isInitialized: () => false,
    })
    const handler = transport.engine.handler()
    const server = Bun.serve({ port: 0, ...handler })
    cleanups.push(() => void server.stop(true))
    cleanups.push(() => transport.close())

    let connectionError = ""
    const connection = new CollectorConnection({
      serverUrl: `http://127.0.0.1:${server.port}`,
      token: "collector-token",
      metadata: {
        hostname: "remote.local",
        version: "0.0.1",
        agents: ["opencode"],
      },
      sources: [sourceWithOneSession()],
      onStateChange(_state, detail) {
        if (detail?.includes("初始化")) connectionError = detail
      },
    })
    cleanups.push(() => connection.disconnect())

    connection.connect()
    await waitFor(() => Boolean(connectionError))
    expect(core.listCollectors()).toHaveLength(0)
  })

  test("persists remote sessions and serves them after disconnect", async () => {
    const storage = await createStorage()
    storage.collectors.create({
      id: "remote-test",
      name: "Managed Name",
      connectionType: "remote",
      token: "collector-token",
    })
    const core = createCore(storage)
    let touches = 0
    const syncStates: boolean[] = []
    const transport = createCollectorSocketServer({
      core,
      sessionSync: new SessionSyncService(storage.sessionSync),
      accessToken: "server-token",
      authenticate: (token) =>
        token === "collector-token"
          ? { id: "remote-test", name: "Managed Name" }
          : undefined,
      getCollector: (id) =>
        id === "remote-test"
          ? { id: "remote-test", name: "Managed Name" }
          : undefined,
      listCollectors: () => [],
      onTouched: (_id, status) => {
        touches += 1
        if (status) syncStates.push(status.syncing)
      },
    })
    const handler = transport.engine.handler()
    const server = Bun.serve({ port: 0, ...handler })
    cleanups.push(() => void server.stop(true))
    cleanups.push(() => transport.close())

    let reads = 0
    const connection = new CollectorConnection({
      serverUrl: `http://127.0.0.1:${server.port}`,
      token: "collector-token",
      metadata: {
        hostname: "remote.local",
        version: "0.0.1",
        agents: ["opencode"],
      },
      sources: [
        sourceWithOneSession(() => {
          reads += 1
        }),
      ],
    })
    cleanups.push(() => connection.disconnect())

    connection.connect()
    await waitFor(() =>
      Boolean(
        storage.sessions.get({
          collectorId: "remote-test",
          agent: "opencode",
          sourceId: "session-1",
        }),
      ),
    )
    expect(core.listCollectors()[0]?.name).toBe("Managed Name")
    await waitFor(
      () => syncStates.includes(true) && syncStates.at(-1) === false,
    )

    await Bun.sleep(20)
    expect(transport.syncCollector("remote-test")).toBe(true)
    await waitFor(() => reads >= 2)

    transport.disconnectCollector("remote-test")
    await waitFor(() => core.listCollectors().length === 0)
    const result = await core.listSessions({ limit: 20 })
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "session-1",
        collectorId: "remote-test",
      }),
    ])
    expect(touches).toBeGreaterThanOrEqual(1)
  })

  test("rejects an unknown token", async () => {
    const storage = await createStorage()
    const core = createCore(storage)
    const transport = createCollectorSocketServer({
      core,
      sessionSync: new SessionSyncService(storage.sessionSync),
      accessToken: "server-token",
      authenticate: () => undefined,
      getCollector: () => undefined,
      listCollectors: () => [],
    })
    const handler = transport.engine.handler()
    const server = Bun.serve({ port: 0, ...handler })
    cleanups.push(() => void server.stop(true))
    cleanups.push(() => transport.close())

    let connectionError = ""
    const connection = new CollectorConnection({
      serverUrl: `http://127.0.0.1:${server.port}`,
      token: "unknown",
      metadata: {
        hostname: "remote.local",
        version: "0.0.1",
        agents: ["opencode"],
      },
      sources: [sourceWithOneSession()],
      onStateChange(_state, detail) {
        if (detail?.includes("凭证")) connectionError = detail
      },
    })
    cleanups.push(() => connection.disconnect())

    connection.connect()
    await waitFor(() => Boolean(connectionError))
    expect(core.listCollectors()).toHaveLength(0)
  })

  test("authenticates the server namespace and pushes Collector snapshots", async () => {
    const storage = await createStorage()
    const core = createCore(storage)
    let collectors = [
      {
        id: "local",
        name: "Local",
        connectionType: "local" as const,
        online: true,
        syncing: false,
        agents: ["opencode"],
        createdAt: 100,
        updatedAt: 100,
      },
    ]
    const transport = createCollectorSocketServer({
      core,
      sessionSync: new SessionSyncService(storage.sessionSync),
      accessToken: "server-token",
      authenticate: () => undefined,
      getCollector: () => undefined,
      listCollectors: () => collectors,
    })
    const handler = transport.engine.handler()
    const server = Bun.serve({ port: 0, ...handler })
    cleanups.push(() => void server.stop(true))
    cleanups.push(() => transport.close())

    const updates: typeof collectors[] = []
    const dashboard = io(`http://127.0.0.1:${server.port}/server`, {
      path: "/socket.io",
      auth: { accessToken: "server-token" },
    })
    cleanups.push(() => {
      dashboard.disconnect()
    })
    dashboard.on("collectors:updated", (items) => updates.push(items))

    await waitFor(() => updates.length === 1)
    expect((dashboard as unknown as { nsp: string }).nsp).toBe("/server")
    expect(updates[0]?.[0]?.syncing).toBe(false)

    collectors = [{ ...collectors[0]!, syncing: true }]
    transport.publishCollectors()
    await waitFor(() => updates.length === 2)
    expect(updates[1]?.[0]?.syncing).toBe(true)

    let unauthorized = ""
    const rejected = io(`http://127.0.0.1:${server.port}/server`, {
      path: "/socket.io",
      auth: { accessToken: "wrong-token" },
    })
    cleanups.push(() => {
      rejected.disconnect()
    })
    rejected.on("connect_error", (error) => {
      unauthorized = (error as Error & { data?: { code?: string } }).data?.code ?? ""
    })
    await waitFor(() => Boolean(unauthorized))
    expect(unauthorized).toBe("unauthorized")
  })
})
