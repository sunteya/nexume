import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type {
  CollectedSessionSummary,
  SessionSyncCheckpoint,
} from "@nexume/contracts";

import {
  CollectorUnavailableError,
  UnsupportedCollectorDataError,
} from "./opencode";
import type {
  CollectorDataSource,
  SessionSourcePage,
  SessionSourcePageRequest,
} from "./source";

interface SessionRow {
  id: string;
  title: string;
  directory: string;
  created_at: string;
  updated_at: string;
}

interface AlmaPosition {
  updatedAt: string;
  id: string;
}

export interface AlmaCollectorOptions {
  databasePath?: string;
}

export function getAlmaDatabasePath(): string {
  return join(
    homedir(),
    "Library",
    "Application Support",
    "alma",
    "chat_threads.db",
  );
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return (
    Number.isSafeInteger(timestamp) &&
    timestamp >= 0 &&
    new Date(timestamp).toISOString() === value
  );
}

function parseTimestamp(value: string): number {
  if (!isCanonicalTimestamp(value)) {
    throw new UnsupportedCollectorDataError(
      "当前 Alma Session 数据包含无效时间。",
    );
  }
  return Date.parse(value);
}

function decodePosition(
  checkpoint: SessionSyncCheckpoint | undefined,
): AlmaPosition | undefined {
  if (!checkpoint) return undefined;
  if (checkpoint.format !== "alma/sqlite/v1") {
    throw new Error("Alma checkpoint 格式不受支持。");
  }
  try {
    const position = JSON.parse(checkpoint.value) as Partial<AlmaPosition>;
    if (!isCanonicalTimestamp(position.updatedAt) || typeof position.id !== "string") {
      throw new Error();
    }
    return position as AlmaPosition;
  } catch {
    throw new Error("Alma checkpoint 内容无效。");
  }
}

function encodePosition(row: SessionRow): SessionSyncCheckpoint {
  return {
    format: "alma/sqlite/v1",
    value: JSON.stringify({ updatedAt: row.updated_at, id: row.id }),
  };
}

export class AlmaCollector implements CollectorDataSource {
  readonly agent = "alma";
  readonly checkpointFormat = "alma/sqlite/v1";
  readonly databasePath: string;

  constructor(options: AlmaCollectorOptions = {}) {
    this.databasePath = options.databasePath ?? getAlmaDatabasePath();
  }

  get available(): boolean {
    return existsSync(this.databasePath);
  }

  readSessionPage(request: SessionSourcePageRequest): SessionSourcePage {
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0) {
      throw new Error("Session 同步批量无效。");
    }
    if (!this.available) {
      throw new CollectorUnavailableError("未发现本机 Alma Session 数据。");
    }

    const position = decodePosition(request.checkpoint);
    const database = new Database(this.databasePath, {
      readonly: true,
      strict: true,
    });

    try {
      const conditions = [
        "t.parent_thread_id IS NULL",
        "t.is_incognito = 0",
      ];
      const parameters: Array<number | string> = [];
      if (position) {
        conditions.push(
          "(t.updated_at > ? OR (t.updated_at = ? AND t.id > ?))",
        );
        parameters.push(position.updatedAt, position.updatedAt, position.id);
      }
      parameters.push(request.limit + 1);

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
        .all(...parameters);
      const selected = rows.slice(0, request.limit);
      const items: CollectedSessionSummary[] = selected.map((row) => ({
        id: row.id,
        agent: this.agent,
        title: row.title,
        directory: row.directory,
        createdAt: parseTimestamp(row.created_at),
        updatedAt: parseTimestamp(row.updated_at),
      }));
      const last = selected.at(-1);
      return {
        items,
        checkpoint: last
          ? encodePosition(last)
          : request.checkpoint ?? {
              format: this.checkpointFormat,
              value: JSON.stringify({
                updatedAt: "1970-01-01T00:00:00.000Z",
                id: "",
              }),
            },
        hasMore: rows.length > request.limit,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("no such table") || message.includes("no such column")) {
        throw new UnsupportedCollectorDataError(
          "当前 Alma Session 数据格式暂不受支持。",
        );
      }
      throw error;
    } finally {
      database.close();
    }
  }
}
