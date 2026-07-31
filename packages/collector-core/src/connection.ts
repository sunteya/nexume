import { io, type Socket } from "socket.io-client"

import type {
  BeginSessionSyncResponse,
  CollectorRuntimeMetadata,
  CollectorSocketAuth,
  CollectorToServerEvents,
  GetSessionDetailResponse,
  ServerToCollectorEvents,
  SessionSyncBatchResponse,
  UpdateSessionTitleResponse,
} from "@nexume/contracts"
import {
  assertGetSessionDetailRequest,
  assertUpdateSessionTitleRequest,
} from "@nexume/contracts"

import {
  SessionTitleConflictError,
  SessionTitleNotFoundError,
  type CollectorDataSource,
  SessionDetailCursorError,
  SessionDetailNotFoundError,
  type SessionDetailDataSource,
  type WritableCollectorDataSource,
} from "./source"
import {
  CollectorUnavailableError,
  UnsupportedCollectorDataError,
} from "./opencode"
import { CollectorSyncRunner } from "./sync-runner"

export type CollectorConnectionState =
  "disconnected" | "connecting" | "connected"

export interface CollectorConnectionOptions {
  serverUrl: string
  token: string
  metadata: CollectorRuntimeMetadata
  sources: CollectorDataSource[]
  syncIntervalMs?: number
  onStateChange?: (state: CollectorConnectionState, detail?: string) => void
  onSyncError?: (agent: string, error: unknown) => void
}

type CollectorSocket = Socket<ServerToCollectorEvents, CollectorToServerEvents>

function responseData<T>(
  response: { ok: true; data: T } | { ok: false; error: { message: string } },
): T {
  if (!response?.ok)
    throw new Error(response?.error.message ?? "Server 返回无效响应。")
  return response.data
}

function titleUpdateError(error: unknown): UpdateSessionTitleResponse {
  let code = "session_title_update_failed"
  if (error instanceof SessionTitleConflictError) {
    code = "session_title_conflict"
  } else if (error instanceof SessionTitleNotFoundError) {
    code = "session_not_found"
  } else if (error instanceof CollectorUnavailableError) {
    code = "collector_unavailable"
  } else if (error instanceof UnsupportedCollectorDataError) {
    code = "unsupported_collector_data"
  }
  return {
    ok: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

function detailError(error: unknown): GetSessionDetailResponse {
  let code = "session_detail_failed"
  if (error instanceof SessionDetailNotFoundError) {
    code = "session_not_found"
  } else if (error instanceof SessionDetailCursorError) {
    code = "invalid_cursor"
  } else if (error instanceof CollectorUnavailableError) {
    code = "collector_unavailable"
  } else if (error instanceof UnsupportedCollectorDataError) {
    code = "unsupported_collector_data"
  }
  return {
    ok: false,
    error: {
      code,
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

export class CollectorConnection {
  readonly socket: CollectorSocket
  private heartbeat?: ReturnType<typeof setInterval>
  private readonly runner: CollectorSyncRunner
  private syncing = false

  constructor(private readonly options: CollectorConnectionOptions) {
    const sourceAgents = new Set<string>()
    const sources = new Map<string, CollectorDataSource>()
    for (const source of options.sources) {
      if (!options.metadata.agents.includes(source.agent)) {
        throw new Error(`Collector metadata 未声明 ${source.agent} Agent。`)
      }
      if (sourceAgents.has(source.agent)) {
        throw new Error(`Collector 包含重复的 ${source.agent} Agent 数据源。`)
      }
      sourceAgents.add(source.agent)
      sources.set(source.agent, source)
    }
    const serverUrl = options.serverUrl.replace(/\/$/, "")
    const auth: CollectorSocketAuth = {
      token: options.token,
      metadata: options.metadata,
    }
    this.socket = io(`${serverUrl}/collector`, {
      path: "/socket.io",
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      auth,
    })
    this.runner = new CollectorSyncRunner({
      sources: options.sources,
      intervalMs: options.syncIntervalMs,
      onError: options.onSyncError,
      onSyncStateChange: (syncing) => {
        this.syncing = syncing
        if (this.socket.connected) this.sendStatus()
      },
      target: {
        begin: async (request) => {
          const response = (await this.socket
            .timeout(10_000)
            .emitWithAck(
              "sessions:sync:begin",
              request,
            )) as BeginSessionSyncResponse
          return responseData(response)
        },
        commit: async (request) => {
          const response = (await this.socket
            .timeout(10_000)
            .emitWithAck(
              "sessions:sync:batch",
              request,
            )) as SessionSyncBatchResponse
          return responseData(response)
        },
      },
    })

    this.socket.on("connect", () => {
      options.onStateChange?.("connected")
      this.sendStatus()
      this.heartbeat = setInterval(() => this.sendStatus(), 30_000)
      this.runner.start()
    })
    this.socket.on("disconnect", (reason) => {
      this.clearTimers()
      options.onStateChange?.("disconnected", reason)
    })
    this.socket.on("connect_error", (error) => {
      options.onStateChange?.("disconnected", error.message)
    })
    this.socket.on("sessions:sync:request", () => {
      void this.runner.syncNow()
    })
    this.socket.on("sessions:title:update", async (request, acknowledge) => {
      try {
        assertUpdateSessionTitleRequest(request)
        const source = sources.get(request.agent)
        if (!source || !("updateSessionTitle" in source)) {
          throw new UnsupportedCollectorDataError(
            "该 Collector 不支持修改此 Agent 的 Session 标题。",
          )
        }
        const session = await (
          source as WritableCollectorDataSource
        ).updateSessionTitle(request)
        acknowledge({ ok: true, data: { session } })
      } catch (error) {
        acknowledge(titleUpdateError(error))
      }
    })
    this.socket.on("sessions:detail:get", async (request, acknowledge) => {
      try {
        assertGetSessionDetailRequest(request)
        const source = sources.get(request.agent)
        if (!source || !("readSessionDetail" in source)) {
          throw new UnsupportedCollectorDataError(
            "该 Collector 不支持读取此 Agent 的 Session 详情。",
          )
        }
        const data = await (
          source as SessionDetailDataSource
        ).readSessionDetail(request)
        acknowledge({ ok: true, data })
      } catch (error) {
        acknowledge(detailError(error))
      }
    })
  }

  connect(): void {
    if (this.socket.connected || this.socket.active) return
    this.options.onStateChange?.("connecting")
    this.socket.connect()
  }

  disconnect(): void {
    this.clearTimers()
    this.socket.disconnect()
  }

  private sendStatus(): void {
    this.socket.emit("collector:status", {
      available: this.options.sources.some((source) => source.available),
      syncing: this.syncing,
    })
  }

  private clearTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = undefined
    this.runner.stop()
  }
}
