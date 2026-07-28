import { hostname } from "node:os";

import {
  CollectorConnection,
  OpenCodeCollector,
} from "@nexume/collector-core";
import packageJson from "../package.json";

import {
  CollectorCliUsageError,
  parseCollectorCliOptions,
  type CollectorCliOptions,
} from "./options";

let options: CollectorCliOptions;
try {
  options = parseCollectorCliOptions(process.argv.slice(2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(error instanceof CollectorCliUsageError ? 2 : 1);
}

const collector = new OpenCodeCollector({
  databasePath: options.databasePath,
});
const connection = new CollectorConnection({
  serverUrl: options.serverUrl,
  token: options.token,
  metadata: {
    hostname: hostname(),
    version: packageJson.version,
    agents: ["opencode"],
  },
  source: collector,
  onStateChange(state, detail) {
    console.log(
      `[collector] ${state}${detail ? `: ${detail}` : ""}`,
    );
  },
});

console.log(
  collector.available
    ? `[collector] OpenCode: ${collector.databasePath}`
    : `[collector] OpenCode database is unavailable: ${collector.databasePath}`,
);
connection.connect();

function stop(): void {
  connection.disconnect();
  process.exit(0);
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
