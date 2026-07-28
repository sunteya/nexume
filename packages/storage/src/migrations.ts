/// <reference path="./env.d.ts" />

import type { Database } from "bun:sqlite";
import type { RunnableMigration } from "umzug";

import initialSql from "./migrations/0001_initial.sql" with { type: "text" };

export interface MigrationContext {
  db: Database;
  dataDir: string;
  cacheDir: string;
}

export function defineMigration(
  migration: RunnableMigration<MigrationContext>,
): RunnableMigration<MigrationContext> {
  return migration;
}

function sqlMigration(
  name: string,
  sql: string,
): RunnableMigration<MigrationContext> {
  return {
    name,
    async up({ context }) {
      context.db.exec(sql);
    },
  };
}

export const migrations: RunnableMigration<MigrationContext>[] = [
  sqlMigration("0001_initial", initialSql),
];
