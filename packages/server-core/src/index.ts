import {
  assertCollectorSessionQuery,
  assertListSessionsParams,
  type CollectedSessionSummary,
  type CollectorConnectionType,
  type CollectorDescriptor,
  type CollectorInfo,
  type CollectorQueryWarning,
  type CollectorSessionBatch,
  type CollectorSessionQuery,
  type ListSessionsParams,
  type SessionBatch,
  type SessionPosition,
  type SessionSummary,
} from "@nexume/contracts";

export interface CollectorSource {
  querySessions(
    query: CollectorSessionQuery,
  ): CollectorSessionBatch | Promise<CollectorSessionBatch>;
}

export interface RegisterCollectorOptions {
  descriptor: CollectorDescriptor;
  connectionType: CollectorConnectionType;
  source: CollectorSource;
}

export interface CollectorRegistration {
  touch(): void;
  unregister(): void;
}

export interface ServerCore {
  registerCollector(options: RegisterCollectorOptions): CollectorRegistration;
  listCollectors(): CollectorInfo[];
  listSessions(params: ListSessionsParams): Promise<SessionBatch>;
}

interface RegistryEntry {
  generation: symbol;
  info: CollectorInfo;
  source: CollectorSource;
}

interface AggregateCursorEntry {
  id: string;
  name: string;
  position: SessionPosition | null;
}

interface AggregateCursor {
  version: 1;
  asOf: number;
  collectors: AggregateCursorEntry[];
}

interface SuccessfulQuery {
  cursorEntry: AggregateCursorEntry;
  registryEntry: RegistryEntry;
  batch: CollectorSessionBatch;
}

interface PendingQuery {
  cursorEntry: AggregateCursorEntry;
  promise: Promise<SuccessfulQuery>;
}

export class CollectorRegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollectorRegistrationError";
  }
}

export class InvalidSessionCursorError extends Error {
  constructor(message = "Session 游标无效或已经过期。") {
    super(message);
    this.name = "InvalidSessionCursorError";
  }
}

