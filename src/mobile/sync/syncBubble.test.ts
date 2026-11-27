import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getToastSnapshot, hideToast } from "../ui/toastBus";
import { SYNC_BUBBLE_ID, beginSyncBubble, settleSyncBubble, updateSyncBubbleProgress } from "./syncBubble";
import { writeSyncStatus, type MobileSyncStatus } from "./syncStatusStore";

/**
 * 261127 用户报障：同步成功后「正在同步…」气泡不消失、同屏还叠一条结果气泡。
 * 这里钉住收口后的判据：一轮同步只有一个气泡 id、收尾必然自动关（成功 6s / 失败 10s）。
 *
 * node 测试环境没有 DOM：toastBus 的 window.setTimeout / localStorage 给最小实现。
 */
if (typeof (globalThis as { window?: unknown }).window === "undefined") {
  (globalThis as { window: unknown }).window = {
    setTimeout: (handler: () => void, ms: number) => setTimeout(handler, ms),
    clearTimeout: (id: number) => clearTimeout(id),
  };
}
if (typeof (globalThis as { localStorage?: unknown }).localStorage === "undefined") {
  const memory = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string): string | null => memory.get(key) ?? null,
      setItem: (key: string, value: string): void => { memory.set(key, String(value)); },
      removeItem: (key: string): void => { memory.delete(key); },
      clear: (): void => { memory.clear(); },
    },
  });
}

const okStatus = (over: Partial<MobileSyncStatus> = {}): MobileSyncStatus => ({
  at: new Date().toISOString(), ok: true, message: "v3 同步完成：↑1 ↓2", ...over,
});
const failStatus = (message = "网络不可用"): MobileSyncStatus => ({
  at: new Date().toISOString(), ok: false, message,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  // 清掉上一用例残留的气泡与「本轮起点」，并写一条**早于本轮**的陈旧状态作为基线。
  settleSyncBubble();
  hideToast(SYNC_BUBBLE_ID);
  writeSyncStatus({ at: "2000-01-01T00:00:00.000Z", ok: true, message: "旧结果" });
});
afterEach(() => {
  hideToast(SYNC_BUBBLE_ID);
  vi.useRealTimers();
});

describe("同步气泡：一轮同步只有一个气泡", () => {
  it("进行中 = 粘性（timeout 0），进度以同 id 覆盖、不叠第二条", () => {
    beginSyncBubble();
    expect(getToastSnapshot()).toHaveLength(1);
    expect(getToastSnapshot()[0]).toMatchObject({ id: SYNC_BUBBLE_ID, text: "正在同步…", timeout: 0 });

    updateSyncBubbleProgress({ phase: "bodies", done: 1, total: 2, at: Date.now() });
    const items = getToastSnapshot();
    expect(items).toHaveLength(1);
    expect(items[0].text).toContain("正在同步：下载正文 1/2");
    expect(items[0].timeout).toBe(0); // 进行中不自动关（可手动关）
  });

  it("成功后同 id 覆盖成结果气泡，6s 自动消失（不再留一条常驻的「正在同步」）", () => {
    beginSyncBubble();
    writeSyncStatus(okStatus({ downloadedDocuments: 1, downloadedQuickNotes: 1, downloadedBytes: 52_000 }));
    expect(settleSyncBubble("已同步")).toBe(true);

    const items = getToastSnapshot();
    expect(items).toHaveLength(1); // 关键：不是「粘性 + 结果」两条
    expect(items[0].id).toBe(SYNC_BUBBLE_ID);
    expect(items[0].text).toContain("同步成功：下载 1 文档");
    expect(items[0].text).toContain("1 小记");
    expect(items[0].timeout).toBe(6_000);

    vi.advanceTimersByTime(5_999);
    expect(getToastSnapshot()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(getToastSnapshot()).toHaveLength(0); // 自己消失
  });

  it("失败后写 error 气泡，10s 自动消失", () => {
    beginSyncBubble();
    writeSyncStatus(failStatus("网络不可用"));
    settleSyncBubble();
    const items = getToastSnapshot();
    expect(items).toHaveLength(1);
    expect(items[0].type).toBe("error");
    expect(items[0].text).toBe("同步失败：网络不可用");
    expect(items[0].timeout).toBe(10_000);
    vi.advanceTimersByTime(10_000);
    expect(getToastSnapshot()).toHaveLength(0);
  });

  it("零进度轮（无变更）也能收尾：bridge 短句覆盖粘性气泡并自动关", () => {
    beginSyncBubble();
    // 本轮没跑引擎（离线 / 导入中 / 未配置）：状态还是上一轮的 ⇒ 不能用旧状态冒充本轮结果
    expect(settleSyncBubble("云同步已关闭")).toBe(true);
    const items = getToastSnapshot();
    expect(items).toHaveLength(1);
    expect(items[0].text).toBe("云同步已关闭");
    expect(items[0].timeout).toBe(6_000);
    vi.advanceTimersByTime(6_000);
    expect(getToastSnapshot()).toHaveLength(0);
  });

  it("进度 effect 收尾 + runSync 再收尾（双写）仍是同一条气泡", () => {
    beginSyncBubble();
    updateSyncBubbleProgress({ phase: "finalize", at: Date.now() });
    writeSyncStatus(okStatus({ uploadedDocuments: 2 }));
    settleSyncBubble(); // 进度清空（HomePage effect）
    settleSyncBubble("已同步"); // 手动同步返回后再收一次
    expect(getToastSnapshot()).toHaveLength(1);
    expect(getToastSnapshot()[0].text).toContain("同步成功：上传 2 文档");
  });

  it("跳过项摘要进结果气泡（task-67 不丢）", () => {
    beginSyncBubble();
    writeSyncStatus(okStatus({ uploadedDocuments: 1, warnings: [{ kind: "asset_missing", filename: "a.png", message: "missing" }] }));
    settleSyncBubble();
    expect(getToastSnapshot()[0].text).toContain("1 项被跳过");
  });

  it("没有结果也没有短句时直接收掉气泡（不留下永不消失的「正在同步」）", () => {
    beginSyncBubble();
    expect(settleSyncBubble()).toBe(false);
    expect(getToastSnapshot()).toHaveLength(0);
  });
});
