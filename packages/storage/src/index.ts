import { mkdirSync } from "node:fs"
import { join, resolve } from "node:path"

import { Database } from "bun:sqlite"
import { Umzug, type RunnableMigration } from "umzug"

import { InitializationService } from "./initialization"
import { CollectorStore } from "./collector"
import { SqliteMigrationStorage } from "./migration-storage"
import { migrations, type MigrationContext } from "./migrations"
import { SessionStore } from "./session"
import { ProjectStore } from "./project"
import { SessionSyncStore } from "./session-sync"
import { SettingsStore } from "./settings"

export {
  AlreadyInitializedError,
  InitializationService,
  type CompleteInitializationOptions,
} from "./initialization"
export { defineMigration, type MigrationContext } from "./migrations"
export {
  SettingsStore,
  type SettingKey,
  type SettingValueMap,
  type StoredAiSettings,
} from "./settings"
export {
  CollectorStore,
  type CollectorRecord,
  type CollectorRuntime,
  type CreateCollectorInput,
} from "./collector"
export {
  SessionStore,
  type ActiveSessionScopeCounts,
  type ActiveSessionCountFilters,
  type AgentId,
  type ApplySourceSessionInput,
  type AvailableSessionDirectoryRecord,
  type ListSessionsOptions,
  type SessionKey,
  type SessionListCursor,
  type SessionListResult,
  type SessionRecord,
  type SessionStatus,
} from "./session"
export {
  ProjectStore,
  type ProjectDirectoryRecord,
  type ProjectRecord,
  type SaveProjectInput,
} from "./project"
export {
  SessionSyncStore,
  type BeginSessionSyncInput,
  type CommitSessionBatchInput,
  type CommitSessionBatchResult,
  type SessionSyncCheckpoint,
  type SessionSyncItem,
  type SessionSyncMode,
  type SessionSyncState,
} from "./session-sync"

export interface OpenStorageOptions {
  dataDir: string
}

export interface AppStorage {
  dataDir: string
  cacheDir: string
  databasePath: string
  db: Database
  initialization: InitializationService
  collectors: CollectorStore
  projects: ProjectStore
  sessions: SessionStore
  sessionSync: SessionSyncStore
  settings: SettingsStore
  close(): void
}

function trackedMigrations(
  context: MigrationContext,
  runnable: RunnableMigration<MigrationContext>[],
): RunnableMigration<MigrationContext>[] {
  return runnable.map((migration) => ({
    name: migration.name,
    async up(params) {
      context.db.exec("BEGIN IMMEDIATE")
      try {
        await migration.up(params)
        context.db
          .query(
            "INSERT INTO system_migrations (name, executed_at) VALUES (?, ?)",
          )
          .run(migration.name, Date.now())
        context.db.exec("COMMIT")
      } catch (error) {
        context.db.exec("ROLLBACK")
        throw error
      }
    },
  }))
}

export async function runMigrations(
  context: MigrationContext,
  runnable: RunnableMigration<MigrationContext>[] = migrations,
): Promise<void> {
  const migrator = new Umzug({
    migrations: trackedMigrations(context, runnable),
    context,
    storage: new SqliteMigrationStorage(context.db),
    logger: undefined,
  })
  await migrator.up()
}

export async function openStorage(
  options: OpenStorageOptions,
): Promise<AppStorage> {
  const dataDir = resolve(options.dataDir)
  const cacheDir = join(dataDir, "cache")
  const databasePath = join(dataDir, "nexume.sqlite")
  mkdirSync(cacheDir, { recursive: true })

  const db = new Database(databasePath, { create: true, strict: true })
  db.exec("PRAGMA foreign_keys = ON")
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA busy_timeout = 5000")

  try {
    const context: MigrationContext = { db, dataDir, cacheDir }
    await runMigrations(context)

    const collectors = new CollectorStore(db)
    const sessions = new SessionStore(db)
    const projects = new ProjectStore(db)
    const sessionSync = new SessionSyncStore(db)
    const settings = new SettingsStore(db)
    return {
      dataDir,
      cacheDir,
      databasePath,
      db,
      initialization: new InitializationService(db),
      collectors,
      projects,
      sessions,
      sessionSync,
      settings,
      close: () => db.close(),
    }
  } catch (error) {
    db.close()
    throw error
  }
}
