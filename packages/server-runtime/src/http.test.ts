import { describe, expect, test } from "bun:test"

import type { ServerCore } from "@nexume/server-core"
import { AlreadyInitializedError } from "@nexume/storage"

import { createRequestHandler } from "./http"

const token = "test-token"
const authorization = { Authorization: `Bearer ${token}` }

function createCore(
  listSessions: ServerCore["listSessions"] = async () => ({
    items: [],
    hasMore: false,
    warnings: [],
  }),
): ServerCore {
  return {
    listSessions,
    listCollectors: () => [],
    renameCollector: () => false,
    registerCollector: () => ({ touch() {}, unregister() {} }),
  }
}

describe("Server HTTP API", () => {
  test("exposes a public health check", async () => {
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(),
    })
    const response = await handler(new Request("http://localhost/api/health"))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
  })

  test("rejects a Session request without a token", async () => {
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(),
    })
    const response = await handler(new Request("http://localhost/api/sessions"))

    expect(response.status).toBe(401)
  })

  test("exposes initialization status without authentication", async () => {
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(),
      initialization: {
        getStatus: () => ({ initialized: false }),
        complete: () => ({ initialized: true, initializedAt: 100 }),
      },
    })
    const response = await handler(
      new Request("http://localhost/api/setup/status"),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ initialized: false })
  })

  test("uses the access token to complete initialization", async () => {
    let initialized = false
    let initializeLocalCollector: boolean | undefined
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(),
      initialization: {
        getStatus: () => ({ initialized }),
        complete: (initializeLocal) => {
          initializeLocalCollector = initializeLocal
          initialized = true
          return { initialized: true, initializedAt: 100 }
        },
      },
    })

    const unauthorized = await handler(
      new Request("http://localhost/api/setup/complete", { method: "POST" }),
    )
    expect(unauthorized.status).toBe(401)

    const completed = await handler(
      new Request("http://localhost/api/setup/complete", {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ initializeLocalCollector: false }),
      }),
    )
    expect(completed.status).toBe(200)
    expect(await completed.json()).toEqual({
      initialized: true,
      initializedAt: 100,
    })
    expect(initializeLocalCollector).toBe(false)

    const duplicate = await handler(
      new Request("http://localhost/api/setup/complete", {
        method: "POST",
        headers: authorization,
      }),
    )
    expect(duplicate.status).toBe(409)
  })

  test("validates setup JSON and maps concurrent completion to 409", async () => {
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(),
      initialization: {
        getStatus: () => ({ initialized: false }),
        complete: () => {
          throw new AlreadyInitializedError()
        },
      },
    })

    const invalid = await handler(
      new Request("http://localhost/api/setup/complete", {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: "[]",
      }),
    )
    expect(invalid.status).toBe(400)

    const duplicate = await handler(
      new Request("http://localhost/api/setup/complete", {
        method: "POST",
        headers: authorization,
      }),
    )
    expect(duplicate.status).toBe(409)
  })

  test("blocks business APIs until initialization completes", async () => {
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(),
      initialization: {
        getStatus: () => ({ initialized: false }),
        complete: () => ({ initialized: true }),
      },
    })
    const response = await handler(
      new Request("http://localhost/api/sessions", {
        headers: authorization,
      }),
    )

    expect(response.status).toBe(428)
    expect(await response.json()).toEqual({
      error: {
        code: "setup_required",
        message: "Complete the Nexume setup before using this API.",
      },
    })
  })

  test("passes a validated cursor query to Server Core", async () => {
    let received: unknown
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(async (params) => {
        received = params
        return { items: [], hasMore: false, warnings: [] }
      }),
    })
    const response = await handler(
      new Request(
        "http://localhost/api/sessions?limit=20&cursor=opaque&collectorId=collector-a&projectId=project-a&agent=codex&title=release%20notes&status=archived",
        {
          headers: authorization,
        },
      ),
    )

    expect(response.status).toBe(200)
    expect(received).toEqual({
      limit: 20,
      cursor: "opaque",
      collectorId: "collector-a",
      projectId: "project-a",
      unassigned: undefined,
      agent: "codex",
      title: "release notes",
      status: "archived",
    })
  })

  test("rejects an invalid batch size", async () => {
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(),
    })
    const response = await handler(
      new Request("http://localhost/api/sessions?limit=25", {
        headers: authorization,
      }),
    )

    expect(response.status).toBe(400)
  })

  test("passes an unassigned Session query and rejects conflicting scopes", async () => {
    let received: unknown
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(async (params) => {
        received = params
        return { items: [], hasMore: false, warnings: [] }
      }),
    })

    const response = await handler(
      new Request("http://localhost/api/sessions?unassigned=true", {
        headers: authorization,
      }),
    )
    expect(response.status).toBe(200)
    expect(received).toEqual({
      limit: 50,
      cursor: undefined,
      collectorId: undefined,
      projectId: undefined,
      unassigned: true,
      agent: undefined,
      title: undefined,
      status: undefined,
    })

    const conflicting = await handler(
      new Request(
        "http://localhost/api/sessions?projectId=project-a&unassigned=true",
        { headers: authorization },
      ),
    )
    expect(conflicting.status).toBe(400)
  })

  test("lists Projects and available Session directories", async () => {
    const project = {
      id: "project-1",
      name: "Nexume",
      groupName: "Work",
      directories: [{ collectorId: "local", directory: "/workspace/nexume" }],
      createdAt: 100,
      updatedAt: 100,
    }
    const directory = {
      collectorId: "local",
      collectorName: "Local",
      directory: "/workspace/nexume",
      projectId: "project-1",
      projectName: "Nexume",
    }
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(),
      projects: {
        list: () => [project],
        create: () => project,
        update: () => project,
        delete: () => {},
        listDirectories: () => [directory],
      },
    })

    const projects = await handler(
      new Request("http://localhost/api/projects", { headers: authorization }),
    )
    expect(projects.status).toBe(200)
    expect(await projects.json()).toEqual({ items: [project] })

    const directories = await handler(
      new Request("http://localhost/api/session-directories", {
        headers: authorization,
      }),
    )
    expect(directories.status).toBe(200)
    expect(await directories.json()).toEqual({ items: [directory] })
  })

  test("creates, updates and deletes a Project", async () => {
    const calls: string[] = []
    const project = {
      id: "project-1",
      name: "Nexume",
      groupName: "Work",
      directories: [{ collectorId: "local", directory: "/workspace/nexume" }],
      createdAt: 100,
      updatedAt: 100,
    }
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(),
      projects: {
        list: () => [],
        create: (input) => {
          calls.push(
            `create:${input.name}:${input.groupName}:${input.directories[0]?.directory}`,
          )
          return project
        },
        update: (id, input) => {
          calls.push(`update:${id}:${input.name}:${input.groupName}`)
          return {
            ...project,
            name: input.name,
            groupName: input.groupName,
            directories: input.directories,
          }
        },
        delete: (id) => {
          calls.push(`delete:${id}`)
        },
        listDirectories: () => [],
      },
    })

    const created = await handler(
      new Request("http://localhost/api/projects", {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Nexume",
          groupName: "Work",
          directories: [
            { collectorId: "local", directory: "/workspace/nexume" },
          ],
        }),
      }),
    )
    expect(created.status).toBe(201)
    expect(await created.json()).toEqual(project)

    const updated = await handler(
      new Request("http://localhost/api/projects/project-1", {
        method: "PATCH",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Renamed",
          groupName: "Personal",
          directories: [],
        }),
      }),
    )
    expect(updated.status).toBe(200)
    expect(await updated.json()).toEqual({
      ...project,
      name: "Renamed",
      groupName: "Personal",
      directories: [],
    })

    const deleted = await handler(
      new Request("http://localhost/api/projects/project-1", {
        method: "DELETE",
        headers: authorization,
      }),
    )
    expect(deleted.status).toBe(204)
    expect(calls).toEqual([
      "create:Nexume:Work:/workspace/nexume",
      "update:project-1:Renamed:Personal",
      "delete:project-1",
    ])
  })

  test("returns the managed Collector list", async () => {
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(),
      collectors: {
        list: () => [
          {
            id: "local",
            name: "Local",
            connectionType: "local",
            online: true,
            hostname: "localhost",
            version: "0.0.1",
            agents: ["opencode"],
            connectedAt: 100,
            lastSeenAt: 100,
            createdAt: 100,
            updatedAt: 100,
          },
        ],
        create: () => {
          throw new Error("not implemented")
        },
        rename: () => {
          throw new Error("not implemented")
        },
        delete: () => {
          throw new Error("not implemented")
        },
        sync: () => {
          throw new Error("not implemented")
        },
        revealToken: () => {
          throw new Error("not implemented")
        },
      },
    })
    const response = await handler(
      new Request("http://localhost/api/collectors", {
        headers: authorization,
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      items: [expect.objectContaining({ id: "local" })],
    })
  })

  test("creates, renames, reveals and deletes a Collector", async () => {
    const calls: string[] = []
    const collector = {
      id: "remote-1",
      name: "Remote",
      connectionType: "remote" as const,
      online: false,
      agents: ["opencode" as const],
      createdAt: 100,
      updatedAt: 100,
    }
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(),
      collectors: {
        list: () => [],
        create: (input) => {
          calls.push(`create:${input.name}`)
          return { collector, token: "collector-token" }
        },
        rename: (id, name) => {
          calls.push(`rename:${id}:${name}`)
          return { ...collector, name }
        },
        delete: (id) => {
          calls.push(`delete:${id}`)
        },
        sync: (id) => {
          calls.push(`sync:${id}`)
        },
        revealToken: (id) => {
          calls.push(`token:${id}`)
          return "collector-token"
        },
      },
    })

    const created = await handler(
      new Request("http://localhost/api/collectors", {
        method: "POST",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Remote", connectionType: "remote" }),
      }),
    )
    expect(created.status).toBe(201)
    expect(created.headers.get("cache-control")).toBe("no-store")
    expect(await created.json()).toEqual({
      collector,
      token: "collector-token",
    })

    const renamed = await handler(
      new Request("http://localhost/api/collectors/remote-1", {
        method: "PATCH",
        headers: { ...authorization, "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed" }),
      }),
    )
    expect(renamed.status).toBe(200)
    expect(((await renamed.json()) as { name: string }).name).toBe("Renamed")

    const tokenResponse = await handler(
      new Request("http://localhost/api/collectors/remote-1/token", {
        headers: authorization,
      }),
    )
    expect(await tokenResponse.json()).toEqual({ token: "collector-token" })
    expect(tokenResponse.headers.get("cache-control")).toBe("no-store")

    const synced = await handler(
      new Request("http://localhost/api/collectors/remote-1/sync", {
        method: "POST",
        headers: authorization,
      }),
    )
    expect(synced.status).toBe(202)
    expect(await synced.json()).toEqual({ accepted: true })

    const deleted = await handler(
      new Request("http://localhost/api/collectors/remote-1", {
        method: "DELETE",
        headers: authorization,
      }),
    )
    expect(deleted.status).toBe(204)
    expect(calls).toEqual([
      "create:Remote",
      "rename:remote-1:Renamed",
      "token:remote-1",
      "sync:remote-1",
      "delete:remote-1",
    ])
  })
})
