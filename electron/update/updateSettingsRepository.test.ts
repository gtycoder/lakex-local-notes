import { describe, expect, it } from "vitest";
import { SettingsRepository } from "../settingsRepository.js";
import type { DbLike } from "../dbLike.js";
import type { SecretCipher } from "../../src/core/secretCipher.js";
import { UPDATE_SETTINGS_DEFAULTS } from "../../src/core/update/updateTypes.js";

const cipher: SecretCipher = { encrypt: (value) => value, decrypt: (value) => value };

/** 最小 DbLike：只实现 settings(key,value) 的 update_settings 行（与 SettingsRepository 的 SQL 对齐）。 */
function makeRepo(rows: Map<string, string>): SettingsRepository {
  const db: DbLike = {
    prepare(sql: string) {
      const key = sql.includes("update_settings") ? "update_settings" : "";
      return {
        get: () => {
          const value = key ? rows.get(key) : undefined;
          return value === undefined ? undefined : { value };
        },
        all: () => [],
        run: (value: unknown) => {
          if (key) rows.set(key, String(value));
          return { changes: 1, lastInsertRowid: 1 };
        },
      };
    },
    transaction: ((fn: unknown) => fn) as DbLike["transaction"],
    pragma: () => undefined,
    exec: () => {},
    close: () => {},
  };
  return new SettingsRepository(db, cipher);
}

describe("更新中心设置（settingsRepository）", () => {
  it("缺省 = 自动检查开 / 24h / 自动下载开 / 未忽略", () => {
    expect(makeRepo(new Map()).getUpdateSettings()).toEqual(UPDATE_SETTINGS_DEFAULTS);
    expect(UPDATE_SETTINGS_DEFAULTS).toEqual({ autoCheck: true, checkIntervalHours: 24, autoDownload: true, ignoredVersion: "" });
  });

  it("保存后持久化（含 0 = 关闭间隔与忽略版本）；坏字段回默认", () => {
    const rows = new Map<string, string>();
    const repo = makeRepo(rows);
    const saved = repo.saveUpdateSettings({ autoCheck: false, checkIntervalHours: 0, autoDownload: false, ignoredVersion: "1.0.5" });
    expect(saved).toEqual({ autoCheck: false, checkIntervalHours: 0, autoDownload: false, ignoredVersion: "1.0.5" });
    expect(makeRepo(rows).getUpdateSettings()).toEqual(saved);

    rows.set("update_settings", JSON.stringify({ checkIntervalHours: 7, autoCheck: "x" }));
    expect(makeRepo(rows).getUpdateSettings()).toEqual(UPDATE_SETTINGS_DEFAULTS);
    rows.set("update_settings", "{bad json");
    expect(makeRepo(rows).getUpdateSettings()).toEqual(UPDATE_SETTINGS_DEFAULTS);
  });
});
