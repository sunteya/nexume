import type { RPCSchema } from "electrobun";

export const sessionPageSizes = [20, 50, 100] as const;

export type SessionPageSize = (typeof sessionPageSizes)[number];

export interface OpenCodeSessionSummary {
  id: string;
  title: string;
  directory: string;
  createdAt: number;
  updatedAt: number;
}

export interface ListOpenCodeSessionsParams {
  page: number;
  pageSize: SessionPageSize;
}

export interface OpenCodeSessionPage {
  items: OpenCodeSessionSummary[];
  page: number;
  pageSize: SessionPageSize;
  total: number;
}

export type DesktopRPC = {
  bun: RPCSchema<{
    requests: {
      listOpenCodeSessions: {
        params: ListOpenCodeSessionsParams;
        response: OpenCodeSessionPage;
      };
    };
    messages: {};
  }>;
  webview: RPCSchema<{
    requests: {};
    messages: {};
  }>;
};
