import type {
  InitializationStatus,
  ListSessionsParams,
  SessionBatch,
} from "@nexume/contracts";

export interface InitializationClient {
  getInitializationStatus(): Promise<InitializationStatus>;
  completeInitialization(accessToken?: string): Promise<InitializationStatus>;
}

export interface SessionClient {
  listSessions(params: ListSessionsParams): Promise<SessionBatch>;
}
