import { Database } from "bun:sqlite"
import { existsSync, readFileSync } from "node:fs"
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
  created_at: number
  updated_at: number
  archived_at: number | null
}

interface DetailThreadRow extends SessionRow {
  rollout_path: string
}

interface CodexPosition {
  updatedAt: number
  id: string
  titleFingerprint?: string
  fullScan?: boolean
}

interface TitleRow {
  id: string
  title: string
}

const maximumTitleLength = 4_096

export interface CodexCollectorOptions {
  databasePath?: string
}

export function getCodexDatabasePath(): string {
  const defaultPath = join(homedir(), ".codex", "state_5.sqlite")
  const configuredHome = process.env.CODEX_HOME?.trim()
  if (!configuredHome) return defaultPath

  const configuredPath = join(configuredHome, "state_5.sqlite")
  return existsSync(configuredPath) ? configuredPath : defaultPath
}

function decodePosition(
  checkpoint: SessionSyncCheckpoint | undefined,
): CodexPosition | undefined {
  if (!checkpoint) return undefined
  if (checkpoint.format !== "codex/sqlite/v1") {
    throw new Error("Codex checkpoint 格式不受支持。")
  }
  try {
    const position = JSON.parse(checkpoint.value) as Partial<CodexPosition>
    if (
      !Number.isSafeInteger(position.updatedAt) ||
      typeof position.id !== "string"
    ) {
      throw new Error()
    }
    return position as CodexPosition
  } catch {
    throw new Error("Codex checkpoint 内容无效。")
  }
}

function encodePosition(
  row: Pick<SessionRow, "updated_at" | "id">,
  titleFingerprint: string,
  fullScan = false,
): SessionSyncCheckpoint {
  return {
    format: "codex/sqlite/v1",
    value: JSON.stringify({
      updatedAt: row.updated_at,
      id: row.id,
      titleFingerprint,
      ...(fullScan ? { fullScan: true } : {}),
    }),
  }
}

function assertTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new UnsupportedCollectorDataError(
      "当前 Codex Session 数据包含无效时间。",
    )
  }
  return value
}

function normalizeTitle(title: string): string {
  if (title.length <= maximumTitleLength) return title

  let end = maximumTitleLength - 3
  const lastCodeUnit = title.charCodeAt(end - 1)
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) end -= 1
  return `${title.slice(0, end)}...`
}

function toSummary(row: SessionRow): CollectedSessionSummary {
  return {
    id: row.id,
    agent: "codex",
    title: normalizeTitle(row.title),
    directory: row.directory,
    createdAt: assertTimestamp(row.created_at),
    updatedAt: assertTimestamp(row.updated_at),
    ...(row.archived_at === null
      ? {}
      : { archivedAt: assertTimestamp(row.archived_at) }),
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {}
}

function timestamp(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isSafeInteger(value)) return value
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    if (Number.isSafeInteger(parsed)) return parsed
  }
  return fallback
}

function role(value: unknown): "user" | "assistant" | "system" | "tool" | "unknown" {
  return value === "user" || value === "assistant" || value === "system"
    ? value
    : value === "tool"
      ? "tool"
      : "unknown"
}

function contentParts(
  value: unknown,
  id: string,
): ReturnType<typeof detailPart>[] {
  if (!Array.isArray(value)) return [detailPart({ id, type: "unknown", text: value })]
  return value.map((item, index) => {
    const data = object(item)
    const type = typeof data.type === "string" ? data.type : "text"
    return detailPart({
      id: `${id}:${index}`,
      type: type === "reasoning" ? "reasoning" : "text",
      text: data.text ?? data.content ?? data,
    })
  })
}

