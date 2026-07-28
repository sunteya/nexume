import type {
  ListSessionsParams,
  SessionBatch,
} from "@nexume/contracts";

export interface SessionClient {
  listSessions(params: ListSessionsParams): Promise<SessionBatch>;
}
