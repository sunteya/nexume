import type { Database } from "bun:sqlite";

import type { CollectorConnectionType } from "@nexume/contracts";

import type { AgentId } from "./session";

export interface CollectorRuntime {
  hostname: string | null;
  version: string | null;
  agents: AgentId[] | null;
  connectedAt: number | null;
  lastSeenAt: number | null;
}

export interface CollectorRecord extends CollectorRuntime {
  id: string;
  name: string;
  connectionType: CollectorConnectionType;
  token: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateCollectorInput {
  id: string;
  name: string;
  connectionType: CollectorConnectionType;
  token?: string | null;
}

interface CollectorRow {
  id: string;
  name: string;
  connection_type: CollectorConnectionType;
  token: string | null;
  hostname: string | null;
  version: string | null;
  agents: string | null;
  connected_at: number | null;
  last_seen_at: number | null;
  created_at: number;
  updated_at: number;
}

function cloneAgents(agents: AgentId[] | null): AgentId[] | null {
  return agents ? [...agents] : null;
}

function fromRow(row: CollectorRow): CollectorRecord {
  const agents = row.agents
    ? (JSON.parse(row.agents) as AgentId[])
    : null;

  return {
    id: row.id,
    name: row.name,
    connectionType: row.connection_type,
    token: row.token,
    hostname: row.hostname,
    version: row.version,
    agents: cloneAgents(agents),
    connectedAt: row.connected_at,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class CollectorStore {
  constructor(private readonly db: Database) {}

  list(): CollectorRecord[] {
    return this.db
      .query<CollectorRow, []>(
        "SELECT * FROM collectors ORDER BY connection_type ASC, name ASC, id ASC",
      )
      .all()
      .map(fromRow);
  }

  get(id: string): CollectorRecord | undefined {
    const row = this.db
      .query<CollectorRow, [string]>("SELECT * FROM collectors WHERE id = ?")
      .get(id);
    return row ? fromRow(row) : undefined;
  }

  create(input: CreateCollectorInput): CollectorRecord {
    const now = Date.now();
    const token = input.connectionType === "local" ? null : input.token ?? null;

    this.db
      .query(
        `INSERT INTO collectors (
           id, name, connection_type,
           token,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.name,
        input.connectionType,
        token,
        now,
        now,
      );

    return this.get(input.id)!;
  }

  updateName(id: string, name: string): CollectorRecord | undefined {
    const result = this.db
      .query(
        "UPDATE collectors SET name = ?, updated_at = ? WHERE id = ?",
      )
      .run(name, Date.now(), id);
    return result.changes === 0 ? undefined : this.get(id);
  }

  updateRuntime(
    id: string,
    runtime: CollectorRuntime,
  ): CollectorRecord | undefined {
    const result = this.db
      .query(
        `UPDATE collectors SET
           hostname = ?,
           version = ?,
           agents = ?,
           connected_at = ?,
           last_seen_at = ?,
           updated_at = ?
         WHERE id = ?`,
      )
      .run(
        runtime.hostname,
        runtime.version,
        runtime.agents === null ? null : JSON.stringify(runtime.agents),
        runtime.connectedAt,
        runtime.lastSeenAt,
        Date.now(),
        id,
      );
    return result.changes === 0 ? undefined : this.get(id);
  }

  delete(id: string): boolean {
    return this.db
      .query("DELETE FROM collectors WHERE id = ?")
      .run(id).changes > 0;
  }
}
