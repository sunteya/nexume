import { BrowserView, BrowserWindow, Updater } from "electrobun/bun";
import { request } from "node:http";

import { OpenCodeCollector } from "@nexume/collector-core";
import { createServerCore } from "@nexume/server-core";

import type { DesktopRPC } from "../shared/desktop-rpc";

const devServerUrl = "http://localhost:5173";
const collector = new OpenCodeCollector({
  databasePath: process.env.OPENCODE_DB_PATH,
});
const core = createServerCore(collector);

function isDevServerRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = request(devServerUrl, { method: "HEAD" }, (response) => {
      response.resume();
      resolve(
        response.statusCode !== undefined &&
          response.statusCode >= 200 &&
          response.statusCode < 400,
      );
    });

    probe.setTimeout(500, () => {
      probe.destroy();
      resolve(false);
    });
    probe.on("error", () => resolve(false));
    probe.end();
  });
}

async function getMainViewUrl(): Promise<string> {
  if (
    (await Updater.localInfo.channel()) === "dev" &&
    (await isDevServerRunning())
  ) {
    return devServerUrl;
  }

  return "views://mainview/index.html";
}

const rpc = BrowserView.defineRPC<DesktopRPC>({
  maxRequestTime: 10_000,
  handlers: {
    requests: {
      listSessions: (params) => core.listSessions(params),
    },
    messages: {},
  },
});

new BrowserWindow({
  title: "Nexume",
  url: await getMainViewUrl(),
  rpc,
  frame: {
    width: 880,
    height: 580,
    x: 160,
    y: 120,
  },
});
