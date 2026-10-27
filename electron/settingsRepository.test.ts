import { describe, expect, it } from "vitest";
import { SettingsRepository } from "./settingsRepository.js";
import type { DbLike } from "./dbLike.js";
import type { SecretCipher } from "../src/core/secretCipher.js";

/**
 * 「启用云同步」的**默认值 = 是否已配置 S3**（261022 用户点单）。
 *
 * 用户看到的是：全新安装、S3 一项都没配，设置页「启用云同步」却是开着的。根因是默认值写死 true。
 * 口径：没配置与关掉在语义上等价（`cloudStateOf` ⇒ unconfigured ⇒ 一律不出网），
 * 所以没配置时默认关闭；已配置的旧库仍默认开着（不回归）；显式存过的值永远优先。
 */

const cipher: SecretCipher = { encrypt: (value) => value, decrypt: (value) => value };

/** 最小 DbLike：只实现 settings(key,value) 的两种查询（与 SettingsRepository 用到的 SQL 对齐）。 */
function makeRepo(rows: Map<string, string>): SettingsRepository {
  const db: DbLike = {
    prepare(sql: string) {
      const key = sql.includes("key='sync_settings'") ? "sync_settings" : sql.includes("key='s3_settings'") ? "s3_settings" : "";
      return {
        get: () => {
          const value = key ? rows.get(key) : undefined;
          return value === undefined ? undefined : { value };
        },
        all: () => [],
        run: () => ({ changes: 1, lastInsertRowid: 1 }),
      };
    },
    transaction: ((fn: unknown) => fn) as DbLike["transaction"],
    pragma: () => undefined,
    exec: () => {},
    close: () => {},
  };
  return new SettingsRepository(db, cipher);
}

const S3_ROW = JSON.stringify({ endpoint: "https://s3.example.com", region: "cn-north-1", bucket: "b", prefix: "p", accessKeyId: "ak", secretAccessKey: "sk", forcePathStyle: false });

describe("云同步默认开关 = 是否已配置 S3", () => {
  it("全新安装（没有任何 S3 配置）⇒ 默认关闭", () => {
    expect(makeRepo(new Map()).getSyncSettings().enabled).toBe(false);
  });

  it("已配置 S3 的旧库 ⇒ 仍默认开着（不回归）", () => {
    const rows = new Map<string, string>([["s3_settings", S3_ROW]]);
    expect(makeRepo(rows).getSyncSettings().enabled).toBe(true);
  });

  it("显式存过的值优先：显式关掉后，即使已配置 S3 也保持关闭", () => {
    const rows = new Map<string, string>([
      ["s3_settings", S3_ROW],
      ["sync_settings", JSON.stringify({ enabled: false, autoMode: "manual", autoIntervalMinutes: 15 })],
    ]);
    expect(makeRepo(rows).getSyncSettings().enabled).toBe(false);
  });

  it("字段缺省/坏 JSON 时回落到默认值（不抛错）", () => {
    const rows = new Map<string, string>([["sync_settings", "{oops"]]);
    expect(makeRepo(rows).getSyncSettings()).toEqual({ enabled: false, autoMode: "manual", autoIntervalMinutes: 15 });
  });
});
