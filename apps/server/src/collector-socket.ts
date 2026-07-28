import { timingSafeEqual } from "node:crypto";

import { Server as BunEngine } from "@socket.io/bun-engine";
import {
  assertCollectorDescriptor,
  type CollectorDescriptor,
  type CollectorQueryResponse,
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
  collectorToken: string;
  core: ServerCore;
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

function tokensEqual(actual: unknown, expected: string): boolean {
  if (typeof actual !== "string") return false;

  const encoder = new TextEncoder();
  const actualBytes = encoder.encode(actual);
  const expectedBytes = encoder.encode(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

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
  const namespace = io.of("/collectors");
  const sockets = new Map<string, CollectorServerSocket>();

  io.bind(engine);

  namespace.use((socket, next) => {
    try {
      if (options.isInitialized && !options.isInitialized()) {
        throw new Error("请先完成 Nexume 初始化。");
      }

      if (!tokensEqual(socket.handshake.auth.token, options.collectorToken)) {
        throw new Error("Collector 连接凭证无效。");
      }

      assertCollectorDescriptor(socket.handshake.auth.collector);
      socket.data.collectorId = socket.handshake.auth.collector.id;
      next();
    } catch (error) {
      next(error instanceof Error ? error : new Error(String(error)));
    }
  });

  namespace.on("connection", (socket) => {
    const descriptor = socket.handshake.auth.collector as CollectorDescriptor;
    const existing = sockets.get(descriptor.id);
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
            return getQueryResult(response, query.limit);
          },
        },
      });
      sockets.set(descriptor.id, socket);

      socket.on("collector:status", () => registration.touch());
      socket.on("disconnect", () => {
        if (sockets.get(descriptor.id)?.id === socket.id) {
          sockets.delete(descriptor.id);
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
    close() {
      io.close();
      engine.close();
    },
  };
}
