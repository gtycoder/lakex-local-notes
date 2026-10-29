import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * 静态锁（261028 验收发现）：v3 同步完成后必须同时写 last_sync_result 与 last_synced_at。
 * 背景：`runFullSync` 只调了 `recordSyncResult`，`markSyncComplete` 没有调用点 ⇒ 同步浮窗的
 * 「上次同步」永远显示旧时间（新机器上为空）。这条回归只能靠「主进程文案/调用点」静态锁住，
 * 因为 runFullSync 依赖 Electron 运行时，没有单测入口。
 */
const main = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("sync status wiring（主进程）", () => {
  it("runFullSync 成功路径同时记录结果与时间", () => {
    expect(main).toContain("store.recordSyncResult(JSON.stringify(result));");
    expect(main).toContain("store.markSyncComplete(");
  });

  it("markSyncComplete 在 recordSyncResult 之后（同一成功分支）", () => {
    const at = main.indexOf("store.recordSyncResult(JSON.stringify(result));");
    const mark = main.indexOf("store.markSyncComplete(");
    expect(at).toBeGreaterThan(0);
    expect(mark).toBeGreaterThan(at);
    expect(mark - at).toBeLessThan(600); // 同一分支内紧邻
  });

  it("Del-6：v3 成功同步后写墓碑水线（Lake + 小记），不再逐行 markTombstonesPublished", () => {
    const sync = readFileSync(new URL("./s3v3/desktopSync.ts", import.meta.url), "utf8");
    expect(sync).toContain("store.markTombstonesWaterline(");
    expect(sync).toContain("quickNotes?.markTombstonesWaterline(");
    expect(sync).not.toContain("markTombstonesPublished");
  });
});
