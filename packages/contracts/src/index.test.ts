import { describe, expect, test } from "bun:test"

import {
  assertCollectorDescriptor,
  assertCollectorRuntimeMetadata,
  assertCollectorSocketAuth,
  assertBeginSessionSyncRequest,
  assertListSessionsParams,
  assertProjectInput,
  assertSessionSyncBatchRequest,
} from "./index"

describe("Session query contracts", () => {
  test("accepts supported batch queries", () => {
    expect(() =>
      assertListSessionsParams({
        limit: 50,
        cursor: "opaque",
        collectorId: "collector-1",
        agent: "claude-code",
        title: "release notes",
        status: "archived",
      }),
    ).not.toThrow()
  })

  test("rejects unsupported batch sizes", () => {
    expect(() => assertListSessionsParams({ limit: 25 as 20 })).toThrow(
      "Session 每批数量无效",
    )
  })

  test("rejects blank or oversized title searches", () => {
    expect(() => assertListSessionsParams({ limit: 50, title: "   " })).toThrow(
      "Session 标题搜索条件无效",
    )
    expect(() =>
      assertListSessionsParams({ limit: 50, title: "x".repeat(257) }),
    ).toThrow("Session 标题搜索条件无效")
  })

  test("accepts either project scope and rejects conflicting scopes", () => {
    expect(() =>
      assertListSessionsParams({ limit: 50, projectId: "project-1" }),
    ).not.toThrow()
    expect(() =>
      assertListSessionsParams({ limit: 50, unassigned: true }),
    ).not.toThrow()
    expect(() =>
      assertListSessionsParams({
        limit: 50,
        projectId: "project-1",
        unassigned: false,
      }),
    ).not.toThrow()
    expect(() =>
      assertListSessionsParams({
        limit: 50,
        projectId: "project-1",
        unassigned: true,
      }),
    ).toThrow("Project 与未归类筛选条件不能同时使用")
  })
})

describe("Project contracts", () => {
  test("accepts a project with unique Collector directories", () => {
    expect(() =>
      assertProjectInput({
        name: "Nexume",
        directories: [
          { collectorId: "local", directory: "/workspace/nexume" },
          { collectorId: "remote", directory: "/srv/nexume" },
        ],
      }),
    ).not.toThrow()
  })

  test("rejects invalid names and duplicate Collector directories", () => {
    expect(() => assertProjectInput({ name: "   ", directories: [] })).toThrow(
      "Project 名称必须是 1 到 128 个字符",
    )
    expect(() =>
      assertProjectInput({
        name: "Nexume",
        directories: [
          { collectorId: "local", directory: "/workspace/nexume" },
          { collectorId: "local", directory: "/workspace/nexume" },
        ],
      }),
    ).toThrow("Project 目录不能重复")
  })
})

describe("assertCollectorDescriptor", () => {
  test("accepts a complete descriptor", () => {
    expect(() =>
      assertCollectorDescriptor({
        id: "workstation",
        name: "Workstation",
        hostname: "host.local",
        version: "0.0.1",
        agents: ["opencode"],
      }),
    ).not.toThrow()
  })

  test("accepts extensible agent identifiers", () => {
    expect(() =>
      assertCollectorDescriptor({
        id: "workstation",
        name: "Workstation",
        hostname: "host.local",
        version: "0.0.1",
        agents: ["claude-code"],
      }),
    ).not.toThrow()
  })
})

describe("Session sync contracts", () => {
  test("validates a begin request and normalized batch", () => {
    expect(() =>
      assertBeginSessionSyncRequest({
        agent: "codex",
        checkpointFormat: "codex/jsonl/v1",
      }),
    ).not.toThrow()
    expect(() =>
      assertSessionSyncBatchRequest({
        agent: "codex",
        runId: "run-1",
        sequence: 0,
        complete: true,
        items: [
          {
            id: "session-1",
            agent: "codex",
            title: "Session",
            directory: "/workspace",
            createdAt: 100,
            updatedAt: 200,
          },
        ],
      }),
    ).not.toThrow()
  })

  test("rejects a batch whose item belongs to another agent", () => {
    expect(() =>
      assertSessionSyncBatchRequest({
        agent: "codex",
        runId: "run-1",
        sequence: 0,
        complete: true,
        items: [
          {
            id: "session-1",
            agent: "opencode",
            title: "Session",
            directory: "/workspace",
            createdAt: 100,
            updatedAt: 200,
          },
        ],
      }),
    ).toThrow("Agent 与同步任务不一致")
  })
})

describe("Collector socket contracts", () => {
  test("accepts runtime metadata without management identity", () => {
    expect(() =>
      assertCollectorRuntimeMetadata({
        hostname: "host.local",
        version: "0.0.1",
        agents: ["opencode"],
      }),
    ).not.toThrow()
  })

  test("accepts token and runtime metadata as socket auth", () => {
    expect(() =>
      assertCollectorSocketAuth({
        token: "collector-token",
        metadata: {
          hostname: "host.local",
          version: "0.0.1",
          agents: ["opencode"],
        },
      }),
    ).not.toThrow()
  })

  test("rejects management identity in runtime metadata", () => {
    expect(() =>
      assertCollectorRuntimeMetadata({
        id: "collector-1",
        name: "Collector 1",
        hostname: "host.local",
        version: "0.0.1",
        agents: ["opencode"],
      }),
    ).toThrow("Collector runtime metadata 字段无效")
  })
})
