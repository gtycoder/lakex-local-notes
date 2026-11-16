// @vitest-environment jsdom
/**
 * P1 流式 Markdown 节流护栏（useThrottledMarkdown）—— 261116 参数收紧后的版本。
 *
 * 只用 react-dom/client + act（本仓 render 用例不引 testing-library）；用 performance.now 的
 * 手动时钟模拟「一次 Markdown 解析 + 提交」的耗时，从而确定性地复现 cost-based 节流。
 *
 * 锁六件事：
 * ① 连续 delta 合并：未到允许时间点不渲染，到期一次提交最新内容；
 * ② 高渲染成本下**最大等待 = 300ms**（新上限，旧值是 2000ms）；
 * ③ 未到上限时「间隔 = 1.5 × 上次渲染耗时」（COST_RATE 新值）；
 * ④ enable=false 立即透传；
 * ⑤ 生成结束（enable=false）当帧渲染最终完整内容，不残留截断；
 * ⑥ 卸载后清掉未触发定时器（无泄漏、无对已卸载组件 setState）。
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useThrottledMarkdown } from "./useThrottledMarkdown";

/** 手动时钟：performance.now 的替身，用来精准控制「渲染耗时」。 */
let clock = 0;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

/**
 * 探针组件：先调 hook（计时起点），再推进 clock（模拟本次渲染剩余部分/提交的耗时）。
 * 这样 hook 量到的「上次渲染耗时」就是 cost，而不是 jsdom 里的 0ms。
 */
function Probe({ text, enabled, cost = 0 }: { text: string; enabled: boolean; cost?: number }) {
  const output = useThrottledMarkdown(text, enabled);
  clock += cost;
  return <div data-output={output} />;
}

function outputOf(): string | null {
  return host.querySelector("[data-output]")?.getAttribute("data-output") ?? null;
}

function render(props: { text: string; enabled: boolean; cost?: number }): void {
  act(() => {
    root!.render(<Probe {...props} />);
  });
}

/** 推进时间：手动时钟与 fake timers 必须一起走（hook 的允许更新点是按 performance.now 算的）。 */
function tick(ms: number): void {
  clock += ms;
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  clock = 0;
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // 只假 setTimeout/clearTimeout：performance.now 由 spy 手动推进，渲染耗时可控。
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useThrottledMarkdown", () => {
  it("连续内容更新被合并：未到允许时间点不渲染，到期只提交最新内容", () => {
    render({ text: "A", enabled: true, cost: 500 });
    expect(outputOf()).toBe("A");
    expect(vi.getTimerCount()).toBe(0);
    // 首次渲染耗时 500ms，已到 300ms 上限 ⇒ 下次允许更新时间点 = 500 + 300 = 800ms。

    render({ text: "AB", enabled: true, cost: 0 });
    expect(outputOf()).toBe("A"); // 第一次 delta 被推迟（delay = 800 - 500 = 300ms）
    expect(vi.getTimerCount()).toBe(1);

    tick(299);
    expect(outputOf()).toBe("A"); // 上限内不允许更新

    // 第二次 delta 在 799ms 到达：旧定时器作废，只保留最新内容，delay = 800 - 799 = 1ms。
    render({ text: "ABC", enabled: true, cost: 0 });
    expect(outputOf()).toBe("A");
    tick(1);
    expect(outputOf()).toBe("ABC");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("高渲染成本（5000ms）下最大等待仍是 300ms，不再是 2000ms", () => {
    render({ text: "A", enabled: true, cost: 5000 });
    expect(outputOf()).toBe("A");
    // 旧参数下这里会是 5000 + 2000 = 7000ms；新上限 = 5000 + 300 = 5300ms。

    render({ text: "AB", enabled: true, cost: 0 });
    expect(outputOf()).toBe("A");
    expect(vi.getTimerCount()).toBe(1);

    tick(299);
    expect(outputOf()).toBe("A");
    tick(1);
    expect(outputOf()).toBe("AB");
  });

  it("未触到上限时间隔 = 1.5 × 上次渲染耗时（COST_RATE）", () => {
    render({ text: "A", enabled: true, cost: 100 });
    // 100ms × 1.5 = 150ms < 300ms 上限 ⇒ 允许时间点 = 250ms。
    render({ text: "AB", enabled: true, cost: 0 });
    expect(outputOf()).toBe("A");
    tick(149);
    expect(outputOf()).toBe("A");
    tick(1);
    expect(outputOf()).toBe("AB");
  });

  it("enable=false 时立即透传最新内容，不排定时器", () => {
    render({ text: "A", enabled: false, cost: 500 });
    expect(outputOf()).toBe("A");

    render({ text: "AB", enabled: false, cost: 10 });
    expect(outputOf()).toBe("AB");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("最终内容一定会渲染：生成结束当帧透传全部内容并清掉待触发定时器", () => {
    render({ text: "A", enabled: true, cost: 500 });
    render({ text: "AB", enabled: true, cost: 0 });
    expect(outputOf()).toBe("A");
    expect(vi.getTimerCount()).toBe(1);

    // 生成结束：enabled 切 false，最终内容必须当帧出现（不能等定时器）。
    render({ text: "ABC", enabled: false, cost: 0 });
    expect(outputOf()).toBe("ABC");
    expect(vi.getTimerCount()).toBe(0);

    act(() => { vi.advanceTimersByTime(5000); });
    expect(outputOf()).toBe("ABC");
  });

  it("卸载后无定时器泄漏：clearTimeout 被调用、fake timer 归零", () => {
    render({ text: "A", enabled: true, cost: 500 });
    render({ text: "AB", enabled: true, cost: 0 });
    expect(vi.getTimerCount()).toBe(1);

    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    act(() => { root!.unmount(); });
    root = null;

    expect(clearSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    // 再推进时间也不会对已卸载组件 setState（没有定时器残留）。
    act(() => { vi.advanceTimersByTime(5000); });
    expect(vi.getTimerCount()).toBe(0);
  });
});