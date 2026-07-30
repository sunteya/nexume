import type { Database } from "bun:sqlite"
import type { UmzugStorage } from "umzug"

interface MigrationRow {
  name: string
}

export class SqliteMigrationStorage implements UmzugStorage {
  constructor(private readonly db: Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS system_migrations (
        name TEXT PRIMARY KEY NOT NULL,
        executed_at INTEGER NOT NULL
      ) STRICT
    `)
  }

  async executed(): Promise<string[]> {
    return this.db
      .query<MigrationRow, []>(
        "SELECT name FROM system_migrations ORDER BY name ASC",
      )
      .all()
      .map((row) => row.name)
  }

  async logMigration({ name }: { name: string }): Promise<void> {
    this.db
      .query(
        "INSERT OR IGNORE INTO system_migrations (name, executed_at) VALUES (?, ?)",
      )
      .run(name, Date.now())
  }

  async unlogMigration(): Promise<void> {
    throw new Error("Nexume migration 仅支持向前执行。")
  }
}
