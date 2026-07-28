import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Nexume",
    identifier: "dev.nexume.desktop",
    version: "0.0.1",
  },
  build: {
    copy: {
      "dist/index.html": "web/index.html",
      "dist/assets": "web/assets",
    },
    watchIgnore: ["dist/**"],
    mac: {
      bundleCEF: false,
      codesign: false,
      notarize: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
  release: {
    generatePatch: false,
  },
} satisfies ElectrobunConfig;
