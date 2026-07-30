import type { Database } from "bun:sqlite"

import type { AgentId } from "./session"

export type SessionSyncMode = "incremental" | "reconcile"

export interface SessionSyncCheckpoint {
  format: string
  value: string
}

export interface SessionSyncState {
  collectorId: string
  agent: AgentId
  checkpoint: SessionSyncCheckpoint | null
  activeRunId: string | null
  activeMode: SessionSyncMode | null
  nextSequence: number
  startedAt: number | null
  lastSyncedAt: number | null
  lastReconciledAt: number | null
}

export interface BeginSessionSyncInput {
  collectorId: string
  agent: AgentId
  runId: string
  mode: SessionSyncMode
}

export interface SessionSyncItem {
  sourceId: string
  title: string
  directory: string
  sourceCreatedAt: number
  sourceUpdatedAt: number
  sourceArchivedAt?: number | null
}

export interface CommitSessionBatchInput {
  collectorId: string
  agent: AgentId
  runId: string
  sequence: number
  items: SessionSyncItem[]
  checkpoint?: SessionSyncCheckpoint | null
  complete?: boolean
}

export interface CommitSessionBatchResult {
  duplicate: boolean
  upserted: number
  deleted: number
  state: SessionSyncState
}

interface SyncStateRow {
  collector_id: string
  agent: string
  checkpoint_format: string | null
  checkpoint: string | null
  active_run_id: string | null
  active_mode: SessionSyncMode | null
  next_sequence: number
  started_at: number | null
  last_synced_at: number | null
  last_reconciled_at: number | null
}

interface SyncBatchRow {
  upserted_count: number
  deleted_count: number
}

