export const sessionBatchSizes = [20, 50, 100] as const;

export type SessionBatchSize = (typeof sessionBatchSizes)[number];
export type AgentType = "opencode";
export type CollectorConnectionType = "local" | "remote";

export interface CollectedSessionSummary {
  id: string;
  agent: AgentType;
  title: string;
  directory: string;
  createdAt: number;
  updatedAt: number;
}

export interface SessionSummary extends CollectedSessionSummary {
  collectorId: string;
  collectorName: string;
}

export interface SessionPosition {
  updatedAt: number;
  agent: AgentType;
  id: string;
}

export interface CollectorSessionQuery {
  asOf: number;
  limit: SessionBatchSize;
  cursor?: SessionPosition;
}

export interface CollectorSessionBatch {
  items: CollectedSessionSummary[];
  hasMore: boolean;
}

export interface ListSessionsParams {
  limit: SessionBatchSize;
  cursor?: string;
}

export interface CollectorQueryWarning {
  collectorId: string;
  collectorName: string;
  message: string;
}

export interface SessionBatch {
  items: SessionSummary[];
  hasMore: boolean;
  nextCursor?: string;
  warnings: CollectorQueryWarning[];
}

export interface CollectorRuntimeMetadata {
  hostname: string;
  version: string;
  agents: AgentType[];
}

export interface CollectorDescriptor extends CollectorRuntimeMetadata {
  id: string;
  name: string;
}

export interface CollectorSocketAuth {
  token: string;
  metadata: CollectorRuntimeMetadata;
}

export interface CollectorInfo extends CollectorDescriptor {
  connectionType: CollectorConnectionType;
  connectedAt: number;
  lastSeenAt: number;
}

export interface ManagedCollectorInfo {
  id: string;
  name: string;
  connectionType: CollectorConnectionType;
  online: boolean;
  hostname?: string;
  version?: string;
  agents: AgentType[];
  connectedAt?: number;
  lastSeenAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CompleteInitializationInput {
  initializeLocalCollector: boolean;
}

export interface CreateCollectorInput {
  name: string;
  connectionType: CollectorConnectionType;
}

export interface RenameCollectorInput {
  name: string;
}

export interface CreateCollectorResult {
  collector: ManagedCollectorInfo;
  token?: string;
}

export interface CollectorTokenResult {
  token: string;
}

export interface RuntimeInfo {
  kind: "server" | "desktop";
  port: number;
  urls: string[];
}

export interface CollectorStatus {
  available: boolean;
  message?: string;
}

export interface InitializationStatus {
  initialized: boolean;
  initializedAt?: number;
}

export interface CollectorQueryError {
  code: string;
  message: string;
}

export type CollectorQueryResponse =
  | { ok: true; data: CollectorSessionBatch }
  | { ok: false; error: CollectorQueryError };

export interface ServerToCollectorEvents {
  "sessions:list": (
    query: CollectorSessionQuery,
    acknowledge: (response: CollectorQueryResponse) => void,
  ) => void;
}

export interface CollectorToServerEvents {
  "collector:status": (status: CollectorStatus) => void;
}

export interface InterServerEvents {}

export interface CollectorSocketData {
  collectorId: string;
}

export function assertListSessionsParams(
  params: ListSessionsParams,
): asserts params is ListSessionsParams {
  if (!sessionBatchSizes.includes(params.limit)) {
    throw new Error("Session 每批数量无效。");
  }

  if (params.cursor !== undefined && params.cursor.length === 0) {
    throw new Error("Session 游标无效。");
  }
}

export function assertCollectorSessionQuery(
  query: CollectorSessionQuery,
): asserts query is CollectorSessionQuery {
  if (!Number.isSafeInteger(query.asOf) || query.asOf < 0) {
    throw new Error("Session 查询时间无效。");
  }

  if (!sessionBatchSizes.includes(query.limit)) {
    throw new Error("Session 每批数量无效。");
  }

  if (query.cursor) {
    if (!Number.isSafeInteger(query.cursor.updatedAt)) {
      throw new Error("Session 游标时间无效。");
    }

    if (!query.cursor.id || query.cursor.agent !== "opencode") {
      throw new Error("Session 游标内容无效。");
    }
  }
}

export function assertCollectorDescriptor(
  value: unknown,
): asserts value is CollectorDescriptor {
  if (!value || typeof value !== "object") {
    throw new Error("Collector 信息无效。");
  }

  const descriptor = value as Partial<CollectorDescriptor>;
  const strings = [
    descriptor.id,
    descriptor.name,
    descriptor.hostname,
    descriptor.version,
  ];

  if (
    strings.some(
      (item) => typeof item !== "string" || !item.trim() || item.length > 128,
    )
  ) {
    throw new Error("Collector 信息不完整。");
  }

  if (
    !Array.isArray(descriptor.agents) ||
    descriptor.agents.length === 0 ||
    descriptor.agents.some((agent) => agent !== "opencode")
  ) {
    throw new Error("Collector Agent 列表无效。");
  }
}

export function assertCollectorRuntimeMetadata(
  value: unknown,
): asserts value is CollectorRuntimeMetadata {
  if (!value || typeof value !== "object") {
    throw new Error("Collector runtime metadata 无效。");
  }

  const metadata = value as Partial<CollectorRuntimeMetadata>;
  if (
    Object.keys(metadata).some(
      (key) => !["hostname", "version", "agents"].includes(key),
    )
  ) {
    throw new Error("Collector runtime metadata 字段无效。");
  }

  const strings = [metadata.hostname, metadata.version];
  if (
    strings.some(
      (item) => typeof item !== "string" || !item.trim() || item.length > 128,
    )
  ) {
    throw new Error("Collector runtime metadata 不完整。");
  }

  if (
    !Array.isArray(metadata.agents) ||
    metadata.agents.length === 0 ||
    metadata.agents.some((agent) => agent !== "opencode")
  ) {
    throw new Error("Collector Agent 列表无效。");
  }
}

export function assertCollectorSocketAuth(
  value: unknown,
): asserts value is CollectorSocketAuth {
  if (!value || typeof value !== "object") {
    throw new Error("Collector Socket auth 无效。");
  }

  const auth = value as Partial<CollectorSocketAuth>;
  if (Object.keys(auth).some((key) => !["token", "metadata"].includes(key))) {
    throw new Error("Collector Socket auth 字段无效。");
  }

  if (typeof auth.token !== "string" || !auth.token.trim()) {
    throw new Error("Collector Socket token 无效。");
  }

  assertCollectorRuntimeMetadata(auth.metadata);
}

export function assertCollectorName(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 128) {
    throw new Error("Collector 名称必须是 1 到 128 个字符。");
  }
}

export function assertCreateCollectorInput(
  value: unknown,
): asserts value is CreateCollectorInput {
  if (!value || typeof value !== "object") {
    throw new Error("Collector 创建参数无效。");
  }

  const input = value as Partial<CreateCollectorInput>;
  assertCollectorName(input.name);
  if (input.connectionType !== "local" && input.connectionType !== "remote") {
    throw new Error("Collector 类型无效。");
  }
}
