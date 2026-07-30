import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { openStorage, type AppStorage } from "@nexume/storage"
import type { WritableCollectorDataSource } from "@nexume/collector-core"

import { SessionManagementService } from "./session-management"

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

async function createStorage(): Promise<AppStorage> {
  const dataDir = mkdtempSync(join(tmpdir(), "nexume-session-management-"))
  const storage = await openStorage({ dataDir })
  cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }))
  cleanups.push(() => storage.close())
  storage.collectors.create({
    id: "local",
    name: "Local",
    connectionType: "local",
  })
  storage.sessionSync.beginSync({
    collectorId: "local",
    agent: "opencode",
    runId: "seed",
    mode: "reconcile",
  })
  storage.sessionSync.commitBatch({
    collectorId: "local",
    agent: "opencode",
    runId: "seed",
    sequence: 0,
    items: [
      {
        sourceId: "session-1",
        title: "Original",
        directory: "/workspace/local",
        sourceCreatedAt: 100,
        sourceUpdatedAt: 200,
      },
    ],
    complete: true,
  })
  return storage
}

describe("SessionManagementService", () => {
  test("writes through a local Collector before updating the cache", async () => {
    const storage = await createStorage()
    let sourceTitle = "Original"
    const source: WritableCollectorDataSource = {
      agent: "opencode",
      checkpointFormat: "opencode/test/v1",
      available: true,
      readSessionPage: () => ({ items: [], hasMore: false }),
      updateSessionTitle(input) {
        sourceTitle = input.title
        return {
          id: input.id,
          agent: "opencode",
          title: sourceTitle,
          directory: "/workspace/local",
          createdAt: 100,
          updatedAt: 200,
        }
      },
    }
    const service = new SessionManagementService({
      sessions: storage.sessions,
      collectors: storage.collectors,
      localSources: [source],
      updateRemote: async () => undefined,
    })

    const updated = await service.updateTitle("local", {
      agent: "opencode",
      id: "session-1",
      title: "Renamed",
      expectedTitle: "Original",
      expectedUpdatedAt: 200,
    })

    expect(sourceTitle).toBe("Renamed")
    expect(updated.title).toBe("Renamed")
    expect(
      storage.sessions.get({
        collectorId: "local",
        agent: "opencode",
        sourceId: "session-1",
      })?.title,
    ).toBe("Renamed")
  })
})
