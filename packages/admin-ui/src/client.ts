import type {
  AvailableSessionDirectory,
  CollectorTokenResult,
  CompleteInitializationInput,
  CreateCollectorInput,
  CreateCollectorResult,
  InitializationStatus,
  ListSessionsParams,
  ManagedCollectorInfo,
  CreateProjectInput,
  ProjectInfo,
  RenameCollectorInput,
  RuntimeInfo,
  SessionBatch,
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
