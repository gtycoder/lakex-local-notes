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
    h.getLaunchUrl.mockResolvedValue({ url: "locallakexnotes://quick-note" });
    const onTrigger = vi.fn();
    const dispose = subscribeQuickNoteShortcut(onTrigger);
    await vi.advanceTimersByTimeAsync(0);
    expect(onTrigger).toHaveBeenCalledTimes(1);

    // 同一次冷启动的第二条路径（appUrlOpen 几乎同时到达）⇒ 被 1.5s 窗口去重
    h.getCb()?.({ url: "locallakexnotes://quick-note" });
    expect(onTrigger).toHaveBeenCalledTimes(1);

    // 用户回到 App，隔一会儿再次长按桌面图标（热启动）⇒ 必须能再次触发
    await vi.advanceTimersByTimeAsync(1600);
    h.getCb()?.({ url: "locallakexnotes://quick-note" });
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

  it("URL 判定容错大小写/尾斜杠（locallakexnotes://quick-note / quicknote）", () => {
    expect(isQuickNoteShortcutUrl("locallakexnotes://quick-note")).toBe(true);
    expect(isQuickNoteShortcutUrl("LOCALLAKEXNOTES://QUICK-NOTE/")).toBe(true);
    expect(isQuickNoteShortcutUrl("locallakexnotes://quicknote")).toBe(true);
    expect(isQuickNoteShortcutUrl("locallakexnotes://quick-notes")).toBe(true);
    expect(isQuickNoteShortcutUrl("locallakexnotes://other")).toBe(false);
    expect(isQuickNoteShortcutUrl(null)).toBe(false);
  });
});

// 用户 261013 定稿：长按小记快捷入口的**这次冷启动**不跑整轮同步（写作区要立刻可输入，
// 而整轮同步在 WebView 主线程上会抢开始打字那几秒）。判据由本模块给 useAutoSync。
// 用 resetModules + 动态 import 拿"全新进程"状态（出厂状态是模块级、每个进程只判定一次）。
describe("冷启动性质判定（快捷入口 ⇒ useAutoSync 跳过本次整轮同步）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    h.getLaunchUrl.mockReset();
    h.remove.mockReset();
    h.setCb(null);
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
  });
  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
  });

  it("命中小记深链 ⇒ true", async () => {
    h.getLaunchUrl.mockResolvedValue({ url: "locallakexnotes://quick-note" });
    const mod = await import("./quickNoteShortcut");
    const pending = mod.whenQuickNoteLaunchResolved();
    mod.subscribeQuickNoteShortcut(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBe(true);
  });

  it("其它深链 ⇒ false（不能被「任意深链」当成快捷入口）", async () => {
    h.getLaunchUrl.mockResolvedValue({ url: "locallakexnotes://other" });
    const mod = await import("./quickNoteShortcut");
    const pending = mod.whenQuickNoteLaunchResolved();
    mod.subscribeQuickNoteShortcut(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBe(false);
  });

  it("普通启动（没有深链）⇒ 轮询窗口走完才 false", async () => {
    h.getLaunchUrl.mockResolvedValue({});
    const mod = await import("./quickNoteShortcut");
    const pending = mod.whenQuickNoteLaunchResolved();
    mod.subscribeQuickNoteShortcut(() => undefined);
    await vi.advanceTimersByTimeAsync(3200);
    await expect(pending).resolves.toBe(false);
  });

  it("兜底：没人订阅也不会永久挂起（超时即按普通启动）", async () => {
    const mod = await import("./quickNoteShortcut");
    const pending = mod.whenQuickNoteLaunchResolved(500);
    await vi.advanceTimersByTimeAsync(600);
    await expect(pending).resolves.toBe(false);
  });

  it("非原生平台立即 false（Web 预览/测试）", async () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => false };
    const mod = await import("./quickNoteShortcut");
    await expect(mod.whenQuickNoteLaunchResolved()).resolves.toBe(false);
  });
});
