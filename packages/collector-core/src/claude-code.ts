import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeSync,
} from "node:fs"
import { homedir } from "node:os"
import { basename, join } from "node:path"

import type {
  CollectedSessionSummary,
  SessionDetailMessage,
  SessionDetailPart,
  SessionSyncCheckpoint,
} from "@nexume/contracts"

import {
  CollectorUnavailableError,
  UnsupportedCollectorDataError,
} from "./opencode"
import type {
  SessionDetailDataSource,
  SessionDetailSourceRequest,
  SessionSourcePage,
  SessionSourcePageRequest,
  SessionTitleUpdateInput,
  WritableCollectorDataSource,
} from "./source"
import {
  createSessionTitleFingerprint,
  detailOffset,
  detailPage,
  detailPart,
  detailParts,
  SessionDetailNotFoundError,
  SessionTitleConflictError,
  SessionTitleNotFoundError,
} from "./source"

interface ClaudeCodePosition {
  updatedAt: number
  id: string
  size?: number
  titleFingerprint?: string
  fullScan?: boolean
}

interface ClaudeSessionFile {
  path: string
  summary: CollectedSessionSummary
  size: number
}

interface SessionSummaryCacheEntry {
  size: number
  modifiedAt: number
  summary?: CollectedSessionSummary
}

interface TranscriptData {
  entries: JsonObject[]
  leafUuid?: string
}

type JsonObject = Record<string, unknown>

const checkpointFormat = "claude-code/jsonl/v1"
const maximumTitleLength = 4_096
const maximumMetadataLength = 512
const maximumMessageIdLength = 480
const transcriptTypes = new Set([
  "user",
  "assistant",
  "progress",
  "system",
  "attachment",
])

export interface ClaudeCodeCollectorOptions {
  projectsPath?: string
}

export function getClaudeCodeProjectsPath(): string {
  const configPath = process.env.CLAUDE_CONFIG_DIR?.trim()
  return join(configPath || join(homedir(), ".claude"), "projects")
}

function object(value: unknown): JsonObject {
  return value && typeof value === "object" ? (value as JsonObject) : {}
}

function string(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined
}

function limitedString(value: string, limit: number): string {
  if (value.length <= limit) return value

  let end = limit - 3
  const lastCodeUnit = value.charCodeAt(end - 1)
  if (lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff) end -= 1
  return `${value.slice(0, end)}...`
}

function timestamp(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed
  }
  return fallback
}

function parseJsonLines(text: string): JsonObject[] {
  const rows: JsonObject[] = []
  let start = 0
  while (start < text.length) {
    const end = text.indexOf("\n", start)
    const line = end === -1 ? text.slice(start) : text.slice(start, end)
    start = end === -1 ? text.length : end + 1
    if (!line.trim()) continue
    try {
      const row = JSON.parse(line)
      if (row && typeof row === "object") rows.push(row as JsonObject)
    } catch {
      // Claude Code can be appending the final JSONL record while it is read.
    }
  }
  return rows
}

function promptFromRow(row: JsonObject): string | undefined {
  if (
    row.type !== "user" ||
    row.isMeta === true ||
    row.isSidechain === true ||
    row.isCompactSummary === true
  ) {
    return undefined
  }
  const content = object(row.message).content
  if (typeof content === "string" && content.trim()) return content.trim()
  if (!Array.isArray(content)) return undefined

  const text = content
    .map((part) => {
      const data = object(part)
      return data.type === "text" && typeof data.text === "string"
        ? data.text
        : ""
    })
    .filter(Boolean)
    .join("\n")
    .trim()
  return text || undefined
}

