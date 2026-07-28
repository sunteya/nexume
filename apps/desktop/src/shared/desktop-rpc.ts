import type { RPCSchema } from "electrobun";

import type {
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
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {};
  }>;
};
