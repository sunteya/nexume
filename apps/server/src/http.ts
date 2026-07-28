import { timingSafeEqual } from "node:crypto";
import { resolve, sep } from "node:path";

import {
  CollectorUnavailableError,
  UnsupportedCollectorDataError,
} from "@nexume/collector-core";
import {
  assertListSessionsParams,
  type ListSessionsParams,
  type SessionPageSize,
} from "@nexume/contracts";
import type { ServerCore } from "@nexume/server-core";

interface ErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface RequestHandlerOptions {
  accessToken: string;
  core: ServerCore;
  webRoot?: string;
  onError?: (error: unknown) => void;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function errorResponse(code: string, message: string, status: number): Response {
  return json({ error: { code, message } } satisfies ErrorBody, status);
}

function hasValidToken(request: Request, expectedToken: string): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;

  const encoder = new TextEncoder();
  const actual = encoder.encode(authorization.slice(7));
  const expected = encoder.encode(expectedToken);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function parseSessionParams(url: URL): ListSessionsParams {
  const pageValue = url.searchParams.get("page");
  const pageSizeValue = url.searchParams.get("pageSize");
  const params = {
    page: pageValue === null ? 1 : Number(pageValue),
    pageSize: (pageSizeValue === null ? 50 : Number(pageSizeValue)) as SessionPageSize,
  };

  assertListSessionsParams(params);
  return params;
}

async function serveWebFile(webRoot: string, url: URL): Promise<Response> {
  let pathname: string;

  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const root = resolve(webRoot);
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const requestedPath = resolve(root, relativePath);

  if (requestedPath !== root && !requestedPath.startsWith(`${root}${sep}`)) {
    return new Response("Not Found", { status: 404 });
  }

  const requestedFile = Bun.file(requestedPath);
  if (await requestedFile.exists()) return new Response(requestedFile);

  const indexFile = Bun.file(resolve(root, "index.html"));
  if (await indexFile.exists()) return new Response(indexFile);

  return new Response("Nexume Web UI has not been built.", { status: 503 });
}

export function createRequestHandler(options: RequestHandlerOptions) {
  return async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/v1/health") {
      return json({ status: "ok" });
    }

    if (url.pathname.startsWith("/api/")) {
      if (!hasValidToken(request, options.accessToken)) {
        return errorResponse(
          "unauthorized",
          "访问令牌无效或缺失。",
          401,
        );
      }

      if (request.method === "GET" && url.pathname === "/api/v1/sessions") {
        let params: ListSessionsParams;

        try {
          params = parseSessionParams(url);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return errorResponse("invalid_request", message, 400);
        }

        try {
          return json(await options.core.listSessions(params));
        } catch (error) {
          if (
            error instanceof CollectorUnavailableError ||
            error instanceof UnsupportedCollectorDataError
          ) {
            return errorResponse("collector_unavailable", error.message, 503);
          }

          options.onError?.(error);
          return errorResponse("internal_error", "Server 内部错误。", 500);
        }
      }

      return errorResponse("not_found", "API 不存在。", 404);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    if (!options.webRoot) {
      return new Response("Not Found", { status: 404 });
    }

    const response = await serveWebFile(options.webRoot, url);
    return request.method === "HEAD"
      ? new Response(null, { headers: response.headers, status: response.status })
      : response;
  };
}
