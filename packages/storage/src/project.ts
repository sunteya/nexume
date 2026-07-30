import type { Database } from "bun:sqlite"

export interface ProjectDirectoryRecord {
  collectorId: string
  directory: string
}

export interface ProjectRecord {
  id: string
  name: string
  directories: ProjectDirectoryRecord[]
  createdAt: number
  updatedAt: number
}

export interface SaveProjectInput {
  id: string
  name: string
  directories: ProjectDirectoryRecord[]
}

interface ProjectRow {
  id: string
  name: string
  created_at: number
  updated_at: number
}

interface ProjectDirectoryRow {
  project_id: string
  collector_id: string
  directory: string
}

function directoryFromRow(row: ProjectDirectoryRow): ProjectDirectoryRecord {
  return { collectorId: row.collector_id, directory: row.directory }
}

export class ProjectStore {
  constructor(private readonly db: Database) {}

  private directories(projectId: string): ProjectDirectoryRecord[] {
    return this.db
      .query<ProjectDirectoryRow, [string]>(
        `SELECT project_id, collector_id, directory
         FROM project_directories
         WHERE project_id = ?
         ORDER BY collector_id ASC, directory ASC`,
      )
      .all(projectId)
      .map(directoryFromRow)
  }

  private fromRow(row: ProjectRow): ProjectRecord {
    return {
      id: row.id,
      name: row.name,
      directories: this.directories(row.id),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  list(): ProjectRecord[] {
    return this.db
      .query<ProjectRow, []>(
        "SELECT * FROM projects ORDER BY name COLLATE NOCASE ASC, id ASC",
      )
      .all()
      .map((row) => this.fromRow(row))
  }

  get(id: string): ProjectRecord | undefined {
    const row = this.db
      .query<ProjectRow, [string]>("SELECT * FROM projects WHERE id = ?")
      .get(id)
    return row ? this.fromRow(row) : undefined
  }

  create(input: SaveProjectInput): ProjectRecord {
    const now = Date.now()
    this.db.exec("BEGIN IMMEDIATE")
    try {
      this.db
        .query(
          "INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
        )
        .run(input.id, input.name.trim(), now, now)
      this.replaceDirectories(input.id, input.directories)
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    return this.get(input.id)!
  }

  update(
    id: string,
    input: Omit<SaveProjectInput, "id">,
  ): ProjectRecord | undefined {
    this.db.exec("BEGIN IMMEDIATE")
    try {
      const result = this.db
        .query("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?")
        .run(input.name.trim(), Date.now(), id)
      if (result.changes === 0) {
        this.db.exec("ROLLBACK")
        return undefined
      }
      this.db
        .query("DELETE FROM project_directories WHERE project_id = ?")
        .run(id)
      this.replaceDirectories(id, input.directories)
      this.db.exec("COMMIT")
    } catch (error) {
      this.db.exec("ROLLBACK")
      throw error
    }
    return this.get(id)
  }

  delete(id: string): boolean {
    return (
      this.db.query("DELETE FROM projects WHERE id = ?").run(id).changes > 0
    )
  }

  private replaceDirectories(
    projectId: string,
    directories: ProjectDirectoryRecord[],
  ): void {
    const statement = this.db.query(
      `INSERT INTO project_directories (project_id, collector_id, directory)
       VALUES (?, ?, ?)`,
    )
    for (const item of directories) {
      statement.run(projectId, item.collectorId, item.directory)
    }
  }
}
