import { describe, expect, test } from "bun:test";

import type {
  CollectedSessionSummary,
  CollectorDescriptor,
  CollectorSessionQuery,
} from "@nexume/contracts";

import {
  CollectorQueryFailedError,
  InvalidSessionCursorError,
  createServerCore,
} from "./index";

function descriptor(id: string): CollectorDescriptor {
  return {
    id,
    name: id.toUpperCase(),
    hostname: `${id}.local`,
    version: "0.0.1",
    agents: ["opencode"],
  };
}

function sessions(prefix: string, timestamps: number[]): CollectedSessionSummary[] {
  return timestamps.map((updatedAt, index) => ({
    id: `${prefix}-${String(index).padStart(3, "0")}`,
    agent: "opencode",
    title: `${prefix} ${index}`,
    directory: `/workspace/${prefix}`,
    createdAt: updatedAt,
    updatedAt,
  }));
}

function source(items: CollectedSessionSummary[]) {
  return {
    querySessions(query: CollectorSessionQuery) {
      const start = query.cursor
        ? items.findIndex(
            (item) =>
              item.updatedAt < query.cursor!.updatedAt ||
              (item.updatedAt === query.cursor!.updatedAt &&
                item.id > query.cursor!.id),
          )
        : 0;
      const available = items
        .filter((item) => item.updatedAt <= query.asOf)
        .slice(start < 0 ? items.length : start);
      return {
        items: available.slice(0, query.limit),
        hasMore: available.length > query.limit,
      };
    },
  };
}

describe("createServerCore", () => {
  test("lists connected collectors and ignores stale unregister calls", () => {
    const core = createServerCore();
    const first = core.registerCollector({
      descriptor: descriptor("remote"),
      connectionType: "remote",
      source: source([]),
    });
    core.registerCollector({
      descriptor: { ...descriptor("remote"), name: "Replacement" },
      connectionType: "remote",
      source: source([]),
    });

    first.unregister();
    expect(core.listCollectors()).toHaveLength(1);
    expect(core.listCollectors()[0]?.name).toBe("Replacement");
  });

  test("renames a connected collector", () => {
    const core = createServerCore();
    core.registerCollector({
      descriptor: descriptor("local"),
      connectionType: "local",
      source: source([]),
    });

    expect(core.renameCollector("local", "Renamed")).toBe(true);
    expect(core.listCollectors()[0]?.name).toBe("Renamed");
    expect(core.renameCollector("missing", "Ignored")).toBe(false);
  });

  test("rejects a cursor after a collector with the same id is replaced", async () => {
    const core = createServerCore();
    const firstRegistration = core.registerCollector({
      descriptor: descriptor("remote"),
      connectionType: "remote",
      source: source(sessions("first", Array.from({ length: 30 }, (_, i) => 100 - i))),
    });
    const first = await core.listSessions({ limit: 20 });
    firstRegistration.unregister();
    core.registerCollector({
      descriptor: descriptor("remote"),
      connectionType: "remote",
      source: source(sessions("second", Array.from({ length: 30 }, (_, i) => 100 - i))),
    });

    await expect(
      core.listSessions({ limit: 20, cursor: first.nextCursor }),
    ).rejects.toBeInstanceOf(InvalidSessionCursorError);
  });

  test("globally merges batches and defers unused source candidates", async () => {
    const core = createServerCore();
    core.registerCollector({
      descriptor: descriptor("a"),
      connectionType: "local",
      source: source(sessions("a", Array.from({ length: 30 }, (_, i) => 100 - i * 2))),
    });
    core.registerCollector({
      descriptor: descriptor("b"),
      connectionType: "remote",
      source: source(sessions("b", Array.from({ length: 30 }, (_, i) => 99 - i * 2))),
    });

    const first = await core.listSessions({ limit: 20 });
    const second = await core.listSessions({
      limit: 20,
      cursor: first.nextCursor,
    });

    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(20);
    expect(first.items.map((item) => item.updatedAt)).toEqual(
      Array.from({ length: 20 }, (_, i) => 100 - i),
    );
    expect(second.items.map((item) => item.updatedAt)).toEqual(
      Array.from({ length: 20 }, (_, i) => 80 - i),
    );
    expect(
      new Set([...first.items, ...second.items].map((item) => item.id)).size,
    ).toBe(40);
  });

  test("keeps a stable order when collectors share update timestamps", async () => {
    const core = createServerCore();
    core.registerCollector({
      descriptor: descriptor("a"),
      connectionType: "local",
      source: source(sessions("a", Array.from({ length: 30 }, () => 100))),
    });
    core.registerCollector({
      descriptor: descriptor("b"),
      connectionType: "remote",
      source: source(sessions("b", Array.from({ length: 30 }, () => 100))),
    });

    const first = await core.listSessions({ limit: 20 });
    const second = await core.listSessions({
      limit: 20,
      cursor: first.nextCursor,
    });

    expect(first.items.every((item) => item.collectorId === "a")).toBe(true);
    expect(second.items.slice(0, 10).every((item) => item.collectorId === "a")).toBe(
      true,
    );
    expect(second.items.slice(10).every((item) => item.collectorId === "b")).toBe(
      true,
    );
  });

  test("returns partial results and warnings when one collector fails", async () => {
    const core = createServerCore();
    core.registerCollector({
      descriptor: descriptor("healthy"),
      connectionType: "local",
      source: source(sessions("healthy", [100, 90])),
    });
    core.registerCollector({
      descriptor: descriptor("failed"),
      connectionType: "remote",
      source: {
        querySessions() {
          throw new Error("offline");
        },
      },
    });

    const result = await core.listSessions({ limit: 20 });
    expect(result.items).toHaveLength(2);
    expect(result.warnings).toEqual([
      expect.objectContaining({ collectorId: "failed" }),
    ]);
  });

  test("fails when no collector can answer", async () => {
    const core = createServerCore();
    await expect(core.listSessions({ limit: 20 })).rejects.toBeInstanceOf(
      CollectorQueryFailedError,
    );
  });
});
