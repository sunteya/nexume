import type { Database, SQLQueryBindings } from "bun:sqlite";

export type AgentId = string;
export type SessionStatus = "active" | "archived" | "deleted";

export interface SessionKey {
  collectorId: string;
  agent: AgentId;
  sourceId: string;
}

export interface SessionRecord extends SessionKey {
  title: string;
  directory: string;
  sourceCreatedAt: number;
  sourceUpdatedAt: number;
  sourceArchivedAt: number | null;
  deletedAt: number | null;
  firstSeenAt: number;
  lastSyncedAt: number;
  lastReconcileId: string | null;
}

export interface SessionListCursor extends SessionKey {
  sourceUpdatedAt: number;
}

export interface ListSessionsOptions {
  collectorId?: string;
  agent?: AgentId;
  title?: string;
  status?: SessionStatus;
  limit: number;
  cursor?: SessionListCursor;
}

export interface SessionListResult {
  items: SessionRecord[];
  hasMore: boolean;
  nextCursor?: SessionListCursor;
}

interface SessionRow {
  collector_id: string;
  agent: string;
  source_id: string;
  title: string;
  directory: string;
  source_created_at: number;
  source_updated_at: number;
  source_archived_at: number | null;
  deleted_at: number | null;
  first_seen_at: number;
  last_synced_at: number;
  last_reconcile_id: string | null;
}

function fromRow(row: SessionRow): SessionRecord {
  return {
    collectorId: row.collector_id,
    agent: row.agent,
    sourceId: row.source_id,
    title: row.title,
    directory: row.directory,
    sourceCreatedAt: row.source_created_at,
    sourceUpdatedAt: row.source_updated_at,
    sourceArchivedAt: row.source_archived_at,
    deletedAt: row.deleted_at,
    firstSeenAt: row.first_seen_at,
    lastSyncedAt: row.last_synced_at,
    lastReconcileId: row.last_reconcile_id,
  };
}

function toCursor(session: SessionRecord): SessionListCursor {
  return {
    sourceUpdatedAt: session.sourceUpdatedAt,
    collectorId: session.collectorId,
    agent: session.agent,
    sourceId: session.sourceId,
  };
}

export class SessionStore {
  constructor(private readonly db: Database) {}

  get(key: SessionKey): SessionRecord | undefined {
    const row = this.db
      .query<SessionRow, [string, string, string]>(
        `SELECT * FROM sessions
         WHERE collector_id = ? AND agent = ? AND source_id = ?`,
      )
      .get(key.collectorId, key.agent, key.sourceId);
    return row ? fromRow(row) : undefined;
  }

  list(options: ListSessionsOptions): SessionListResult {
    if (!Number.isSafeInteger(options.limit) || options.limit <= 0) {
      throw new Error("Session list limit must be a positive safe integer.");
    }

    const conditions: string[] = [];
    const bindings: SQLQueryBindings[] = [];
    if (options.collectorId !== undefined) {
      conditions.push("collector_id = ?");
      bindings.push(options.collectorId);
    }
    if (options.agent !== undefined) {
      conditions.push("agent = ?");
      bindings.push(options.agent);
    }
    if (options.title !== undefined) {
      conditions.push("instr(lower(title), lower(?)) > 0");
      bindings.push(options.title);
    }

    const status = options.status ?? "active";
    if (status === "active") {
      conditions.push("source_archived_at IS NULL", "deleted_at IS NULL");
    } else if (status === "archived") {
      conditions.push("source_archived_at IS NOT NULL", "deleted_at IS NULL");
    } else if (status === "deleted") {
      conditions.push("deleted_at IS NOT NULL");
    } else {
      throw new Error(`Unsupported session status: ${String(status)}`);
    }

    if (options.cursor) {
      conditions.push(`(
        source_updated_at < ? OR
        (source_updated_at = ? AND collector_id > ?) OR
        (source_updated_at = ? AND collector_id = ? AND agent > ?) OR
        (source_updated_at = ? AND collector_id = ? AND agent = ? AND source_id > ?)
      )`);
      bindings.push(
        options.cursor.sourceUpdatedAt,
        options.cursor.sourceUpdatedAt,
        options.cursor.collectorId,
        options.cursor.sourceUpdatedAt,
        options.cursor.collectorId,
        options.cursor.agent,
        options.cursor.sourceUpdatedAt,
        options.cursor.collectorId,
        options.cursor.agent,
        options.cursor.sourceId,
      );
    }

    bindings.push(options.limit + 1);
    const rows = this.db
      .query<SessionRow, SQLQueryBindings[]>(
        `SELECT * FROM sessions
         WHERE ${conditions.join(" AND ")}
         ORDER BY source_updated_at DESC, collector_id ASC, agent ASC, source_id ASC
         LIMIT ?`,
      )
      .all(...bindings);
    const hasMore = rows.length > options.limit;
    const items = rows.slice(0, options.limit).map(fromRow);
    const last = items.at(-1);

    return {
      items,
      hasMore,
      ...(hasMore && last ? { nextCursor: toCursor(last) } : {}),
    };
  }
}
