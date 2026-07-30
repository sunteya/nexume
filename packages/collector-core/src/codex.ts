import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type {
  CollectedSessionSummary,
  SessionSyncCheckpoint,
} from "@nexume/contracts"

import {
  CollectorUnavailableError,
  UnsupportedCollectorDataError,
} from "./opencode"
import type {
  SessionSourcePage,
  SessionSourcePageRequest,
  SessionTitleUpdateInput,
  WritableCollectorDataSource,
} from "./source"
import {
  createSessionTitleFingerprint,
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

export class CodexCollector implements WritableCollectorDataSource {
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
