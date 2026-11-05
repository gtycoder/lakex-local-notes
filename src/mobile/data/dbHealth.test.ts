/**
 * 坏库判据（261105）：打开阶段错误归类 + quick_check 结果判定。
 * 页面只消费这里的结果（不在 UI 里再写一套判据）。
 */
import { describe, expect, it } from "vitest";
import type { MobileDb } from "./sqliteDb.js";
import { checkMobileDbHealth, classifyDbOpenError, describeDbHealth } from "./dbHealth.js";

function fakeDb(opts: { quickCheck?: string; fkRows?: unknown[]; throwOnQuick?: boolean }): MobileDb {
  return {
    prepare: (sql: string) => ({
      get: async () => {
        if (sql.includes("quick_check")) {
          if (opts.throwOnQuick) throw new Error("database disk image is malformed");
          return { quick_check: opts.quickCheck ?? "ok" };
        }
        return undefined;
      },
      all: async () => (sql.includes("foreign_key_check") ? opts.fkRows ?? [] : []),
      run: async () => ({ changes: 0, lastInsertRowid: 0 }),
    }),
    transaction: async (fn: () => Promise<unknown>) => await fn(),
    pragma: async () => [],
    exec: async () => undefined,
    databaseSizeBytes: async () => 0,
    close: async () => undefined,
  } as unknown as MobileDb;
}

describe("classifyDbOpenError", () => {
  it("损坏类消息 ⇒ corrupt", () => {
    for (const message of [
      "database disk image is malformed",
      "file is not a database",
      "SQLITE_CORRUPT: database corruption detected",
      "disk I/O error",
    ]) {
      expect(classifyDbOpenError(new Error(message)), message).toBe("corrupt");
    }
  });

  it("其它错误 / 空值 ⇒ other（按普通启动失败处理）", () => {
    expect(classifyDbOpenError(new Error("no such table: notes"))).toBe("other");
    expect(classifyDbOpenError("")).toBe("other");
    expect(classifyDbOpenError(undefined)).toBe("other");
  });
});

describe("checkMobileDbHealth", () => {
  it("quick_check=ok 且无外键错误 ⇒ 健康", async () => {
    await expect(checkMobileDbHealth(fakeDb({}))).resolves.toEqual({ ok: true, quickCheck: "ok", foreignKeyErrors: 0 });
    expect(describeDbHealth({ ok: true, quickCheck: "ok", foreignKeyErrors: 0 })).toContain("通过");
  });

  it("quick_check 报错 / 外键错误 ⇒ 不健康（带原因）", async () => {
    const bad = await checkMobileDbHealth(fakeDb({ quickCheck: "*** in database main *** Page 3 is never used" }));
    expect(bad.ok).toBe(false);
    expect(describeDbHealth(bad)).toContain("quick_check=");
    const fk = await checkMobileDbHealth(fakeDb({ fkRows: [{ id: 1 }] }));
    expect(fk.ok).toBe(false);
  });

  it("PRAGMA 本身抛错 ⇒ 判不健康但不抛（页面只需结论）", async () => {
    const health = await checkMobileDbHealth(fakeDb({ throwOnQuick: true }));
    expect(health.ok).toBe(false);
    expect(health.quickCheck).toContain("检查失败");
  });
});
