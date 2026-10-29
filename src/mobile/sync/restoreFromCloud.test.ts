/**
 * 移动端「从云端恢复（换机/坏库）」护栏（261028，用户批准）。
 *
 * 语义：只清本机 v3 同步账本 → 立即整轮「只拉不打」（引擎「有 pointer、无 baseline」= pullAll）；
 * 不上传本机内容、不删本地附件、不隔离目录、不重启。
 *
 * 本用例锁三条：① 离线/未配置 ⇒ ok:false 且**不写库、不跑同步**；
 * ② 正常路径**先清账本再 syncNow**（顺序）；③ syncNow 抛错**原样上抛**（失败状态由 syncNow 自己写，不在这里吞）。
 *
 * 用真 DB（sql.js 门面，与 bridge 测试同口径）+ 真 clearV3State；syncNow 用 spy 替换（不真出网）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../native/nativeSqliteDb.js", async () =>
  (await import("../native/nativeSqliteDbTestMock.js")).createNativeSqliteDbMockModule(),
);

import { syncDomain } from "../bridge/sync";
import { ensureDb } from "../bridge/context";
import { EMPTY_MOBILE_V3_STATE, loadV3State, saveV3State } from "../data/v3StateRepository";

const S3_KEY = "lakex-local-notes-mobile.s3";
const SYNC_KEY = "lakex-local-notes-mobile.sync";
const S3_CONFIG = { endpoint: "https://s3.example.com", region: "cn-east-1", bucket: "bucket", accessKeyId: "ak", prefix: "lakex-local-notes" };

/** 内存 localStorage（node 环境；cloudState 判据读的就是它）。 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
    removeItem: (key: string) => { map.delete(key); },
    clear: () => { map.clear(); },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size; },
  } as Storage;
}

function enableCloud(): void {
  localStorage.setItem(S3_KEY, JSON.stringify(S3_CONFIG));
  localStorage.setItem(SYNC_KEY, JSON.stringify({ enabled: true, autoMode: "manual" }));
}

/** 预置一份非空账本：清空后必须回到 EMPTY（证明"清的是账本"）。 */
async function seedLedger() {
  const d = await ensureDb();
  await saveV3State(d, { ...EMPTY_MOBILE_V3_STATE, remotePurged: ["old-purged"], restorePending: ["old-restore"] });
  return d;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("bridge.restoreFromCloud（261028）", () => {
  it("云同步关闭（offline）：ok:false + 可见原因，且不写库、不跑同步", async () => {
    localStorage.setItem(S3_KEY, JSON.stringify(S3_CONFIG));
    localStorage.setItem(SYNC_KEY, JSON.stringify({ enabled: false, autoMode: "manual" }));
    const d = await seedLedger();
    const syncNow = vi.spyOn(syncDomain, "syncNow");

    const result = await syncDomain.restoreFromCloud();

    expect(result.ok).toBe(false);
    expect(result.message).toContain("云同步已关闭");
    expect(syncNow).not.toHaveBeenCalled();
    expect((await loadV3State(d)).remotePurged).toEqual(["old-purged"]);
  });

  it("未配置 S3：ok:false「未配置 S3」（不抛、不写库）", async () => {
    localStorage.setItem(SYNC_KEY, JSON.stringify({ enabled: true, autoMode: "manual" }));
    const d = await seedLedger();
    const syncNow = vi.spyOn(syncDomain, "syncNow");

    const result = await syncDomain.restoreFromCloud();

    expect(result).toEqual({ ok: false, message: "未配置 S3" });
    expect(syncNow).not.toHaveBeenCalled();
    expect((await loadV3State(d)).remotePurged).toEqual(["old-purged"]);
  });

  it("正常路径：先清空本机账本，再跑 syncNow（顺序锁死）", async () => {
    enableCloud();
    const d = await seedLedger();
    let ledgerWhenSyncStarted: unknown = "syncNow-not-called";
    const syncNow = vi.spyOn(syncDomain, "syncNow").mockImplementation(async () => {
      ledgerWhenSyncStarted = await loadV3State(d);
      return { message: "v3 同步完成：↑0 ↓12", quickNotes: null };
    });

    const result = await syncDomain.restoreFromCloud();

    expect(result).toEqual({ ok: true, message: "已从云端恢复：v3 同步完成：↑0 ↓12" });
    expect(syncNow).toHaveBeenCalledTimes(1);
    // 进 syncNow 的那一刻账本已是 EMPTY ⇒「先清 state，再全量重拉」
    expect(ledgerWhenSyncStarted).toEqual(EMPTY_MOBILE_V3_STATE);
  });

  it("syncNow 抛错：原样上抛、不吞（失败状态由 syncNow 自己写进 syncStatusStore/诊断）", async () => {
    enableCloud();
    await seedLedger();
    const failure = Object.assign(new Error("云端是另一套数据（epoch 不一致）"), { code: "epoch-mismatch" });
    vi.spyOn(syncDomain, "syncNow").mockRejectedValue(failure);

    await expect(syncDomain.restoreFromCloud()).rejects.toBe(failure);
  });
});
