// @vitest-environment jsdom
/**
 * P1 流式 Markdown 节流护栏（useThrottledMarkdown）。
 *
 * 只用 react-dom/client + act（本仓 render 用例不引 testing-library）；用 performance.now 的
 * 手动时钟模拟「一次 Markdown 解析 + 提交」的耗时，从而确定性地复现 cost-based 节流。
 *
 * 锁四件事：
 * ① 连续 delta 合并：未到允许时间点不渲染，到期一次提交最新内容；
 * ② enable=false 立即透传；
 * ③ 生成结束（enable=false）当帧渲染最终完整内容，不残留截断；
 * ④ 卸载后清掉未触发定时器（无泄漏、无对已卸载组件 setState）。
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
    // 首次渲染耗时 500ms ⇒ 下次允许更新时间点 = 500 + 500×2 = 1500ms。

    clock = 500;
    render({ text: "AB", enabled: true, cost: 10 });
    expect(outputOf()).toBe("A"); // 第一次 delta 被推迟
    expect(vi.getTimerCount()).toBe(1);

    clock = 510;
    render({ text: "ABC", enabled: true, cost: 10 });
    expect(outputOf()).toBe("A"); // 第二次 delta 合并，旧定时器作废
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(outputOf()).toBe("ABC");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("enable=false 时立即透传最新内容，不排定时器", () => {
    render({ text: "A", enabled: false, cost: 500 });
    expect(outputOf()).toBe("A");

    clock = 500;
    render({ text: "AB", enabled: false, cost: 10 });
    expect(outputOf()).toBe("AB");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("最终内容一定会渲染：生成结束当帧透传全部内容并清掉待触发定时器", () => {
    render({ text: "A", enabled: true, cost: 500 });
    clock = 500;
    render({ text: "AB", enabled: true, cost: 10 });
    expect(outputOf()).toBe("A");
    expect(vi.getTimerCount()).toBe(1);

    // 生成结束：enabled 切 false，最终内容必须当帧出现（不能等定时器）。
    render({ text: "ABC", enabled: false, cost: 10 });
    expect(outputOf()).toBe("ABC");
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(outputOf()).toBe("ABC");
  });

  it("卸载后无定时器泄漏：clearTimeout 被调用、fake timer 归零", () => {
    render({ text: "A", enabled: true, cost: 500 });
    clock = 500;
    render({ text: "AB", enabled: true, cost: 10 });
    expect(vi.getTimerCount()).toBe(1);

    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    act(() => {
      root!.unmount();
    });
    root = null;

    expect(clearSpy).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    // 再推进时间也不会对已卸载组件 setState（没有定时器残留）。
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
