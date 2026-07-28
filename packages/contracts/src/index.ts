export const sessionPageSizes = [20, 50, 100] as const;

export type SessionPageSize = (typeof sessionPageSizes)[number];
export type AgentType = "opencode";

export interface SessionSummary {
  id: string;
  agent: AgentType;
  title: string;
  directory: string;
  createdAt: number;
  updatedAt: number;
}

export interface ListSessionsParams {
  page: number;
  pageSize: SessionPageSize;
}

export interface SessionPage {
  items: SessionSummary[];
  page: number;
  pageSize: SessionPageSize;
  total: number;
}

export function assertListSessionsParams(
  params: ListSessionsParams,
): asserts params is ListSessionsParams {
  if (!Number.isInteger(params.page) || params.page < 1) {
    throw new Error("Session 页码无效。");
  }

  if (!sessionPageSizes.includes(params.pageSize)) {
    throw new Error("Session 每页数量无效。");
  }
}
