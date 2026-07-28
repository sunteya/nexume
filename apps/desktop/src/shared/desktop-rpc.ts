import type { RPCSchema } from "electrobun";

import type {
  ListSessionsParams,
  SessionPage,
} from "@nexume/contracts";

export type DesktopRPC = {
  bun: RPCSchema<{
    requests: {
      listSessions: {
        params: ListSessionsParams;
        response: SessionPage;
      };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {};
  }>;
};
