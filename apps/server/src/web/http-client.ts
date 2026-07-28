import type { SessionClient } from "@nexume/admin-ui";
import type { SessionBatch } from "@nexume/contracts";

interface ApiErrorBody {
  error?: {
    message?: string;
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
        const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
        throw new Error(body.error?.message ?? "读取 Session 失败。");
      }

      return (await response.json()) as SessionBatch;
    },
  };
}
