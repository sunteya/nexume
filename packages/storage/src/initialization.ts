import type { Database } from "bun:sqlite";

import type { InitializationStatus } from "@nexume/contracts";

import { CollectorStore } from "./collector";
import { SettingsStore } from "./settings";

export class AlreadyInitializedError extends Error {
  constructor() {
    super("Nexume 已经完成初始化。");
    this.name = "AlreadyInitializedError";
  }
}

export interface CompleteInitializationOptions {
  localCollector?: {
    id: string;
    name: string;
  };
}

export class InitializationService {
  private readonly settings: SettingsStore;
  private readonly collectors: CollectorStore;

  constructor(private readonly db: Database) {
    this.settings = new SettingsStore(db);
    this.collectors = new CollectorStore(db);
  }

  getStatus(): InitializationStatus {
    const initializedAt = this.settings.get("app.initialized_at");
    return initializedAt === undefined
      ? { initialized: false }
      : { initialized: true, initializedAt };
  }

  complete(options: CompleteInitializationOptions = {}): InitializationStatus {
    const initializedAt = Date.now();

    this.db.transaction(() => {
      if (this.settings.get("app.initialized_at") !== undefined) {
        throw new AlreadyInitializedError();
      }
      this.settings.set("app.initialized_at", initializedAt);
      if (options.localCollector && !this.collectors.get(options.localCollector.id)) {
        this.collectors.create({
          id: options.localCollector.id,
          name: options.localCollector.name,
          connectionType: "local",
        });
      }
    })();

    return { initialized: true, initializedAt };
  }
}
