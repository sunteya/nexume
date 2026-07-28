import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CollectorConnection } from "@nexume/collector-core";
import { openStorage } from "@nexume/storage";

import { startServerRuntime } from "./runtime";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("等待 runtime 状态超时。");
    await Bun.sleep(10);
  }
}

describe("startServerRuntime", () => {
  test("serves Web, API and Collector Socket.IO on one port", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "nexume-runtime-data-"));
    const webRoot = mkdtempSync(join(tmpdir(), "nexume-runtime-web-"));
    writeFileSync(join(webRoot, "index.html"), "<h1>Nexume Runtime</h1>");
    const storage = await openStorage({ dataDir });
    const runtime = startServerRuntime({
      accessToken: "access-token",
      storage,
      hostname: "127.0.0.1",
      port: 0,
      webRoot,
      localSource: { querySessions: () => ({ items: [], hasMore: false }) },
      localMetadata: {
        hostname: "runtime.local",
        version: "0.0.1",
        agents: ["opencode"],
      },
      defaultLocalCollectorName: "Runtime Local",
    });
    cleanups.push(() => rmSync(webRoot, { recursive: true, force: true }));
    cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
    cleanups.push(() => storage.close());
    cleanups.push(() => void runtime.close());

    const actualPort = runtime.server.port!;
    const origin = `http://127.0.0.1:${actualPort}`;
    const page = await fetch(origin);
    expect(await page.text()).toContain("Nexume Runtime");
    expect(page.headers.get("cache-control")).toBe("no-cache");
    expect((await fetch(`${origin}/assets/missing.js`)).status).toBe(404);
    expect(await (await fetch(`${origin}/api/health`)).json()).toEqual({ status: "ok" });

    const bootstrapUrl = new URL(runtime.createBootstrapUrl());
    expect(new URLSearchParams(bootstrapUrl.hash.slice(1)).get("accessToken")).toBe(
      "access-token",
    );

    const authorization = { Authorization: "Bearer access-token" };
    const initialized = await fetch(`${origin}/api/setup/complete`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ initializeLocalCollector: false }),
    });
    expect(initialized.status).toBe(200);
    const created = await fetch(`${origin}/api/collectors`, {
      method: "POST",
      headers: { ...authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Remote", connectionType: "remote" }),
    });
    const credential = (await created.json()) as { token: string };

    const connection = new CollectorConnection({
      serverUrl: origin,
      token: credential.token,
      metadata: {
        hostname: "remote.local",
        version: "0.0.1",
        agents: ["opencode"],
      },
      source: {
        available: true,
        querySessions: () => ({ items: [], hasMore: false }),
      },
    });
    cleanups.push(() => connection.disconnect());
    connection.connect();
    await waitFor(() => runtime.core.listCollectors().length === 1);
    expect(runtime.core.listCollectors()[0]?.name).toBe("Remote");

    connection.disconnect();
    await runtime.close();
    await runtime.close();
    const replacement = Bun.serve({
      hostname: "127.0.0.1",
      port: actualPort,
      fetch: () => new Response("replacement"),
    });
    expect(await (await fetch(origin)).text()).toBe("replacement");
    void replacement.stop(true);
  }, 15_000);
});
