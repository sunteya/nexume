import { describe, expect, test } from "bun:test";

import { createServerCore } from "./index";

describe("createServerCore", () => {
  test("delegates a valid Session query to its source", async () => {
    const core = createServerCore({
      listSessions: (params) => ({ items: [], total: 0, ...params }),
    });

    await expect(
      core.listSessions({ page: 1, pageSize: 50 }),
    ).resolves.toEqual({ items: [], page: 1, pageSize: 50, total: 0 });
  });

  test("rejects invalid pagination before calling its source", async () => {
    let calls = 0;
    const core = createServerCore({
      listSessions: (params) => {
        calls += 1;
        return { items: [], total: 0, ...params };
      },
    });

    await expect(
      core.listSessions({ page: 0, pageSize: 50 }),
    ).rejects.toThrow("Session 页码无效");
    expect(calls).toBe(0);
  });
});
