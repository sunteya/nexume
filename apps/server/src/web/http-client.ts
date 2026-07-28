import type { InitializationClient, SessionClient } from "@nexume/admin-ui";
import type { InitializationStatus, SessionBatch } from "@nexume/contracts";

interface ApiErrorBody {
  error?: {
    message?: string;
  };
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
  return new Error(body.error?.message ?? fallback);
}

export function createHttpInitializationClient(): InitializationClient {
  return {
    async getInitializationStatus() {
      const response = await fetch("/api/v1/setup/status");
      if (!response.ok) throw await responseError(response, "读取初始化状态失败。");
      return (await response.json()) as InitializationStatus;
    },

    async completeInitialization(accessToken) {
      const response = await fetch("/api/v1/setup/complete", {
        method: "POST",
        headers: accessToken
          ? { Authorization: `Bearer ${accessToken}` }
          : undefined,
      });
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
      const url = new URL("/api/v1/sessions", window.location.origin);
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
