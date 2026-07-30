import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  CollectorUnavailableError,
  OpenCodeCollector,
  UnsupportedCollectorDataError,
} from "./opencode"
import { SessionTitleConflictError } from "./source"

const temporaryRoots: string[] = []

function createDatabase(schema = true): string {
  const root = mkdtempSync(join(tmpdir(), "nexume-opencode-"))
  const databasePath = join(root, "opencode.db")
  const database = new Database(databasePath, { create: true, strict: true })

  temporaryRoots.push(root)

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
    `)

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
    `)

    for (let index = 1; index <= 25; index += 1) {
      insert.run(
        `session-${String(index).padStart(2, "0")}`,
        `Session ${index}`,
        null,
        index * 100,
        index * 100,
        null,
      )
    }

    insert.run("child", "Child", "session-25", 3_000, 3_000, null)
    insert.run("archived", "Archived", null, 4_000, 4_000, 4_100)
  }

  database.close()
  return databasePath
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("OpenCodeCollector", () => {
  test("returns root sessions including archived data in incremental order", () => {
    const collector = new OpenCodeCollector({ databasePath: createDatabase() })
    const result = collector.readSessionPage({ mode: "reconcile", limit: 20 })

    expect(result.hasMore).toBe(true)
    expect(result.items).toHaveLength(20)
    expect(result.items[0]).toMatchObject({
      id: "session-01",
      agent: "opencode",
    })
    expect(result.items.some((session) => session.id === "child")).toBe(false)
  })

  test("continues strictly after an opaque checkpoint", () => {
    const collector = new OpenCodeCollector({ databasePath: createDatabase() })
    const first = collector.readSessionPage({ mode: "reconcile", limit: 20 })
    const result = collector.readSessionPage({
      mode: "incremental",
      limit: 20,
      checkpoint: first.checkpoint,
    })

    expect(result.hasMore).toBe(false)
    expect(result.items).toHaveLength(6)
    expect(result.items[0]?.id).toBe("session-21")
    expect(result.items.at(-1)).toMatchObject({
      id: "archived",
      archivedAt: 4_100,
    })
  })

  test("writes titles conditionally and detects title-only source changes", () => {
    const databasePath = createDatabase()
    const collector = new OpenCodeCollector({ databasePath })
    const initial = collector.readSessionPage({ mode: "reconcile", limit: 100 })
    const database = new Database(databasePath, { strict: true })
    database
      .query("UPDATE session SET title = ? WHERE id = ?")
      .run("Changed in OpenCode", "session-01")
    database.close()

    const changed = collector.readSessionPage({
      mode: "incremental",
      checkpoint: initial.checkpoint,
      limit: 100,
    })
    expect(
      changed.items.find((item) => item.id === "session-01"),
    ).toMatchObject({ title: "Changed in OpenCode", updatedAt: 100 })

    const updated = collector.updateSessionTitle({
      id: "session-01",
      title: "Changed in Nexume",
      expectedTitle: "Changed in OpenCode",
      expectedUpdatedAt: 100,
    })
    expect(updated).toMatchObject({
      title: "Changed in Nexume",
      updatedAt: 100,
    })
    expect(() =>
      collector.updateSessionTitle({
        id: "session-01",
        title: "Stale overwrite",
        expectedTitle: "Changed in OpenCode",
        expectedUpdatedAt: 100,
      }),
    ).toThrow(SessionTitleConflictError)
  })

  test("reports a missing database", () => {
    const collector = new OpenCodeCollector({
      databasePath: "/path/that/does/not/exist.db",
    })

    expect(() =>
      collector.readSessionPage({ mode: "incremental", limit: 20 }),
    ).toThrow(CollectorUnavailableError)
  })

  test("reports an unsupported database schema", () => {
    const collector = new OpenCodeCollector({
      databasePath: createDatabase(false),
    })

    expect(() =>
      collector.readSessionPage({ mode: "incremental", limit: 20 }),
    ).toThrow(UnsupportedCollectorDataError)
  })
})
