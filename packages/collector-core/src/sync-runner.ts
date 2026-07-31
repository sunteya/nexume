import type {
  BeginSessionSyncRequest,
  BeginSessionSyncResult,
  SessionSyncBatchRequest,
  SessionSyncBatchResult,
} from "@nexume/contracts"

import type { CollectorDataSource } from "./source"

export interface SessionSyncTarget {
  begin(request: BeginSessionSyncRequest): Promise<BeginSessionSyncResult>
  commit(request: SessionSyncBatchRequest): Promise<SessionSyncBatchResult>
}

export interface CollectorSyncRunnerOptions {
  sources: CollectorDataSource[]
  target: SessionSyncTarget
  intervalMs?: number
  onError?: (agent: string, error: unknown) => void
  onSyncStateChange?: (syncing: boolean) => void
}

export class CollectorSyncRunner {
  private timer?: ReturnType<typeof setInterval>
  private readonly syncing = new Set<string>()

  constructor(private readonly options: CollectorSyncRunnerOptions) {}

  start(): void {
    if (this.timer) return
    void this.syncNow()
    this.timer = setInterval(
      () => void this.syncNow(),
      this.options.intervalMs ?? 60_000,
    )
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  async syncNow(): Promise<void> {
    await Promise.all(
      this.options.sources.map(async (source) => {
        if (!source.available || this.syncing.has(source.agent)) return
        const wasIdle = this.syncing.size === 0
        this.syncing.add(source.agent)
        if (wasIdle) this.options.onSyncStateChange?.(true)
        try {
          await this.syncSource(source)
        } catch (error) {
          this.options.onError?.(source.agent, error)
        } finally {
          this.syncing.delete(source.agent)
          if (this.syncing.size === 0) this.options.onSyncStateChange?.(false)
        }
      }),
    )
  }

  private async syncSource(source: CollectorDataSource): Promise<void> {
    const run = await this.options.target.begin({
      agent: source.agent,
      checkpointFormat: source.checkpointFormat,
    })
    let checkpoint = run.checkpoint
    let sequence = 0

    while (true) {
      const page = await source.readSessionPage({
        mode: run.mode,
        checkpoint,
        limit: run.batchSize,
      })
      if (page.items.length > run.batchSize) {
        throw new Error(`${source.agent} 返回的同步批次超过 Server 限制。`)
      }
      const nextCheckpoint = page.checkpoint ?? checkpoint
      if (
        page.hasMore &&
        nextCheckpoint?.format === checkpoint?.format &&
        nextCheckpoint?.value === checkpoint?.value
      ) {
        throw new Error(
          `${source.agent} 同步仍有后续数据，但 checkpoint 未推进。`,
        )
      }
      const complete = !page.hasMore
      await this.options.target.commit({
        agent: source.agent,
        runId: run.runId,
        sequence,
        items: page.items,
        checkpoint: nextCheckpoint,
        complete,
      })
      checkpoint = nextCheckpoint
      sequence += 1
      if (complete) return
    }
  }
}
