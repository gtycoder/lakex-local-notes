import { beforeEach, describe, expect, it } from "vitest";
import { beginSyncProgress, describeSyncProgress, endSyncProgress, pushSyncProgress, readSyncProgress } from "./syncProgressStore";

describe("移动端同步进度（P0-6）", () => {
  beforeEach(() => { beginSyncProgress(); });
  it("阶段切换立即通知；同阶段同百分比在 250ms 内节流", () => {
    pushSyncProgress({ phase: "bodies", done: 10, total: 100 });
    expect(readSyncProgress()?.phase).toBe("bodies");
    pushSyncProgress({ phase: "bodies", done: 10, total: 100 });
    expect(readSyncProgress()?.done).toBe(10); // 同百分比且 <250ms：不刷新
    pushSyncProgress({ phase: "bodies", done: 11, total: 100 });
    expect(readSyncProgress()?.done).toBe(11); // 进度变化 ≥1%：允许刷新
    pushSyncProgress({ phase: "assets", done: 1, total: 100, bytesDone: 2048, bytesTotal: 4096 });
    expect(readSyncProgress()?.phase).toBe("assets");
    expect(describeSyncProgress(readSyncProgress())).toContain("下载附件");
    expect(describeSyncProgress(readSyncProgress())).toContain("1/100");
    expect(describeSyncProgress(readSyncProgress())).toContain("KB");
    endSyncProgress();
    expect(readSyncProgress()).toBeNull();
  });
});
