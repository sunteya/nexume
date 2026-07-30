import { describe, expect, test } from "bun:test"

import type { CollectorDescriptor } from "@nexume/contracts"

import {
  InvalidSessionCursorError,
  createServerCore,
  type CachedSessionCatalog,
  type CachedSessionRecord,
} from "./index"

function descriptor(id: string): CollectorDescriptor {
  return {
    id,
    name: id.toUpperCase(),
    hostname: `${id}.local`,
    version: "0.0.1",
    agents: ["opencode"],
  }
}

function record(
  collectorId: string,
  agent: string,
  sourceUpdatedAt: number,
  index: number,
): CachedSessionRecord {
  return {
    collectorId,
    collectorName: collectorId.toUpperCase(),
    agent,
    sourceId: `session-${index}`,
    title: `Session ${index}`,
    directory: `/workspace/${collectorId}`,
    sourceCreatedAt: sourceUpdatedAt,
    sourceUpdatedAt,
    sourceArchivedAt: null,
    deletedAt: null,
  }
}

function catalog(records: CachedSessionRecord[]): CachedSessionCatalog {
  return {
    list(options) {
      let items = records.filter(
        (item) =>
          (!options.collectorId || item.collectorId === options.collectorId) &&
          (!options.agent || item.agent === options.agent) &&
          (!options.title ||
            item.title.toLowerCase().includes(options.title.toLowerCase())),
      )
      if (options.cursor) {
        const index = items.findIndex(
          (item) =>
            item.sourceUpdatedAt === options.cursor!.sourceUpdatedAt &&
            item.collectorId === options.cursor!.collectorId &&
            item.agent === options.cursor!.agent &&
            item.sourceId === options.cursor!.sourceId,
        )
        items = items.slice(index + 1)
      }
      const selected = items.slice(0, options.limit)
      const last = selected.at(-1)
      return {
        items: selected,
        hasMore: items.length > options.limit,
        ...(items.length > options.limit && last
          ? {
              nextCursor: {
                sourceUpdatedAt: last.sourceUpdatedAt,
                collectorId: last.collectorId,
                agent: last.agent,
                sourceId: last.sourceId,
              },
            }
          : {}),
      }
    },
  }
}

describe("createServerCore", () => {
  test("lists connected collectors and ignores stale unregister calls", () => {
    const core = createServerCore()
    const first = core.registerCollector({
      descriptor: descriptor("remote"),
      connectionType: "remote",
    })
    core.registerCollector({
      descriptor: { ...descriptor("remote"), name: "Replacement" },
      connectionType: "remote",
    })

    first.unregister()
    expect(core.listCollectors()).toHaveLength(1)
    expect(core.listCollectors()[0]?.name).toBe("Replacement")
  })

  test("renames a connected collector", () => {
    const core = createServerCore()
    core.registerCollector({
      descriptor: descriptor("local"),
      connectionType: "local",
    })

    expect(core.renameCollector("local", "Renamed")).toBe(true)
    expect(core.listCollectors()[0]?.name).toBe("Renamed")
    expect(core.renameCollector("missing", "Ignored")).toBe(false)
  })

  test("reads cached sessions while no collector is online", async () => {
    const records = Array.from({ length: 30 }, (_, index) =>
      record("offline", "opencode", 100 - index, index),
    )
    const core = createServerCore({ sessions: catalog(records) })

    const first = await core.listSessions({ limit: 20 })
    const second = await core.listSessions({
      limit: 20,
      cursor: first.nextCursor,
    })

    expect(core.listCollectors()).toEqual([])
    expect(first.items).toHaveLength(20)
    expect(second.items).toHaveLength(10)
    expect(first.items[0]).toMatchObject({
      collectorId: "offline",
      collectorName: "OFFLINE",
      id: "session-0",
    })
    expect(first.warnings).toEqual([])
  })

  test("passes collector and agent filters to the cache", async () => {
    const calls: unknown[] = []
    const core = createServerCore({
      sessions: {
        list(options) {
          calls.push(options)
          return { items: [], hasMore: false }
        },
      },
    })

    await core.listSessions({
      limit: 50,
      collectorId: "collector-a",
      agent: "claude-code",
      title: "release notes",
      status: "archived",
    })
    expect(calls).toEqual([
      {
        limit: 50,
        collectorId: "collector-a",
        agent: "claude-code",
        title: "release notes",
        status: "archived",
        cursor: undefined,
      },
    ])
  })

  test("passes project scopes to the cache", async () => {
    const calls: unknown[] = []
    const core = createServerCore({
      sessions: {
        list(options) {
          calls.push(options)
          return { items: [], hasMore: false }
        },
      },
    })

    await core.listSessions({ limit: 50, projectId: "project-a" })
    await core.listSessions({ limit: 50, unassigned: true })

    expect(calls).toEqual([
      {
        projectId: "project-a",
        status: "active",
        limit: 50,
        cursor: undefined,
      },
      {
        unassigned: true,
        status: "active",
        limit: 50,
        cursor: undefined,
      },
    ])
  })

  test("rejects a pagination cursor after filters change", async () => {
    const records = Array.from({ length: 30 }, (_, index) =>
      record("collector-a", "opencode", 100 - index, index),
    )
    const core = createServerCore({ sessions: catalog(records) })
    const first = await core.listSessions({
      limit: 20,
      collectorId: "collector-a",
    })

    await expect(
      core.listSessions({
        limit: 20,
        collectorId: "collector-b",
        cursor: first.nextCursor,
      }),
    ).rejects.toBeInstanceOf(InvalidSessionCursorError)
  })

  test("filters titles and rejects a cursor after the title changes", async () => {
    const records = Array.from({ length: 50 }, (_, index) => ({
      ...record("collector-a", "opencode", 100 - index, index),
      title: index % 2 === 0 ? `Release ${index}` : `Draft ${index}`,
    }))
    const core = createServerCore({ sessions: catalog(records) })
    const first = await core.listSessions({ limit: 20, title: "release" })

    expect(first.items).toHaveLength(20)
    expect(first.nextCursor).toBeDefined()
    await expect(
      core.listSessions({
        limit: 20,
        title: "draft",
        cursor: first.nextCursor,
      }),
    ).rejects.toBeInstanceOf(InvalidSessionCursorError)
  })

  test("rejects a pagination cursor after the project scope changes", async () => {
    const records = Array.from({ length: 30 }, (_, index) =>
      record("collector-a", "opencode", 100 - index, index),
    )
    const core = createServerCore({ sessions: catalog(records) })
    const projectPage = await core.listSessions({
      limit: 20,
      projectId: "project-a",
    })
    const unassignedPage = await core.listSessions({
      limit: 20,
      unassigned: true,
    })

    expect(projectPage.nextCursor).toBeDefined()
    expect(unassignedPage.nextCursor).toBeDefined()
    await expect(
      core.listSessions({
        limit: 20,
        projectId: "project-b",
        cursor: projectPage.nextCursor,
      }),
    ).rejects.toBeInstanceOf(InvalidSessionCursorError)
    await expect(
      core.listSessions({
        limit: 20,
        unassigned: true,
        cursor: projectPage.nextCursor,
      }),
    ).rejects.toBeInstanceOf(InvalidSessionCursorError)
    await expect(
      core.listSessions({
        limit: 20,
        cursor: unassignedPage.nextCursor,
      }),
    ).rejects.toBeInstanceOf(InvalidSessionCursorError)
  })
})
