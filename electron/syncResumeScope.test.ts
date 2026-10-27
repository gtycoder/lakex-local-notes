import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const HOOK = readFileSync(new URL("../src/hooks/useSyncProgress.ts", import.meta.url), "utf8");
const DESKTOP_SYNC = readFileSync(new URL("./s3v3/desktopSync.ts", import.meta.url), "utf8");

describe("桌面端断点续传 + 渐进展示（261026）", () => {
  it("runFullSync 开始置位、成功清除；启动时优先续传（不受 autoMode 限制）", () => {
    expect(MAIN).toContain("markSyncInterrupted");
    expect(MAIN).toContain("clearSyncInterrupted");
    expect(MAIN).toContain("getSyncInterruptedAt");
    expect(MAIN.indexOf("markSyncInterrupted")).toBeLessThan(MAIN.indexOf("clearSyncInterrupted"));
    expect(MAIN).toContain("启动自动续传");
    // 启动判据：有标记时即使 shouldSyncOnOpenClose=false 也要跑
    expect(MAIN).toMatch(/interruptedAt !== null \|\| shouldSyncOnOpenClose/);
  });

  it("引擎传输进度逐对象上报（有节流），并带阶段标签", () => {
    expect(DESKTOP_SYNC).toContain("onProgress");
    expect(DESKTOP_SYNC).toContain("v3：下载正文");
    expect(DESKTOP_SYNC).toContain("v3：下载附件");
    expect(DESKTOP_SYNC).toMatch(/lastProgressAt/);
  });

  it("渲染层在同步进行中节流刷新列表/目录（文档边下边出现）", () => {
    expect(HOOK).toContain("refreshListsProgressively");
    expect(HOOK).toContain("listNoteSummaries");
    expect(HOOK).toContain("listTreeNodes");
    expect(HOOK).toMatch(/progress\.phase !== "done" && !progress\.error/);
  });
});
