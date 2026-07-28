import type {
  CollectorClient,
  InitializationClient,
  SessionClient,
} from "./client";
import type {
  CollectorTokenResult,
  CompleteInitializationInput,
  CreateCollectorInput,
  CreateCollectorResult,
  InitializationStatus,
  ManagedCollectorInfo,
  RenameCollectorInput,
  RuntimeInfo,
  SessionBatch,
} from "@nexume/contracts";

interface ApiErrorBody {
  error?: {
    message?: string;
  };
}

interface CollectorListResult {
  items: ManagedCollectorInfo[];
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
  return new Error(body.error?.message ?? fallback);
}

export function createHttpInitializationClient(
  onUnauthorized?: () => void,
): InitializationClient {
  return {
    async getInitializationStatus() {
      const response = await fetch("/api/setup/status");
      if (!response.ok) throw await responseError(response, "读取初始化状态失败。");
      return (await response.json()) as InitializationStatus;
    },

    async completeInitialization(input: CompleteInitializationInput, accessToken) {
      const response = await fetch("/api/setup/complete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify(input),
      });
      if (response.status === 401) onUnauthorized?.();
      if (!response.ok) throw await responseError(response, "初始化 Nexume 失败。");
      return (await response.json()) as InitializationStatus;
    },
  };
}

export function createHttpSessionClient(
  accessToken: string,
  onUnauthorized: () => void,
): SessionClient {
  return {
    async listSessions(params) {
      const url = new URL("/api/sessions", window.location.origin);
      url.searchParams.set("limit", String(params.limit));
      if (params.cursor) url.searchParams.set("cursor", params.cursor);

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (response.status === 401) {
        onUnauthorized();
        throw new Error("访问令牌无效。");
      }

      if (!response.ok) {
        throw await responseError(response, "读取 Session 失败。");
      }

      return (await response.json()) as SessionBatch;
    },
  };
}

export function createHttpCollectorClient(
  accessToken: string,
  onUnauthorized: () => void,
): CollectorClient {
  async function request(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const response = await fetch(input, {
      ...init,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...init?.headers,
      },
    });

    if (response.status === 401) {
      onUnauthorized();
      throw new Error("访问令牌无效。");
    }

    return response;
  }

  return {
    async getRuntimeInfo() {
      const response = await request("/api/runtime");
      if (!response.ok) throw await responseError(response, "读取运行信息失败。");
      return (await response.json()) as RuntimeInfo;
    },

    async list() {
      const response = await request("/api/collectors");
      if (!response.ok) throw await responseError(response, "读取 Collector 失败。");
      return ((await response.json()) as CollectorListResult).items;
    },

    async create(input: CreateCollectorInput) {
      const response = await request("/api/collectors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw await responseError(response, "创建 Collector 失败。");
      return (await response.json()) as CreateCollectorResult;
    },

    async rename(id: string, input: RenameCollectorInput) {
      const response = await request(`/api/collectors/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) throw await responseError(response, "修改 Collector 名称失败。");
      return (await response.json()) as ManagedCollectorInfo;
    },

    async delete(id: string) {
      const response = await request(`/api/collectors/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw await responseError(response, "删除 Collector 失败。");
    },

    async getToken(id: string) {
      const response = await request(
        `/api/collectors/${encodeURIComponent(id)}/token`,
      );
      if (!response.ok) {
        throw await responseError(response, "读取 Collector token 失败。");
      }
      return (await response.json()) as CollectorTokenResult;
    },
  };
}