export class CollectorQueryFailedError extends Error {
  constructor(readonly warnings: CollectorQueryWarning[]) {
    super("当前没有 Collector 能够完成 Session 查询。");
    this.name = "CollectorQueryFailedError";
  }
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareSessions(left: SessionSummary, right: SessionSummary): number {
  return (
    right.updatedAt - left.updatedAt ||
    compareStrings(left.collectorId, right.collectorId) ||
    compareStrings(left.agent, right.agent) ||
    compareStrings(left.id, right.id)
  );
}

function sessionPosition(session: CollectedSessionSummary): SessionPosition {
  return {
    updatedAt: session.updatedAt,
    agent: session.agent,
    id: session.id,
  };
}

function encodeCursor(cursor: AggregateCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: string): AggregateCursor {
  try {
    const decoded = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<AggregateCursor>;

    if (
      decoded.version !== 1 ||
      typeof decoded.asOf !== "number" ||
      !Number.isSafeInteger(decoded.asOf) ||
      !Array.isArray(decoded.collectors)
    ) {
      throw new InvalidSessionCursorError();
    }

    const ids = new Set<string>();
    for (const entry of decoded.collectors) {
      if (
        !entry ||
        typeof entry.id !== "string" ||
        !entry.id ||
        typeof entry.name !== "string" ||
        !entry.name ||
        ids.has(entry.id)
      ) {
        throw new InvalidSessionCursorError();
      }
      ids.add(entry.id);

      if (entry.position === undefined) {
        throw new InvalidSessionCursorError();
      }

      if (entry.position !== null) {
        assertCollectorSessionQuery({
          asOf: decoded.asOf,
          limit: 20,
          cursor: entry.position,
        });
      }
    }

    return decoded as AggregateCursor;
  } catch (error) {
    if (error instanceof InvalidSessionCursorError) throw error;
    throw new InvalidSessionCursorError();
  }
}

function warningFor(
  cursorEntry: AggregateCursorEntry,
  error: unknown,
): CollectorQueryWarning {
  return {
    collectorId: cursorEntry.id,
    collectorName: cursorEntry.name,
    message: error instanceof Error ? error.message : String(error),
  };
}

export function createServerCore(): ServerCore {
  const registry = new Map<string, RegistryEntry>();

  return {
    registerCollector(options) {
      const existing = registry.get(options.descriptor.id);
      if (existing?.info.connectionType === "local") {
        throw new CollectorRegistrationError(
          `Collector ID ${options.descriptor.id} 已由内部 Collector 使用。`,
        );
      }

      const now = Date.now();
      const generation = Symbol(options.descriptor.id);
      const entry: RegistryEntry = {
        generation,
        source: options.source,
        info: {
          ...options.descriptor,
          connectionType: options.connectionType,
          connectedAt: now,
          lastSeenAt: now,
        },
      };
      registry.set(options.descriptor.id, entry);

      return {
        touch() {
          const current = registry.get(options.descriptor.id);
          if (current?.generation === generation) {
            current.info.lastSeenAt = Date.now();
          }
        },
        unregister() {
          const current = registry.get(options.descriptor.id);
          if (current?.generation === generation) {
            registry.delete(options.descriptor.id);
          }
        },
      };
    },

    listCollectors() {
      return [...registry.values()]
        .map((entry) => ({ ...entry.info, agents: [...entry.info.agents] }))
        .sort(
          (left, right) =>
            compareStrings(left.connectionType, right.connectionType) ||
            compareStrings(left.name, right.name) ||
            compareStrings(left.id, right.id),
        );
    },

    async listSessions(params) {
      assertListSessionsParams(params);
      const aggregateCursor = params.cursor
        ? decodeCursor(params.cursor)
        : {
            version: 1 as const,
            asOf: Date.now(),
            collectors: [...registry.values()].map((entry) => ({
              id: entry.info.id,
              name: entry.info.name,
              position: null,
            })),
          };
      const warnings: CollectorQueryWarning[] = [];
      const pendingQueries: PendingQuery[] = [];

      for (const cursorEntry of aggregateCursor.collectors) {
        const registryEntry = registry.get(cursorEntry.id);
        if (!registryEntry) {
          warnings.push(
            warningFor(cursorEntry, new Error("Collector 已断开连接。")),
          );
          continue;
        }

        pendingQueries.push({
          cursorEntry,
          promise: Promise.resolve()
            .then(() =>
              registryEntry.source.querySessions({
                asOf: aggregateCursor.asOf,
                limit: params.limit,
                cursor: cursorEntry.position ?? undefined,
              }),
            )
            .then((batch) => ({ cursorEntry, registryEntry, batch })),
        });
      }

      const settled = await Promise.allSettled(
        pendingQueries.map((query) => query.promise),
      );
      const successful: SuccessfulQuery[] = [];

      for (const [index, result] of settled.entries()) {
        if (result.status === "fulfilled") {
          result.value.registryEntry.info.lastSeenAt = Date.now();
          successful.push(result.value);
        } else {
          warnings.push(
            warningFor(pendingQueries[index]!.cursorEntry, result.reason),
          );
        }
      }

      if (successful.length === 0) {
        if (warnings.length === 0) {
          warnings.push({
            collectorId: "server",
            collectorName: "Server",
            message: "当前没有已连接的 Collector。",
          });
        }
        throw new CollectorQueryFailedError(warnings);
      }

      const candidates = successful
        .flatMap(({ registryEntry, batch }) =>
          batch.items.map((session) => ({
            ...session,
            collectorId: registryEntry.info.id,
            collectorName: registryEntry.info.name,
          })),
        )
        .sort(compareSessions);
      const items = candidates.slice(0, params.limit);
      const selectedByCollector = new Map<string, SessionSummary[]>();

      for (const item of items) {
        const selected = selectedByCollector.get(item.collectorId) ?? [];
        selected.push(item);
        selectedByCollector.set(item.collectorId, selected);
      }

      const nextEntries: AggregateCursorEntry[] = [];
      for (const result of successful) {
        const selected = selectedByCollector.get(result.cursorEntry.id) ?? [];
        const sourceHasMore =
          result.batch.hasMore || selected.length < result.batch.items.length;
        if (!sourceHasMore) continue;

        nextEntries.push({
          id: result.cursorEntry.id,
          name: result.registryEntry.info.name,
          position: selected.length
            ? sessionPosition(selected.at(-1)!)
            : result.cursorEntry.position,
        });
      }

      const hasMore = nextEntries.length > 0;
      return {
        items,
        hasMore,
        nextCursor: hasMore
          ? encodeCursor({
              version: 1,
              asOf: aggregateCursor.asOf,
              collectors: nextEntries,
            })
          : undefined,
        warnings,
      };
    },
  };
}
