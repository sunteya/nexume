import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type {
  CollectedSessionSummary,
  SessionDetailMessage,
  SessionSyncCheckpoint,
} from "@nexume/contracts"

import {
  CollectorUnavailableError,
  UnsupportedCollectorDataError,
} from "./opencode"
import type {
  SessionSourcePage,
  SessionSourcePageRequest,
  SessionDetailDataSource,
  SessionDetailSourceRequest,
  SessionTitleUpdateInput,
  WritableCollectorDataSource,
} from "./source"
import {
  createSessionTitleFingerprint,
  detailOffset,
  detailPage,
  detailPart,
  detailParts,
  SessionDetailCursorError,
  SessionDetailNotFoundError,
  SessionTitleConflictError,
  SessionTitleNotFoundError,
} from "./source"

interface SessionRow {
  id: string
  title: string
  directory: string
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: string
  message: string
  timestamp: string
}

interface AlmaPosition {
  updatedAt: string
  id: string
  titleFingerprint?: string
  fullScan?: boolean
}

interface TitleRow {
  id: string
  title: string
}

export interface AlmaCollectorOptions {
  databasePath?: string
}

export function getAlmaDatabasePath(): string {
  return join(
    homedir(),
    "Library",
    "Application Support",
    "alma",
    "chat_threads.db",
  )
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false
  const timestamp = Date.parse(value)
  return (
    Number.isSafeInteger(timestamp) &&
    timestamp >= 0 &&
    new Date(timestamp).toISOString() === value
  )
}

function parseTimestamp(value: string): number {
  if (!isCanonicalTimestamp(value)) {
    throw new UnsupportedCollectorDataError(
      "当前 Alma Session 数据包含无效时间。",
    )
  }
  return Date.parse(value)
}

function decodePosition(
  checkpoint: SessionSyncCheckpoint | undefined,
): AlmaPosition | undefined {
  if (!checkpoint) return undefined
  if (checkpoint.format !== "alma/sqlite/v1") {
    throw new Error("Alma checkpoint 格式不受支持。")
  }
  try {
    const position = JSON.parse(checkpoint.value) as Partial<AlmaPosition>
    if (
      !isCanonicalTimestamp(position.updatedAt) ||
      typeof position.id !== "string"
    ) {
      throw new Error()
    }
    return position as AlmaPosition
  } catch {
    throw new Error("Alma checkpoint 内容无效。")
  }
}

function encodePosition(
  row: Pick<SessionRow, "updated_at" | "id">,
  titleFingerprint: string,
  fullScan = false,
): SessionSyncCheckpoint {
  return {
    format: "alma/sqlite/v1",
    value: JSON.stringify({
      updatedAt: row.updated_at,
      id: row.id,
      titleFingerprint,
      ...(fullScan ? { fullScan: true } : {}),
    }),
  }
}

