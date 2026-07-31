import type { CollectorRuntimeMetadata, RuntimeInfo } from "@nexume/contracts"
import {
  CollectorSyncRunner,
  type CollectorDataSource,
} from "@nexume/collector-core"
import { createServerCore } from "@nexume/server-core"
import type { AppStorage } from "@nexume/storage"

import { CollectorManagementService } from "./collector-management"
import { createCollectorSocketServer } from "./collector-socket"
import { createRequestHandler } from "./http"
import { SessionSyncService } from "./session-sync"
import { ProjectManagementService } from "./project-management"
import { SessionManagementService } from "./session-management"
import { AiSettingsService } from "./ai-settings"

export interface StartServerRuntimeOptions {
  accessToken: string
  storage: AppStorage
  hostname: string
  port: number
  webRoot: string
  localSources: CollectorDataSource[]
  localMetadata: CollectorRuntimeMetadata
  defaultLocalCollectorName: string
  getRuntimeInfo?: (port: number) => RuntimeInfo
  onError?: (error: unknown) => void
}

export function startServerRuntime(options: StartServerRuntimeOptions) {
  const core = createServerCore({
    sessions: {
      list(query) {
        const result = options.storage.sessions.list(query)
        return {
          ...result,
          items: result.items.map((item) => ({
            ...item,
            collectorName:
              options.storage.collectors.get(item.collectorId)?.name ??
              item.collectorId,
          })),
        }
      },
    },
  })
  const sessionSync = new SessionSyncService(options.storage.sessionSync)
  const projects = new ProjectManagementService(
    options.storage.projects,
    options.storage.sessions,
  )
  const localSync = new CollectorSyncRunner({
    sources: options.localSources,
    onError: (_agent, error) => options.onError?.(error),
    target: {
      begin: async (request) => sessionSync.begin("local", request),
      commit: async (request) => sessionSync.commit("local", request),
    },
  })
  const collectors = new CollectorManagementService({
    collectors: options.storage.collectors,
    core,
    localMetadata: options.localMetadata,
    onLocalCollectorChanged(enabled) {
      if (enabled) localSync.start()
      else localSync.stop()
    },
  })

  if (options.storage.initialization.getStatus().initialized) {
    collectors.syncLocalCollector()
  }

  const collectorSockets = createCollectorSocketServer({
    core,
    sessionSync,
    authenticate: (token) => collectors.authenticate(token),
    getCollector: (id) => collectors.getRemote(id),
    onConnected: (id, metadata) => collectors.connected(id, metadata),
    onTouched: (id) => collectors.touched(id),
    isInitialized: () => options.storage.initialization.getStatus().initialized,
    onError: options.onError,
  })
  const sessions = new SessionManagementService({
    sessions: options.storage.sessions,
    collectors: options.storage.collectors,
    localSources: options.localSources,
    updateRemote: (collectorId, request) =>
      collectorSockets.updateSessionTitle(collectorId, request),
    getRemoteDetail: (collectorId, request) =>
      collectorSockets.getSessionDetail(collectorId, request),
  })
  const aiSettings = new AiSettingsService(options.storage.settings)
  collectors.setRemoteDisconnect(collectorSockets.disconnectCollector)
  collectors.setSyncTrigger((id) => {
    if (id === "local") {
      void localSync.syncNow()
      return true
    }
    return collectorSockets.syncCollector(id)
  })
  const collectorSocketHandler = collectorSockets.engine.handler()
  let server: ReturnType<typeof Bun.serve>

  const handler = createRequestHandler({
    accessToken: options.accessToken,
    core,
    initialization: {
      getStatus: () => options.storage.initialization.getStatus(),
      complete(initializeLocalCollector) {
        const status = options.storage.initialization.complete({
          localCollector: initializeLocalCollector
            ? { id: "local", name: options.defaultLocalCollectorName }
            : undefined,
        })
        collectors.syncLocalCollector()
        return status
      },
    },
    collectors,
    sessions,
    aiSettings,
    projects,
    getRuntimeInfo: () =>
      options.getRuntimeInfo?.(server.port ?? options.port) ?? {
        kind: "server",
        port: server.port ?? options.port,
        urls: [],
      },
    webRoot: options.webRoot,
    onError: options.onError,
  })

  server = Bun.serve({
    ...collectorSocketHandler,
    hostname: options.hostname,
    port: options.port,
    maxRequestBodySize: 2 * 1024 * 1024,
    fetch(request, bunServer) {
      return new URL(request.url).pathname.startsWith("/socket.io/")
        ? collectorSocketHandler.fetch(request, bunServer)
        : handler(request)
    },
    error(error) {
      options.onError?.(error)
      return Response.json(
        {
          error: {
            code: "internal_error",
            message: "The Server encountered an internal error.",
          },
        },
        { status: 500 },
      )
    },
  })

  let closing: Promise<void> | undefined
  return {
    server,
    core,
    collectors,
    sessions,
    aiSettings,
    createBootstrapUrl(host = "127.0.0.1"): string {
      return `http://${host}:${server.port ?? options.port}/#accessToken=${encodeURIComponent(options.accessToken)}`
    },
    close(): Promise<void> {
      if (closing) return closing
      closing = Promise.resolve().then(async () => {
        localSync.stop()
        await collectorSockets.close()
        await server.stop(true)
      })
      return closing
    },
  }
}