function codexMessages(
  path: string,
  fallbackTimestamp: number,
): SessionDetailMessage[] {
  const text = readFileSync(path, "utf8")
  const result: SessionDetailMessage[] = []
  const fallbackMessages: SessionDetailMessage[] = []
  let index = 0
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    let row: Record<string, unknown>
    try {
      row = object(JSON.parse(line))
    } catch {
      continue
    }
    const payload = object(row.payload)
    const rowType = typeof row.type === "string" ? row.type : ""
    const payloadType = typeof payload.type === "string" ? payload.type : ""
    const createdAt = timestamp(row.timestamp, fallbackTimestamp)
    const id = `${rowType || "event"}:${index++}`

    if (rowType === "event_msg" && payloadType === "user_message") {
      fallbackMessages.push({
        id,
        role: "user",
        createdAt,
        parts: [detailPart({ id: `${id}:text`, type: "text", text: payload.message ?? payload })],
      })
      continue
    }
    if (
      rowType === "event_msg" &&
      (payloadType === "agent_message" || payloadType === "assistant_message")
    ) {
      fallbackMessages.push({
        id,
        role: "assistant",
        createdAt,
        parts: [detailPart({ id: `${id}:text`, type: "text", text: payload.message ?? payload })],
      })
      continue
    }
    if (rowType === "response_item") {
      if (payloadType === "message") {
        result.push({
          id,
          role: role(payload.role),
          createdAt,
          parts: detailParts(contentParts(payload.content, id)),
        })
        continue
      }
      if (payloadType === "reasoning") {
        result.push({
          id,
          role: "assistant",
          createdAt,
          parts: [
            detailPart({
              id: `${id}:reasoning`,
              type: "reasoning",
              text: payload.summary ?? payload.content ?? "",
            }),
          ],
        })
        continue
      }
      if (
        payloadType.includes("call") &&
        !payloadType.includes("output")
      ) {
        result.push({
          id,
          role: "assistant",
          createdAt,
          parts: [
            detailPart({
              id: `${id}:call`,
              type: "tool-call",
              name: typeof payload.name === "string" ? payload.name : payloadType,
              callId:
                typeof payload.call_id === "string" ? payload.call_id : undefined,
              text: payload.arguments ?? payload.input ?? payload,
            }),
          ],
        })
        continue
      }
      if (payloadType.includes("output")) {
        result.push({
          id,
          role: "tool",
          createdAt,
          parts: [
            detailPart({
              id: `${id}:result`,
              type: "tool-result",
              callId:
                typeof payload.call_id === "string" ? payload.call_id : undefined,
              text: payload.output ?? payload.result ?? payload,
            }),
          ],
        })
      }
    }
  }
  return result.some(
    (message) =>
      (message.role === "user" || message.role === "assistant") &&
      message.parts.some(
        (part) => part.type === "text" || part.type === "reasoning",
      ),
  )
    ? result
    : [...fallbackMessages, ...result].sort(
        (left, right) => left.createdAt - right.createdAt,
      )
}

