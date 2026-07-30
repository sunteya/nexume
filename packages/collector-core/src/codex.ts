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
  CollectorDataSource,
  SessionSourcePage,
  SessionSourcePageRequest,
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

function encodePosition(row: SessionRow): SessionSyncCheckpoint {
  return {
    format: "codex/sqlite/v1",
    value: JSON.stringify({ updatedAt: row.updated_at, id: row.id }),
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

export class CodexCollector implements CollectorDataSource {
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

    const position = decodePosition(request.checkpoint)
    const database = new Database(this.databasePath, {
      readonly: true,
      strict: true,
    })

    try {
      database.exec("PRAGMA busy_timeout = 5000; PRAGMA query_only = ON")

      const conditions = [
        "preview <> ''",
        "source IN ('cli', 'vscode', 'atlas', 'chatgpt')",
      ]
      const parameters: Array<number | string> = []
      if (position) {
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
      const items: CollectedSessionSummary[] = selected.map((row) => ({
        id: row.id,
        agent: this.agent,
        title: normalizeTitle(row.title),
        directory: row.directory,
        createdAt: assertTimestamp(row.created_at),
        updatedAt: assertTimestamp(row.updated_at),
        ...(row.archived_at === null
          ? {}
          : { archivedAt: assertTimestamp(row.archived_at) }),
      }))
      const last = selected.at(-1)
      return {
        items,
        checkpoint: last
          ? encodePosition(last)
          : (request.checkpoint ?? {
              format: this.checkpointFormat,
              value: JSON.stringify({ updatedAt: 0, id: "" }),
            }),
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
}
