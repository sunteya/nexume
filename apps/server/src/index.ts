import { resolve } from "node:path";
import { hostname as getHostname } from "node:os";

import { OpenCodeCollector } from "@nexume/collector-core";
import { startServerRuntime } from "@nexume/server-runtime";
import { openStorage } from "@nexume/storage";
import packageJson from "../package.json";

function readPort(value: string | undefined): number {
  const port = Number(value ?? 3000);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT 必须是 1 到 65535 之间的整数。");
  }

  return port;
}

const accessToken = process.env.NEXUME_ACCESS_TOKEN?.trim();
if (!accessToken) {
  throw new Error("启动 Server 前必须设置 NEXUME_ACCESS_TOKEN。");
}
const hostname = process.env.HOST?.trim() || "0.0.0.0";
const port = readPort(process.env.PORT);
const dataDir = resolve(process.env.NEXUME_DATA_DIR?.trim() || "data");
const storage = await openStorage({ dataDir });
const collector = new OpenCodeCollector({
  databasePath: process.env.OPENCODE_DB_PATH,
});
const runtime = startServerRuntime({
  accessToken,
  storage,
  hostname,
  port,
  webRoot: resolve(import.meta.dir, "../dist"),
  localSource: collector,
  localMetadata: {
    hostname: getHostname(),
    version: packageJson.version,
    agents: ["opencode"],
  },
  defaultLocalCollectorName: "Server Local",
  getRuntimeInfo: (actualPort) => ({
    kind: "server",
    port: actualPort,
    urls: [`http://${hostname}:${actualPort}`],
  }),
  onError: (error) => console.error(error),
});

console.log(`Nexume Server: http://${hostname}:${runtime.server.port}`);
console.log(`Data: ${storage.dataDir}`);
console.log(
  collector.available
    ? `OpenCode: ${collector.databasePath}`
    : `OpenCode 数据库暂不可用: ${collector.databasePath}`,
);

async function stop(): Promise<void> {
  await runtime.close();
  storage.close();
  process.exit(0);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
