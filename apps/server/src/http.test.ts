import { describe, expect, test } from "bun:test";

import { CollectorUnavailableError } from "@nexume/collector-core";
import type { ServerCore } from "@nexume/server-core";

import { createRequestHandler } from "./http";

const token = "test-token";
const authorization = { Authorization: `Bearer ${token}` };

function createCore(
  listSessions: ServerCore["listSessions"] = async (params) => ({
    items: [],
    total: 0,
    ...params,
  }),
): ServerCore {
  return { listSessions };
}

describe("Server HTTP API", () => {
  test("exposes a public health check", async () => {
    const handler = createRequestHandler({ accessToken: token, core: createCore() });
    const response = await handler(
      new Request("http://localhost/api/v1/health"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  test("rejects a Session request without a token", async () => {
    const handler = createRequestHandler({ accessToken: token, core: createCore() });
    const response = await handler(
      new Request("http://localhost/api/v1/sessions"),
    );

    expect(response.status).toBe(401);
  });

  test("passes validated pagination to Server Core", async () => {
    let received: unknown;
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(async (params) => {
        received = params;
        return { items: [], total: 0, ...params };
      }),
    });
    const response = await handler(
      new Request("http://localhost/api/v1/sessions?page=2&pageSize=20", {
        headers: authorization,
      }),
    );

    expect(response.status).toBe(200);
    expect(received).toEqual({ page: 2, pageSize: 20 });
  });

  test("rejects invalid pagination", async () => {
    const handler = createRequestHandler({ accessToken: token, core: createCore() });
    const response = await handler(
      new Request("http://localhost/api/v1/sessions?page=0", {
        headers: authorization,
      }),
    );

    expect(response.status).toBe(400);
  });

  test("maps an unavailable Collector to 503", async () => {
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(() => {
        throw new CollectorUnavailableError("OpenCode unavailable");
      }),
    });
    const response = await handler(
      new Request("http://localhost/api/v1/sessions", {
        headers: authorization,
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "collector_unavailable",
        message: "OpenCode unavailable",
      },
    });
  });
});
