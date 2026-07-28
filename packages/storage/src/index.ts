import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

import { Database } from "bun:sqlite";
import { Umzug, type RunnableMigration } from "umzug";

import { InitializationService } from "./initialization";
import { SqliteMigrationStorage } from "./migration-storage";
import { migrations, type MigrationContext } from "./migrations";

export { AlreadyInitializedError, InitializationService } from "./initialization";
export { defineMigration, type MigrationContext } from "./migrations";
export { SettingsStore, type SettingKey, type SettingValueMap } from "./settings";

export interface OpenStorageOptions {
  dataDir: string;
}

export interface AppStorage {
  dataDir: string;
  cacheDir: string;
  databasePath: string;
  db: Database;
  initialization: InitializationService;
  close(): void;
}

function trackedMigrations(
  context: MigrationContext,
  runnable: RunnableMigration<MigrationContext>[],
): RunnableMigration<MigrationContext>[] {
  return runnable.map((migration) => ({
    name: migration.name,
    async up(params) {
      context.db.exec("BEGIN IMMEDIATE");
      try {
        await migration.up(params);
        context.db
          .query(
            "INSERT INTO system_migrations (name, executed_at) VALUES (?, ?)",
          )
          .run(migration.name, Date.now());
        context.db.exec("COMMIT");
      } catch (error) {
        context.db.exec("ROLLBACK");
        throw error;
      }
    },
  }));
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
  });
  await migrator.up();
}

export async function openStorage(
  options: OpenStorageOptions,
): Promise<AppStorage> {
  const dataDir = resolve(options.dataDir);
  const cacheDir = join(dataDir, "cache");
  const databasePath = join(dataDir, "nexume.sqlite");
  mkdirSync(cacheDir, { recursive: true });

  const db = new Database(databasePath, { create: true, strict: true });
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");

  try {
    const context: MigrationContext = { db, dataDir, cacheDir };
    await runMigrations(context);

    return {
      dataDir,
      cacheDir,
      databasePath,
      db,
      initialization: new InitializationService(db),
      close: () => db.close(),
    };
  } catch (error) {
    db.close();
    throw error;
  }
}
