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
})
