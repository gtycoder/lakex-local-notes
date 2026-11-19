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

import { isQuickNoteShortcutUrl, quickNoteShortcutMode, subscribeQuickNoteShortcut } from "./quickNoteShortcut";

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
    h.getLaunchUrl.mockResolvedValue({ url: "lakexlocalnotes://quick-note" });
    const onTrigger = vi.fn();
    const dispose = subscribeQuickNoteShortcut(onTrigger);
    await vi.advanceTimersByTimeAsync(0);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    // 无参深链 = plain（旧「小记」语义钉死：回调载荷就是旧模式）。
    expect(onTrigger).toHaveBeenCalledWith("plain");

    // 同一次冷启动的第二条路径（appUrlOpen 几乎同时到达）⇒ 被 1.5s 窗口去重
    h.getCb()?.({ url: "lakexlocalnotes://quick-note" });
    expect(onTrigger).toHaveBeenCalledTimes(1);

    // 用户回到 App，隔一会儿再次长按桌面图标（热启动）⇒ 必须能再次触发
    await vi.advanceTimersByTimeAsync(1600);
    h.getCb()?.({ url: "lakexlocalnotes://quick-note" });
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

  it("URL 判定容错大小写/尾斜杠（lakexlocalnotes://quick-note / quicknote）", () => {
    expect(isQuickNoteShortcutUrl("lakexlocalnotes://quick-note")).toBe(true);
    expect(isQuickNoteShortcutUrl("LAKEXLOCALNOTES://QUICK-NOTE/")).toBe(true);
    expect(isQuickNoteShortcutUrl("lakexlocalnotes://quicknote")).toBe(true);
    expect(isQuickNoteShortcutUrl("lakexlocalnotes://quick-notes")).toBe(true);
    expect(isQuickNoteShortcutUrl("lakexlocalnotes://other")).toBe(false);
    expect(isQuickNoteShortcutUrl(null)).toBe(false);
  });

  it("订阅回调携带模式：?src=camera 热启动触发 camera", async () => {
    h.getLaunchUrl.mockResolvedValue({});
    const onTrigger = vi.fn();
    const dispose = subscribeQuickNoteShortcut(onTrigger);
    await vi.advanceTimersByTimeAsync(0);
    h.getCb()?.({ url: "lakexlocalnotes://quick-note?src=camera" });
    expect(onTrigger).toHaveBeenCalledWith("camera");
    dispose();
  });
});

/**
 * 快捷方式三模式解析（261119）：「小记」（无参）/「拍照小记」（?src=camera）/「剪切板小记」（?src=clipboard）。
 * 无参旧语义必须钉死：不带 src 一律 "plain"，多余/未知参数不得劫持旧语义。
 */
describe("quickNoteShortcutMode 三模式解析", () => {
  it("无参 = plain（现有「小记」语义零变化）", () => {
    expect(quickNoteShortcutMode("lakexlocalnotes://quick-note")).toBe("plain");
    expect(quickNoteShortcutMode("lakexlocalnotes://quick-note/")).toBe("plain");
    expect(quickNoteShortcutMode("lakexlocalnotes://quicknote")).toBe("plain");
    expect(quickNoteShortcutMode("LAKEXLOCALNOTES://QUICK-NOTE")).toBe("plain");
    expect(quickNoteShortcutMode("lakexlocalnotes://quick-note?foo=1")).toBe("plain");
  });

  it("?src=camera / ?src=clipboard = 新增两模式", () => {
    expect(quickNoteShortcutMode("lakexlocalnotes://quick-note?src=camera")).toBe("camera");
    expect(quickNoteShortcutMode("lakexlocalnotes://quick-note?src=clipboard")).toBe("clipboard");
    expect(quickNoteShortcutMode("lakexlocalnotes://quicknote?src=clipboard")).toBe("clipboard");
  });

  it("容错：大小写 / 多余参数 / fragment 都不改判定；未知 src 按 plain", () => {
    expect(quickNoteShortcutMode("lakexlocalnotes://quick-note?SRC=CAMERA")).toBe("camera");
    expect(quickNoteShortcutMode("lakexlocalnotes://quick-note?x=1&src=camera")).toBe("camera");
    expect(quickNoteShortcutMode("lakexlocalnotes://quick-note?src=camera#frag")).toBe("camera");
    expect(quickNoteShortcutMode("lakexlocalnotes://quick-note?src=unknown")).toBe("plain");
    expect(quickNoteShortcutMode("lakexlocalnotes://quick-note?src=")).toBe("plain");
  });

  it("非小记深链 = null（与 isQuickNoteShortcutUrl 同边界）", () => {
    expect(quickNoteShortcutMode(null)).toBeNull();
    expect(quickNoteShortcutMode("")).toBeNull();
    expect(quickNoteShortcutMode("https://example.com/?src=camera")).toBeNull();
    expect(quickNoteShortcutMode("lakexlocalnotes://other?src=camera")).toBeNull();
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
    h.getLaunchUrl.mockResolvedValue({ url: "lakexlocalnotes://quick-note" });
    const mod = await import("./quickNoteShortcut");
    const pending = mod.whenQuickNoteLaunchResolved();
    mod.subscribeQuickNoteShortcut(() => undefined);
    await vi.advanceTimersByTimeAsync(0);
    await expect(pending).resolves.toBe(true);
  });

  it("其它深链 ⇒ false（不能被「任意深链」当成快捷入口）", async () => {
    h.getLaunchUrl.mockResolvedValue({ url: "lakexlocalnotes://other" });
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
