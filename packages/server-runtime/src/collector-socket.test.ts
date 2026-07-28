import { afterEach, describe, expect, test } from "bun:test";

import { CollectorConnection } from "@nexume/collector-core";
import { createServerCore } from "@nexume/server-core";

import { createCollectorSocketServer } from "./collector-socket";

const cleanups: Array<() => void | Promise<void>> = [];

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("等待连接状态超时。");
    await Bun.sleep(10);
  }
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("Collector Socket.IO transport", () => {
  test("rejects Collectors before initialization", async () => {
    const core = createServerCore();
    const transport = createCollectorSocketServer({
      core,
      authenticate: () => ({ id: "blocked-test", name: "Blocked Test" }),
      getCollector: () => ({ id: "blocked-test", name: "Blocked Test" }),
      isInitialized: () => false,
    });
    const handler = transport.engine.handler();
    const server = Bun.serve({ port: 0, ...handler });
    cleanups.push(() => transport.close());
    cleanups.push(() => void server.stop(true));

    let connectionError = "";
    const connection = new CollectorConnection({
      serverUrl: `http://127.0.0.1:${server.port}`,
      token: "collector-token",
      metadata: {
        hostname: "remote.local",
        version: "0.0.1",
        agents: ["opencode"],
      },
      source: {
        available: true,
        querySessions: () => ({ items: [], hasMore: false }),
      },
      onStateChange(_state, detail) {
        if (detail?.includes("初始化")) connectionError = detail;
      },
    });
    cleanups.push(() => connection.disconnect());

    connection.connect();
    await waitFor(() => Boolean(connectionError));
    expect(core.listCollectors()).toHaveLength(0);
  });

  test("registers, queries and removes a remote Collector", async () => {
    const core = createServerCore();
    let touches = 0;
    const transport = createCollectorSocketServer({
      core,
      authenticate: (token) =>
        token === "collector-token"
          ? { id: "remote-test", name: "Managed Name" }
          : undefined,
      getCollector: (id) =>
        id === "remote-test"
          ? { id: "remote-test", name: "Managed Name" }
          : undefined,
      onTouched: () => {
        touches += 1;
      },
    });
    const handler = transport.engine.handler();
    const server = Bun.serve({ port: 0, ...handler });
    cleanups.push(() => transport.close());
    cleanups.push(() => void server.stop(true));

    const connection = new CollectorConnection({
      serverUrl: `http://127.0.0.1:${server.port}`,
      token: "collector-token",
      metadata: {
        hostname: "remote.local",
        version: "0.0.1",
        agents: ["opencode"],
      },
      source: {
        available: true,
        querySessions: () => ({
          items: [
            {
              id: "session-1",
              agent: "opencode",
              title: "Remote Session",
              directory: "/workspace/remote",
              createdAt: 100,
              updatedAt: 100,
            },
          ],
          hasMore: false,
        }),
      },
    });
    cleanups.push(() => connection.disconnect());

    connection.connect();
    await waitFor(() => core.listCollectors().length === 1);
    expect(core.listCollectors()[0]?.name).toBe("Managed Name");

    const result = await core.listSessions({ limit: 20 });
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "session-1",
        collectorId: "remote-test",
      }),
    ]);
    expect(touches).toBeGreaterThanOrEqual(1);

    transport.disconnectCollector("remote-test");
    await waitFor(() => core.listCollectors().length === 0);
  });

  test("rejects an unknown token", async () => {
    const core = createServerCore();
    const transport = createCollectorSocketServer({
      core,
      authenticate: () => undefined,
      getCollector: () => undefined,
    });
    const handler = transport.engine.handler();
    const server = Bun.serve({ port: 0, ...handler });
    cleanups.push(() => transport.close());
    cleanups.push(() => void server.stop(true));

    let connectionError = "";
    const connection = new CollectorConnection({
      serverUrl: `http://127.0.0.1:${server.port}`,
      token: "unknown",
      metadata: {
        hostname: "remote.local",
        version: "0.0.1",
        agents: ["opencode"],
      },
      source: {
        available: true,
        querySessions: () => ({ items: [], hasMore: false }),
      },
      onStateChange(_state, detail) {
        if (detail?.includes("凭证")) connectionError = detail;
      },
    });
    cleanups.push(() => connection.disconnect());

    connection.connect();
    await waitFor(() => Boolean(connectionError));
    expect(core.listCollectors()).toHaveLength(0);
  });
});
