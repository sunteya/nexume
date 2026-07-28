import { Server as BunEngine } from "@socket.io/bun-engine";
import {
  assertCollectorSocketAuth,
  type CollectorQueryResponse,
  type CollectorRuntimeMetadata,
  type CollectorSessionBatch,
  type CollectorSocketData,
  type CollectorToServerEvents,
  type InterServerEvents,
  type ServerToCollectorEvents,
} from "@nexume/contracts";
import {
  CollectorRegistrationError,
  type ServerCore,
} from "@nexume/server-core";
import { Server as SocketIOServer, type Socket } from "socket.io";

export interface CollectorSocketServerOptions {
  core: ServerCore;
  authenticate(token: string): { id: string; name: string } | undefined;
  getCollector(id: string): { id: string; name: string } | undefined;
  onConnected?: (id: string, metadata: CollectorRuntimeMetadata) => void;
  onTouched?: (id: string) => void;
  isInitialized?: () => boolean;
  queryTimeout?: number;
  onError?: (error: unknown) => void;
}

type CollectorServerSocket = Socket<
  CollectorToServerEvents,
  ServerToCollectorEvents,
  InterServerEvents,
  CollectorSocketData
>;

function getQueryResult(
  response: CollectorQueryResponse,
  limit: number,
): CollectorSessionBatch {
  if (!response || typeof response !== "object") {
    throw new Error("Collector 返回了无效响应。");
  }
  if (!response.ok) throw new Error(response.error.message);

  if (
    !response.data ||
    !Array.isArray(response.data.items) ||
    typeof response.data.hasMore !== "boolean" ||
    response.data.items.length > limit ||
    response.data.items.some(
      (item) =>
        !item ||
        typeof item.id !== "string" ||
        item.agent !== "opencode" ||
        typeof item.title !== "string" ||
        typeof item.directory !== "string" ||
        !Number.isSafeInteger(item.createdAt) ||
        !Number.isSafeInteger(item.updatedAt),
    )
  ) {
    throw new Error("Collector 返回了无效 Session 数据。");
  }

  return response.data;
}

export function createCollectorSocketServer(
  options: CollectorSocketServerOptions,
) {
  const engine = new BunEngine({ path: "/socket.io/" });
  const io = new SocketIOServer<
    CollectorToServerEvents,
    ServerToCollectorEvents,
    InterServerEvents,
    CollectorSocketData
  >();
  const sockets = new Map<string, CollectorServerSocket>();

  io.bind(engine);

  io.use((socket, next) => {
    try {
      if (options.isInitialized && !options.isInitialized()) {
        throw new Error("请先完成 Nexume 初始化。");
      }

      assertCollectorSocketAuth(socket.handshake.auth);
      const collector = options.authenticate(socket.handshake.auth.token);
      if (!collector) {
        throw new Error("Collector 连接凭证无效。");
      }

      socket.data.collectorId = collector.id;
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error(String(error)));
    }
  });

  io.on("connection", (socket) => {
    const metadata = socket.handshake.auth.metadata as CollectorRuntimeMetadata;
    const collector = options.getCollector(socket.data.collectorId);
    if (!collector) {
      socket.disconnect(true);
      return;
    }

    const descriptor = { ...collector, ...metadata };
    const existing = sockets.get(collector.id);
    if (existing && existing.id !== socket.id) existing.disconnect(true);

    try {
      const registration = options.core.registerCollector({
        descriptor,
        connectionType: "remote",
        source: {
          async querySessions(query) {
            const response = await socket
              .timeout(options.queryTimeout ?? 10_000)
              .emitWithAck("sessions:list", query);
            const result = getQueryResult(response, query.limit);
            options.onTouched?.(collector.id);
            return result;
          },
        },
      });
      sockets.set(collector.id, socket);
      options.onConnected?.(collector.id, metadata);

      socket.on("collector:status", () => {
        registration.touch();
        options.onTouched?.(collector.id);
      });
      socket.on("disconnect", () => {
        if (sockets.get(collector.id)?.id === socket.id) {
          sockets.delete(collector.id);
        }
        registration.unregister();
      });
    } catch (error) {
      if (!(error instanceof CollectorRegistrationError)) {
        options.onError?.(error);
      }
      socket.disconnect(true);
    }
  });

  return {
    engine,
    io,
    disconnectCollector(id: string) {
      sockets.get(id)?.disconnect(true);
    },
    close(): Promise<void> {
      return new Promise((resolve) => {
        io.close(() => {
          engine.close();
          resolve();
        });
      });
    },
  };
}
