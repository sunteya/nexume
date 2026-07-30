import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { AlmaCollector } from "./alma"
import {
  CollectorUnavailableError,
  UnsupportedCollectorDataError,
} from "./opencode"
import { SessionTitleConflictError } from "./source"

const temporaryRoots: string[] = []

function timestamp(milliseconds: number): string {
  return new Date(milliseconds).toISOString()
}

function createDatabase(schema = true): string {
  const root = mkdtempSync(join(tmpdir(), "nexume-alma-"))
  const databasePath = join(root, "chat_threads.db")
  const database = new Database(databasePath, { create: true, strict: true })

  temporaryRoots.push(root)

  if (schema) {
    database.exec(`
      CREATE TABLE workspaces (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL
      );
      CREATE TABLE chat_threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        is_incognito INTEGER DEFAULT 0,
        workspace_id TEXT,
        parent_thread_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO workspaces (id, path)
      VALUES ('workspace-1', '/workspace/alma-project');
    `)

    const insert = database.query<
      void,
      [string, string, number, string | null, string, string]
    >(`
      INSERT INTO chat_threads (
        id,
        title,
        workspace_id,
        is_incognito,
        parent_thread_id,
        created_at,
        updated_at
      ) VALUES (?, ?, 'workspace-1', ?, ?, ?, ?)
    `)

    for (let index = 1; index <= 25; index += 1) {
      insert.run(
        `thread-${String(index).padStart(2, "0")}`,
        `Thread ${index}`,
        0,
        null,
        timestamp(index * 1_000),
        timestamp(index * 1_000),
      )
    }

    insert.run(
      "thread-20b",
      "Thread sharing a timestamp",
      0,
      null,
      timestamp(20_000),
      timestamp(20_000),
    )
    insert.run(
      "child",
      "Child",
      0,
      "thread-25",
      timestamp(30_000),
      timestamp(30_000),
    )
    insert.run(
      "incognito",
      "Incognito",
      1,
      null,
      timestamp(31_000),
      timestamp(31_000),
    )
  }

  database.close()
  return databasePath
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("AlmaCollector", () => {
  test("returns visible root sessions with workspace metadata", () => {
    const collector = new AlmaCollector({ databasePath: createDatabase() })
    const result = collector.readSessionPage({ mode: "reconcile", limit: 20 })

    expect(result.hasMore).toBe(true)
    expect(result.items).toHaveLength(20)
    expect(result.items[0]).toEqual({
      id: "thread-01",
      agent: "alma",
      title: "Thread 1",
      directory: "/workspace/alma-project",
      createdAt: 1_000,
      updatedAt: 1_000,
    })
    expect(result.items.some((session) => session.id === "child")).toBe(false)
    expect(result.items.some((session) => session.id === "incognito")).toBe(
      false,
    )
  })

  test("continues after a tied timestamp using the session id", () => {
    const collector = new AlmaCollector({ databasePath: createDatabase() })
    const first = collector.readSessionPage({ mode: "reconcile", limit: 20 })
    const result = collector.readSessionPage({
      mode: "incremental",
      limit: 20,
      checkpoint: first.checkpoint,
    })

    expect(result.hasMore).toBe(false)
    expect(result.items.map((session) => session.id)).toEqual([
      "thread-20b",
      "thread-21",
      "thread-22",
      "thread-23",
      "thread-24",
      "thread-25",
    ])
  })

  test("writes titles conditionally and detects title-only source changes", () => {
    const databasePath = createDatabase()
    const collector = new AlmaCollector({ databasePath })
    const initial = collector.readSessionPage({ mode: "reconcile", limit: 100 })
    const database = new Database(databasePath, { strict: true })
    database
      .query("UPDATE chat_threads SET title = ? WHERE id = ?")
      .run("Changed in Alma", "thread-01")
    database.close()

    const changed = collector.readSessionPage({
      mode: "incremental",
      checkpoint: initial.checkpoint,
      limit: 100,
    })
    expect(changed.items.find((item) => item.id === "thread-01")).toMatchObject(
      {
        title: "Changed in Alma",
        updatedAt: 1_000,
      },
    )

    const updated = collector.updateSessionTitle({
      id: "thread-01",
      title: "Changed in Nexume",
      expectedTitle: "Changed in Alma",
      expectedUpdatedAt: 1_000,
    })
    expect(updated).toMatchObject({
      title: "Changed in Nexume",
      updatedAt: 1_000,
    })
    expect(() =>
      collector.updateSessionTitle({
        id: "thread-01",
        title: "Stale overwrite",
        expectedTitle: "Changed in Alma",
        expectedUpdatedAt: 1_000,
      }),
    ).toThrow(SessionTitleConflictError)
  })

  test("reports a missing database", () => {
    const collector = new AlmaCollector({
      databasePath: "/path/that/does/not/exist.db",
    })

    expect(() =>
      collector.readSessionPage({ mode: "incremental", limit: 20 }),
    ).toThrow(CollectorUnavailableError)
  })

  test("reports an unsupported database schema", () => {
    const collector = new AlmaCollector({ databasePath: createDatabase(false) })

    expect(() =>
      collector.readSessionPage({ mode: "incremental", limit: 20 }),
    ).toThrow(UnsupportedCollectorDataError)
  })

  test("reports invalid timestamps", () => {
    const databasePath = createDatabase()
    const database = new Database(databasePath, { strict: true })
    database
      .query(
        "UPDATE chat_threads SET created_at = 'invalid' WHERE id = 'thread-01'",
      )
      .run()
    database.close()
    const collector = new AlmaCollector({ databasePath })

    expect(() =>
      collector.readSessionPage({ mode: "reconcile", limit: 20 }),
    ).toThrow(UnsupportedCollectorDataError)
  })
})
