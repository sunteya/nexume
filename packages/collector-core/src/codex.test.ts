import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { CodexCollector, getCodexDatabasePath } from "./codex"
import {
  CollectorUnavailableError,
  UnsupportedCollectorDataError,
} from "./opencode"
import { SessionTitleConflictError } from "./source"

const temporaryRoots: string[] = []

function createDatabase(schema = true): string {
  const root = mkdtempSync(join(tmpdir(), "nexume-codex-"))
  const databasePath = join(root, "state_5.sqlite")
  const database = new Database(databasePath, { create: true, strict: true })

  temporaryRoots.push(root)

  if (schema) {
    database.exec(`
      CREATE TABLE threads (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        cwd TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        created_at_ms INTEGER,
        updated_at_ms INTEGER,
        archived INTEGER NOT NULL DEFAULT 0,
        archived_at INTEGER,
        preview TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL
      );
    `)

    const insert = database.query<
      void,
      [string, string, number, number, number, string, string]
    >(`
      INSERT INTO threads (
        id,
        title,
        cwd,
        created_at,
        updated_at,
        updated_at_ms,
        preview,
        source
      ) VALUES (?, ?, '/workspace/codex-project', ?, ?, ?, ?, ?)
    `)

    for (let index = 1; index <= 25; index += 1) {
      insert.run(
        `thread-${String(index).padStart(2, "0")}`,
        `Thread ${index}`,
        index,
        index,
        index * 1_000,
        `Preview ${index}`,
        index === 25 ? "chatgpt" : "cli",
      )
    }

    insert.run(
      "thread-20b",
      "Thread sharing a timestamp",
      20,
      20,
      20_000,
      "Tied preview",
      "vscode",
    )
    insert.run(
      "atlas-thread",
      "Atlas thread",
      30,
      30,
      30_000,
      "Atlas preview",
      "atlas",
    )
    insert.run(
      "internal-thread",
      "Internal thread",
      31,
      31,
      31_000,
      "Internal preview",
      '{"subagent":{"other":"guardian"}}',
    )
    insert.run("empty-thread", "Empty thread", 32, 32, 32_000, "", "cli")
    database.exec(`
      UPDATE threads
      SET archived = 1, archived_at = 40
      WHERE id = 'atlas-thread';
    `)
  }

  database.close()
  return databasePath
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("CodexCollector", () => {
  test("returns visible interactive sessions from Codex and ChatGPT sources", () => {
    const collector = new CodexCollector({ databasePath: createDatabase() })
    const result = collector.readSessionPage({ mode: "reconcile", limit: 20 })

    expect(result.hasMore).toBe(true)
    expect(result.items).toHaveLength(20)
    expect(result.items[0]).toEqual({
      id: "thread-01",
      agent: "codex",
      title: "Thread 1",
      directory: "/workspace/codex-project",
      createdAt: 1_000,
      updatedAt: 1_000,
    })
  })

  test("continues after a tied millisecond timestamp", () => {
    const collector = new CodexCollector({ databasePath: createDatabase() })
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
      "atlas-thread",
    ])
    expect(result.items.at(-1)).toMatchObject({
      id: "atlas-thread",
      archivedAt: 40_000,
    })
    expect(
      result.items.some((session) => session.id === "internal-thread"),
    ).toBe(false)
    expect(result.items.some((session) => session.id === "empty-thread")).toBe(
      false,
    )
  })

  test("truncates titles that exceed the session contract limit", () => {
    const databasePath = createDatabase()
    const database = new Database(databasePath, { strict: true })
    database
      .query("UPDATE threads SET title = ? WHERE id = 'thread-01'")
      .run(`${"a".repeat(4_092)}😀${"b".repeat(1_000)}`)
    database.close()

    const collector = new CodexCollector({ databasePath })
    const result = collector.readSessionPage({ mode: "reconcile", limit: 20 })
    const title = result.items[0]?.title

    expect(title).toHaveLength(4_095)
    expect(title?.endsWith("...")).toBe(true)
    expect(title?.includes("�")).toBe(false)
  })

  test("writes titles conditionally and detects title-only source changes", () => {
    const databasePath = createDatabase()
    const collector = new CodexCollector({ databasePath })
    const initial = collector.readSessionPage({ mode: "reconcile", limit: 100 })
    const database = new Database(databasePath, { strict: true })
    database
      .query("UPDATE threads SET title = ? WHERE id = ?")
      .run("Changed in Codex", "thread-01")
    database.close()

    const changed = collector.readSessionPage({
      mode: "incremental",
      checkpoint: initial.checkpoint,
      limit: 100,
    })
    expect(changed.items.find((item) => item.id === "thread-01")).toMatchObject(
      {
        title: "Changed in Codex",
        updatedAt: 1_000,
      },
    )

    const updated = collector.updateSessionTitle({
      id: "thread-01",
      title: "Changed in Nexume",
      expectedTitle: "Changed in Codex",
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
        expectedTitle: "Changed in Codex",
        expectedUpdatedAt: 1_000,
      }),
    ).toThrow(SessionTitleConflictError)
  })

  test("uses CODEX_HOME for the default database path", () => {
    const databasePath = createDatabase()
    const codexHome = dirname(databasePath)
    const previous = process.env.CODEX_HOME
    process.env.CODEX_HOME = codexHome
    try {
      expect(getCodexDatabasePath()).toBe(databasePath)
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previous
    }
  })

  test("falls back when CODEX_HOME has no state database", () => {
    const previous = process.env.CODEX_HOME
    process.env.CODEX_HOME = "/custom/codex-home-without-state"
    try {
      expect(getCodexDatabasePath()).toBe(
        join(homedir(), ".codex", "state_5.sqlite"),
      )
    } finally {
      if (previous === undefined) delete process.env.CODEX_HOME
      else process.env.CODEX_HOME = previous
    }
  })

  test("reports a missing database", () => {
    const collector = new CodexCollector({
      databasePath: "/path/that/does/not/exist.db",
    })

    expect(() =>
      collector.readSessionPage({ mode: "incremental", limit: 20 }),
    ).toThrow(CollectorUnavailableError)
  })

  test("reports an unsupported database schema", () => {
    const collector = new CodexCollector({
      databasePath: createDatabase(false),
    })

    expect(() =>
      collector.readSessionPage({ mode: "incremental", limit: 20 }),
    ).toThrow(UnsupportedCollectorDataError)
  })
})
