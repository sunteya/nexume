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

export interface CollectorDataSource {
  readonly agent: AgentId
  readonly checkpointFormat: string
  readonly available: boolean
  readSessionPage(
    request: SessionSourcePageRequest,
  ): SessionSourcePage | Promise<SessionSourcePage>
}
