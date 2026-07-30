import { randomUUID } from "node:crypto"

import type {
  AvailableSessionDirectory,
  CreateProjectInput,
  ProjectInfo,
  UpdateProjectInput,
} from "@nexume/contracts"
import type { ProjectStore, SessionStore } from "@nexume/storage"

export class ProjectManagementError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "ProjectManagementError"
  }
}

function mapStorageError(error: unknown): never {
  const message = error instanceof Error ? error.message : ""
  if (message.includes("projects.name")) {
    throw new ProjectManagementError(
      "project_name_conflict",
      "A project with this name already exists.",
      409,
    )
  }
  if (
    message.includes(
      "project_directories.collector_id, project_directories.directory",
    )
  ) {
    throw new ProjectManagementError(
      "project_directory_conflict",
      "One or more directories already belong to another project.",
      409,
    )
  }
  if (message.includes("FOREIGN KEY constraint failed")) {
    throw new ProjectManagementError(
      "project_directory_invalid",
      "One or more selected collectors no longer exist.",
      400,
    )
  }
  throw error
}

export class ProjectManagementService {
  constructor(
    private readonly projects: ProjectStore,
    private readonly sessions: SessionStore,
  ) {}

  list(): ProjectInfo[] {
    return this.projects.list()
  }

  private assertDirectoriesAvailable(
    input: CreateProjectInput,
    existing: ProjectInfo | undefined,
  ): void {
    const available = new Set(
      this.sessions
        .listAvailableDirectories()
        .map((item) => JSON.stringify([item.collectorId, item.directory])),
    )
    for (const item of existing?.directories ?? []) {
      available.add(JSON.stringify([item.collectorId, item.directory]))
    }
    if (
      input.directories.some(
        (item) =>
          !available.has(JSON.stringify([item.collectorId, item.directory])),
      )
    ) {
      throw new ProjectManagementError(
        "project_directory_unavailable",
        "One or more selected directories are no longer available.",
        400,
      )
    }
  }

  create(input: CreateProjectInput): ProjectInfo {
    try {
      this.assertDirectoriesAvailable(input, undefined)
      return this.projects.create({ id: randomUUID(), ...input })
    } catch (error) {
      mapStorageError(error)
    }
  }

  update(id: string, input: UpdateProjectInput): ProjectInfo {
    try {
      const existing = this.projects.get(id)
      if (!existing) {
        throw new ProjectManagementError(
          "project_not_found",
          "The project does not exist.",
          404,
        )
      }
      this.assertDirectoriesAvailable(input, existing)
      const project = this.projects.update(id, input)
      return project!
    } catch (error) {
      if (error instanceof ProjectManagementError) throw error
      mapStorageError(error)
    }
  }

  delete(id: string): void {
    if (!this.projects.delete(id)) {
      throw new ProjectManagementError(
        "project_not_found",
        "The project does not exist.",
        404,
      )
    }
  }

  listDirectories(): AvailableSessionDirectory[] {
    return this.sessions.listAvailableDirectories().map((item) => ({
      collectorId: item.collectorId,
      collectorName: item.collectorName,
      directory: item.directory,
      ...(item.projectId ? { projectId: item.projectId } : {}),
      ...(item.projectName ? { projectName: item.projectName } : {}),
    }))
  }
}
