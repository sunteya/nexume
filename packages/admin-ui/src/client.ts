import type {
  ListSessionsParams,
  SessionPage,
} from "@nexume/contracts";

export interface SessionClient {
  listSessions(params: ListSessionsParams): Promise<SessionPage>;
}
