// @vitest-environment jsdom
/**
 * 延迟加载 hook 的行为（261116 A）：<300ms 快操作直接出结果；>300ms 才显示；显示后至少 500ms。
 * 用假定时器驱动（vitest fake timers 同时推进 Date.now ⇒ minVisibleMs 的算术可测）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DelayedLoading, LOADING_DELAY_MS, LOADING_MIN_VISIBLE_MS, useDelayedLoading } from "./delayedLoading";

let host: HTMLDivElement;
let root: Root;

function Probe({ loading }: { loading: boolean }) {
  const show = useDelayedLoading(loading);
  return createElement("span", { "data-flag": show ? "loading" : "idle" });
}
function Gate({ children }: { children: string }) {
  return createElement(DelayedLoading, null, createElement("span", { "data-child": children }));
}

const render = (node: React.ReactElement) => act(() => root.render(node));
const flag = () => host.querySelector("[data-flag]")?.getAttribute("data-flag");
const child = () => host.querySelector("[data-child]")?.getAttribute("data-child") ?? null;
const advance = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useDelayedLoading", () => {
  it("快操作（delay 内结束）全程不显示加载态", async () => {
    render(createElement(Probe, { loading: true }));
    expect(flag()).toBe("idle");
    await advance(LOADING_DELAY_MS - 1);
    expect(flag()).toBe("idle");
    render(createElement(Probe, { loading: false }));
    await advance(LOADING_DELAY_MS * 4);
    expect(flag()).toBe("idle");
  });

  it("超过 delay 才显示；结束后至少停留 minVisible", async () => {
    render(createElement(Probe, { loading: true }));
    await advance(LOADING_DELAY_MS);
    expect(flag()).toBe("loading");
    render(createElement(Probe, { loading: false }));
    await advance(LOADING_MIN_VISIBLE_MS - 1);
    expect(flag()).toBe("loading");
    await advance(1);
    expect(flag()).toBe("idle");
  });

  it("加载已满 minVisible 后结束 ⇒ 立即消失（不再延住）", async () => {
    render(createElement(Probe, { loading: true }));
    await advance(LOADING_DELAY_MS + LOADING_MIN_VISIBLE_MS);
    expect(flag()).toBe("loading");
    render(createElement(Probe, { loading: false }));
    await advance(0);
    expect(flag()).toBe("idle");
  });

  it("卸载后不再 setState（定时器被清）", async () => {
    render(createElement(Probe, { loading: true }));
    await act(async () => root.unmount());
    root = createRoot(host);
    await advance(LOADING_DELAY_MS * 2);
    expect(host.textContent).toBe("");
  });
});

describe("DelayedLoading（Suspense 兜底）", () => {
  it("延迟 delay 后才渲染 children（快分包不闪文字）", async () => {
    render(createElement(Gate, null, "正在加载…"));
    expect(child()).toBeNull();
    await advance(LOADING_DELAY_MS - 1);
    expect(child()).toBeNull();
    await advance(1);
    expect(child()).toBe("正在加载…");
  });
});