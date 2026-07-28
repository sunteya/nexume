import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  sessionPageSizes,
  type ListOpenCodeSessionsParams,
  type OpenCodeSessionPage,
  type OpenCodeSessionSummary,
  type SessionPageSize,
} from "../shared/desktop-rpc";

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

export function getOpenCodeDatabasePath(): string {
  return join(homedir(), ".local", "share", "opencode", "opencode.db");
}

function assertPageParams(
  params: ListOpenCodeSessionsParams,
): asserts params is { page: number; pageSize: SessionPageSize } {
  if (!Number.isInteger(params.page) || params.page < 1) {
    throw new Error("Session 页码无效。");
  }

  if (!sessionPageSizes.includes(params.pageSize)) {
    throw new Error("Session 每页数量无效。");
  }
}

export function listOpenCodeSessions(
  params: ListOpenCodeSessionsParams,
  databasePath = getOpenCodeDatabasePath(),
): OpenCodeSessionPage {
  assertPageParams(params);

  if (!existsSync(databasePath)) {
    throw new Error("未发现本机 OpenCode Session 数据。");
  }

  const database = new Database(databasePath, {
    readonly: true,
    strict: true,
  });

  try {
    const filters = "parent_id IS NULL AND time_archived IS NULL";
    const count = database
      .query<CountRow, []>(`SELECT COUNT(*) AS total FROM session WHERE ${filters}`)
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

    const items: OpenCodeSessionSummary[] = rows.map((row) => ({
      id: row.id,
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
      throw new Error("当前 OpenCode Session 数据格式暂不受支持。");
    }

    throw error;
  } finally {
    database.close();
  }
}
