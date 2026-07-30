import {
  assertAgentId,
  assertListSessionsParams,
  sessionStatuses,
  type AgentId,
  type CollectorConnectionType,
  type CollectorDescriptor,
  type CollectorInfo,
  type ListSessionsParams,
  type SessionBatch,
  type SessionStatus,
  type SessionSummary,
} from "@nexume/contracts"

export interface CachedSessionPosition {
  sourceUpdatedAt: number
  collectorId: string
  agent: AgentId
  sourceId: string
}

export interface CachedSessionRecord extends CachedSessionPosition {
  collectorName: string
  title: string
  directory: string
  sourceCreatedAt: number
  sourceArchivedAt: number | null
  deletedAt: number | null
}

export interface CachedSessionListOptions {
  collectorId?: string
  agent?: AgentId
  title?: string
  status: SessionStatus
  limit: number
  cursor?: CachedSessionPosition
}

export interface CachedSessionCatalog {
  list(options: CachedSessionListOptions): {
    items: CachedSessionRecord[]
    hasMore: boolean
    nextCursor?: CachedSessionPosition
  }
}

export interface RegisterCollectorOptions {
  descriptor: CollectorDescriptor
  connectionType: CollectorConnectionType
}

export interface CollectorRegistration {
  touch(): void
  unregister(): void
}

export interface ServerCore {
  registerCollector(options: RegisterCollectorOptions): CollectorRegistration
  listCollectors(): CollectorInfo[]
  renameCollector(id: string, name: string): boolean
  listSessions(params: ListSessionsParams): Promise<SessionBatch>
}

interface RegistryEntry {
  generation: symbol
  info: CollectorInfo
}

interface SessionCursorFilters {
  collectorId?: string
  agent?: AgentId
  title?: string
  status: SessionStatus
}

interface SessionCursor {
  version: 2
  filters: SessionCursorFilters
  position: CachedSessionPosition
}

export class CollectorRegistrationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CollectorRegistrationError"
  }
}

export class InvalidSessionCursorError extends Error {
  constructor(message = "Session 游标无效或与当前筛选条件不一致。") {
    super(message)
    this.name = "InvalidSessionCursorError"
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function filtersFor(params: ListSessionsParams): SessionCursorFilters {
  return {
    ...(params.collectorId ? { collectorId: params.collectorId } : {}),
    ...(params.agent ? { agent: params.agent } : {}),
    ...(params.title ? { title: params.title } : {}),
    status: params.status ?? "active",
  }
}

function filtersEqual(
  left: SessionCursorFilters,
  right: SessionCursorFilters,
): boolean {
  return (
    left.collectorId === right.collectorId &&
    left.agent === right.agent &&
    left.title === right.title &&
    left.status === right.status
  )
}

function assertPosition(
  value: unknown,
): asserts value is CachedSessionPosition {
  if (!value || typeof value !== "object") throw new InvalidSessionCursorError()
  const position = value as Partial<CachedSessionPosition>
  if (
    !Number.isSafeInteger(position.sourceUpdatedAt) ||
    typeof position.collectorId !== "string" ||
    !position.collectorId ||
    typeof position.sourceId !== "string" ||
    !position.sourceId
  ) {
    throw new InvalidSessionCursorError()
  }
  try {
    assertAgentId(position.agent)
  } catch {
    throw new InvalidSessionCursorError()
  }
}

function decodeCursor(value: string): SessionCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<SessionCursor>
    if (
      decoded.version !== 2 ||
      !decoded.filters ||
      typeof decoded.filters !== "object" ||
      !sessionStatuses.includes(decoded.filters.status as SessionStatus)
    ) {
      throw new InvalidSessionCursorError()
    }
    if (
      decoded.filters.collectorId !== undefined &&
      (typeof decoded.filters.collectorId !== "string" ||
        !decoded.filters.collectorId)
    ) {
      throw new InvalidSessionCursorError()
    }
    if (decoded.filters.agent !== undefined) {
      assertAgentId(decoded.filters.agent)
    }
    if (
      decoded.filters.title !== undefined &&
      (typeof decoded.filters.title !== "string" ||
        !decoded.filters.title.trim() ||
        decoded.filters.title.length > 256)
    ) {
      throw new InvalidSessionCursorError()
    }
    assertPosition(decoded.position)
    return decoded as SessionCursor
  } catch (error) {
    if (error instanceof InvalidSessionCursorError) throw error
    throw new InvalidSessionCursorError()
  }
}

function encodeCursor(cursor: SessionCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url")
}

function toSummary(record: CachedSessionRecord): SessionSummary {
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
    collectorName: record.collectorName,
  }
}

const emptyCatalog: CachedSessionCatalog = {
  list: () => ({ items: [], hasMore: false }),
}

export function createServerCore(
  options: { sessions?: CachedSessionCatalog } = {},
): ServerCore {
  const registry = new Map<string, RegistryEntry>()
  const sessions = options.sessions ?? emptyCatalog

  return {
    registerCollector(registration) {
      const existing = registry.get(registration.descriptor.id)
      if (existing?.info.connectionType === "local") {
        throw new CollectorRegistrationError(
          `Collector ID ${registration.descriptor.id} 已由内部 Collector 使用。`,
        )
      }

      const now = Date.now()
      const generation = Symbol(registration.descriptor.id)
      registry.set(registration.descriptor.id, {
        generation,
        info: {
          ...registration.descriptor,
          connectionType: registration.connectionType,
          connectedAt: now,
          lastSeenAt: now,
        },
      })

      return {
        touch() {
          const current = registry.get(registration.descriptor.id)
          if (current?.generation === generation) {
            current.info.lastSeenAt = Date.now()
          }
        },
        unregister() {
          const current = registry.get(registration.descriptor.id)
          if (current?.generation === generation) {
            registry.delete(registration.descriptor.id)
          }
        },
      }
    },

    listCollectors() {
      return [...registry.values()]
        .map((entry) => ({ ...entry.info, agents: [...entry.info.agents] }))
        .sort(
          (left, right) =>
            compareStrings(left.connectionType, right.connectionType) ||
            compareStrings(left.name, right.name) ||
            compareStrings(left.id, right.id),
        )
    },

    renameCollector(id, name) {
      const entry = registry.get(id)
      if (!entry) return false
      entry.info.name = name
      return true
    },

    async listSessions(params) {
      assertListSessionsParams(params)
      const filters = filtersFor(params)
      const decoded = params.cursor ? decodeCursor(params.cursor) : undefined
      if (decoded && !filtersEqual(decoded.filters, filters)) {
        throw new InvalidSessionCursorError()
      }

      const result = sessions.list({
        ...filters,
        limit: params.limit,
        cursor: decoded?.position,
      })
      return {
        items: result.items.map(toSummary),
        hasMore: result.hasMore,
        nextCursor: result.nextCursor
          ? encodeCursor({
              version: 2,
              filters,
              position: result.nextCursor,
            })
          : undefined,
        warnings: [],
      }
    },
  }
}
