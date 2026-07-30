export const sessionBatchSizes = [20, 50, 100] as const
export const sessionStatuses = ["active", "archived", "deleted"] as const

export type SessionBatchSize = (typeof sessionBatchSizes)[number]
export type SessionStatus = (typeof sessionStatuses)[number]
export type AgentId = string
export type CollectorConnectionType = "local" | "remote"
export type SessionSyncMode = "incremental" | "reconcile"

export interface CollectedSessionSummary {
  id: string
  agent: AgentId
  title: string
  directory: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export interface UpdateSessionTitleRequest {
  agent: AgentId
  id: string
  title: string
  expectedTitle: string
  expectedUpdatedAt: number
}

export interface UpdateSessionTitleResult {
  session: CollectedSessionSummary
}

export interface SessionSummary extends CollectedSessionSummary {
  collectorId: string
  collectorName: string
  deletedAt?: number
}

export interface ListSessionsParams {
  limit: SessionBatchSize
  cursor?: string
  collectorId?: string
  projectId?: string
  unassigned?: boolean
  agent?: AgentId
  title?: string
  status?: SessionStatus
}

export interface ProjectDirectory {
  collectorId: string
  directory: string
}

export interface ProjectInfo {
  id: string
  name: string
  groupName?: string
  directories: ProjectDirectory[]
  createdAt: number
  updatedAt: number
}

export interface CreateProjectInput {
  name: string
  groupName?: string
  directories: ProjectDirectory[]
}

export type UpdateProjectInput = CreateProjectInput

export interface AvailableSessionDirectory extends ProjectDirectory {
  collectorName: string
  projectId?: string
  projectName?: string
}

export interface CollectorQueryWarning {
  collectorId: string
  collectorName: string
  message: string
}

export interface SessionBatch {
  items: SessionSummary[]
  hasMore: boolean
  nextCursor?: string
  warnings: CollectorQueryWarning[]
}

export interface CollectorRuntimeMetadata {
  hostname: string
  version: string
  agents: AgentId[]
}

export interface CollectorDescriptor extends CollectorRuntimeMetadata {
  id: string
  name: string
}

export interface CollectorSocketAuth {
  token: string
  metadata: CollectorRuntimeMetadata
}

export interface CollectorInfo extends CollectorDescriptor {
  connectionType: CollectorConnectionType
  connectedAt: number
  lastSeenAt: number
}

export interface ManagedCollectorInfo {
  id: string
  name: string
  connectionType: CollectorConnectionType
  online: boolean
  hostname?: string
  version?: string
  agents: AgentId[]
  connectedAt?: number
  lastSeenAt?: number
  createdAt: number
  updatedAt: number
}

export interface CompleteInitializationInput {
  initializeLocalCollector: boolean
}

export interface CreateCollectorInput {
  name: string
  connectionType: CollectorConnectionType
}

export interface RenameCollectorInput {
  name: string
}

export interface CreateCollectorResult {
  collector: ManagedCollectorInfo
  token?: string
}

export interface CollectorTokenResult {
  token: string
}

export interface RuntimeInfo {
  kind: "server" | "desktop"
  port: number
  urls: string[]
}

export interface CollectorStatus {
  available: boolean
  message?: string
}

export interface InitializationStatus {
  initialized: boolean
  initializedAt?: number
}

export interface SessionSyncCheckpoint {
  format: string
  value: string
}

export interface BeginSessionSyncRequest {
  agent: AgentId
  checkpointFormat: string
  forceReconcile?: boolean
}

export interface BeginSessionSyncResult {
  runId: string
  mode: SessionSyncMode
  checkpoint?: SessionSyncCheckpoint
  batchSize: number
}

export interface SessionSyncBatchRequest {
  agent: AgentId
  runId: string
  sequence: number
  items: CollectedSessionSummary[]
  checkpoint?: SessionSyncCheckpoint
  complete: boolean
}

export interface SessionSyncBatchResult {
  duplicate: boolean
  upserted: number
  deleted: number
}

export interface CollectorProtocolError {
  code: string
  message: string
}

export type UpdateSessionTitleResponse =
  | { ok: true; data: UpdateSessionTitleResult }
  | { ok: false; error: CollectorProtocolError }

export type BeginSessionSyncResponse =
  | { ok: true; data: BeginSessionSyncResult }
  | { ok: false; error: CollectorProtocolError }

export type SessionSyncBatchResponse =
  | { ok: true; data: SessionSyncBatchResult }
  | { ok: false; error: CollectorProtocolError }

export interface ServerToCollectorEvents {
  "sessions:sync:request": () => void
  "sessions:title:update": (
    request: UpdateSessionTitleRequest,
    acknowledge: (response: UpdateSessionTitleResponse) => void,
  ) => void
}

export interface CollectorToServerEvents {
  "collector:status": (status: CollectorStatus) => void
  "sessions:sync:begin": (
    request: BeginSessionSyncRequest,
    acknowledge: (response: BeginSessionSyncResponse) => void,
  ) => void
  "sessions:sync:batch": (
    request: SessionSyncBatchRequest,
    acknowledge: (response: SessionSyncBatchResponse) => void,
  ) => void
}

export interface InterServerEvents {}

export interface CollectorSocketData {
  collectorId: string
}

export function assertAgentId(value: unknown): asserts value is AgentId {
  if (typeof value !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) {
    throw new Error("Agent ID 无效。")
  }
}

export function assertListSessionsParams(
  params: ListSessionsParams,
): asserts params is ListSessionsParams {
  if (!sessionBatchSizes.includes(params.limit)) {
    throw new Error("Session 每批数量无效。")
  }
  if (params.cursor !== undefined && params.cursor.length === 0) {
    throw new Error("Session 游标无效。")
  }
  if (params.collectorId !== undefined && !params.collectorId.trim()) {
    throw new Error("Collector ID 无效。")
  }
  if (params.projectId !== undefined && !params.projectId.trim()) {
    throw new Error("Project ID 无效。")
  }
  if (
    params.unassigned !== undefined &&
    typeof params.unassigned !== "boolean"
  ) {
    throw new Error("未归类筛选条件无效。")
  }
  if (params.projectId !== undefined && params.unassigned) {
    throw new Error("Project 与未归类筛选条件不能同时使用。")
  }
  if (params.agent !== undefined) assertAgentId(params.agent)
  if (
    params.title !== undefined &&
    (!params.title.trim() || params.title.length > 256)
  ) {
    throw new Error("Session 标题搜索条件无效。")
  }
  if (params.status !== undefined && !sessionStatuses.includes(params.status)) {
    throw new Error("Session 状态无效。")
  }
}

function assertSafeTimestamp(value: unknown, field: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${field} 无效。`)
  }
}

export function assertCollectedSessionSummary(
  value: unknown,
  expectedAgent?: AgentId,
): asserts value is CollectedSessionSummary {
  if (!value || typeof value !== "object") {
    throw new Error("Session 数据无效。")
  }
  const session = value as Partial<CollectedSessionSummary>
  if (
    typeof session.id !== "string" ||
    !session.id ||
    session.id.length > 512 ||
    typeof session.title !== "string" ||
    session.title.length > 4096 ||
    typeof session.directory !== "string" ||
    session.directory.length > 8192
  ) {
    throw new Error("Session 数据不完整。")
  }
  assertAgentId(session.agent)
  if (expectedAgent !== undefined && session.agent !== expectedAgent) {
    throw new Error("Session Agent 与同步任务不一致。")
  }
  assertSafeTimestamp(session.createdAt, "Session 创建时间")
  assertSafeTimestamp(session.updatedAt, "Session 更新时间")
  if (session.archivedAt !== undefined) {
    assertSafeTimestamp(session.archivedAt, "Session 归档时间")
  }
}

export function assertUpdateSessionTitleRequest(
  value: unknown,
): asserts value is UpdateSessionTitleRequest {
  if (!value || typeof value !== "object") {
    throw new Error("Session 标题修改参数无效。")
  }
  const request = value as Partial<UpdateSessionTitleRequest>
  assertAgentId(request.agent)
  if (
    typeof request.id !== "string" ||
    !request.id ||
    request.id.length > 512 ||
    typeof request.title !== "string" ||
    !request.title.trim() ||
    request.title.length > 4096 ||
    typeof request.expectedTitle !== "string" ||
    request.expectedTitle.length > 4096
  ) {
    throw new Error("Session 标题修改参数无效。")
  }
  assertSafeTimestamp(request.expectedUpdatedAt, "Session 预期更新时间")
}

export function assertSessionSyncCheckpoint(
  value: unknown,
): asserts value is SessionSyncCheckpoint {
  if (!value || typeof value !== "object") {
    throw new Error("同步 checkpoint 无效。")
  }
  const checkpoint = value as Partial<SessionSyncCheckpoint>
  if (
    typeof checkpoint.format !== "string" ||
    !checkpoint.format ||
    checkpoint.format.length > 128 ||
    typeof checkpoint.value !== "string" ||
    checkpoint.value.length > 65_536
  ) {
    throw new Error("同步 checkpoint 无效。")
  }
}

export function assertBeginSessionSyncRequest(
  value: unknown,
): asserts value is BeginSessionSyncRequest {
  if (!value || typeof value !== "object") {
    throw new Error("同步开始参数无效。")
  }
  const request = value as Partial<BeginSessionSyncRequest>
  assertAgentId(request.agent)
  if (
    typeof request.checkpointFormat !== "string" ||
    !request.checkpointFormat ||
    request.checkpointFormat.length > 128 ||
    (request.forceReconcile !== undefined &&
      typeof request.forceReconcile !== "boolean")
  ) {
    throw new Error("同步开始参数无效。")
  }
}

export function assertSessionSyncBatchRequest(
  value: unknown,
): asserts value is SessionSyncBatchRequest {
  if (!value || typeof value !== "object") {
    throw new Error("同步批次无效。")
  }
  const request = value as Partial<SessionSyncBatchRequest>
  assertAgentId(request.agent)
  if (
    typeof request.runId !== "string" ||
    !request.runId ||
    request.runId.length > 128 ||
    !Number.isSafeInteger(request.sequence) ||
    (request.sequence as number) < 0 ||
    typeof request.complete !== "boolean" ||
    !Array.isArray(request.items) ||
    request.items.length > 500
  ) {
    throw new Error("同步批次无效。")
  }
  for (const item of request.items) {
    assertCollectedSessionSummary(item, request.agent)
  }
  if (request.checkpoint !== undefined) {
    assertSessionSyncCheckpoint(request.checkpoint)
  }
}

export function assertCollectorDescriptor(
  value: unknown,
): asserts value is CollectorDescriptor {
  if (!value || typeof value !== "object") {
    throw new Error("Collector 信息无效。")
  }
  const descriptor = value as Partial<CollectorDescriptor>
  const strings = [
    descriptor.id,
    descriptor.name,
    descriptor.hostname,
    descriptor.version,
  ]
  if (
    strings.some(
      (item) => typeof item !== "string" || !item.trim() || item.length > 128,
    )
  ) {
    throw new Error("Collector 信息不完整。")
  }
  assertAgentList(descriptor.agents)
}

function assertAgentList(value: unknown): asserts value is AgentId[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("Collector Agent 列表无效。")
  }
  const unique = new Set<string>()
  for (const agent of value) {
    assertAgentId(agent)
    if (unique.has(agent)) throw new Error("Collector Agent 列表重复。")
    unique.add(agent)
  }
}

export function assertCollectorRuntimeMetadata(
  value: unknown,
): asserts value is CollectorRuntimeMetadata {
  if (!value || typeof value !== "object") {
    throw new Error("Collector runtime metadata 无效。")
  }
  const metadata = value as Partial<CollectorRuntimeMetadata>
  if (
    Object.keys(metadata).some(
      (key) => !["hostname", "version", "agents"].includes(key),
    )
  ) {
    throw new Error("Collector runtime metadata 字段无效。")
  }
  if (
    [metadata.hostname, metadata.version].some(
      (item) => typeof item !== "string" || !item.trim() || item.length > 128,
    )
  ) {
    throw new Error("Collector runtime metadata 不完整。")
  }
  assertAgentList(metadata.agents)
}

export function assertCollectorSocketAuth(
  value: unknown,
): asserts value is CollectorSocketAuth {
  if (!value || typeof value !== "object") {
    throw new Error("Collector Socket auth 无效。")
  }
  const auth = value as Partial<CollectorSocketAuth>
  if (Object.keys(auth).some((key) => !["token", "metadata"].includes(key))) {
    throw new Error("Collector Socket auth 字段无效。")
  }
  if (typeof auth.token !== "string" || !auth.token.trim()) {
    throw new Error("Collector Socket token 无效。")
  }
  assertCollectorRuntimeMetadata(auth.metadata)
}

export function assertCollectorName(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 128) {
    throw new Error("Collector 名称必须是 1 到 128 个字符。")
  }
}

export function assertProjectName(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 128) {
    throw new Error("Project 名称必须是 1 到 128 个字符。")
  }
}

export function assertProjectInput(
  value: unknown,
): asserts value is CreateProjectInput {
  if (!value || typeof value !== "object") {
    throw new Error("Project 参数无效。")
  }
  const input = value as Partial<CreateProjectInput>
  assertProjectName(input.name)
  if (
    input.groupName !== undefined &&
    (typeof input.groupName !== "string" || input.groupName.trim().length > 128)
  ) {
    throw new Error("Project 分组名称不能超过 128 个字符。")
  }
  if (!Array.isArray(input.directories) || input.directories.length > 1_000) {
    throw new Error("Project 目录列表无效。")
  }

  const unique = new Set<string>()
  for (const item of input.directories) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.collectorId !== "string" ||
      !item.collectorId.trim() ||
      typeof item.directory !== "string" ||
      !item.directory ||
      item.directory.length > 8_192
    ) {
      throw new Error("Project 目录无效。")
    }
    const key = `${item.collectorId}\u0000${item.directory}`
    if (unique.has(key)) throw new Error("Project 目录不能重复。")
    unique.add(key)
  }
}

export function assertCreateCollectorInput(
  value: unknown,
): asserts value is CreateCollectorInput {
  if (!value || typeof value !== "object") {
    throw new Error("Collector 创建参数无效。")
  }
  const input = value as Partial<CreateCollectorInput>
  assertCollectorName(input.name)
  if (input.connectionType !== "local" && input.connectionType !== "remote") {
    throw new Error("Collector 类型无效。")
  }
}
