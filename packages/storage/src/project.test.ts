import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { openStorage, type AppStorage } from "./index"

const temporaryDirectories: string[] = []

function createDataDir(): string {
  const path = mkdtempSync(join(tmpdir(), "nexume-project-storage-"))
  temporaryDirectories.push(path)
  return path
}

async function createStorage(dataDir = createDataDir()): Promise<AppStorage> {
  const storage = await openStorage({ dataDir })
  storage.collectors.create({
    id: "collector-a",
    name: "Collector A",
    connectionType: "remote",
    token: "token-a",
  })
  storage.collectors.create({
    id: "collector-b",
    name: "Collector B",
    connectionType: "remote",
    token: "token-b",
  })
  return storage
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

describe("ProjectStore", () => {
  test("supports empty project CRUD and persists updates", async () => {
    const dataDir = createDataDir()
    const first = await createStorage(dataDir)

    const created = first.projects.create({
      id: "empty",
      name: "  Empty Project  ",
      directories: [],
    })
    expect(created).toEqual({
      id: "empty",
      name: "Empty Project",
      directories: [],
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    })
    expect(first.projects.list()).toEqual([created])
    first.close()

    const second = await openStorage({ dataDir })
    expect(second.projects.get("empty")).toEqual(created)
    expect(
      second.projects.update("empty", {
        name: "Renamed Empty Project",
        directories: [],
      }),
    ).toEqual(
      expect.objectContaining({
        id: "empty",
        name: "Renamed Empty Project",
        directories: [],
        createdAt: created.createdAt,
      }),
    )
    expect(
      second.projects.update("missing", { name: "Missing", directories: [] }),
    ).toBeUndefined()
    second.close()

    const third = await openStorage({ dataDir })
    expect(third.projects.get("empty")?.name).toBe("Renamed Empty Project")
    expect(third.projects.delete("empty")).toBe(true)
    expect(third.projects.delete("empty")).toBe(false)
    expect(third.projects.get("empty")).toBeUndefined()
    third.close()
  })

  test("stores multiple directories from multiple collectors", async () => {
    const storage = await createStorage()

    expect(
      storage.projects.create({
        id: "workspace",
        name: "Workspace",
        directories: [
          { collectorId: "collector-b", directory: "/srv/b" },
          { collectorId: "collector-a", directory: "/work/z" },
          { collectorId: "collector-a", directory: "/work/a" },
        ],
      }).directories,
    ).toEqual([
      { collectorId: "collector-a", directory: "/work/a" },
      { collectorId: "collector-a", directory: "/work/z" },
      { collectorId: "collector-b", directory: "/srv/b" },
    ])
    storage.close()
  })

  test("rejects assigning one collector directory to different projects", async () => {
    const storage = await createStorage()
    storage.projects.create({
      id: "first",
      name: "First",
      directories: [{ collectorId: "collector-a", directory: "/work/shared" }],
    })

    expect(() =>
      storage.projects.create({
        id: "second",
        name: "Second",
        directories: [
          { collectorId: "collector-a", directory: "/work/shared" },
        ],
      }),
    ).toThrow()
    expect(storage.projects.get("second")).toBeUndefined()
    expect(storage.projects.get("first")?.directories).toEqual([
      { collectorId: "collector-a", directory: "/work/shared" },
    ])
    storage.close()
  })

  test("removes collector bindings without deleting the project", async () => {
    const storage = await createStorage()
    storage.projects.create({
      id: "survivor",
      name: "Survivor",
      directories: [
        { collectorId: "collector-a", directory: "/work/a" },
        { collectorId: "collector-b", directory: "/work/b" },
      ],
    })

    expect(storage.collectors.delete("collector-a")).toBe(true)
    expect(storage.projects.get("survivor")).toEqual(
      expect.objectContaining({
        id: "survivor",
        directories: [{ collectorId: "collector-b", directory: "/work/b" }],
      }),
    )
    expect(storage.collectors.delete("collector-b")).toBe(true)
    expect(storage.projects.get("survivor")).toEqual(
      expect.objectContaining({ id: "survivor", directories: [] }),
    )
    storage.close()
  })
})
