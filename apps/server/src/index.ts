import { resolve } from "node:path";

import { OpenCodeCollector } from "@nexume/collector-core";
import { createServerCore } from "@nexume/server-core";

import { createRequestHandler } from "./http";

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
const collector = new OpenCodeCollector({
  databasePath: process.env.OPENCODE_DB_PATH,
});
const core = createServerCore(collector);
const handler = createRequestHandler({
  accessToken,
  core,
  webRoot: resolve(import.meta.dir, "../dist"),
  onError: (error) => console.error(error),
});
const server = Bun.serve({
  hostname,
  port,
  fetch: handler,
  error(error) {
    console.error(error);
    return Response.json(
      { error: { code: "internal_error", message: "Server 内部错误。" } },
      { status: 500 },
    );
  },
});

console.log(`Nexume Server: http://${hostname}:${server.port}`);
console.log(
  collector.available
    ? `OpenCode: ${collector.databasePath}`
    : `OpenCode 数据库暂不可用: ${collector.databasePath}`,
);

async function stop(): Promise<void> {
  await server.stop();
  process.exit(0);
}

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());
