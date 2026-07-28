import { io, type Socket } from "socket.io-client";

import {
  assertCollectorSessionQuery,
  type CollectorSessionBatch,
  type CollectorSessionQuery,
  type CollectorRuntimeMetadata,
  type CollectorSocketAuth,
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
  metadata: CollectorRuntimeMetadata;
  source: CollectorDataSource;
  onStateChange?: (state: CollectorConnectionState, detail?: string) => void;
}

type CollectorSocket = Socket<ServerToCollectorEvents, CollectorToServerEvents>;

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CollectorConnection {
  readonly socket: CollectorSocket;
  private heartbeat?: ReturnType<typeof setInterval>;

  constructor(private readonly options: CollectorConnectionOptions) {
    const serverUrl = options.serverUrl.replace(/\/$/, "");
    const auth: CollectorSocketAuth = {
      token: options.token,
      metadata: options.metadata,
    };
    this.socket = io(serverUrl, {
      path: "/socket.io",
      autoConnect: false,
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 30_000,
      auth,
    });

    this.socket.on("connect", () => {
      options.onStateChange?.("connected");
      this.sendStatus();
      this.heartbeat = setInterval(() => this.sendStatus(), 30_000);
    });
    this.socket.on("disconnect", (reason) => {
      this.clearHeartbeat();
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
    this.clearHeartbeat();
    this.socket.disconnect();
  }

  private sendStatus(): void {
    this.socket.emit("collector:status", {
      available: this.options.source.available,
    });
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }
}