function toSummary(row: SessionRow): CollectedSessionSummary {
  return {
    id: row.id,
    agent: "alma",
    title: row.title,
    directory: row.directory,
    createdAt: parseTimestamp(row.created_at),
    updatedAt: parseTimestamp(row.updated_at),
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
}

function jsonObject(value: string): Record<string, unknown> {
  try {
    return object(JSON.parse(value))
  } catch {
    return {}
  }
}

function partMessages(value: unknown, id: string): ReturnType<typeof detailPart>[] {
  if (!Array.isArray(value)) {
    return [detailPart({ id, type: "unknown", text: value })]
  }
  return value.flatMap((item, index) => {
    const data = object(item)
    const type = typeof data.type === "string" ? data.type : "unknown"
    const partId = `${id}:${index}`
    if (type === "text" || type === "reasoning") {
      return [detailPart({ id: partId, type, text: data.text ?? "" })]
    }
    if (type.includes("tool")) {
      const callId =
        typeof data.toolCallId === "string" ? data.toolCallId : undefined
      const name =
        typeof data.toolName === "string"
          ? data.toolName
          : type.replace(/^tool-/, "")
      const result = []
      if (data.input !== undefined || data.arguments !== undefined) {
        result.push(
          detailPart({
            id: `${partId}:call`,
            type: "tool-call",
            name,
            callId,
            text: data.input ?? data.arguments,
          }),
        )
      }
      if (data.output !== undefined || data.result !== undefined || data.error !== undefined) {
        result.push(
          detailPart({
            id: `${partId}:result`,
            type: "tool-result",
            name,
            callId,
            text: data.output ?? data.result ?? data.error,
          }),
        )
      }
      return result.length > 0
        ? result
        : [detailPart({ id: partId, type: "unknown", text: data })]
    }
    if (type === "file") {
      return [
        detailPart({
          id: partId,
          type: "file",
          text: data.filename ?? data.url ?? data,
        }),
      ]
    }
    if (type === "patch") {
      return [detailPart({ id: partId, type: "patch", text: data.text ?? data })]
    }
    return [detailPart({ id: partId, type: "unknown", text: data })]
  })
}

function toDetailMessage(row: MessageRow): SessionDetailMessage {
  const data = jsonObject(row.message)
  const role =
    data.role === "user" ||
    data.role === "assistant" ||
    data.role === "system" ||
    data.role === "tool"
      ? data.role
      : "unknown"
  return {
    id: row.id,
    role,
    createdAt: parseTimestamp(row.timestamp),
    parts: detailParts(partMessages(data.parts, row.id)),
  }
}

export class AlmaCollector
  implements WritableCollectorDataSource, SessionDetailDataSource
{
  readonly agent = "alma"
  readonly checkpointFormat = "alma/sqlite/v1"
  readonly databasePath: string

  constructor(options: AlmaCollectorOptions = {}) {
    this.databasePath = options.databasePath ?? getAlmaDatabasePath()
  }

  get available(): boolean {
    return existsSync(this.databasePath)
  }

  readSessionPage(request: SessionSourcePageRequest): SessionSourcePage {
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0) {
      throw new Error("Session 同步批量无效。")
    }
    if (!this.available) {
      throw new CollectorUnavailableError("未发现本机 Alma Session 数据。")
    }

    const database = new Database(this.databasePath, {
      readonly: true,
      strict: true,
    })

    try {
      database.exec("PRAGMA busy_timeout = 5000; PRAGMA query_only = ON")
      const position = decodePosition(request.checkpoint)
      const titleFingerprint = createSessionTitleFingerprint(
        database
          .query<TitleRow, []>(
            `SELECT id, title FROM chat_threads
             WHERE parent_thread_id IS NULL AND is_incognito = 0`,
          )
          .all(),
      )
      const continuingFullScan = position?.fullScan === true
      const fullScan =
        continuingFullScan ||
        position === undefined ||
        position.titleFingerprint !== titleFingerprint
      const scanFingerprint = continuingFullScan
        ? (position.titleFingerprint ?? titleFingerprint)
        : titleFingerprint
      const conditions = ["t.parent_thread_id IS NULL", "t.is_incognito = 0"]
      const parameters: Array<number | string> = []
      if (position && (continuingFullScan || !fullScan)) {
        conditions.push("(t.updated_at > ? OR (t.updated_at = ? AND t.id > ?))")
        parameters.push(position.updatedAt, position.updatedAt, position.id)
      }
      parameters.push(request.limit + 1)

      const rows = database
        .query<SessionRow, Array<number | string>>(
          `SELECT
             t.id,
             t.title,
             COALESCE(w.path, '') AS directory,
             t.created_at,
             t.updated_at
           FROM chat_threads AS t
           LEFT JOIN workspaces AS w ON w.id = t.workspace_id
           WHERE ${conditions.join(" AND ")}
           ORDER BY t.updated_at ASC, t.id ASC
           LIMIT ?`,
        )
        .all(...parameters)
      const selected = rows.slice(0, request.limit)
      const items = selected.map(toSummary)
      const last = selected.at(-1)
      return {
        items,
        checkpoint: last
          ? encodePosition(
              last,
              scanFingerprint,
              fullScan && rows.length > request.limit,
            )
          : {
              format: this.checkpointFormat,
              value: JSON.stringify({
                updatedAt: position?.updatedAt ?? "1970-01-01T00:00:00.000Z",
                id: position?.id ?? "",
                titleFingerprint: scanFingerprint,
              }),
            },
        hasMore: rows.length > request.limit,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (
        message.includes("no such table") ||
        message.includes("no such column")
      ) {
        throw new UnsupportedCollectorDataError(
          "当前 Alma Session 数据格式暂不受支持。",
        )
      }
      throw error
    } finally {
      database.close()
    }
  }

  readSessionDetail(request: SessionDetailSourceRequest) {
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0) {
      throw new Error("Session 详情批量无效。")
    }
    if (!this.available) {
      throw new CollectorUnavailableError("未发现本机 Alma Session 数据。")
    }

    const database = new Database(this.databasePath, {
      readonly: true,
      strict: true,
    })
    try {
      database.exec("PRAGMA busy_timeout = 5000; PRAGMA query_only = ON")
      const session = database
        .query<SessionRow, [string]>(
          `SELECT
             t.id, t.title, COALESCE(w.path, '') AS directory,
             t.created_at, t.updated_at
           FROM chat_threads AS t
           LEFT JOIN workspaces AS w ON w.id = t.workspace_id
           WHERE t.id = ? AND t.parent_thread_id IS NULL
             AND t.is_incognito = 0`,
        )
        .get(request.id)
      if (!session) throw new SessionDetailNotFoundError()

      const offset = detailOffset(request.cursor)
      const total =
        database
          .query<{ count: number }, [string]>(
            "SELECT COUNT(*) AS count FROM chat_messages WHERE thread_id = ?",
          )
          .get(request.id)?.count ?? 0
      const messages = database
        .query<MessageRow, [string, number, number]>(
          `SELECT id, message, timestamp FROM chat_messages
           WHERE thread_id = ? ORDER BY timestamp ASC, id ASC
           LIMIT ? OFFSET ?`,
        )
        .all(request.id, request.limit, offset)
      return detailPage(
        toSummary(session),
        messages.map(toDetailMessage),
        offset,
        total,
      )
    } catch (error) {
      if (error instanceof SessionDetailCursorError) throw error
      const message = error instanceof Error ? error.message : String(error)
      if (
        message.includes("no such table") ||
        message.includes("no such column")
      ) {
        throw new UnsupportedCollectorDataError(
          "当前 Alma Session 详情格式暂不受支持。",
        )
      }
      throw error
    } finally {
      database.close()
    }
  }

  updateSessionTitle(input: SessionTitleUpdateInput): CollectedSessionSummary {
    if (!this.available) {
      throw new CollectorUnavailableError("未发现本机 Alma Session 数据。")
    }

    const database = new Database(this.databasePath, { strict: true })
    try {
      database.exec("PRAGMA busy_timeout = 5000")
      return database.transaction(() => {
        const select = database.query<SessionRow, [string]>(
          `SELECT
             t.id,
             t.title,
             COALESCE(w.path, '') AS directory,
             t.created_at,
             t.updated_at
           FROM chat_threads AS t
           LEFT JOIN workspaces AS w ON w.id = t.workspace_id
           WHERE t.id = ? AND t.parent_thread_id IS NULL
             AND t.is_incognito = 0`,
        )
        const current = select.get(input.id)
        if (!current) throw new SessionTitleNotFoundError()
        if (
          current.title !== input.expectedTitle ||
          parseTimestamp(current.updated_at) !== input.expectedUpdatedAt
        ) {
          throw new SessionTitleConflictError()
        }

        database
          .query("UPDATE chat_threads SET title = ? WHERE id = ?")
          .run(input.title, input.id)
        return toSummary(select.get(input.id)!)
      })()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (
        message.includes("no such table") ||
        message.includes("no such column")
      ) {
        throw new UnsupportedCollectorDataError(
          "当前 Alma Session 数据格式暂不受支持。",
        )
      }
      throw error
    } finally {
      database.close()
    }
  }
}
