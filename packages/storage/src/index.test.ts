import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  AlreadyInitializedError,
  defineMigration,
  openStorage,
  runMigrations,
} from "./index"
import { migrations } from "./migrations"

const temporaryDirectories: string[] = []

function createDataDir(): string {
  const path = mkdtempSync(join(tmpdir(), "nexume-storage-"))
  temporaryDirectories.push(path)
  return path
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe("Nexume storage", () => {
  test("runs SQL migrations once and records them", async () => {
    const dataDir = createDataDir()
    const first = await openStorage({ dataDir })

    expect(
      first.db
        .query<{ name: string }, []>(
          "SELECT name FROM system_migrations ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: "0001_initial" },
      { name: "0002_collectors" },
      { name: "0003_sessions" },
      { name: "0004_projects" },
      { name: "0005_project_groups" },
    ])
    expect(
      first.db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'",
        )
        .get(),
    ).toEqual({ name: "settings" })
    first.close()

    const second = await openStorage({ dataDir })
    expect(
      second.db
        .query<{ count: number }, []>(
          "SELECT count(*) AS count FROM system_migrations",
        )
        .get(),
    ).toEqual({ count: 5 })
    second.close()
  })

  test("persists initialization state", async () => {
    const dataDir = createDataDir()
    const first = await openStorage({ dataDir })

    expect(first.initialization.getStatus()).toEqual({ initialized: false })
    const completed = first.initialization.complete()
    expect(completed.initialized).toBe(true)
    expect(completed.initializedAt).toBeInteger()
    expect(() => first.initialization.complete()).toThrow(
      AlreadyInitializedError,
    )
    first.close()

    const second = await openStorage({ dataDir })
    expect(second.initialization.getStatus()).toEqual(completed)
    second.close()
  })

  test("runs TypeScript migrations with cache directory access", async () => {
    const storage = await openStorage({ dataDir: createDataDir() })
    const markerPath = join(storage.cacheDir, "migrated.txt")
    const cacheMigration = defineMigration({
      name: "0002_cache_marker",
      async up({ context }) {
        writeFileSync(join(context.cacheDir, "migrated.txt"), "migrated")
      },
    })
    const context = {
      db: storage.db,
      dataDir: storage.dataDir,
      cacheDir: storage.cacheDir,
    }

    await runMigrations(context, [...migrations, cacheMigration])
    await runMigrations(context, [...migrations, cacheMigration])

    expect(existsSync(markerPath)).toBe(true)
    expect(
      storage.db
        .query<{ count: number }, [string]>(
          "SELECT count(*) AS count FROM system_migrations WHERE name = ?",
        )
        .get(cacheMigration.name),
    ).toEqual({ count: 1 })
    storage.close()
  })

  test("rolls back database changes when a migration fails", async () => {
    const storage = await openStorage({ dataDir: createDataDir() })
    const failedMigration = defineMigration({
      name: "0002_failed",
      async up({ context }) {
        context.db.exec("CREATE TABLE incomplete_data (id INTEGER PRIMARY KEY)")
        throw new Error("migration failed")
      },
    })
    const context = {
      db: storage.db,
      dataDir: storage.dataDir,
      cacheDir: storage.cacheDir,
    }

    await expect(
      runMigrations(context, [...migrations, failedMigration]),
    ).rejects.toThrow("migration failed")
    expect(
      storage.db
        .query<{ count: number }, []>(
          `SELECT count(*) AS count FROM sqlite_master
           WHERE type = 'table' AND name = 'incomplete_data'`,
        )
        .get(),
    ).toEqual({ count: 0 })
    expect(
      storage.db
        .query<{ count: number }, [string]>(
          "SELECT count(*) AS count FROM system_migrations WHERE name = ?",
        )
        .get(failedMigration.name),
    ).toEqual({ count: 0 })
    storage.close()
  })
})
