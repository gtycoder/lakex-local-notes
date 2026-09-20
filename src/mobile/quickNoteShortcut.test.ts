/**
 * 「小记」深链订阅护栏（260920）。
 *
 * 覆盖一个**实测复现过的真 bug**：早先用一个永久布尔量去重冷启动的"双触发"（getLaunchUrl + appUrlOpen），
 * 结果**一次冷启动之后，进程存活期间再长按图标（热启动）就永远被忽略**。正确口径 = 只对"同一次点击的
 * 两条路径"做**短时间去重**，之后的热启动必须还能触发。
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  let cb: ((event: { url?: string }) => void) | null = null;
  const getLaunchUrl = vi.fn();
  const remove = vi.fn();
  return {
    getCb: () => cb,
    setCb: (fn: typeof cb) => { cb = fn; },
    getLaunchUrl,
    remove,
    addListener: (_event: string, fn: (event: { url?: string }) => void) => {
      cb = fn;
      return Promise.resolve({ remove });
    },
  };
});

vi.mock("@capacitor/app", () => ({
  App: { getLaunchUrl: h.getLaunchUrl, addListener: h.addListener },
}));

import { isQuickNoteShortcutUrl, subscribeQuickNoteShortcut } from "./quickNoteShortcut";

describe("小记深链订阅", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    h.getLaunchUrl.mockReset();
    h.remove.mockReset();
    h.setCb(null);
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  it("冷启动触发一次；之后的热启动 appUrlOpen 仍能再次触发（不是永久去重）", async () => {
    h.getLaunchUrl.mockResolvedValue({ url: "lakenotes://quick-note" });
    const onTrigger = vi.fn();
    const dispose = subscribeQuickNoteShortcut(onTrigger);
    await vi.advanceTimersByTimeAsync(0);
    expect(onTrigger).toHaveBeenCalledTimes(1);

    // 同一次冷启动的第二条路径（appUrlOpen 几乎同时到达）⇒ 被 1.5s 窗口去重
    h.getCb()?.({ url: "lakenotes://quick-note" });
    expect(onTrigger).toHaveBeenCalledTimes(1);

    // 用户回到 App，隔一会儿再次长按桌面图标（热启动）⇒ 必须能再次触发
    await vi.advanceTimersByTimeAsync(1600);
    h.getCb()?.({ url: "lakenotes://quick-note" });
    expect(onTrigger).toHaveBeenCalledTimes(2);
    dispose();
  });

  it("非深链 URL 不触发；非原生平台不订阅", async () => {
    h.getLaunchUrl.mockResolvedValue({ url: "https://example.com/other" });
    const onTrigger = vi.fn();
    const dispose = subscribeQuickNoteShortcut(onTrigger);
    await vi.advanceTimersByTimeAsync(1000);
    h.getCb()?.({ url: "https://example.com/other" });
    expect(onTrigger).not.toHaveBeenCalled();
    dispose();

    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => false };
    const onTrigger2 = vi.fn();
    subscribeQuickNoteShortcut(onTrigger2)();
    expect(h.getLaunchUrl).toHaveBeenCalledTimes(1); // 仍只是上面那一次
    expect(onTrigger2).not.toHaveBeenCalled();
  });

  it("URL 判定容错大小写/尾斜杠（lakenotes://quick-note / quicknote）", () => {
    expect(isQuickNoteShortcutUrl("lakenotes://quick-note")).toBe(true);
    expect(isQuickNoteShortcutUrl("LAKENOTES://QUICK-NOTE/")).toBe(true);
    expect(isQuickNoteShortcutUrl("lakenotes://quicknote")).toBe(true);
    expect(isQuickNoteShortcutUrl("lakenotes://quick-notes")).toBe(true);
    expect(isQuickNoteShortcutUrl("lakenotes://other")).toBe(false);
    expect(isQuickNoteShortcutUrl(null)).toBe(false);
  });
});
