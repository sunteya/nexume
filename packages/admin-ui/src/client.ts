import type {
  AvailableSessionDirectory,
  AiCatalog,
  AiSettings,
  AiSettingsInput,
  AiValidationResult,
  CollectorTokenResult,
  CompleteInitializationInput,
  CreateCollectorInput,
  CreateCollectorResult,
  InitializationStatus,
  GetSessionDetailRequest,
  ListSessionsParams,
  ManagedCollectorInfo,
  CreateProjectInput,
  ProjectInfo,
  RenameCollectorInput,
  RuntimeInfo,
  SessionBatch,
  SessionDetailPage,
  SessionSummary,
  UpdateSessionTitleRequest,
} from "@nexume/contracts"

export interface InitializationClient {
  getInitializationStatus(): Promise<InitializationStatus>
  completeInitialization(
    input: CompleteInitializationInput,
    accessToken?: string,
  ): Promise<InitializationStatus>
}

export interface SessionClient {
  listSessions(params: ListSessionsParams): Promise<SessionBatch>
  getSessionDetail(
    collectorId: string,
    input: GetSessionDetailRequest,
  ): Promise<SessionDetailPage>
  updateSessionTitle(
    collectorId: string,
    input: UpdateSessionTitleRequest,
  ): Promise<SessionSummary>
}

export interface CollectorClient {
  getRuntimeInfo(): Promise<RuntimeInfo>
  list(): Promise<ManagedCollectorInfo[]>
  create(input: CreateCollectorInput): Promise<CreateCollectorResult>
  rename(id: string, input: RenameCollectorInput): Promise<ManagedCollectorInfo>
  delete(id: string): Promise<void>
  sync(id: string): Promise<void>
  getToken(id: string): Promise<CollectorTokenResult>
}

export interface ProjectClient {
  list(): Promise<ProjectInfo[]>
  listDirectories(): Promise<AvailableSessionDirectory[]>
  create(input: CreateProjectInput): Promise<ProjectInfo>
  update(id: string, input: CreateProjectInput): Promise<ProjectInfo>
  delete(id: string): Promise<void>
}

export interface AiSettingsClient {
  getCatalog(): Promise<AiCatalog>
  getSettings(): Promise<AiSettings | null>
  save(input: AiSettingsInput): Promise<AiSettings>
  validate(input: AiSettingsInput): Promise<AiValidationResult>
}
