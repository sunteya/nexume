import type {
  CollectorRuntimeMetadata,
  RuntimeInfo,
} from "@nexume/contracts";
import { createServerCore, type CollectorSource } from "@nexume/server-core";
import type { AppStorage } from "@nexume/storage";

import { CollectorManagementService } from "./collector-management";
import { createCollectorSocketServer } from "./collector-socket";
import { createRequestHandler } from "./http";

export interface StartServerRuntimeOptions {
  accessToken: string;
  storage: AppStorage;
  hostname: string;
  port: number;
  webRoot: string;
  localSource: CollectorSource;
  localMetadata: CollectorRuntimeMetadata;
  defaultLocalCollectorName: string;
  getRuntimeInfo?: (port: number) => RuntimeInfo;
  onError?: (error: unknown) => void;
}

export function startServerRuntime(options: StartServerRuntimeOptions) {
  const core = createServerCore();
  const collectors = new CollectorManagementService({
    collectors: options.storage.collectors,
    core,
    localSource: options.localSource,
    localMetadata: options.localMetadata,
  });

  if (options.storage.initialization.getStatus().initialized) {
    collectors.syncLocalCollector();
  }

  const collectorSockets = createCollectorSocketServer({
    core,
    authenticate: (token) => collectors.authenticate(token),
    getCollector: (id) => collectors.getRemote(id),
    onConnected: (id, metadata) => collectors.connected(id, metadata),
    onTouched: (id) => collectors.touched(id),
    isInitialized: () => options.storage.initialization.getStatus().initialized,
    onError: options.onError,
  });
  collectors.setRemoteDisconnect(collectorSockets.disconnectCollector);
  const collectorSocketHandler = collectorSockets.engine.handler();
  let server: ReturnType<typeof Bun.serve>;

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
        });
        collectors.syncLocalCollector();
        return status;
      },
    },
    collectors,
    getRuntimeInfo: () => options.getRuntimeInfo?.(server.port ?? options.port) ?? {
      kind: "server",
      port: server.port ?? options.port,
      urls: [],
    },
    webRoot: options.webRoot,
    onError: options.onError,
  });

  server = Bun.serve({
    ...collectorSocketHandler,
    hostname: options.hostname,
    port: options.port,
    maxRequestBodySize: 65_536,
    fetch(request, bunServer) {
      return new URL(request.url).pathname.startsWith("/socket.io/")
        ? collectorSocketHandler.fetch(request, bunServer)
        : handler(request);
    },
    error(error) {
      options.onError?.(error);
      return Response.json(
        { error: { code: "internal_error", message: "Server 内部错误。" } },
        { status: 500 },
      );
    },
  });

  let closing: Promise<void> | undefined;
  return {
    server,
    core,
    collectors,
    createBootstrapUrl(host = "127.0.0.1"): string {
      return `http://${host}:${server.port ?? options.port}/#accessToken=${encodeURIComponent(options.accessToken)}`;
    },
    close(): Promise<void> {
      if (closing) return closing;
      closing = Promise.resolve().then(async () => {
        await collectorSockets.close();
        await server.stop(true);
      });
      return closing;
    },
  };
}
