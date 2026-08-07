import { timingSafeEqual } from "node:crypto"

import { Server as BunEngine } from "@socket.io/bun-engine"
import {
  assertCollectorSocketAuth,
  type CollectorRuntimeMetadata,
  type CollectorStatus,
  type CollectorSocketData,
  type CollectorToServerEvents,
  type DashboardSocketData,
  type DashboardToServerEvents,
  type GetSessionDetailRequest,
  type GetSessionDetailResponse,
  type InterServerEvents,
  type ManagedCollectorInfo,
  type ServerToCollectorEvents,
  type ServerToDashboardEvents,
  type UpdateSessionTitleRequest,
  type UpdateSessionTitleResponse,
} from "@nexume/contracts"
import {
  CollectorRegistrationError,
  type ServerCore,
} from "@nexume/server-core"
import {
  Server as SocketIOServer,
  type Namespace,
  type Socket,
} from "socket.io"

import { SessionSyncService } from "./session-sync"

export interface CollectorSocketServerOptions {
  core: ServerCore
  sessionSync: SessionSyncService
  accessToken: string
  authenticate(token: string): { id: string; name: string } | undefined
  getCollector(id: string): { id: string; name: string } | undefined
  listCollectors(): ManagedCollectorInfo[]
  onConnected?: (id: string, metadata: CollectorRuntimeMetadata) => void
  onTouched?: (id: string, status?: CollectorStatus) => void
  onDisconnected?: (id: string) => void
  isInitialized?: () => boolean
  onError?: (error: unknown) => void
}

type CollectorServerSocket = Socket<
  CollectorToServerEvents,
  ServerToCollectorEvents,
  InterServerEvents,
  CollectorSocketData
>

type CollectorNamespace = Namespace<
  CollectorToServerEvents,
  ServerToCollectorEvents,
  InterServerEvents,
  CollectorSocketData
>

type DashboardNamespace = Namespace<
  DashboardToServerEvents,
  ServerToDashboardEvents,
  InterServerEvents,
  DashboardSocketData
>

function tokensEqual(actual: string, expected: string): boolean {
  const encoder = new TextEncoder()
  const actualBytes = encoder.encode(actual)
  const expectedBytes = encoder.encode(expected)
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  )
}

function protocolError(error: unknown) {
  return {
    ok: false as const,
    error: {
      code: "session_sync_failed",
      message: error instanceof Error ? error.message : String(error),
    },
  }
}

export function createCollectorSocketServer(
  options: CollectorSocketServerOptions,
) {
  const engine = new BunEngine({ path: "/socket.io/" })
  const io = new SocketIOServer()
  const collectorNamespace = io.of("/collector") as CollectorNamespace
  const dashboardNamespace = io.of("/server") as DashboardNamespace
  const sockets = new Map<string, CollectorServerSocket>()

  io.bind(engine)
  collectorNamespace.use((socket, next) => {
    try {
      if (options.isInitialized && !options.isInitialized()) {
        throw new Error("请先完成 Nexume 初始化。")
      }
      assertCollectorSocketAuth(socket.handshake.auth)
      const collector = options.authenticate(socket.handshake.auth.token)
      if (!collector) throw new Error("Collector 连接凭证无效。")
      socket.data.collectorId = collector.id
      next()
    } catch (error) {
      next(error instanceof Error ? error : new Error(String(error)))
    }
  })

  collectorNamespace.on("connection", (socket) => {
    const metadata = socket.handshake.auth.metadata as CollectorRuntimeMetadata
    const collector = options.getCollector(socket.data.collectorId)
    if (!collector) {
      socket.disconnect(true)
      return
    }

    const existing = sockets.get(collector.id)
    if (existing && existing.id !== socket.id) existing.disconnect(true)
    try {
      const registration = options.core.registerCollector({
        descriptor: { ...collector, ...metadata },
        connectionType: "remote",
      })
      sockets.set(collector.id, socket)
      options.onConnected?.(collector.id, metadata)

      socket.on("collector:status", (status) => {
        registration.touch()
        options.onTouched?.(collector.id, status)
      })
      socket.on("sessions:sync:begin", (request, acknowledge) => {
        try {
          if (!metadata.agents.includes(request.agent)) {
            throw new Error("Collector 未声明该 Agent 数据源。")
          }
          const data = options.sessionSync.begin(collector.id, request)
          registration.touch()
          options.onTouched?.(collector.id)
          acknowledge({ ok: true, data })
        } catch (error) {
          acknowledge(protocolError(error))
        }
      })
      socket.on("sessions:sync:batch", (request, acknowledge) => {
        try {
          if (!metadata.agents.includes(request.agent)) {
            throw new Error("Collector 未声明该 Agent 数据源。")
          }
          const data = options.sessionSync.commit(collector.id, request)
          registration.touch()
          options.onTouched?.(collector.id)
          acknowledge({ ok: true, data })
        } catch (error) {
          acknowledge(protocolError(error))
        }
      })
      socket.on("disconnect", () => {
        const isCurrent = sockets.get(collector.id)?.id === socket.id
        if (isCurrent) {
          sockets.delete(collector.id)
        }
        registration.unregister()
        if (isCurrent) options.onDisconnected?.(collector.id)
      })
    } catch (error) {
      if (!(error instanceof CollectorRegistrationError))
        options.onError?.(error)
      socket.disconnect(true)
    }
  })

  dashboardNamespace.use((socket, next) => {
    const accessToken = socket.handshake.auth?.accessToken
    if (
      typeof accessToken !== "string" ||
      !tokensEqual(accessToken, options.accessToken)
    ) {
      const error = new Error("Server access token 无效。") as Error & {
        data?: { code: string }
      }
      error.data = { code: "unauthorized" }
      next(error)
      return
    }
    next()
  })
  dashboardNamespace.on("connection", (socket) => {
    socket.emit("collectors:updated", options.listCollectors())
  })

  return {
    engine,
    io,
    publishCollectors() {
      dashboardNamespace.emit("collectors:updated", options.listCollectors())
    },
    disconnectCollector(id: string) {
      sockets.get(id)?.disconnect(true)
    },
    syncCollector(id: string): boolean {
      const socket = sockets.get(id)
      if (!socket?.connected) return false
      socket.emit("sessions:sync:request")
      return true
    },
    async updateSessionTitle(
      id: string,
      request: UpdateSessionTitleRequest,
    ): Promise<UpdateSessionTitleResponse | undefined> {
      const socket = sockets.get(id)
      if (!socket?.connected) return undefined
      return (await socket
        .timeout(10_000)
        .emitWithAck(
          "sessions:title:update",
          request,
         )) as UpdateSessionTitleResponse
    },
    async getSessionDetail(
      id: string,
      request: GetSessionDetailRequest,
    ): Promise<GetSessionDetailResponse | undefined> {
      const socket = sockets.get(id)
      if (!socket?.connected) return undefined
      return (await socket
        .timeout(10_000)
        .emitWithAck("sessions:detail:get", request)) as GetSessionDetailResponse
    },
    async close(): Promise<void> {
      await io.close()
    },
  }
}
