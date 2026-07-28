import type { Database } from "bun:sqlite";

export interface SettingValueMap {
  "app.initialized_at": number;
}

export type SettingKey = keyof SettingValueMap;

interface SettingRow {
  value: string;
}

export class SettingsStore {
  constructor(private readonly db: Database) {}

  get<K extends SettingKey>(key: K): SettingValueMap[K] | undefined {
    const row = this.db
      .query<SettingRow, [SettingKey]>(
        "SELECT value FROM settings WHERE key = ?",
      )
      .get(key);
    return row ? (JSON.parse(row.value) as SettingValueMap[K]) : undefined;
  }

  set<K extends SettingKey>(key: K, value: SettingValueMap[K]): void {
    this.db
      .query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), Date.now());
  }
}
