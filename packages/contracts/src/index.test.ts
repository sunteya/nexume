import { describe, expect, test } from "bun:test";

import {
  assertCollectorDescriptor,
  assertCollectorSessionQuery,
  assertListSessionsParams,
} from "./index";

describe("Session query contracts", () => {
  test("accepts supported batch queries", () => {
    expect(() =>
      assertListSessionsParams({ limit: 50, cursor: "opaque" }),
    ).not.toThrow();
    expect(() =>
      assertCollectorSessionQuery({
        asOf: 1_000,
        limit: 20,
        cursor: { updatedAt: 900, agent: "opencode", id: "session-1" },
      }),
    ).not.toThrow();
  });

  test("rejects unsupported batch sizes", () => {
    expect(() =>
      assertListSessionsParams({ limit: 25 as 20 }),
    ).toThrow("Session 每批数量无效");
  });
});

describe("assertCollectorDescriptor", () => {
  test("accepts a complete descriptor", () => {
    expect(() =>
      assertCollectorDescriptor({
        id: "workstation",
        name: "Workstation",
        hostname: "host.local",
        version: "0.0.1",
        agents: ["opencode"],
      }),
    ).not.toThrow();
  });

  test("rejects unknown agents", () => {
    expect(() =>
      assertCollectorDescriptor({
        id: "workstation",
        name: "Workstation",
        hostname: "host.local",
        version: "0.0.1",
        agents: ["unknown"],
      }),
    ).toThrow("Collector Agent 列表无效");
  });
});
