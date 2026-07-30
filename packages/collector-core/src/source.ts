import { createHash } from "node:crypto"

import type {
  AgentId,
  CollectedSessionSummary,
  SessionSyncCheckpoint,
  SessionSyncMode,
} from "@nexume/contracts"

export interface SessionSourcePage {
  items: CollectedSessionSummary[]
  checkpoint?: SessionSyncCheckpoint
  hasMore: boolean
}

export interface SessionSourcePageRequest {
  mode: SessionSyncMode
  checkpoint?: SessionSyncCheckpoint
  limit: number
}

export interface SessionTitleUpdateInput {
  id: string
  title: string
  expectedTitle: string
  expectedUpdatedAt: number
}

export class SessionTitleConflictError extends Error {
  constructor(message = "Session 标题已在源端发生变化。") {
    super(message)
    this.name = "SessionTitleConflictError"
  }
}

export class SessionTitleNotFoundError extends Error {
  constructor(message = "源端 Session 不存在。") {
    super(message)
    this.name = "SessionTitleNotFoundError"
  }
}

export function createSessionTitleFingerprint(
  rows: ReadonlyArray<Pick<CollectedSessionSummary, "id" | "title">>,
): string {
  const hash = createHash("sha256")
  for (const row of [...rows].sort((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    hash.update(`${row.id.length}:${row.id}:${row.title.length}:${row.title}\0`)
  }
  return hash.digest("hex")
}

export interface CollectorDataSource {
  readonly agent: AgentId
  readonly checkpointFormat: string
  readonly available: boolean
  readSessionPage(
    request: SessionSourcePageRequest,
  ): SessionSourcePage | Promise<SessionSourcePage>
}

export interface WritableCollectorDataSource extends CollectorDataSource {
  updateSessionTitle(
    input: SessionTitleUpdateInput,
  ): CollectedSessionSummary | Promise<CollectedSessionSummary>
}