function sessionSummary(
  path: string,
  cache: Map<string, SessionSummaryCacheEntry>,
): CollectedSessionSummary | undefined {
  let stat
  try {
    stat = statSync(path)
    if (!stat.isFile() || stat.size === 0) return undefined
  } catch {
    return undefined
  }
  const cached = cache.get(path)
  if (cached?.size === stat.size && cached.modifiedAt === stat.mtimeMs) {
    return cached.summary
  }

  let rows: JsonObject[]
  try {
    rows = parseJsonLines(readFileSync(path, "utf8"))
  } catch {
    return undefined
  }
  if (rows[0]?.isSidechain === true) {
    cache.set(path, { size: stat.size, modifiedAt: stat.mtimeMs })
    return undefined
  }

  const id = basename(path, ".jsonl")
  let customTitle: string | undefined
  let aiTitle: string | undefined
  let prompt: string | undefined
  let directory: string | undefined
  let firstTimestamp: number | undefined
  for (const row of rows) {
    if (row.type === "custom-title" && string(row.customTitle)) {
      customTitle = row.customTitle as string
    } else if (row.type === "ai-title" && string(row.aiTitle)) {
      aiTitle = row.aiTitle as string
    }
    prompt ??= promptFromRow(row)
    directory ??= string(row.cwd)
    const rowTimestamp = timestamp(row.timestamp, -1)
    if (firstTimestamp === undefined && rowTimestamp >= 0) {
      firstTimestamp = rowTimestamp
    }
  }
  const title = limitedString(
    customTitle?.trim() || aiTitle?.trim() || prompt || `Claude Code ${id}`,
    maximumTitleLength,
  )
  const summary: CollectedSessionSummary = {
    id,
    agent: "claude-code",
    title,
    directory: directory ?? "",
    createdAt:
      firstTimestamp ??
      Math.max(0, Math.trunc(stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs)),
    updatedAt: Math.max(0, Math.trunc(stat.mtimeMs)),
  }
  cache.set(path, { size: stat.size, modifiedAt: stat.mtimeMs, summary })
  return summary
}

