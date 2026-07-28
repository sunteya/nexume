import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServerCore } from "@nexume/server-core";
import { openStorage, type AppStorage } from "@nexume/storage";

import {
  CollectorManagementError,
  CollectorManagementService,
} from "./collector-management";

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

async function createManagement(): Promise<{
  dataDir: string;
  storage: AppStorage;
  service: CollectorManagementService;
}> {
  const dataDir = mkdtempSync(join(tmpdir(), "nexume-management-"));
  const storage = await openStorage({ dataDir });
  cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
  cleanups.push(() => storage.close());
  const service = new CollectorManagementService({
    collectors: storage.collectors,
    core: createServerCore(),
    localSource: {
      querySessions: () => ({ items: [], hasMore: false }),
    },
    localMetadata: {
      hostname: "server.local",
      version: "0.0.1",
      agents: ["opencode"],
    },
  });
  return { dataDir, storage, service };
}

describe("CollectorManagementService", () => {
  test("creates, renames and deletes the only local collector", async () => {
    const { service } = await createManagement();

    const created = service.create({
      name: "Server Local",
      connectionType: "local",
    });
    expect(created.token).toBeUndefined();
    expect(created.collector).toEqual(
      expect.objectContaining({ id: "local", online: true }),
    );
    expect(() =>
      service.create({ name: "Second", connectionType: "local" }),
    ).toThrow(CollectorManagementError);

    expect(service.rename("local", "Renamed").name).toBe("Renamed");
    service.delete("local");
    expect(service.list()).toEqual([]);
    expect(
      service.create({ name: "Restored", connectionType: "local" }).collector
        .online,
    ).toBe(true);
  });

  test("issues a recoverable token and binds it to the remote collector", async () => {
    const { service } = await createManagement();
    let disconnected = "";
    service.setRemoteDisconnect((id) => {
      disconnected = id;
    });

    const created = service.create({
      name: "Build Host",
      connectionType: "remote",
    });
    const token = created.token!;
    expect(token.startsWith(`nxc_${created.collector.id}.`)).toBe(true);
    expect(service.revealToken(created.collector.id)).toBe(token);
    expect(service.authenticate(token)).toEqual({
      id: created.collector.id,
      name: "Build Host",
    });
    expect(service.authenticate(`${token}invalid`)).toBeUndefined();

    service.connected(created.collector.id, {
      hostname: "build.local",
      version: "1.0.0",
      agents: ["opencode"],
    });
    expect(service.list()[0]).toEqual(
      expect.objectContaining({
        online: false,
        hostname: "build.local",
        version: "1.0.0",
      }),
    );

    service.delete(created.collector.id);
    expect(disconnected).toBe(created.collector.id);
    expect(service.authenticate(token)).toBeUndefined();
  });
});
