import { afterEach, describe, expect, test } from "bun:test"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { ClaudeCodeCollector, getClaudeCodeProjectsPath } from "./claude-code"
import { CollectorUnavailableError } from "./opencode"
import { SessionDetailCursorError, SessionTitleConflictError } from "./source"

const temporaryRoots: string[] = []

function createProjectsPath(): string {
  const root = mkdtempSync(join(tmpdir(), "nexume-claude-code-"))
  const projectsPath = join(root, "projects")
  mkdirSync(projectsPath)
  temporaryRoots.push(root)
  return projectsPath
}

function user(
  id: string,
  parentUuid: string | null,
  content: unknown,
  timestamp: string,
  extra: Record<string, unknown> = {},
) {
  return {
    type: "user",
    uuid: id,
    parentUuid,
    sessionId: "session",
    cwd: "/workspace/claude-project",
    timestamp,
    isSidechain: false,
    message: { role: "user", content },
    ...extra,
  }
}

function assistant(
  id: string,
  parentUuid: string | null,
  content: unknown,
  timestamp: string,
  extra: Record<string, unknown> = {},
) {
  return {
    type: "assistant",
    uuid: id,
    parentUuid,
    sessionId: "session",
    cwd: "/workspace/claude-project",
    timestamp,
    isSidechain: false,
    message: { role: "assistant", content },
    ...extra,
  }
}

