import {
  assertListSessionsParams,
  type ListSessionsParams,
  type SessionPage,
} from "@nexume/contracts";

export interface SessionSource {
  listSessions(
    params: ListSessionsParams,
  ): SessionPage | Promise<SessionPage>;
}

export interface ServerCore {
  listSessions(params: ListSessionsParams): Promise<SessionPage>;
}

export function createServerCore(sessionSource: SessionSource): ServerCore {
  return {
    async listSessions(params) {
      assertListSessionsParams(params);
      return await sessionSource.listSessions(params);
    },
  };
}
