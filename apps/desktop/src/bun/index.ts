import { BrowserWindow, Updater } from "electrobun/bun";
import { request } from "node:http";

const devServerUrl = "http://localhost:5173";

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

new BrowserWindow({
  title: "Nexume",
  url: await getMainViewUrl(),
  frame: {
    width: 880,
    height: 580,
    x: 160,
    y: 120,
  },
});