function writeSession(
  projectsPath: string,
  id: string,
  rows: unknown[],
  modifiedAt: number,
  project = "-workspace-claude-project",
): string {
  const projectPath = join(projectsPath, project)
  mkdirSync(projectPath, { recursive: true })
  const path = join(projectPath, `${id}.jsonl`)
  writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`)
  utimesSync(path, modifiedAt / 1_000, modifiedAt / 1_000)
  return path
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe("ClaudeCodeCollector", () => {
  test("reads main sessions in stable incremental pages", () => {
    const projectsPath = createProjectsPath()
    writeSession(
      projectsPath,
      "session-b",
      [user("user-b", null, "Second prompt", "1970-01-01T00:00:02.000Z")],
      2_000,
    )
    writeSession(
      projectsPath,
      "session-a",
      [user("user-a", null, "First prompt", "1970-01-01T00:00:01.000Z")],
      2_000,
    )
    writeSession(
      projectsPath,
      "session-c",
      [
        user("user-c", null, "Original prompt", "1970-01-01T00:00:03.000Z"),
        {
          type: "ai-title",
          aiTitle: "Generated title",
          sessionId: "session-c",
        },
        {
          type: "custom-title",
          customTitle: "Custom title",
          sessionId: "session-c",
        },
      ],
      3_000,
    )

    const collector = new ClaudeCodeCollector({ projectsPath })
    const first = collector.readSessionPage({ mode: "reconcile", limit: 2 })
    expect(first.hasMore).toBe(true)
    expect(first.items).toEqual([
      {
        id: "session-a",
        agent: "claude-code",
        title: "First prompt",
        directory: "/workspace/claude-project",
        createdAt: 1_000,
        updatedAt: 2_000,
      },
      {
        id: "session-b",
        agent: "claude-code",
        title: "Second prompt",
        directory: "/workspace/claude-project",
        createdAt: 2_000,
        updatedAt: 2_000,
      },
    ])

    const second = collector.readSessionPage({
      mode: "reconcile",
      checkpoint: first.checkpoint,
      limit: 2,
    })
    expect(second.hasMore).toBe(false)
    expect(second.items).toHaveLength(1)
    expect(second.items[0]).toMatchObject({
      id: "session-c",
      title: "Custom title",
      updatedAt: 3_000,
    })
  })

  test("uses the same UTF-16 ordering for tied IDs and checkpoints", () => {
    const projectsPath = createProjectsPath()
    writeSession(
      projectsPath,
      "session-a",
      [user("user-a", null, "A", "1970-01-01T00:00:01.000Z")],
      1_000,
    )
    writeSession(
      projectsPath,
      "session-B",
      [user("user-b", null, "B", "1970-01-01T00:00:01.000Z")],
      1_000,
    )
    const collector = new ClaudeCodeCollector({ projectsPath })
    const first = collector.readSessionPage({ mode: "reconcile", limit: 1 })
    const second = collector.readSessionPage({
      mode: "reconcile",
      checkpoint: first.checkpoint,
      limit: 20,
    })
    expect(first.items.map((item) => item.id)).toEqual(["session-B"])
    expect(second.items.map((item) => item.id)).toEqual(["session-a"])
  })

  test("detects title-only changes even when mtime does not advance", () => {
    const projectsPath = createProjectsPath()
    const path = writeSession(
      projectsPath,
      "session-title",
      [user("user", null, "Initial title", "1970-01-01T00:00:01.000Z")],
      1_000,
    )
    const collector = new ClaudeCodeCollector({ projectsPath })
    const initial = collector.readSessionPage({ mode: "reconcile", limit: 20 })

    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}${JSON.stringify({
        type: "custom-title",
        customTitle: "Changed title",
        sessionId: "session-title",
      })}\n`,
    )
    utimesSync(path, 1, 1)

    const changed = collector.readSessionPage({
      mode: "incremental",
      checkpoint: initial.checkpoint,
      limit: 20,
    })
    expect(changed.items).toHaveLength(1)
    expect(changed.items[0]).toMatchObject({
      id: "session-title",
      title: "Changed title",
      updatedAt: 1_000,
    })
  })

  test("detects appended content when mtime remains in the same millisecond", () => {
    const projectsPath = createProjectsPath()
    const path = writeSession(
      projectsPath,
      "session-append",
      [user("user", null, "Stable title", "1970-01-01T00:00:01.000Z")],
      1_000,
    )
    const collector = new ClaudeCodeCollector({ projectsPath })
    const initial = collector.readSessionPage({ mode: "reconcile", limit: 20 })

    writeFileSync(
      path,
      `${readFileSync(path, "utf8")}${JSON.stringify(
        assistant(
          "assistant",
          "user",
          "New response",
          "1970-01-01T00:00:01.500Z",
        ),
      )}\n`,
    )
    utimesSync(path, 1, 1)

    const changed = collector.readSessionPage({
      mode: "incremental",
      checkpoint: initial.checkpoint,
      limit: 20,
    })
    expect(changed.items.map((item) => item.id)).toEqual(["session-append"])
  })

  test("retains custom titles after the title record moves into the file middle", () => {
    const projectsPath = createProjectsPath()
    writeSession(
      projectsPath,
      "long-session",
      [
        user("user", null, "Fallback prompt", "1970-01-01T00:00:01.000Z"),
        {
          type: "custom-title",
          customTitle: "Persistent custom title",
          sessionId: "long-session",
        },
        assistant(
          "large-assistant",
          "user",
          [{ type: "text", text: "x".repeat(160_000) }],
          "1970-01-01T00:00:02.000Z",
        ),
      ],
      2_000,
    )

    const result = new ClaudeCodeCollector({ projectsPath }).readSessionPage({
      mode: "reconcile",
      limit: 20,
    })
    expect(result.items[0]?.title).toBe("Persistent custom title")
  })

  test("excludes subagent files, sidechains, empty files, and corrupt tails", () => {
    const projectsPath = createProjectsPath()
    const mainPath = writeSession(
      projectsPath,
      "main-session",
      [user("main-user", null, "Main session", "1970-01-01T00:00:01.000Z")],
      1_000,
    )
    writeFileSync(mainPath, `${readFileSync(mainPath, "utf8")}{"partial":`)

    writeSession(
      projectsPath,
      "sidechain-session",
      [
        user("side-user", null, "Sidechain", "1970-01-01T00:00:02.000Z", {
          isSidechain: true,
        }),
      ],
      2_000,
    )

    const projectPath = join(projectsPath, "-workspace-claude-project")
    const subagentsPath = join(projectPath, "main-session", "subagents")
    mkdirSync(subagentsPath, { recursive: true })
    writeFileSync(
      join(subagentsPath, "agent-1.jsonl"),
      `${JSON.stringify(user("agent", null, "Agent", "1970-01-01T00:00:03.000Z"))}\n`,
    )
    writeFileSync(join(projectPath, "empty.jsonl"), "")

    const result = new ClaudeCodeCollector({ projectsPath }).readSessionPage({
      mode: "reconcile",
      limit: 20,
    })
    expect(result.items.map((item) => item.id)).toEqual(["main-session"])
  })

  test("reconstructs the current branch and normalizes Claude content blocks", () => {
    const projectsPath = createProjectsPath()
    writeSession(
      projectsPath,
      "detail-session",
      [
        user(
          "user-1",
          null,
          [{ type: "text", text: "Inspect this project" }],
          "1970-01-01T00:00:01.000Z",
        ),
        assistant(
          "assistant-1",
          "user-1",
          [
            { type: "thinking", thinking: "I should inspect the file." },
            { type: "text", text: "I will inspect it." },
            {
              type: "tool_use",
              id: "tool-1",
              name: "Read",
              input: { file_path: "README.md" },
            },
          ],
          "1970-01-01T00:00:02.000Z",
        ),
        user(
          "tool-result",
          "assistant-1",
          [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "README contents",
            },
          ],
          "1970-01-01T00:00:03.000Z",
        ),
        assistant(
          "discarded-branch",
          "tool-result",
          [{ type: "text", text: "Discarded answer" }],
          "1970-01-01T00:00:04.000Z",
        ),
        {
          type: "system",
          subtype: "local_command",
          uuid: "meta-link",
          parentUuid: "assistant-1",
          timestamp: "1970-01-01T00:00:05.000Z",
        },
        user(
          "current-branch",
          "meta-link",
          [{ type: "text", text: "Use a different approach" }],
          "1970-01-01T00:00:06.000Z",
        ),
        assistant(
          "later-discarded-branch",
          "tool-result",
          [{ type: "text", text: "Later discarded answer" }],
          "1970-01-01T00:00:07.000Z",
        ),
        {
          type: "last-prompt",
          sessionId: "detail-session",
          leafUuid: "current-branch",
        },
      ],
      6_000,
    )

    const collector = new ClaudeCodeCollector({ projectsPath })
    const result = collector.readSessionDetail({
      id: "detail-session",
      limit: 20,
    })
    expect(result.hasMore).toBe(false)
    expect(result.items[0]).toMatchObject({
      role: "user",
      parts: [{ type: "text", text: "Inspect this project" }],
    })
    expect(result.items[1]).toMatchObject({
      role: "assistant",
      parts: [
        { type: "reasoning", text: "I should inspect the file." },
        { type: "text", text: "I will inspect it." },
        { type: "tool-call", name: "Read", callId: "tool-1" },
      ],
    })

    expect(result.items.slice(2)).toEqual([
      {
        id: "current-branch",
        role: "user",
        createdAt: 6_000,
        parts: [
          {
            id: "current-branch:0",
            type: "text",
            text: "Use a different approach",
          },
        ],
      },
    ])
    expect(
      result.items.some((item) =>
        item.parts.some(
          (part) =>
            part.text === "Discarded answer" ||
            part.text === "Later discarded answer",
        ),
      ),
    ).toBe(false)
  })

  test("maps tool result messages to the tool role", () => {
    const projectsPath = createProjectsPath()
    writeSession(
      projectsPath,
      "tool-session",
      [
        user("user", null, "Run it", "1970-01-01T00:00:01.000Z"),
        {
          ...assistant(
            "assistant",
            "user",
            [{ type: "text", text: "Running it." }],
            "1970-01-01T00:00:02.000Z",
          ),
          message: {
            role: "assistant",
            id: "api-message-1",
            content: [{ type: "text", text: "Running it." }],
          },
        },
        {
          ...assistant(
            "assistant-call",
            "assistant",
            [{ type: "tool_use", id: "call-1", name: "Bash", input: {} }],
            "1970-01-01T00:00:02.000Z",
          ),
          message: {
            role: "assistant",
            id: "api-message-1",
            content: [
              { type: "tool_use", id: "call-1", name: "Bash", input: {} },
            ],
          },
        },
        user(
          "result",
          "assistant",
          [
            {
              type: "tool_result",
              tool_use_id: "call-1",
              content: "failed",
              is_error: true,
            },
          ],
          "1970-01-01T00:00:03.000Z",
        ),
      ],
      3_000,
    )

    const result = new ClaudeCodeCollector({ projectsPath }).readSessionDetail({
      id: "tool-session",
      limit: 20,
    })
    expect(result.items[2]).toMatchObject({
      role: "tool",
      parts: [
        {
          type: "tool-result",
          callId: "call-1",
          status: "error",
          text: "failed",
        },
      ],
    })
  })

  test("appends Claude-compatible custom titles and detects conflicts", () => {
    const projectsPath = createProjectsPath()
    const path = writeSession(
      projectsPath,
      "rename-session",
      [user("user", null, "Original title", "1970-01-01T00:00:01.000Z")],
      1_000,
    )
    const collector = new ClaudeCodeCollector({ projectsPath })
    const current = collector.readSessionPage({ mode: "reconcile", limit: 20 })
      .items[0]!

    const updated = collector.updateSessionTitle({
      id: current.id,
      title: "Renamed in Nexume",
      expectedTitle: current.title,
      expectedUpdatedAt: current.updatedAt,
    })
    expect(updated.title).toBe("Renamed in Nexume")
    expect(
      JSON.parse(readFileSync(path, "utf8").trim().split("\n").at(-1)!),
    ).toEqual({
      type: "custom-title",
      customTitle: "Renamed in Nexume",
      sessionId: "rename-session",
    })
    expect(() =>
      collector.updateSessionTitle({
        id: current.id,
        title: "Stale title",
        expectedTitle: current.title,
        expectedUpdatedAt: current.updatedAt,
      }),
    ).toThrow(SessionTitleConflictError)
  })

  test("truncates long titles without splitting surrogate pairs", () => {
    const projectsPath = createProjectsPath()
    writeSession(
      projectsPath,
      "long-title",
      [
        user("user", null, "Prompt", "1970-01-01T00:00:01.000Z"),
        {
          type: "custom-title",
          customTitle: `${"a".repeat(4_092)}😀${"b".repeat(1_000)}`,
        },
      ],
      1_000,
    )
    const title = new ClaudeCodeCollector({ projectsPath }).readSessionPage({
      mode: "reconcile",
      limit: 20,
    }).items[0]?.title
    expect(title).toHaveLength(4_095)
    expect(title?.endsWith("...")).toBe(true)
    expect(title?.includes("�")).toBe(false)
  })

  test("uses CLAUDE_CONFIG_DIR and validates unavailable data and cursors", () => {
    const projectsPath = createProjectsPath()
    const configPath = join(projectsPath, "..")
    const previous = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = configPath
    try {
      expect(getClaudeCodeProjectsPath()).toBe(projectsPath)
    } finally {
      if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = previous
    }

    const missing = new ClaudeCodeCollector({
      projectsPath: join(homedir(), ".missing-claude-projects"),
    })
    expect(() =>
      missing.readSessionPage({ mode: "incremental", limit: 20 }),
    ).toThrow(CollectorUnavailableError)

    writeSession(
      projectsPath,
      "cursor-session",
      [user("user", null, "Prompt", "1970-01-01T00:00:01.000Z")],
      1_000,
    )
    expect(() =>
      new ClaudeCodeCollector({ projectsPath }).readSessionDetail({
        id: "cursor-session",
        cursor: "invalid",
        limit: 20,
      }),
    ).toThrow(SessionDetailCursorError)
  })
})