function fromRow(row: SyncStateRow): SessionSyncState {
  return {
    collectorId: row.collector_id,
    agent: row.agent,
    checkpoint:
      row.checkpoint_format === null || row.checkpoint === null
        ? null
        : { format: row.checkpoint_format, value: row.checkpoint },
    activeRunId: row.active_run_id,
    activeMode: row.active_mode,
    nextSequence: row.next_sequence,
    startedAt: row.started_at,
    lastSyncedAt: row.last_synced_at,
    lastReconciledAt: row.last_reconciled_at,
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (!value.trim()) {
    throw new Error(`${field} must not be empty.`)
  }
}

function assertCheckpoint(checkpoint: SessionSyncCheckpoint): void {
  assertNonEmpty(checkpoint.format, "Checkpoint format")
}

export class SessionSyncStore {
  constructor(private readonly db: Database) {}

  get(collectorId: string, agent: AgentId): SessionSyncState | undefined {
    const row = this.db
      .query<SyncStateRow, [string, string]>(
        `SELECT * FROM session_sync_states
         WHERE collector_id = ? AND agent = ?`,
      )
      .get(collectorId, agent)
    return row ? fromRow(row) : undefined
  }

  beginSync(input: BeginSessionSyncInput): SessionSyncState {
    assertNonEmpty(input.agent, "Agent")
    assertNonEmpty(input.runId, "Sync run ID")
    if (input.mode !== "incremental" && input.mode !== "reconcile") {
      throw new Error(`Unsupported session sync mode: ${String(input.mode)}`)
    }

    return this.db.transaction(() => {
      const current = this.get(input.collectorId, input.agent)
      if (current?.activeRunId === input.runId) {
        if (current.activeMode !== input.mode) {
          throw new Error("A sync run cannot change mode.")
        }
        return current
      }

      const reusedRun = this.db
        .query<{ found: number }, [string, string, string]>(
          `SELECT 1 AS found FROM session_sync_batches
           WHERE collector_id = ? AND agent = ? AND run_id = ? LIMIT 1`,
        )
        .get(input.collectorId, input.agent, input.runId)
      if (reusedRun) {
        throw new Error("A committed sync run ID cannot be reused.")
      }

      const now = Date.now()
      this.db
        .query(
          `DELETE FROM session_sync_batches
           WHERE collector_id = ? AND agent = ?`,
        )
        .run(input.collectorId, input.agent)
      this.db
        .query(
          `INSERT INTO session_sync_states (
             collector_id, agent, active_run_id, active_mode, next_sequence, started_at
           ) VALUES (?, ?, ?, ?, 0, ?)
           ON CONFLICT (collector_id, agent) DO UPDATE SET
             active_run_id = excluded.active_run_id,
             active_mode = excluded.active_mode,
             next_sequence = 0,
             started_at = excluded.started_at`,
        )
        .run(input.collectorId, input.agent, input.runId, input.mode, now)
      return this.get(input.collectorId, input.agent)!
    })()
  }

  commitBatch(input: CommitSessionBatchInput): CommitSessionBatchResult {
    assertNonEmpty(input.agent, "Agent")
    assertNonEmpty(input.runId, "Sync run ID")
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
      throw new Error(
        "Sync batch sequence must be a non-negative safe integer.",
      )
    }
    if (input.checkpoint !== undefined && input.checkpoint !== null) {
      assertCheckpoint(input.checkpoint)
    }
    const sourceIds = new Set<string>()
    for (const item of input.items) {
      assertNonEmpty(item.sourceId, "Session source ID")
      if (sourceIds.has(item.sourceId)) {
        throw new Error(
          `Duplicate session source ID in batch: ${item.sourceId}`,
        )
      }
      sourceIds.add(item.sourceId)
    }

    return this.db.transaction(() => {
      const duplicate = this.db
        .query<SyncBatchRow, [string, string, string, number]>(
          `SELECT upserted_count, deleted_count FROM session_sync_batches
           WHERE collector_id = ? AND agent = ? AND run_id = ? AND sequence = ?`,
        )
        .get(input.collectorId, input.agent, input.runId, input.sequence)
      if (duplicate) {
        return {
          duplicate: true,
          upserted: duplicate.upserted_count,
          deleted: duplicate.deleted_count,
          state: this.get(input.collectorId, input.agent)!,
        }
      }

      const state = this.get(input.collectorId, input.agent)
      if (
        !state ||
        state.activeRunId !== input.runId ||
        state.activeMode === null
      ) {
        throw new Error("Sync run is not active.")
      }
      if (state.nextSequence !== input.sequence) {
        throw new Error(
          `Out-of-order sync batch: expected ${state.nextSequence}, received ${input.sequence}.`,
        )
      }

      const now = Date.now()
      const reconcileId = state.activeMode === "reconcile" ? input.runId : null
      const upsert = this.db.query(
        `INSERT INTO sessions (
           collector_id, agent, source_id, title, directory,
           source_created_at, source_updated_at, source_archived_at,
           deleted_at, first_seen_at, last_synced_at, last_reconcile_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
         ON CONFLICT (collector_id, agent, source_id) DO UPDATE SET
           title = excluded.title,
           directory = excluded.directory,
           source_created_at = excluded.source_created_at,
           source_updated_at = excluded.source_updated_at,
           source_archived_at = excluded.source_archived_at,
           deleted_at = NULL,
           last_synced_at = excluded.last_synced_at,
           last_reconcile_id = CASE
             WHEN excluded.last_reconcile_id IS NOT NULL THEN excluded.last_reconcile_id
             ELSE sessions.last_reconcile_id
           END`,
      )
      for (const item of input.items) {
        upsert.run(
          input.collectorId,
          input.agent,
          item.sourceId,
          item.title,
          item.directory,
          item.sourceCreatedAt,
          item.sourceUpdatedAt,
          item.sourceArchivedAt ?? null,
          now,
          now,
          reconcileId,
        )
      }

      let deleted = 0
      const complete = input.complete === true
      if (complete && state.activeMode === "reconcile") {
        deleted = this.db
          .query(
            `UPDATE sessions SET deleted_at = ?, last_synced_at = ?
             WHERE collector_id = ? AND agent = ? AND deleted_at IS NULL
               AND (last_reconcile_id IS NULL OR last_reconcile_id <> ?)`,
          )
          .run(now, now, input.collectorId, input.agent, input.runId).changes
      }

      const checkpoint = input.checkpoint
      this.db
        .query(
          `UPDATE session_sync_states SET
             checkpoint_format = CASE WHEN ? THEN ? ELSE checkpoint_format END,
             checkpoint = CASE WHEN ? THEN ? ELSE checkpoint END,
             active_run_id = CASE WHEN ? THEN NULL ELSE active_run_id END,
             active_mode = CASE WHEN ? THEN NULL ELSE active_mode END,
             started_at = CASE WHEN ? THEN NULL ELSE started_at END,
             next_sequence = ?,
             last_synced_at = ?,
             last_reconciled_at = CASE WHEN ? THEN ? ELSE last_reconciled_at END
           WHERE collector_id = ? AND agent = ?`,
        )
        .run(
          checkpoint !== undefined,
          checkpoint?.format ?? null,
          checkpoint !== undefined,
          checkpoint?.value ?? null,
          complete,
          complete,
          complete,
          input.sequence + 1,
          now,
          complete && state.activeMode === "reconcile",
          now,
          input.collectorId,
          input.agent,
        )

      this.db
        .query(
          `INSERT INTO session_sync_batches (
             collector_id, agent, run_id, sequence,
             upserted_count, deleted_count, complete, committed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.collectorId,
          input.agent,
          input.runId,
          input.sequence,
          input.items.length,
          deleted,
          complete,
          now,
        )

      return {
        duplicate: false,
        upserted: input.items.length,
        deleted,
        state: this.get(input.collectorId, input.agent)!,
      }
    })()
  }
}
