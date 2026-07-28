import { describe, expect, test } from "bun:test";

import {
  CollectorQueryFailedError,
  type ServerCore,
} from "@nexume/server-core";

import { createRequestHandler } from "./http";

const token = "test-token";
const authorization = { Authorization: `Bearer ${token}` };

function createCore(
  listSessions: ServerCore["listSessions"] = async () => ({
    items: [],
    hasMore: false,
    warnings: [],
  }),
): ServerCore {
  return {
    listSessions,
    listCollectors: () => [],
    registerCollector: () => ({ touch() {}, unregister() {} }),
  };
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

  test("exposes initialization status without authentication", async () => {
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(),
      initialization: {
        getStatus: () => ({ initialized: false }),
        complete: () => ({ initialized: true, initializedAt: 100 }),
      },
    });
    const response = await handler(
      new Request("http://localhost/api/v1/setup/status"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ initialized: false });
  });

  test("uses the access token to complete initialization", async () => {
    let initialized = false;
    let initializedCallback = false;
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(),
      initialization: {
        getStatus: () => ({ initialized }),
        complete: () => {
          initialized = true;
          return { initialized: true, initializedAt: 100 };
        },
      },
      onInitialized: () => {
        initializedCallback = true;
      },
    });

    const unauthorized = await handler(
      new Request("http://localhost/api/v1/setup/complete", { method: "POST" }),
    );
    expect(unauthorized.status).toBe(401);

    const completed = await handler(
      new Request("http://localhost/api/v1/setup/complete", {
        method: "POST",
        headers: authorization,
      }),
    );
    expect(completed.status).toBe(200);
    expect(await completed.json()).toEqual({
      initialized: true,
      initializedAt: 100,
    });
    expect(initializedCallback).toBe(true);

    const duplicate = await handler(
      new Request("http://localhost/api/v1/setup/complete", {
        method: "POST",
        headers: authorization,
      }),
    );
    expect(duplicate.status).toBe(409);
  });

  test("blocks business APIs until initialization completes", async () => {
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(),
      initialization: {
        getStatus: () => ({ initialized: false }),
        complete: () => ({ initialized: true }),
      },
    });
    const response = await handler(
      new Request("http://localhost/api/v1/sessions", {
        headers: authorization,
      }),
    );

    expect(response.status).toBe(428);
    expect(await response.json()).toEqual({
      error: {
        code: "setup_required",
        message: "请先完成 Nexume 初始化。",
      },
    });
  });

  test("passes a validated cursor query to Server Core", async () => {
    let received: unknown;
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(async (params) => {
        received = params;
        return { items: [], hasMore: false, warnings: [] };
      }),
    });
    const response = await handler(
      new Request("http://localhost/api/v1/sessions?limit=20&cursor=opaque", {
        headers: authorization,
      }),
    );

    expect(response.status).toBe(200);
    expect(received).toEqual({ limit: 20, cursor: "opaque" });
  });

  test("rejects an invalid batch size", async () => {
    const handler = createRequestHandler({ accessToken: token, core: createCore() });
    const response = await handler(
      new Request("http://localhost/api/v1/sessions?limit=25", {
        headers: authorization,
      }),
    );

    expect(response.status).toBe(400);
  });

  test("maps unavailable Collectors to 503", async () => {
    const handler = createRequestHandler({
      accessToken: token,
      core: createCore(() => {
        throw new CollectorQueryFailedError([
          {
            collectorId: "local",
            collectorName: "Local",
            message: "OpenCode unavailable",
          },
        ]);
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
        message: "当前没有 Collector 能够完成 Session 查询。",
      },
    });
  });

  test("returns the connected Collector list", async () => {
    const core = createCore();
    core.listCollectors = () => [
      {
        id: "local",
        name: "Local",
        hostname: "localhost",
        version: "0.0.1",
        agents: ["opencode"],
        connectionType: "local",
        connectedAt: 100,
        lastSeenAt: 100,
      },
    ];
    const handler = createRequestHandler({ accessToken: token, core });
    const response = await handler(
      new Request("http://localhost/api/v1/collectors", {
        headers: authorization,
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      items: [expect.objectContaining({ id: "local" })],
    });
  });
});