export class CodexCollector
  implements WritableCollectorDataSource, SessionDetailDataSource
{
  readonly agent = "codex"
  readonly checkpointFormat = "codex/sqlite/v1"
  readonly databasePath: string

  constructor(options: CodexCollectorOptions = {}) {
    this.databasePath = options.databasePath ?? getCodexDatabasePath()
  }

  get available(): boolean {
    return existsSync(this.databasePath)
  }

  readSessionPage(request: SessionSourcePageRequest): SessionSourcePage {
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0) {
      throw new Error("Session 同步批量无效。")
    }
    if (!this.available) {
      throw new CollectorUnavailableError("未发现本机 Codex Session 数据。")
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
            `SELECT id, title FROM threads
             WHERE preview <> ''
               AND source IN ('cli', 'vscode', 'atlas', 'chatgpt')`,
          )
          .all()
          .map((row) => ({ id: row.id, title: normalizeTitle(row.title) })),
      )
      const continuingFullScan = position?.fullScan === true
      const fullScan =
        continuingFullScan ||
        position === undefined ||
        position.titleFingerprint !== titleFingerprint
      const scanFingerprint = continuingFullScan
        ? (position.titleFingerprint ?? titleFingerprint)
        : titleFingerprint

      const conditions = [
        "preview <> ''",
        "source IN ('cli', 'vscode', 'atlas', 'chatgpt')",
      ]
      const parameters: Array<number | string> = []
      if (position && (continuingFullScan || !fullScan)) {
        conditions.push(
          "(COALESCE(updated_at_ms, updated_at * 1000) > ? OR (COALESCE(updated_at_ms, updated_at * 1000) = ? AND id > ?))",
        )
        parameters.push(position.updatedAt, position.updatedAt, position.id)
      }
      parameters.push(request.limit + 1)

      const rows = database
        .query<SessionRow, Array<number | string>>(
          `SELECT
             id,
             title,
             cwd AS directory,
             COALESCE(created_at_ms, created_at * 1000) AS created_at,
             COALESCE(updated_at_ms, updated_at * 1000) AS updated_at,
             CASE
               WHEN archived = 1
               THEN COALESCE(archived_at * 1000, updated_at_ms, updated_at * 1000)
               ELSE NULL
             END AS archived_at
           FROM threads
           WHERE ${conditions.join(" AND ")}
           ORDER BY COALESCE(updated_at_ms, updated_at * 1000) ASC, id ASC
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
                updatedAt: position?.updatedAt ?? 0,
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
          "当前 Codex Session 数据格式暂不受支持。",
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
      throw new CollectorUnavailableError("未发现本机 Codex Session 数据。")
    }

    const database = new Database(this.databasePath, {
      readonly: true,
      strict: true,
    })
    try {
      database.exec("PRAGMA busy_timeout = 5000; PRAGMA query_only = ON")
      const session = database
        .query<DetailThreadRow, [string]>(
          `SELECT id, rollout_path, title, cwd AS directory,
             COALESCE(created_at_ms, created_at * 1000) AS created_at,
             COALESCE(updated_at_ms, updated_at * 1000) AS updated_at,
             CASE WHEN archived = 1
               THEN COALESCE(archived_at * 1000, updated_at_ms, updated_at * 1000)
               ELSE NULL END AS archived_at
           FROM threads WHERE id = ? AND preview <> ''
             AND source IN ('cli', 'vscode', 'atlas', 'chatgpt')`,
        )
        .get(request.id)
      if (!session) throw new SessionDetailNotFoundError()
      if (!session.rollout_path || !existsSync(session.rollout_path)) {
        throw new CollectorUnavailableError("未发现该 Codex Session 的详情文件。")
      }

      const messages = codexMessages(
        session.rollout_path,
        assertTimestamp(session.created_at),
      )
      const offset = detailOffset(request.cursor)
      const items = messages.slice(offset, offset + request.limit)
      return detailPage(
        toSummary(session),
        items,
        offset,
        messages.length,
      )
    } catch (error) {
      if (error instanceof SessionDetailCursorError) throw error
      const message = error instanceof Error ? error.message : String(error)
      if (
        message.includes("no such table") ||
        message.includes("no such column")
      ) {
        throw new UnsupportedCollectorDataError(
          "当前 Codex Session 详情格式暂不受支持。",
        )
      }
      throw error
    } finally {
      database.close()
    }
  }

  updateSessionTitle(input: SessionTitleUpdateInput): CollectedSessionSummary {
    if (!this.available) {
      throw new CollectorUnavailableError("未发现本机 Codex Session 数据。")
    }

    const database = new Database(this.databasePath, { strict: true })
    try {
      database.exec("PRAGMA busy_timeout = 5000")
      return database.transaction(() => {
        const select = database.query<SessionRow, [string]>(
          `SELECT
             id,
             title,
             cwd AS directory,
             COALESCE(created_at_ms, created_at * 1000) AS created_at,
             COALESCE(updated_at_ms, updated_at * 1000) AS updated_at,
             CASE
               WHEN archived = 1
               THEN COALESCE(archived_at * 1000, updated_at_ms, updated_at * 1000)
               ELSE NULL
             END AS archived_at
           FROM threads
           WHERE id = ? AND preview <> ''
             AND source IN ('cli', 'vscode', 'atlas', 'chatgpt')`,
        )
        const current = select.get(input.id)
        if (!current) throw new SessionTitleNotFoundError()
        if (
          normalizeTitle(current.title) !== input.expectedTitle ||
          current.updated_at !== input.expectedUpdatedAt
        ) {
          throw new SessionTitleConflictError()
        }

        database
          .query("UPDATE threads SET title = ? WHERE id = ?")
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
          "当前 Codex Session 数据格式暂不受支持。",
        )
      }
      throw error
    } finally {
      database.close()
    }
  }
}
