import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  assertCollectorSessionQuery,
  type CollectedSessionSummary,
  type CollectorSessionBatch,
  type CollectorSessionQuery,
} from "@nexume/contracts";

interface SessionRow {
  id: string;
  title: string;
  directory: string;
  time_created: number;
  time_updated: number;
}

export interface OpenCodeCollectorOptions {
  databasePath?: string;
}

export class CollectorUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectorUnavailableError";
  }
}

export class UnsupportedCollectorDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedCollectorDataError";
  }
}

export function getOpenCodeDatabasePath(): string {
  return join(homedir(), ".local", "share", "opencode", "opencode.db");
}

export class OpenCodeCollector {
  readonly databasePath: string;

  constructor(options: OpenCodeCollectorOptions = {}) {
    this.databasePath = options.databasePath ?? getOpenCodeDatabasePath();
  }

  get available(): boolean {
    return existsSync(this.databasePath);
  }

  querySessions(query: CollectorSessionQuery): CollectorSessionBatch {
    assertCollectorSessionQuery(query);

    if (!this.available) {
      throw new CollectorUnavailableError(
        "未发现本机 OpenCode Session 数据。",
      );
    }

    const database = new Database(this.databasePath, {
      readonly: true,
      strict: true,
    });

    try {
      const conditions = [
        "parent_id IS NULL",
        "time_archived IS NULL",
        "time_updated <= ?",
      ];
      const parameters: Array<number | string> = [query.asOf];

      if (query.cursor) {
        conditions.push(
          "(time_updated < ? OR (time_updated = ? AND id > ?))",
        );
        parameters.push(
          query.cursor.updatedAt,
          query.cursor.updatedAt,
          query.cursor.id,
        );
      }

      parameters.push(query.limit + 1);
      const rows = database
        .query<SessionRow, Array<number | string>>(
          `SELECT id, title, directory, time_created, time_updated
           FROM session
           WHERE ${conditions.join(" AND ")}
           ORDER BY time_updated DESC, id ASC
           LIMIT ?`,
        )
        .all(...parameters);
      const hasMore = rows.length > query.limit;
      const items: CollectedSessionSummary[] = rows
        .slice(0, query.limit)
        .map((row) => ({
          id: row.id,
          agent: "opencode",
          title: row.title,
          directory: row.directory,
          createdAt: row.time_created,
          updatedAt: row.time_updated,
        }));

      return { items, hasMore };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("no such table") || message.includes("no such column")) {
        throw new UnsupportedCollectorDataError(
          "当前 OpenCode Session 数据格式暂不受支持。",
        );
      }

      throw error;
    } finally {
      database.close();
    }
  }
}
