import { describe, expect, test } from "bun:test"

import {
  assertCollectorDescriptor,
  assertCollectorRuntimeMetadata,
  assertCollectorSocketAuth,
  assertBeginSessionSyncRequest,
  assertAiSettingsInput,
  assertCollectedSessionDetailPage,
  assertGetSessionDetailRequest,
  assertListSessionsParams,
  assertProjectInput,
  assertSessionSyncBatchRequest,
  assertUpdateSessionTitleRequest,
} from "./index"

describe("AI settings contracts", () => {
  test("accepts supported providers and nullable default thinking", () => {
    expect(() =>
      assertAiSettingsInput({
        provider: "openai",
        model: "gpt-5.6",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "secret",
        thinkingLevel: null,
      }),
    ).not.toThrow()
    expect(() =>
      assertAiSettingsInput({
        provider: "anthropic",
        model: "claude-sonnet",
        baseUrl: "http://127.0.0.1:8080",
        thinkingLevel: "off",
      }),
    ).not.toThrow()
  })

  test("rejects unsupported providers, levels, and unsafe URLs", () => {
    const valid = {
      provider: "openai",
      model: "gpt-5.6",
      baseUrl: "https://api.openai.com/v1",
      thinkingLevel: "medium",
    }
    expect(() =>
      assertAiSettingsInput({ ...valid, provider: "google" }),
    ).toThrow("AI Provider 无效")
    expect(() =>
      assertAiSettingsInput({ ...valid, thinkingLevel: "minimal" }),
    ).toThrow("AI 思考强度无效")
    expect(() =>
      assertAiSettingsInput({
        ...valid,
        baseUrl: "https://user:password@example.com/v1",
      }),
    ).toThrow("不能包含凭据")
    expect(() =>
      assertAiSettingsInput({
        ...valid,
        baseUrl: "http://192.168.1.10:8080/v1",
      }),
    ).toThrow("仅允许对本机回环地址使用 HTTP")
  })
})

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
        groupName: "Work",
        directories: [
          { collectorId: "local", directory: "/workspace/nexume" },
          { collectorId: "remote", directory: "/srv/nexume" },
        ],
      }),
    ).not.toThrow()
    expect(() =>
      assertProjectInput({ name: "Nexume", groupName: "   ", directories: [] }),
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
    expect(() =>
      assertProjectInput({
        name: "Nexume",
        groupName: "x".repeat(129),
        directories: [],
      }),
    ).toThrow("Project 分组名称不能超过 128 个字符")
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
  test("validates paged Session detail requests and responses", () => {
    expect(() =>
      assertGetSessionDetailRequest({
        agent: "opencode",
        id: "session-1",
        limit: 20,
        cursor: "20",
      }),
    ).not.toThrow()
    expect(() =>
      assertCollectedSessionDetailPage(
        {
          session: {
            id: "session-1",
            agent: "opencode",
            title: "Session",
            directory: "/workspace",
            createdAt: 100,
            updatedAt: 200,
          },
          items: [
            {
              id: "message-1",
              role: "assistant",
              createdAt: 200,
              parts: [{ id: "part-1", type: "text", text: "Result" }],
            },
          ],
          hasMore: false,
        },
        "opencode",
        "session-1",
      ),
    ).not.toThrow()
    expect(() =>
      assertGetSessionDetailRequest({
        agent: "opencode",
        id: "session-1",
        limit: 25,
      }),
    ).toThrow("Session 详情参数无效")
  })

  test("validates optimistic Session title updates", () => {
    expect(() =>
      assertUpdateSessionTitleRequest({
        agent: "codex",
        id: "session-1",
        title: "New title",
        expectedTitle: "Old title",
        expectedUpdatedAt: 200,
      }),
    ).not.toThrow()
    expect(() =>
      assertUpdateSessionTitleRequest({
        agent: "codex",
        id: "session-1",
        title: "   ",
        expectedTitle: "Old title",
        expectedUpdatedAt: 200,
      }),
    ).toThrow("Session 标题修改参数无效")
  })

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
