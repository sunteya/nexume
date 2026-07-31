import { describe, expect, test } from "bun:test"

import { CollectorSyncRunner } from "./sync-runner"

describe("CollectorSyncRunner", () => {
  test("pushes pages in sequence and advances acknowledged checkpoints", async () => {
    const checkpoints: Array<string | undefined> = []
    const batches: Array<{
      sequence: number
      complete: boolean
      ids: string[]
    }> = []
    const runner = new CollectorSyncRunner({
      sources: [
        {
          agent: "codex",
          checkpointFormat: "codex/test/v1",
          available: true,
          readSessionPage(request) {
            checkpoints.push(request.checkpoint?.value)
            const page = checkpoints.length
            return {
              items: [
                {
                  id: `session-${page}`,
                  agent: "codex",
                  title: `Session ${page}`,
                  directory: "/workspace",
                  createdAt: page,
                  updatedAt: page,
                },
              ],
              checkpoint: {
                format: "codex/test/v1",
                value: String(page),
              },
              hasMore: page === 1,
            }
          },
        },
      ],
      target: {
        async begin() {
          return {
            runId: "run-1",
            mode: "incremental",
            checkpoint: { format: "codex/test/v1", value: "0" },
            batchSize: 500,
          }
        },
        async commit(request) {
          batches.push({
            sequence: request.sequence,
            complete: request.complete,
            ids: request.items.map((item) => item.id),
          })
          return {
            duplicate: false,
            upserted: request.items.length,
            deleted: 0,
          }
        },
      },
    })

    await runner.syncNow()

    expect(checkpoints).toEqual(["0", "1"])
    expect(batches).toEqual([
      { sequence: 0, complete: false, ids: ["session-1"] },
      { sequence: 1, complete: true, ids: ["session-2"] },
    ])
  })

  test("reports aggregate sync state until every source finishes", async () => {
    const states: boolean[] = []
    let releaseFirst!: () => void
    let releaseSecond!: () => void
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const secondBlocked = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    const runner = new CollectorSyncRunner({
      sources: [
        {
          agent: "opencode",
          checkpointFormat: "opencode/test/v1",
          available: true,
          async readSessionPage() {
            await firstBlocked
            return { items: [], hasMore: false }
          },
        },
        {
          agent: "codex",
          checkpointFormat: "codex/test/v1",
          available: true,
          async readSessionPage() {
            await secondBlocked
            return { items: [], hasMore: false }
          },
        },
      ],
      onSyncStateChange: (syncing) => states.push(syncing),
      target: {
        async begin(request) {
          return {
            runId: request.agent,
            mode: "incremental",
            batchSize: 100,
          }
        },
        async commit() {
          return { duplicate: false, upserted: 0, deleted: 0 }
        },
      },
    })

    const syncing = runner.syncNow()
    await Promise.resolve()
    expect(states).toEqual([true])

    releaseFirst()
    await Promise.resolve()
    expect(states).toEqual([true])

    releaseSecond()
    await syncing
    expect(states).toEqual([true, false])
  })

  test("clears sync state after a source error", async () => {
    const states: boolean[] = []
    const runner = new CollectorSyncRunner({
      sources: [
        {
          agent: "opencode",
          checkpointFormat: "opencode/test/v1",
          available: true,
          readSessionPage() {
            throw new Error("read failed")
          },
        },
      ],
      onSyncStateChange: (syncing) => states.push(syncing),
      target: {
        async begin() {
          return { runId: "run-1", mode: "incremental", batchSize: 100 }
        },
        async commit() {
          return { duplicate: false, upserted: 0, deleted: 0 }
        },
      },
    })

    await runner.syncNow()

    expect(states).toEqual([true, false])
  })
})
