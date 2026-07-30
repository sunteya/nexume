import {
  assertCollectedSessionSummary,
  type SessionSummary,
  type UpdateSessionTitleRequest,
  type UpdateSessionTitleResponse,
} from "@nexume/contracts"
import {
  CollectorUnavailableError,
  SessionTitleConflictError,
  SessionTitleNotFoundError,
  UnsupportedCollectorDataError,
  type CollectorDataSource,
  type WritableCollectorDataSource,
} from "@nexume/collector-core"
import type {
  CollectorStore,
  SessionRecord,
  SessionStore,
} from "@nexume/storage"

export class SessionManagementError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "SessionManagementError"
  }
}

export interface SessionManagementOptions {
  sessions: SessionStore
  collectors: CollectorStore
  localSources: CollectorDataSource[]
  updateRemote(
    collectorId: string,
    request: UpdateSessionTitleRequest,
  ): Promise<UpdateSessionTitleResponse | undefined>
}

function writableSource(
  source: CollectorDataSource | undefined,
): WritableCollectorDataSource | undefined {
  return source && "updateSessionTitle" in source
    ? (source as WritableCollectorDataSource)
    : undefined
}

function toSummary(
  record: SessionRecord,
  collectorName: string,
): SessionSummary {
  return {
    id: record.sourceId,
    agent: record.agent,
    title: record.title,
    directory: record.directory,
    createdAt: record.sourceCreatedAt,
    updatedAt: record.sourceUpdatedAt,
    ...(record.sourceArchivedAt === null
      ? {}
      : { archivedAt: record.sourceArchivedAt }),
    ...(record.deletedAt === null ? {} : { deletedAt: record.deletedAt }),
    collectorId: record.collectorId,
    collectorName,
  }
}

function sourceError(error: unknown): SessionManagementError {
  if (error instanceof SessionTitleConflictError) {
    return new SessionManagementError(
      "session_title_conflict",
      error.message,
      409,
    )
  }
  if (error instanceof SessionTitleNotFoundError) {
    return new SessionManagementError("session_not_found", error.message, 404)
  }
  if (
    error instanceof CollectorUnavailableError ||
    error instanceof UnsupportedCollectorDataError
  ) {
    return new SessionManagementError(
      "collector_unavailable",
      error.message,
      503,
    )
  }
  return new SessionManagementError(
    "session_title_update_failed",
    error instanceof Error ? error.message : String(error),
    500,
  )
}

function remoteError(
  response: Extract<UpdateSessionTitleResponse, { ok: false }>,
): SessionManagementError {
  if (response.error.code === "session_title_conflict") {
    return new SessionManagementError(
      response.error.code,
      response.error.message,
      409,
    )
  }
  if (response.error.code === "session_not_found") {
    return new SessionManagementError(
      response.error.code,
      response.error.message,
      404,
    )
  }
  if (
    response.error.code === "collector_unavailable" ||
    response.error.code === "unsupported_collector_data"
  ) {
    return new SessionManagementError(
      response.error.code,
      response.error.message,
      503,
    )
  }
  return new SessionManagementError(
    response.error.code,
    response.error.message,
    502,
  )
}

export class SessionManagementService {
  private readonly localSources: Map<string, CollectorDataSource>

  constructor(private readonly options: SessionManagementOptions) {
    this.localSources = new Map(
      options.localSources.map((source) => [source.agent, source]),
    )
  }

  async updateTitle(
    collectorId: string,
    request: UpdateSessionTitleRequest,
  ): Promise<SessionSummary> {
    const key = {
      collectorId,
      agent: request.agent,
      sourceId: request.id,
    }
    const cached = this.options.sessions.get(key)
    if (!cached) {
      throw new SessionManagementError(
        "session_not_found",
        "Session 不存在。",
        404,
      )
    }
    if (
      cached.title !== request.expectedTitle ||
      cached.sourceUpdatedAt !== request.expectedUpdatedAt
    ) {
      throw new SessionManagementError(
        "session_title_conflict",
        "Session 标题已发生变化，请刷新后重试。",
        409,
      )
    }

    let session
    if (collectorId === "local") {
      const source = writableSource(this.localSources.get(request.agent))
      if (!source) {
        throw new SessionManagementError(
          "collector_unavailable",
          "本地 Collector 不支持修改此 Session。",
          503,
        )
      }
      try {
        session = await source.updateSessionTitle(request)
      } catch (error) {
        throw sourceError(error)
      }
    } else {
      let response: UpdateSessionTitleResponse | undefined
      try {
        response = await this.options.updateRemote(collectorId, request)
      } catch {
        throw new SessionManagementError(
          "collector_unavailable",
          "Collector 未能及时响应 Session 标题修改请求。",
          503,
        )
      }
      if (!response) {
        throw new SessionManagementError(
          "collector_offline",
          "Collector 当前离线，无法修改 Session 标题。",
          503,
        )
      }
      if (!response.ok) throw remoteError(response)
      session = response.data.session
    }

    try {
      assertCollectedSessionSummary(session, request.agent)
    } catch {
      throw new SessionManagementError(
        "invalid_collector_response",
        "Collector 返回了无效的 Session 数据。",
        502,
      )
    }
    if (session.id !== request.id) {
      throw new SessionManagementError(
        "invalid_collector_response",
        "Collector 返回了不匹配的 Session。",
        502,
      )
    }

    const record = this.options.sessions.applySourceUpdate(key, {
      title: session.title,
      directory: session.directory,
      sourceCreatedAt: session.createdAt,
      sourceUpdatedAt: session.updatedAt,
      sourceArchivedAt: session.archivedAt,
    })
    if (!record) {
      throw new SessionManagementError(
        "session_not_found",
        "Session 缓存不存在。",
        404,
      )
    }
    const collectorName =
      this.options.collectors.get(collectorId)?.name ?? collectorId
    return toSummary(record, collectorName)
  }
}