function discoverSessionFiles(
  projectsPath: string,
  cache: Map<string, SessionSummaryCacheEntry>,
): ClaudeSessionFile[] {
  const sessions = new Map<string, ClaudeSessionFile>()
  const discoveredPaths = new Set<string>()
  let projects
  try {
    projects = readdirSync(projectsPath, { withFileTypes: true })
  } catch {
    return []
  }

  for (const project of projects) {
    if (!project.isDirectory()) continue
    const projectPath = join(projectsPath, project.name)
    let entries
    try {
      entries = readdirSync(projectPath, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue
      const path = join(projectPath, entry.name)
      discoveredPaths.add(path)
      const summary = sessionSummary(path, cache)
      if (!summary) continue
      const size = cache.get(path)?.size
      if (size === undefined) continue
      const current = sessions.get(summary.id)
      if (
        !current ||
        current.summary.updatedAt < summary.updatedAt ||
        (current.summary.updatedAt === summary.updatedAt && current.size < size)
      ) {
        sessions.set(summary.id, { path, summary, size })
      }
    }
  }

  for (const path of cache.keys()) {
    if (!discoveredPaths.has(path)) cache.delete(path)
  }

  return [...sessions.values()].sort(
    (left, right) =>
      left.summary.updatedAt - right.summary.updatedAt ||
      (left.summary.id < right.summary.id
        ? -1
        : left.summary.id > right.summary.id
          ? 1
          : 0),
  )
}

function decodePosition(
  checkpoint: SessionSyncCheckpoint | undefined,
): ClaudeCodePosition | undefined {
  if (!checkpoint) return undefined
  if (checkpoint.format !== checkpointFormat) {
    throw new Error("Claude Code checkpoint 格式不受支持。")
  }
  try {
    const position = JSON.parse(checkpoint.value) as Partial<ClaudeCodePosition>
    if (
      !Number.isSafeInteger(position.updatedAt) ||
      typeof position.id !== "string" ||
      (position.size !== undefined && !Number.isSafeInteger(position.size))
    ) {
      throw new Error()
    }
    return position as ClaudeCodePosition
  } catch {
    throw new Error("Claude Code checkpoint 内容无效。")
  }
}

function encodePosition(
  session: Pick<ClaudeSessionFile, "summary" | "size">,
  titleFingerprint: string,
  fullScan = false,
): SessionSyncCheckpoint {
  return {
    format: checkpointFormat,
    value: JSON.stringify({
      updatedAt: session.summary.updatedAt,
      id: session.summary.id,
      size: session.size,
      titleFingerprint,
      ...(fullScan ? { fullScan: true } : {}),
    }),
  }
}

function afterPosition(
  session: ClaudeSessionFile,
  position: ClaudeCodePosition,
): boolean {
  return (
    session.summary.updatedAt > position.updatedAt ||
    (session.summary.updatedAt === position.updatedAt &&
      (session.summary.id > position.id ||
        (session.summary.id === position.id &&
          position.size !== undefined &&
          session.size > position.size)))
  )
}

function transcriptData(path: string): TranscriptData {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch {
    throw new CollectorUnavailableError(
      "未发现该 Claude Code Session 的详情文件。",
    )
  }
  const rows = parseJsonLines(text)
  let leafUuid: string | undefined
  const entries: JsonObject[] = []
  for (const row of rows) {
    if (row.type === "last-prompt" && string(row.leafUuid)) {
      leafUuid = row.leafUuid as string
    }
    if (transcriptTypes.has(String(row.type)) && typeof row.uuid === "string") {
      entries.push(row)
    }
  }
  return { entries, leafUuid }
}

function conversationChain(
  entries: JsonObject[],
  leafUuid?: string,
): JsonObject[] {
  if (entries.length === 0) return []
  const byId = new Map<string, JsonObject>()
  const entryIndexes = new Map<string, number>()
  const parentIds = new Set<string>()
  for (const [index, entry] of entries.entries()) {
    byId.set(entry.uuid as string, entry)
    entryIndexes.set(entry.uuid as string, index)
    const parentId = string(entry.parentUuid)
    if (parentId) parentIds.add(parentId)
  }
  const leaves = entries.filter((entry) => !parentIds.has(entry.uuid as string))
  if (leaves.length === 0) return []
  const mainLeaves = leaves.filter(
    (entry) =>
      entry.isSidechain !== true &&
      typeof entry.teamName !== "string" &&
      entry.isMeta !== true,
  )
  const leaf =
    (leafUuid ? byId.get(leafUuid) : undefined) ??
    (mainLeaves.length > 0 ? mainLeaves : leaves).reduce((latest, entry) =>
      (entryIndexes.get(entry.uuid as string) ?? -1) >
      (entryIndexes.get(latest.uuid as string) ?? -1)
        ? entry
        : latest,
    )

  const chain: JsonObject[] = []
  const visited = new Set<string>()
  let current: JsonObject | undefined = leaf
  while (current) {
    const id = current.uuid as string
    if (visited.has(id)) break
    visited.add(id)
    chain.push(current)
    const parentId = string(current.parentUuid)
    current = parentId ? byId.get(parentId) : undefined
  }
  return chain.reverse()
}

function contentPart(
  value: unknown,
  id: string,
  index: number,
): SessionDetailPart {
  const data = object(value)
  const type = string(data.type) ?? "unknown"
  const partId = `${id}:${index}`

  if (type === "text") {
    return detailPart({ id: partId, type: "text", text: data.text ?? "" })
  }
  if (type === "thinking") {
    return detailPart({
      id: partId,
      type: "reasoning",
      text: data.thinking ?? "",
    })
  }
  if (type === "redacted_thinking") {
    return detailPart({
      id: partId,
      type: "reasoning",
      text: "Reasoning was redacted by Claude Code.",
    })
  }
  if (type === "tool_use") {
    return detailPart({
      id: partId,
      type: "tool-call",
      name: limitedString(string(data.name) ?? "tool", maximumMetadataLength),
      callId: string(data.id)
        ? limitedString(data.id as string, maximumMetadataLength)
        : undefined,
      text: data.input ?? {},
    })
  }
  if (type === "tool_result") {
    const content = data.content
    const resultText = Array.isArray(content)
      ? content.every(
          (part) =>
            object(part).type === "text" &&
            typeof object(part).text === "string",
        )
        ? content.map((part) => object(part).text as string).join("\n")
        : content
      : (content ?? "")
    return detailPart({
      id: partId,
      type: "tool-result",
      callId: string(data.tool_use_id)
        ? limitedString(data.tool_use_id as string, maximumMetadataLength)
        : undefined,
      status: data.is_error === true ? "error" : undefined,
      text: resultText,
    })
  }
  if (type === "image" || type === "document") {
    return detailPart({ id: partId, type: "file", text: data })
  }
  return detailPart({ id: partId, type: "unknown", text: data })
}

function messageParts(value: unknown, id: string): SessionDetailPart[] {
  if (typeof value === "string") {
    return [detailPart({ id: `${id}:0`, type: "text", text: value })]
  }
  if (!Array.isArray(value)) {
    return [detailPart({ id: `${id}:0`, type: "unknown", text: value })]
  }
  return detailParts(value.map((part, index) => contentPart(part, id, index)))
}

function detailMessages(
  path: string,
  fallbackTimestamp: number,
): SessionDetailMessage[] {
  const transcript = transcriptData(path)
  const messages: SessionDetailMessage[] = []
  let previousAssistantMessageId: string | undefined
  for (const row of conversationChain(
    transcript.entries,
    transcript.leafUuid,
  )) {
    if (
      (row.type !== "user" && row.type !== "assistant") ||
      row.isMeta === true ||
      row.isSidechain === true ||
      typeof row.teamName === "string"
    ) {
      continue
    }

    const id = limitedString(row.uuid as string, maximumMessageIdLength)
    const parts = messageParts(object(row.message).content, id)
    const sourceMessageId = string(object(row.message).id)
    const previous = messages.at(-1)
    if (
      row.type === "assistant" &&
      sourceMessageId &&
      sourceMessageId === previousAssistantMessageId &&
      previous?.role === "assistant"
    ) {
      previous.parts = detailParts([...previous.parts, ...parts])
      continue
    }

    messages.push({
      id,
      role:
        row.type === "user" &&
        parts.length > 0 &&
        parts.every((part) => part.type === "tool-result")
          ? "tool"
          : row.type,
      createdAt: timestamp(row.timestamp, fallbackTimestamp),
      parts,
    })
    previousAssistantMessageId =
      row.type === "assistant" ? sourceMessageId : undefined
  }
  return messages
}

export class ClaudeCodeCollector
  implements WritableCollectorDataSource, SessionDetailDataSource
{
  readonly agent = "claude-code"
  readonly checkpointFormat = checkpointFormat
  readonly projectsPath: string
  readonly dataPath: string
  private readonly summaryCache = new Map<string, SessionSummaryCacheEntry>()

  constructor(options: ClaudeCodeCollectorOptions = {}) {
    this.projectsPath = options.projectsPath ?? getClaudeCodeProjectsPath()
    this.dataPath = this.projectsPath
  }

  get available(): boolean {
    return existsSync(this.projectsPath)
  }

  readSessionPage(request: SessionSourcePageRequest): SessionSourcePage {
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0) {
      throw new Error("Session 同步批量无效。")
    }
    if (!this.available) {
      throw new CollectorUnavailableError(
        "未发现本机 Claude Code Session 数据。",
      )
    }

    const sessions = discoverSessionFiles(this.projectsPath, this.summaryCache)
    const position = decodePosition(request.checkpoint)
    const titleFingerprint = createSessionTitleFingerprint(
      sessions.map(({ summary }) => summary),
    )
    const continuingFullScan = position?.fullScan === true
    const fullScan =
      continuingFullScan ||
      position === undefined ||
      position.titleFingerprint !== titleFingerprint
    const scanFingerprint = continuingFullScan
      ? (position.titleFingerprint ?? titleFingerprint)
      : titleFingerprint
    const candidates = sessions.filter(
      (session) =>
        !position ||
        (!fullScan && afterPosition(session, position)) ||
        (continuingFullScan && afterPosition(session, position)) ||
        (fullScan && !continuingFullScan),
    )
    const selected = candidates.slice(0, request.limit)
    const hasMore = candidates.length > request.limit
    const last = selected.at(-1)

    return {
      items: selected.map(({ summary }) => summary),
      checkpoint: last
        ? encodePosition(last, scanFingerprint, fullScan && hasMore)
        : {
            format: this.checkpointFormat,
            value: JSON.stringify({
              updatedAt: position?.updatedAt ?? 0,
              id: position?.id ?? "",
              titleFingerprint: scanFingerprint,
            }),
          },
      hasMore,
    }
  }

  readSessionDetail(request: SessionDetailSourceRequest) {
    if (!Number.isSafeInteger(request.limit) || request.limit <= 0) {
      throw new Error("Session 详情批量无效。")
    }
    if (!this.available) {
      throw new CollectorUnavailableError(
        "未发现本机 Claude Code Session 数据。",
      )
    }

    const session = discoverSessionFiles(
      this.projectsPath,
      this.summaryCache,
    ).find(({ summary }) => summary.id === request.id)
    if (!session) throw new SessionDetailNotFoundError()

    const messages = detailMessages(session.path, session.summary.createdAt)
    const offset = detailOffset(request.cursor)
    return detailPage(
      session.summary,
      messages.slice(offset, offset + request.limit),
      offset,
      messages.length,
    )
  }

  updateSessionTitle(input: SessionTitleUpdateInput): CollectedSessionSummary {
    if (!this.available) {
      throw new CollectorUnavailableError(
        "未发现本机 Claude Code Session 数据。",
      )
    }
    const session = discoverSessionFiles(
      this.projectsPath,
      this.summaryCache,
    ).find(({ summary }) => summary.id === input.id)
    if (!session) throw new SessionTitleNotFoundError()
    if (
      session.summary.title !== input.expectedTitle ||
      session.summary.updatedAt !== input.expectedUpdatedAt
    ) {
      throw new SessionTitleConflictError()
    }

    const title = input.title.trim()
    if (!title) {
      throw new UnsupportedCollectorDataError(
        "Claude Code Session 标题不能为空。",
      )
    }

    let descriptor: number | undefined
    try {
      descriptor = openSync(
        session.path,
        constants.O_WRONLY | constants.O_APPEND,
      )
      const openedStat = fstatSync(descriptor)
      const cached = this.summaryCache.get(session.path)
      if (
        !cached ||
        cached.size !== openedStat.size ||
        cached.modifiedAt !== openedStat.mtimeMs
      ) {
        throw new SessionTitleConflictError()
      }
      const data = `${JSON.stringify({
        type: "custom-title",
        customTitle: title,
        sessionId: input.id,
      })}\n`
      const bytes = new TextEncoder().encode(data)
      let offset = 0
      while (offset < bytes.length) {
        const written = writeSync(
          descriptor,
          bytes,
          offset,
          bytes.length - offset,
        )
        if (written <= 0) throw new Error("写入未完成。")
        offset += written
      }
    } catch (error) {
      if (error instanceof SessionTitleConflictError) throw error
      throw new CollectorUnavailableError(
        `无法修改 Claude Code Session 标题：${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    } finally {
      if (descriptor !== undefined) closeSync(descriptor)
    }

    const updated = sessionSummary(session.path, this.summaryCache)
    if (!updated) throw new SessionTitleNotFoundError()
    if (updated.title !== limitedString(title, maximumTitleLength)) {
      throw new SessionTitleConflictError()
    }
    return updated
  }
}
