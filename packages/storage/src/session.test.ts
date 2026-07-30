import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { openStorage, type AppStorage, type SessionSyncItem } from "./index"

const temporaryDirectories: string[] = []

function createDataDir(): string {
  const path = mkdtempSync(join(tmpdir(), "nexume-session-storage-"))
  temporaryDirectories.push(path)
  return path
}

async function createStorage(dataDir = createDataDir()): Promise<AppStorage> {
  const storage = await openStorage({ dataDir })
  storage.collectors.create({
    id: "collector-a",
    name: "Collector A",
    connectionType: "remote",
    token: "token-a",
  })
  storage.collectors.create({
    id: "collector-b",
    name: "Collector B",
    connectionType: "remote",
    token: "token-b",
  })
  return storage
}

function item(
  sourceId: string,
  sourceUpdatedAt: number,
  overrides: Partial<SessionSyncItem> = {},
): SessionSyncItem {
  return {
    sourceId,
    title: `Session ${sourceId}`,
    directory: `/work/${sourceId}`,
    sourceCreatedAt: sourceUpdatedAt - 1,
    sourceUpdatedAt,
    ...overrides,
  }
}

function sync(
  storage: AppStorage,
  options: {
    collectorId?: string
    agent?: string
    runId: string
    mode?: "incremental" | "reconcile"
    items: SessionSyncItem[]
    complete?: boolean
  },
): void {
  const collectorId = options.collectorId ?? "collector-a"
  const agent = options.agent ?? "opencode"
  storage.sessionSync.beginSync({
    collectorId,
    agent,
    runId: options.runId,
    mode: options.mode ?? "incremental",
  })
  storage.sessionSync.commitBatch({
    collectorId,
    agent,
    runId: options.runId,
    sequence: 0,
    items: options.items,
    complete: options.complete ?? true,
  })
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe("session storage", () => {
  test("isolates identical source IDs by collector and agent", async () => {
    const storage = await createStorage()
    sync(storage, { runId: "a-opencode", items: [item("same", 10)] })
    sync(storage, {
      collectorId: "collector-b",
      runId: "b-opencode",
      items: [item("same", 20)],
    })
    sync(storage, {
      agent: "other-agent",
      runId: "a-other",
      items: [item("same", 30)],
    })

    expect(
      storage.sessions
        .list({ limit: 10 })
        .items.map((row) => [row.collectorId, row.agent, row.sourceId]),
    ).toEqual([
      ["collector-a", "other-agent", "same"],
      ["collector-b", "opencode", "same"],
      ["collector-a", "opencode", "same"],
    ])
    storage.close()
  })

  test("upserts sessions and makes run sequence retries idempotent", async () => {
    const storage = await createStorage()
    storage.sessionSync.beginSync({
      collectorId: "collector-a",
      agent: "opencode",
      runId: "incremental-1",
      mode: "incremental",
    })
    const first = storage.sessionSync.commitBatch({
      collectorId: "collector-a",
      agent: "opencode",
      runId: "incremental-1",
      sequence: 0,
      items: [item("one", 10)],
      checkpoint: { format: "opaque-v1", value: "cursor:one" },
    })
    const duplicate = storage.sessionSync.commitBatch({
      collectorId: "collector-a",
      agent: "opencode",
      runId: "incremental-1",
      sequence: 0,
      items: [item("one", 999, { title: "must not replace" })],
      checkpoint: { format: "opaque-v1", value: "different" },
    })
    storage.sessionSync.commitBatch({
      collectorId: "collector-a",
      agent: "opencode",
      runId: "incremental-1",
      sequence: 1,
      items: [item("one", 20, { title: "Updated" })],
      complete: true,
    })

    expect(first.duplicate).toBe(false)
    expect(duplicate).toEqual(
      expect.objectContaining({
        duplicate: true,
        upserted: 1,
        deleted: 0,
      }),
    )
    expect(
      storage.sessions.get({
        collectorId: "collector-a",
        agent: "opencode",
        sourceId: "one",
      }),
    ).toEqual(
      expect.objectContaining({ title: "Updated", sourceUpdatedAt: 20 }),
    )
    expect(storage.sessionSync.get("collector-a", "opencode")).toEqual(
      expect.objectContaining({
        checkpoint: { format: "opaque-v1", value: "cursor:one" },
        activeRunId: null,
        nextSequence: 2,
      }),
    )
    storage.close()
  })

  test("does not delete on interrupted reconcile and deletes only on completion", async () => {
    const storage = await createStorage()
    sync(storage, {
      runId: "seed",
      items: [item("keep", 30), item("missing", 20)],
    })
    storage.sessionSync.beginSync({
      collectorId: "collector-a",
      agent: "opencode",
      runId: "reconcile-interrupted",
      mode: "reconcile",
    })
    storage.sessionSync.commitBatch({
      collectorId: "collector-a",
      agent: "opencode",
      runId: "reconcile-interrupted",
      sequence: 0,
      items: [item("keep", 31)],
    })

    expect(
      storage.sessions.list({ limit: 10 }).items.map((row) => row.sourceId),
    ).toEqual(["keep", "missing"])

    storage.sessionSync.beginSync({
      collectorId: "collector-a",
      agent: "opencode",
      runId: "reconcile-complete",
      mode: "reconcile",
    })
    const completed = storage.sessionSync.commitBatch({
      collectorId: "collector-a",
      agent: "opencode",
      runId: "reconcile-complete",
      sequence: 0,
      items: [item("keep", 32)],
      complete: true,
    })

    expect(completed.deleted).toBe(1)
    expect(
      storage.sessions.list({ limit: 10 }).items.map((row) => row.sourceId),
    ).toEqual(["keep"])
    expect(
      storage.sessions.list({ status: "deleted", limit: 10 }).items,
    ).toEqual([
      expect.objectContaining({
        sourceId: "missing",
        deletedAt: expect.any(Number),
      }),
    ])
    storage.close()
  })

  test("restores a deleted session when it appears again", async () => {
    const storage = await createStorage()
    sync(storage, { runId: "seed", items: [item("returning", 10)] })
    sync(storage, {
      runId: "remove",
      mode: "reconcile",
      items: [],
    })
    expect(
      storage.sessions.list({ status: "deleted", limit: 10 }).items,
    ).toHaveLength(1)

    sync(storage, {
      runId: "returns",
      items: [item("returning", 30, { title: "Returned" })],
    })
    expect(storage.sessions.list({ limit: 10 }).items).toEqual([
      expect.objectContaining({
        sourceId: "returning",
        title: "Returned",
        deletedAt: null,
      }),
    ])
    storage.close()
  })

  test("filters statuses and scopes while paginating with structured cursors", async () => {
    const storage = await createStorage()
    sync(storage, {
      runId: "active-a",
      items: [item("a-3", 30), item("a-2", 20), item("a-1", 10)],
    })
    sync(storage, {
      collectorId: "collector-b",
      runId: "active-b",
      items: [item("b-2", 25), item("b-1", 15)],
    })
    sync(storage, {
      agent: "other-agent",
      runId: "archived",
      items: [item("archived", 40, { sourceArchivedAt: 41 })],
    })

    const first = storage.sessions.list({ agent: "opencode", limit: 2 })
    const second = storage.sessions.list({
      agent: "opencode",
      limit: 2,
      cursor: first.nextCursor,
    })
    const third = storage.sessions.list({
      agent: "opencode",
      limit: 2,
      cursor: second.nextCursor,
    })
    expect(first.items.map((row) => row.sourceId)).toEqual(["a-3", "b-2"])
    expect(second.items.map((row) => row.sourceId)).toEqual(["a-2", "b-1"])
    expect(third.items.map((row) => row.sourceId)).toEqual(["a-1"])
    expect(first.nextCursor).toEqual({
      sourceUpdatedAt: 25,
      collectorId: "collector-b",
      agent: "opencode",
      sourceId: "b-2",
    })
    expect(
      storage.sessions.list({
        collectorId: "collector-a",
        agent: "opencode",
        limit: 10,
      }).items,
    ).toHaveLength(3)
    expect(
      storage.sessions.list({ status: "archived", limit: 10 }).items,
    ).toEqual([expect.objectContaining({ sourceId: "archived" })])
    storage.close()
  })

  test("filters titles with case-insensitive substring matching while paginating", async () => {
    const storage = await createStorage()
    sync(storage, {
      runId: "title-search",
      items: [
        item("release-3", 30, { title: "Release Notes 3" }),
        item("draft", 25, { title: "Draft plan" }),
        item("release-2", 20, { title: "release notes 2" }),
        item("release-1", 10, { title: "First RELEASE notes" }),
      ],
    })

    const first = storage.sessions.list({ title: "release", limit: 2 })
    const second = storage.sessions.list({
      title: "release",
      limit: 2,
      cursor: first.nextCursor,
    })

    expect(first.items.map((row) => row.sourceId)).toEqual([
      "release-3",
      "release-2",
    ])
    expect(first.hasMore).toBe(true)
    expect(second.items.map((row) => row.sourceId)).toEqual(["release-1"])
    expect(second.hasMore).toBe(false)
    storage.close()
  })

  test("persists sessions, checkpoints, active runs, and batch idempotency", async () => {
    const dataDir = createDataDir()
    const first = await createStorage(dataDir)
    first.sessionSync.beginSync({
      collectorId: "collector-a",
      agent: "opencode",
      runId: "persistent",
      mode: "incremental",
    })
    first.sessionSync.commitBatch({
      collectorId: "collector-a",
      agent: "opencode",
      runId: "persistent",
      sequence: 0,
      items: [item("one", 10)],
      checkpoint: { format: "token-v2", value: "opaque-data" },
    })
    first.close()

    const second = await openStorage({ dataDir })
    expect(second.sessions.list({ limit: 10 }).items).toEqual([
      expect.objectContaining({ sourceId: "one" }),
    ])
    expect(second.sessionSync.get("collector-a", "opencode")).toEqual(
      expect.objectContaining({
        checkpoint: { format: "token-v2", value: "opaque-data" },
        activeRunId: "persistent",
        nextSequence: 1,
      }),
    )
    expect(
      second.sessionSync.commitBatch({
        collectorId: "collector-a",
        agent: "opencode",
        runId: "persistent",
        sequence: 0,
        items: [item("one", 999)],
      }).duplicate,
    ).toBe(true)
    second.sessionSync.commitBatch({
      collectorId: "collector-a",
      agent: "opencode",
      runId: "persistent",
      sequence: 1,
      items: [],
      complete: true,
    })
    second.close()
  })
})
