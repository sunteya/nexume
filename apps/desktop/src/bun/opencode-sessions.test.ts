import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { listOpenCodeSessions } from "./opencode-sessions";

const temporaryRoots: string[] = [];

function createDatabase(): string {
  const root = mkdtempSync(join(tmpdir(), "nexume-opencode-"));
  const databasePath = join(root, "opencode.db");
  const database = new Database(databasePath, { create: true, strict: true });

  temporaryRoots.push(root);
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
      directory,
      parent_id,
      time_created,
      time_updated,
      time_archived
    ) VALUES (?, ?, '/workspace/project', ?, ?, ?, ?)
  `);

  for (let index = 1; index <= 25; index += 1) {
    insert.run(
      `session-${index}`,
      `Session ${index}`,
      null,
      index * 100,
      index * 100,
      null,
    );
  }

  insert.run("child", "Child", "session-25", 3_000, 3_000, null);
  insert.run("archived", "Archived", null, 4_000, 4_000, 4_100);
  database.close();

  return databasePath;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("listOpenCodeSessions", () => {
  test("returns only active root sessions in updated order", () => {
    const databasePath = createDatabase();
    const result = listOpenCodeSessions(
      { page: 1, pageSize: 20 },
      databasePath,
    );

    expect(result.total).toBe(25);
    expect(result.items).toHaveLength(20);
    expect(result.items[0]?.id).toBe("session-25");
    expect(result.items.some((session) => session.id === "child")).toBe(false);
    expect(result.items.some((session) => session.id === "archived")).toBe(
      false,
    );
  });

  test("returns the last valid page when the requested page is out of range", () => {
    const databasePath = createDatabase();
    const result = listOpenCodeSessions(
      { page: 99, pageSize: 20 },
      databasePath,
    );

    expect(result.page).toBe(2);
    expect(result.items).toHaveLength(5);
    expect(result.items.at(-1)?.id).toBe("session-1");
  });
});
