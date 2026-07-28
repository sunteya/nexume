import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import {
  assertCollectorName,
  type CollectorRuntimeMetadata,
  type CreateCollectorInput,
  type CreateCollectorResult,
  type ManagedCollectorInfo,
} from "@nexume/contracts";
import type {
  CollectorRegistration,
  CollectorSource,
  ServerCore,
} from "@nexume/server-core";
import type { CollectorRecord, CollectorStore } from "@nexume/storage";

export class CollectorManagementError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CollectorManagementError";
  }
}

export interface CollectorManagementOptions {
  collectors: CollectorStore;
  core: ServerCore;
  localSource: CollectorSource;
  localMetadata: CollectorRuntimeMetadata;
}

function collectorIdFromToken(token: string): string | undefined {
  if (!token.startsWith("nxc_")) return undefined;
  const separator = token.indexOf(".", 4);
  return separator > 4 ? token.slice(4, separator) : undefined;
}

function tokensEqual(actual: string, expected: string): boolean {
  const encoder = new TextEncoder();
  const actualBytes = encoder.encode(actual);
  const expectedBytes = encoder.encode(expected);
  return actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes);
}

function managedInfo(
  record: CollectorRecord,
  online: ReturnType<ServerCore["listCollectors"]>[number] | undefined,
): ManagedCollectorInfo {
  return {
    id: record.id,
    name: record.name,
    connectionType: record.connectionType,
    online: Boolean(online),
    hostname: online?.hostname ?? record.hostname ?? undefined,
    version: online?.version ?? record.version ?? undefined,
    agents: [...(online?.agents ?? record.agents ?? [])],
    connectedAt: online?.connectedAt ?? record.connectedAt ?? undefined,
    lastSeenAt: online?.lastSeenAt ?? record.lastSeenAt ?? undefined,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export class CollectorManagementService {
  private localRegistration?: CollectorRegistration;
  private disconnectRemote: (id: string) => void = () => {};

  constructor(private readonly options: CollectorManagementOptions) {}

  setRemoteDisconnect(disconnect: (id: string) => void): void {
    this.disconnectRemote = disconnect;
  }

  syncLocalCollector(): void {
    const record = this.options.collectors.get("local");
    if (!record || record.connectionType !== "local" || this.localRegistration) {
      return;
    }

    const now = Date.now();
    this.localRegistration = this.options.core.registerCollector({
      descriptor: {
        id: record.id,
        name: record.name,
        ...this.options.localMetadata,
      },
      connectionType: "local",
      source: this.options.localSource,
    });
    this.options.collectors.updateRuntime(record.id, {
      ...this.options.localMetadata,
      connectedAt: now,
      lastSeenAt: now,
    });
  }

  list(): ManagedCollectorInfo[] {
    const online = new Map(
      this.options.core.listCollectors().map((collector) => [collector.id, collector]),
    );
    return this.options.collectors
      .list()
      .map((record) => managedInfo(record, online.get(record.id)));
  }

  create(input: CreateCollectorInput): CreateCollectorResult {
    assertCollectorName(input.name);
    const name = input.name.trim();

    if (input.connectionType === "local") {
      if (this.options.collectors.list().some((item) => item.connectionType === "local")) {
        throw new CollectorManagementError(
          "local_collector_exists",
          "本机 Collector 已经存在。",
          409,
        );
      }

      let record: CollectorRecord;
      try {
        record = this.options.collectors.create({
          id: "local",
          name,
          connectionType: "local",
        });
      } catch (error) {
        if (this.options.collectors.list().some((item) => item.connectionType === "local")) {
          throw new CollectorManagementError(
            "local_collector_exists",
            "本机 Collector 已经存在。",
            409,
          );
        }
        throw error;
      }
      try {
        this.syncLocalCollector();
      } catch (error) {
        this.options.collectors.delete(record.id);
        throw error;
      }
      return { collector: this.getManaged(record.id) };
    }

    const id = randomUUID();
    const token = `nxc_${id}.${randomBytes(32).toString("base64url")}`;
    const record = this.options.collectors.create({
      id,
      name,
      connectionType: "remote",
      token,
    });
    return { collector: managedInfo(record, undefined), token };
  }

  rename(id: string, name: string): ManagedCollectorInfo {
    assertCollectorName(name);
    const record = this.options.collectors.updateName(id, name.trim());
    if (!record) throw this.notFound();
    this.options.core.renameCollector(id, record.name);
    return this.getManaged(id);
  }

  delete(id: string): void {
    const record = this.options.collectors.get(id);
    if (!record) throw this.notFound();

    this.options.collectors.delete(id);
    if (record.connectionType === "local") {
      this.localRegistration?.unregister();
      this.localRegistration = undefined;
    } else {
      this.disconnectRemote(id);
    }
  }

  revealToken(id: string): string {
    const record = this.options.collectors.get(id);
    if (!record) throw this.notFound();
    if (record.connectionType !== "remote") {
      throw new CollectorManagementError(
        "collector_has_no_token",
        "本机 Collector 不使用连接 token。",
        409,
      );
    }

    const token = record.token;
    if (!token) {
      throw new CollectorManagementError(
        "collector_token_unavailable",
        "Collector token 无法读取。",
        500,
      );
    }
    return token;
  }

  authenticate(token: string): Pick<CollectorRecord, "id" | "name"> | undefined {
    const id = collectorIdFromToken(token);
    if (!id) return undefined;
    const record = this.options.collectors.get(id);
    return record?.connectionType === "remote" && record.token && tokensEqual(token, record.token)
      ? { id: record.id, name: record.name }
      : undefined;
  }

  getRemote(id: string): Pick<CollectorRecord, "id" | "name"> | undefined {
    const record = this.options.collectors.get(id);
    return record?.connectionType === "remote"
      ? { id: record.id, name: record.name }
      : undefined;
  }

  connected(id: string, metadata: CollectorRuntimeMetadata): void {
    const now = Date.now();
    this.options.collectors.updateRuntime(id, {
      ...metadata,
      connectedAt: now,
      lastSeenAt: now,
    });
  }

  touched(id: string): void {
    const record = this.options.collectors.get(id);
    if (!record) return;
    this.options.collectors.updateRuntime(id, {
      hostname: record.hostname,
      version: record.version,
      agents: record.agents,
      connectedAt: record.connectedAt,
      lastSeenAt: Date.now(),
    });
  }

  private getManaged(id: string): ManagedCollectorInfo {
    const record = this.options.collectors.get(id);
    if (!record) throw this.notFound();
    const online = this.options.core
      .listCollectors()
      .find((collector) => collector.id === id);
    return managedInfo(record, online);
  }

  private notFound(): CollectorManagementError {
    return new CollectorManagementError(
      "collector_not_found",
      "Collector 不存在。",
      404,
    );
  }
}
