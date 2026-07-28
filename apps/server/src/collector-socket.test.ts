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
      collectorToken: "collector-token",
      core,
      isInitialized: () => false,
    });
    const handler = transport.engine.handler();
    const server = Bun.serve({ port: 0, ...handler });
    cleanups.push(() => server.stop(true));
    cleanups.push(() => transport.close());

    let connectionError = "";
    const connection = new CollectorConnection({
      serverUrl: `http://127.0.0.1:${server.port}`,
      token: "collector-token",
      descriptor: {
        id: "blocked-test",
        name: "Blocked Test",
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
    const transport = createCollectorSocketServer({
      collectorToken: "collector-token",
      core,
    });
    const handler = transport.engine.handler();
    const server = Bun.serve({ port: 0, ...handler });
    cleanups.push(() => server.stop(true));
    cleanups.push(() => transport.close());

    const connection = new CollectorConnection({
      serverUrl: `http://127.0.0.1:${server.port}`,
      token: "collector-token",
      descriptor: {
        id: "remote-test",
        name: "Remote Test",
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

    const result = await core.listSessions({ limit: 20 });
    expect(result.items).toEqual([
      expect.objectContaining({
        id: "session-1",
        collectorId: "remote-test",
      }),
    ]);

    connection.disconnect();
    await waitFor(() => core.listCollectors().length === 0);
  });
});
