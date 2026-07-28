import { describe, expect, test } from "bun:test";

import { assertListSessionsParams } from "./index";

describe("assertListSessionsParams", () => {
  test("accepts supported pagination", () => {
    expect(() =>
      assertListSessionsParams({ page: 1, pageSize: 50 }),
    ).not.toThrow();
  });

  test("rejects unsupported pagination", () => {
    expect(() =>
      assertListSessionsParams({ page: 1, pageSize: 25 as 20 }),
    ).toThrow("Session 每页数量无效");
  });
});
