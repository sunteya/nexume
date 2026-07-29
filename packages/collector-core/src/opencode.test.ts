import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CollectorUnavailableError,
  OpenCodeCollector,
  UnsupportedCollectorDataError,
} from "./opencode";

const temporaryRoots: string[] = [];

function createDatabase(schema = true): string {
  const root = mkdtempSync(join(tmpdir(), "nexume-opencode-"));
  const databasePath = join(root, "opencode.db");
  const database = new Database(databasePath, { create: true, strict: true });

  temporaryRoots.push(root);

  if (schema) {
    database.exec(`
      CREATE TABLE session (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        directory TEXT NOT NULL,
        parent_id TEXT,
        time_created INTEGER NOT NULL,
        time_updated INTEGER NOT NULL,
        time_archived INTEGER
      );
    `);

    const insert = database.query<
      void,
      [string, string, string | null, number, number, number | null]
    >(`
      INSERT INTO session (
        id,
        title,
        parent_id,
        time_created,
        time_updated,
        time_archived,
        directory
      ) VALUES (?, ?, ?, ?, ?, ?, '/workspace/project')
    `);

    for (let index = 1; index <= 25; index += 1) {
      insert.run(
        `session-${String(index).padStart(2, "0")}`,
        `Session ${index}`,
        null,
        index * 100,
        index * 100,
        null,
      );
    }

    insert.run("child", "Child", "session-25", 3_000, 3_000, null);
    insert.run("archived", "Archived", null, 4_000, 4_000, 4_100);
  }

  database.close();
  return databasePath;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("OpenCodeCollector", () => {
  test("returns root sessions including archived data in incremental order", () => {
    const collector = new OpenCodeCollector({ databasePath: createDatabase() });
    const result = collector.readSessionPage({ mode: "reconcile", limit: 20 });

    expect(result.hasMore).toBe(true);
    expect(result.items).toHaveLength(20);
    expect(result.items[0]).toMatchObject({
      id: "session-01",
      agent: "opencode",
    });
    expect(result.items.some((session) => session.id === "child")).toBe(false);
  });

  test("continues strictly after an opaque checkpoint", () => {
    const collector = new OpenCodeCollector({ databasePath: createDatabase() });
    const result = collector.readSessionPage({
      mode: "incremental",
      limit: 20,
      checkpoint: {
        format: collector.checkpointFormat,
        value: JSON.stringify({ updatedAt: 2_000, id: "session-20" }),
      },
    });

    expect(result.hasMore).toBe(false);
    expect(result.items).toHaveLength(6);
    expect(result.items[0]?.id).toBe("session-21");
    expect(result.items.at(-1)).toMatchObject({
      id: "archived",
      archivedAt: 4_100,
    });
  });

  test("reports a missing database", () => {
    const collector = new OpenCodeCollector({
      databasePath: "/path/that/does/not/exist.db",
    });

    expect(() => collector.readSessionPage({ mode: "incremental", limit: 20 })).toThrow(
      CollectorUnavailableError,
    );
  });

  test("reports an unsupported database schema", () => {
    const collector = new OpenCodeCollector({
      databasePath: createDatabase(false),
    });

    expect(() => collector.readSessionPage({ mode: "incremental", limit: 20 })).toThrow(
      UnsupportedCollectorDataError,
    );
  });
});
