import { Database } from "bun:sqlite"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import type {
  CollectedSessionSummary,
  SessionSyncCheckpoint,
} from "@nexume/contracts"

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
  time_created: number
  time_updated: number
  time_archived: number | null
}

interface OpenCodePosition {
  updatedAt: number
  id: string
  titleFingerprint?: string
  fullScan?: boolean
}

interface TitleRow {
  id: string
  title: string
}

export interface OpenCodeCollectorOptions {
  databasePath?: string
}

export class CollectorUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "CollectorUnavailableError"
  }
}

export class UnsupportedCollectorDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UnsupportedCollectorDataError"
  }
}

export function getOpenCodeDatabasePath(): string {
  return join(homedir(), ".local", "share", "opencode", "opencode.db")
}

function decodePosition(
  checkpoint: SessionSyncCheckpoint | undefined,
): OpenCodePosition | undefined {
  if (!checkpoint) return undefined
  if (checkpoint.format !== "opencode/sqlite/v1") {
    throw new Error("OpenCode checkpoint 格式不受支持。")
  }
  try {
    const position = JSON.parse(checkpoint.value) as Partial<OpenCodePosition>
    if (
      !Number.isSafeInteger(position.updatedAt) ||
      typeof position.id !== "string"
    ) {
      throw new Error()
    }
    return position as OpenCodePosition
  } catch {
    throw new Error("OpenCode checkpoint 内容无效。")
  }
}

function encodePosition(
  row: Pick<SessionRow, "time_updated" | "id">,
  titleFingerprint: string,
  fullScan = false,
): SessionSyncCheckpoint {
  return {
    format: "opencode/sqlite/v1",
    value: JSON.stringify({
      updatedAt: row.time_updated,
      id: row.id,
      titleFingerprint,
      ...(fullScan ? { fullScan: true } : {}),
    }),
  }
}

function toSummary(row: SessionRow): CollectedSessionSummary {
  return {
    id: row.id,
    agent: "opencode",
    title: row.title,
    directory: row.directory,
    createdAt: row.time_created,
    updatedAt: row.time_updated,
    ...(row.time_archived === null ? {} : { archivedAt: row.time_archived }),
  }
}

export class OpenCodeCollector implements WritableCollectorDataSource {
  readonly agent = "opencode"
  readonly checkpointFormat = "opencode/sqlite/v1"
  readonly databasePath: string

  constructor(options: OpenCodeCollectorOptions = {}) {
    this.databasePath = options.databasePath ?? getOpenCodeDatabasePath()
  }

  get available(): boolean {
    return existsSync(this.databasePath)
  }

  readSessionPage(request: SessionSourcePageRequest): SessionSourcePage {
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0) {
      throw new Error("Session 同步批量无效。")
    }
    if (!this.available) {
      throw new CollectorUnavailableError("未发现本机 OpenCode Session 数据。")
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
            "SELECT id, title FROM session WHERE parent_id IS NULL",
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
      const conditions = ["parent_id IS NULL"]
      const parameters: Array<number | string> = []
      if (position && (continuingFullScan || !fullScan)) {
        conditions.push("(time_updated > ? OR (time_updated = ? AND id > ?))")
        parameters.push(position.updatedAt, position.updatedAt, position.id)
      }
      parameters.push(request.limit + 1)

      const rows = database
        .query<SessionRow, Array<number | string>>(
          `SELECT id, title, directory, time_created, time_updated, time_archived
           FROM session
           WHERE ${conditions.join(" AND ")}
           ORDER BY time_updated ASC, id ASC
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
          "当前 OpenCode Session 数据格式暂不受支持。",
        )
      }
      throw error
    } finally {
      database.close()
    }
  }

  updateSessionTitle(input: SessionTitleUpdateInput): CollectedSessionSummary {
    if (!this.available) {
      throw new CollectorUnavailableError("未发现本机 OpenCode Session 数据。")
    }

    const database = new Database(this.databasePath, { strict: true })
    try {
      database.exec("PRAGMA busy_timeout = 5000")
      return database.transaction(() => {
        const select = database.query<SessionRow, [string]>(
          `SELECT id, title, directory, time_created, time_updated, time_archived
           FROM session
           WHERE id = ? AND parent_id IS NULL`,
        )
        const current = select.get(input.id)
        if (!current) throw new SessionTitleNotFoundError()
        if (
          current.title !== input.expectedTitle ||
          current.time_updated !== input.expectedUpdatedAt
        ) {
          throw new SessionTitleConflictError()
        }

        database
          .query("UPDATE session SET title = ? WHERE id = ?")
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
          "当前 OpenCode Session 数据格式暂不受支持。",
        )
      }
      throw error
    } finally {
      database.close()
    }
  }
}
