import { describe, expect, test } from "bun:test";

import {
  CollectorCliUsageError,
  parseCollectorCliOptions,
} from "./options";

describe("parseCollectorCliOptions", () => {
  test("parses Collector connection options", () => {
    expect(
      parseCollectorCliOptions([
        "--server-url",
        "https://nexume.example.com",
        "--token",
        "collector-token",
        "--id",
        "build-agent",
        "--name",
        "Build Agent",
        "--db-path",
        "/data/opencode.db",
      ]),
    ).toEqual({
      serverUrl: "https://nexume.example.com",
      token: "collector-token",
      collectorId: "build-agent",
      collectorName: "Build Agent",
      databasePath: "/data/opencode.db",
    });
  });

  test("requires Server URL and token", () => {
    expect(() => parseCollectorCliOptions([])).toThrow(CollectorCliUsageError);
  });

  test("rejects unknown options", () => {
    expect(() =>
      parseCollectorCliOptions([
        "--server-url",
        "http://localhost:3000",
        "--token",
        "token",
        "--unknown",
      ]),
    ).toThrow("Unknown option");
  });
});
