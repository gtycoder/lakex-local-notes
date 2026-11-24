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

describe("261204 系统钥匙串退役：enc:v1 → enc:v2 一次性迁移", () => {
  // 与生产同款格式的桩：enc:v2: = 本机 machine.key 加密；enc:v1: = 旧 safeStorage（钥匙串）。
  const makeCipher = (failV1 = false): SecretCipher => ({
    encrypt: (v) => "enc:v2:" + Buffer.from(v).toString("base64"),
    decrypt: (v) => v.startsWith("enc:v2:") ? Buffer.from(v.slice("enc:v2:".length), "base64").toString()
      : v.startsWith("enc:v1:") ? (failV1 ? "" : Buffer.from(v.slice("enc:v1:".length), "base64").toString())
      : "",
  });
  const v1 = (plain: string) => "enc:v1:" + Buffer.from(plain).toString("base64");
  function repoWith(rows: Map<string, string>, cipher: SecretCipher = makeCipher()) {
    const db: DbLike = {
      prepare(sql: string) {
        const key = /key='([^']+)'/.exec(sql)?.[1] ?? "";
        return {
          get: () => (rows.has(key) ? { value: rows.get(key)! } : undefined),
          all: () => [],
          run: (...args: unknown[]) => {
            // SQL 形如 INSERT INTO settings(key,value) VALUES('<key>',?) —— key 内联、占位符只有 value
            const insertKey = sql.includes("VALUES('") ? sql.split("VALUES('")[1].split("',")[0] : "";
            if (insertKey) rows.set(insertKey, String(args[0]));
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
  const s3Row = (secret: string) => JSON.stringify({ endpoint: "e", region: "r", bucket: "b", prefix: "", accessKeyId: "ak", secretAccessKey: secret, forcePathStyle: false });
  const aiRow = (apiKey: string) => JSON.stringify({ version: 1, activeProviderId: "openai", providers: { openai: { apiKey } } });

  it("S3 + AI 的 enc:v1 一次性换写 v2；二次清扫零改动；换写后读出明文", () => {
    const rows = new Map<string, string>([
      ["s3_settings", s3Row(v1("sk-old"))],
      ["ai_settings", aiRow(v1("sk-ai"))],
    ]);
    const repo = repoWith(rows);
    expect(repo.migrateLegacySecrets().migrated).toBe(2);
    expect(JSON.parse(rows.get("s3_settings")!).secretAccessKey.startsWith("enc:v2:")).toBe(true);
    expect(JSON.parse(rows.get("ai_settings")!).providers.openai.apiKey.startsWith("enc:v2:")).toBe(true);
    expect(repo.getS3Settings()!.secretAccessKey).toBe("sk-old");
    expect(repo.getAiSettings().providers.openai?.apiKey).toBe("sk-ai");
    const before = rows.get("s3_settings");
    expect(repo.migrateLegacySecrets().migrated).toBe(0); // 幂等：零钥匙串访问
    expect(rows.get("s3_settings")).toBe(before);
  });

  it("解不开的 v1 保持原样（换机/钥匙丢失不落明文、不损坏行）", () => {
    const rows = new Map<string, string>([["s3_settings", s3Row(v1("sk-old"))]]);
    const repo = repoWith(rows, makeCipher(true));
    expect(repo.migrateLegacySecrets().migrated).toBe(0);
    expect(rows.get("s3_settings")).toBe(s3Row(v1("sk-old"))); // 原样保留
    expect(repo.getS3Settings()!.secretAccessKey).toBe(""); // 读路径按未配置口径
  });

  it("getter 首读触发惰性清扫（此后读路径不再出现 enc:v1）", () => {
    const rows = new Map<string, string>([["ai_settings", aiRow(v1("sk-ai"))]]);
    const repo = repoWith(rows);
    expect(repo.getAiSettings().providers.openai?.apiKey).toBe("sk-ai");
    expect(rows.get("ai_settings")!.includes("enc:v1:")).toBe(false);
  });
});

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
