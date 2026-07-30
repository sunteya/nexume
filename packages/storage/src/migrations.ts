/// <reference path="./env.d.ts" />

import type { Database } from "bun:sqlite"
import type { RunnableMigration } from "umzug"

import initialSql from "./migrations/0001_initial.sql" with { type: "text" }
import collectorsSql from "./migrations/0002_collectors.sql" with { type: "text" }
import sessionsSql from "./migrations/0003_sessions.sql" with { type: "text" }
import projectsSql from "./migrations/0004_projects.sql" with { type: "text" }
import projectGroupsSql from "./migrations/0005_project_groups.sql" with { type: "text" }

export interface MigrationContext {
  db: Database
  dataDir: string
  cacheDir: string
}

export function defineMigration(
  migration: RunnableMigration<MigrationContext>,
): RunnableMigration<MigrationContext> {
  return migration
}

function sqlMigration(
  name: string,
  sql: string,
): RunnableMigration<MigrationContext> {
  return {
    name,
    async up({ context }) {
      context.db.exec(sql)
    },
  }
}

export const migrations: RunnableMigration<MigrationContext>[] = [
  sqlMigration("0001_initial", initialSql),
  sqlMigration("0002_collectors", collectorsSql),
  sqlMigration("0003_sessions", sessionsSql),
  sqlMigration("0004_projects", projectsSql),
  sqlMigration("0005_project_groups", projectGroupsSql),
]
