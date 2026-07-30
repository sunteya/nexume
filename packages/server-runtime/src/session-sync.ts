import { randomUUID } from "node:crypto"

import {
  assertBeginSessionSyncRequest,
  assertSessionSyncBatchRequest,
  type BeginSessionSyncRequest,
  type BeginSessionSyncResult,
  type SessionSyncBatchRequest,
  type SessionSyncBatchResult,
} from "@nexume/contracts"
import type { SessionSyncStore } from "@nexume/storage"

interface ActiveRun {
  runId: string
  checkpointFormat: string
}

export class SessionSyncService {
  private readonly runs = new Map<string, ActiveRun>()

  constructor(
    private readonly store: SessionSyncStore,
    private readonly reconcileIntervalMs = 24 * 60 * 60 * 1_000,
  ) {}

  begin(
    collectorId: string,
    request: BeginSessionSyncRequest,
  ): BeginSessionSyncResult {
    assertBeginSessionSyncRequest(request)
    const current = this.store.get(collectorId, request.agent)
    const checkpointMatches =
      current?.checkpoint?.format === request.checkpointFormat
    const reconcileDue =
      current?.lastReconciledAt === null ||
      current?.lastReconciledAt === undefined ||
      Date.now() - current.lastReconciledAt >= this.reconcileIntervalMs
    const mode =
      request.forceReconcile || !checkpointMatches || reconcileDue
        ? "reconcile"
        : "incremental"
    const runId = randomUUID()

    this.store.beginSync({
      collectorId,
      agent: request.agent,
      runId,
      mode,
    })
    this.runs.set(this.key(collectorId, request.agent), {
      runId,
      checkpointFormat: request.checkpointFormat,
    })
    return {
      runId,
      mode,
      ...(mode === "incremental" && current?.checkpoint
        ? { checkpoint: current.checkpoint }
        : {}),
      batchSize: 100,
    }
  }

  commit(
    collectorId: string,
    request: SessionSyncBatchRequest,
  ): SessionSyncBatchResult {
    assertSessionSyncBatchRequest(request)
    const key = this.key(collectorId, request.agent)
    const active = this.runs.get(key)
    if (!active || active.runId !== request.runId) {
      throw new Error("Session 同步任务已失效，请重新开始同步。")
    }
    if (
      request.checkpoint &&
      request.checkpoint.format !== active.checkpointFormat
    ) {
      throw new Error("Session checkpoint 格式与同步任务不一致。")
    }

    const result = this.store.commitBatch({
      collectorId,
      agent: request.agent,
      runId: request.runId,
      sequence: request.sequence,
      items: request.items.map((item) => ({
        sourceId: item.id,
        title: item.title,
        directory: item.directory,
        sourceCreatedAt: item.createdAt,
        sourceUpdatedAt: item.updatedAt,
        sourceArchivedAt: item.archivedAt,
      })),
      checkpoint: request.checkpoint,
      complete: request.complete,
    })
    return {
      duplicate: result.duplicate,
      upserted: result.upserted,
      deleted: result.deleted,
    }
  }

  private key(collectorId: string, agent: string): string {
    return `${collectorId}\u0000${agent}`
  }
}
