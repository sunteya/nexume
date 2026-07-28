import type {
  CollectorTokenResult,
  CompleteInitializationInput,
  CreateCollectorInput,
  CreateCollectorResult,
  InitializationStatus,
  ListSessionsParams,
  ManagedCollectorInfo,
  RenameCollectorInput,
  RuntimeInfo,
  SessionBatch,
} from "@nexume/contracts";

export interface InitializationClient {
  getInitializationStatus(): Promise<InitializationStatus>;
  completeInitialization(
    input: CompleteInitializationInput,
    accessToken?: string,
  ): Promise<InitializationStatus>;
}

export interface SessionClient {
  listSessions(params: ListSessionsParams): Promise<SessionBatch>;
}

export interface CollectorClient {
  getRuntimeInfo(): Promise<RuntimeInfo>;
  list(): Promise<ManagedCollectorInfo[]>;
  create(input: CreateCollectorInput): Promise<CreateCollectorResult>;
  rename(
    id: string,
    input: RenameCollectorInput,
  ): Promise<ManagedCollectorInfo>;
  delete(id: string): Promise<void>;
  getToken(id: string): Promise<CollectorTokenResult>;
}
