import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  assertListSessionsParams,
  type ListSessionsParams,
  type SessionPage,
  type SessionSummary,
} from "@nexume/contracts";

interface CountRow {
  total: number;
}

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

  listSessions(params: ListSessionsParams): SessionPage {
    assertListSessionsParams(params);

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
      const filters = "parent_id IS NULL AND time_archived IS NULL";
      const count = database
        .query<CountRow, []>(
          `SELECT COUNT(*) AS total FROM session WHERE ${filters}`,
        )
        .get();
      const total = count?.total ?? 0;
      const lastPage = Math.max(1, Math.ceil(total / params.pageSize));
      const page = Math.min(params.page, lastPage);
      const offset = (page - 1) * params.pageSize;
      const rows = database
        .query<SessionRow, [number, number]>(
          `SELECT id, title, directory, time_created, time_updated
           FROM session
           WHERE ${filters}
           ORDER BY time_updated DESC
           LIMIT ? OFFSET ?`,
        )
        .all(params.pageSize, offset);

      const items: SessionSummary[] = rows.map((row) => ({
        id: row.id,
        agent: "opencode",
        title: row.title,
        directory: row.directory,
        createdAt: row.time_created,
        updatedAt: row.time_updated,
      }));

      return {
        items,
        page,
        pageSize: params.pageSize,
        total,
      };
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
