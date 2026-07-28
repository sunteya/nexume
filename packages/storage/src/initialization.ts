import type { Database } from "bun:sqlite";

import type { InitializationStatus } from "@nexume/contracts";

import { SettingsStore } from "./settings";

export class AlreadyInitializedError extends Error {
  constructor() {
    super("Nexume 已经完成初始化。");
    this.name = "AlreadyInitializedError";
  }
}

export class InitializationService {
  private readonly settings: SettingsStore;

  constructor(private readonly db: Database) {
    this.settings = new SettingsStore(db);
  }

  getStatus(): InitializationStatus {
    const initializedAt = this.settings.get("app.initialized_at");
    return initializedAt === undefined
      ? { initialized: false }
      : { initialized: true, initializedAt };
  }

  complete(): InitializationStatus {
    const initializedAt = Date.now();

    this.db.transaction(() => {
      if (this.settings.get("app.initialized_at") !== undefined) {
        throw new AlreadyInitializedError();
      }
      this.settings.set("app.initialized_at", initializedAt);
    })();

    return { initialized: true, initializedAt };
  }
}
