/**
 * 261127 同步气泡接线护栏（静态源码契约）：
 * 用户报障「正在同步的气泡成功后不消失 / 同屏两条不同状态的气泡」。根因 = 收尾有两套出口各写各的
 * （粘性气泡 timeout 0 + 另一条结果 toast）。收口后：手动同步入口（首页 / 工作区）都只经
 * \`sync/syncBubble.ts\` 的 begin/update/settle 写同一个 id，页面里不得再自己造同步 toast。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

const HOME = code(read("src/mobile/home/HomePage.tsx"));
const WORKSPACE = code(read("src/mobile/notebook/useWorkspaceSync.ts"));
const BUBBLE = code(read("src/mobile/sync/syncBubble.ts"));

describe("同步气泡接线（261127）", () => {
  it("两个手动同步入口都经共享气泡 begin/settle，不自己另起结果 toast", () => {
    for (const src of [HOME, WORKSPACE]) {
      expect(src).toContain("beginSyncBubble()");
      expect(src).toContain("settleSyncBubble(");
      expect(src).not.toContain("showToast((r.message");
      expect(src).not.toContain('toastActionError("同步"');
    }
  });

  it("首页进度实时写同一气泡（同 id 覆盖）", () => {
    expect(HOME).toContain("updateSyncBubbleProgress(syncProgress)");
    expect(HOME).not.toContain('showToast("正在同步');
  });

  it("收尾自动关的时长单一来源：成功 6s / 失败 10s / 进行中不自动关", () => {
    expect(BUBBLE).toContain("RESULT_TIMEOUT_OK_MS = 6_000");
    expect(BUBBLE).toContain("RESULT_TIMEOUT_ERROR_MS = 10_000");
    expect(BUBBLE).toMatch(/beginSyncBubble\(\)[\s\S]*timeout: 0/);
  });
});
