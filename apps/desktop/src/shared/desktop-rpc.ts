import type { RPCSchema } from "electrobun";

import type {
  InitializationStatus,
  ListSessionsParams,
  SessionBatch,
} from "@nexume/contracts";

export type DesktopRPC = {
  bun: RPCSchema<{
    requests: {
      listSessions: {
        params: ListSessionsParams;
        response: SessionBatch;
      };
      getInitializationStatus: {
        params: undefined;
        response: InitializationStatus;
      };
      completeInitialization: {
        params: Record<string, never>;
        response: InitializationStatus;
      };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {};
  }>;
};
