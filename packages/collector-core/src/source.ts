import { createHash } from "node:crypto"

import type {
  AgentId,
  CollectedSessionSummary,
  CollectedSessionDetailPage,
  GetSessionDetailRequest,
  SessionDetailMessage,
  SessionDetailPart,
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

export class SessionDetailNotFoundError extends Error {
  constructor(message = "源端 Session 不存在。") {
    super(message)
    this.name = "SessionDetailNotFoundError"
  }
}

export class SessionDetailCursorError extends Error {
  constructor(message = "Session 详情游标无效。") {
    super(message)
    this.name = "SessionDetailCursorError"
  }
}

export const sessionDetailTextLimit = 64 * 1024
const sessionDetailPageTextLimit = 2 * 1024 * 1024

export function detailText(value: unknown): {
  text: string
  truncated?: boolean
} {
  let text =
    typeof value === "string"
      ? value
      : (() => {
          try {
            return JSON.stringify(value, null, 2)
          } catch {
            return String(value)
          }
        })()
  if (text === undefined) text = ""
  if (text.length <= sessionDetailTextLimit) return { text }
  return {
    text: `${text.slice(0, sessionDetailTextLimit - 32)}\n... [truncated]`,
    truncated: true,
  }
}

export function detailPart(
  part: Omit<SessionDetailPart, "text" | "truncated"> & { text: unknown },
): SessionDetailPart {
  return { ...part, ...detailText(part.text) }
}

export function detailParts(parts: SessionDetailPart[]): SessionDetailPart[] {
  if (parts.length <= 500) return parts
  return [
    ...parts.slice(0, 499),
    detailPart({
      id: "details:truncated",
      type: "unknown",
      text: `${parts.length - 499} additional parts were omitted.`,
    }),
  ]
}

export function detailOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (!/^\d{1,12}$/.test(cursor)) throw new SessionDetailCursorError()
  const offset = Number(cursor)
  if (!Number.isSafeInteger(offset)) throw new SessionDetailCursorError()
  return offset
}

export function detailPage(
  session: CollectedSessionSummary,
  items: SessionDetailMessage[],
  offset: number,
  total: number,
): CollectedSessionDetailPage {
  const limitedItems: SessionDetailMessage[] = []
  let textSize = 0
  for (const item of items) {
    if (textSize >= sessionDetailPageTextLimit) break
    const parts: SessionDetailPart[] = []
    for (const part of item.parts) {
      if (textSize + part.text.length > sessionDetailPageTextLimit) {
        parts.push(
          detailPart({
            id: `${part.id}:page-truncated`,
            type: "unknown",
            text: "Additional content in this message was omitted.",
          }),
        )
        textSize = sessionDetailPageTextLimit
        break
      }
      parts.push(part)
      textSize += part.text.length
    }
    limitedItems.push({ ...item, parts })
  }
  const nextOffset = offset + limitedItems.length
  return {
    session,
    items: limitedItems,
    hasMore: nextOffset < total,
    ...(nextOffset < total ? { nextCursor: String(nextOffset) } : {}),
  }
}

export type SessionDetailSourceRequest = Pick<
  GetSessionDetailRequest,
  "id" | "limit" | "cursor"
>

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
  readonly dataPath?: string
  readSessionPage(
    request: SessionSourcePageRequest,
  ): SessionSourcePage | Promise<SessionSourcePage>
}

export interface SessionDetailDataSource extends CollectorDataSource {
  readSessionDetail(
    request: SessionDetailSourceRequest,
  ): CollectedSessionDetailPage | Promise<CollectedSessionDetailPage>
}

export interface WritableCollectorDataSource extends CollectorDataSource {
  updateSessionTitle(
    input: SessionTitleUpdateInput,
  ): CollectedSessionSummary | Promise<CollectedSessionSummary>
}
