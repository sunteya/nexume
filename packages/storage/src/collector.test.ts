import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";

import { openStorage, runMigrations } from "./index";
import { migrations } from "./migrations";

const temporaryDirectories: string[] = [];

function createDataDir(): string {
  const path = mkdtempSync(join(tmpdir(), "nexume-collector-storage-"));
  temporaryDirectories.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("CollectorStore", () => {
  test("does not backfill a local collector in a new uninitialized database", async () => {
    const storage = await openStorage({ dataDir: createDataDir() });

    expect(storage.collectors.list()).toEqual([]);
    storage.close();
  });

  test("backfills local collectors for an initialized database", async () => {
    const dataDir = createDataDir();
    const storage = await openStorage({ dataDir });
    storage.initialization.complete({
      localCollector: { id: "local", name: "Server Local" },
    });
    storage.close();

    const reopened = await openStorage({ dataDir });
    expect(reopened.collectors.get("local")).toEqual(
      expect.objectContaining({
        id: "local",
        name: "Server Local",
        connectionType: "local",
        token: null,
      }),
    );
    reopened.close();
  });

  test("enforces one local collector and clears local token fields", async () => {
    const storage = await openStorage({ dataDir: createDataDir() });
    storage.collectors.create({
      id: "first-local",
      name: "First",
      connectionType: "local",
      token: "ignored",
    });

    expect(() =>
      storage.collectors.create({
        id: "second-local",
        name: "Second",
        connectionType: "local",
      }),
    ).toThrow();
    expect(storage.collectors.get("first-local")).toEqual(
      expect.objectContaining({
        token: null,
      }),
    );
    storage.close();
  });

  test("supports remote CRUD and clones agents", async () => {
    const storage = await openStorage({ dataDir: createDataDir() });
    const agents = ["opencode"] as const;
    const created = storage.collectors.create({
      id: "remote-1",
      name: "Remote One",
      connectionType: "remote",
      token: "token",
    });

    expect(created).toEqual(
      expect.objectContaining({
        id: "remote-1",
        name: "Remote One",
        connectionType: "remote",
        token: "token",
        hostname: null,
        agents: null,
      }),
    );
    expect(storage.collectors.updateName("remote-1", "Renamed")?.name).toBe(
      "Renamed",
    );
    expect(
      storage.collectors.updateRuntime("remote-1", {
        hostname: "remote.local",
        version: "1.2.3",
        agents: [...agents],
        connectedAt: 100,
        lastSeenAt: 200,
      }),
    ).toEqual(
      expect.objectContaining({
        hostname: "remote.local",
        version: "1.2.3",
        agents: ["opencode"],
        connectedAt: 100,
        lastSeenAt: 200,
      }),
    );

    const listed = storage.collectors.list();
    listed[0]!.agents!.push("opencode");
    expect(storage.collectors.get("remote-1")?.agents).toEqual(["opencode"]);
    expect(storage.collectors.delete("remote-1")).toBe(true);
    expect(storage.collectors.delete("remote-1")).toBe(false);
    expect(storage.collectors.get("remote-1")).toBeUndefined();
    storage.close();
  });

  test("preserves collectors after reopening", async () => {
    const dataDir = createDataDir();
    const first = await openStorage({ dataDir });
    first.collectors.create({
      id: "remote-1",
      name: "Remote One",
      connectionType: "remote",
      token: "token",
    });
    first.collectors.updateRuntime("remote-1", {
      hostname: "host",
      version: "1",
      agents: ["opencode"],
      connectedAt: 10,
      lastSeenAt: 20,
    });
    first.close();

    const second = await openStorage({ dataDir });
    expect(second.collectors.get("remote-1")).toEqual(
      expect.objectContaining({
        name: "Remote One",
        hostname: "host",
        agents: ["opencode"],
        connectedAt: 10,
        lastSeenAt: 20,
      }),
    );
    second.close();
  });

  test("backfills an old initialized database when the new migration runs", async () => {
    const dataDir = createDataDir();
    const db = new Database(join(dataDir, "nexume.sqlite"), {
      create: true,
      strict: true,
    });
    const cacheDir = join(dataDir, "cache");
    await runMigrations({ db, dataDir, cacheDir }, [migrations[0]!]);
    db.query(
      "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)",
    ).run("app.initialized_at", JSON.stringify(Date.now()), Date.now());
    db.close();

    const storage = await openStorage({ dataDir });
    expect(storage.collectors.get("local")).toEqual(
      expect.objectContaining({ id: "local", name: "Server Local" }),
    );
    storage.close();
  });
});
