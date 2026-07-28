import { io, type Socket } from "socket.io-client";

import {
  assertCollectorSessionQuery,
  type CollectorDescriptor,
  type CollectorSessionBatch,
  type CollectorSessionQuery,
  type CollectorToServerEvents,
  type ServerToCollectorEvents,
} from "@nexume/contracts";

export interface CollectorDataSource {
  readonly available: boolean;
  querySessions(
    query: CollectorSessionQuery,
  ): CollectorSessionBatch | Promise<CollectorSessionBatch>;
}

export type CollectorConnectionState =
  | "disconnected"
  | "connecting"
  | "connected";

export interface CollectorConnectionOptions {
  serverUrl: string;
  token: string;
  descriptor: CollectorDescriptor;
  source: CollectorDataSource;
  onStateChange?: (state: CollectorConnectionState, detail?: string) => void;
}

type CollectorSocket = Socket<ServerToCollectorEvents, CollectorToServerEvents>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CollectorConnection {
  readonly socket: CollectorSocket;

  constructor(private readonly options: CollectorConnectionOptions) {
    const serverUrl = options.serverUrl.replace(/\/$/, "");
    this.socket = io(`${serverUrl}/collectors`, {
      path: "/socket.io",
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      auth: {
        token: options.token,
        collector: options.descriptor,
      },
    });

    this.socket.on("connect", () => {
      options.onStateChange?.("connected");
      this.socket.emit("collector:status", {
        available: options.source.available,
      });
    });
    this.socket.on("disconnect", (reason) => {
      options.onStateChange?.("disconnected", reason);
    });
    this.socket.on("connect_error", (error) => {
      options.onStateChange?.("disconnected", error.message);
    });
    this.socket.on("sessions:list", async (query, acknowledge) => {
      try {
        assertCollectorSessionQuery(query);
        acknowledge({
          ok: true,
          data: await options.source.querySessions(query),
        });
      } catch (error) {
        acknowledge({
          ok: false,
          error: {
            code: "collector_query_failed",
            message: getErrorMessage(error),
          },
        });
      }
    });
  }

  connect(): void {
    if (this.socket.connected || this.socket.active) return;
    this.options.onStateChange?.("connecting");
    this.socket.connect();
  }

  disconnect(): void {
    this.socket.disconnect();
  }
}
