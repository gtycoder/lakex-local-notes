// @vitest-environment jsdom
/**
 * P2 贴底跟随护栏（useStickToBottom）。
 *
 * jsdom 没有真实布局（scrollHeight/clientHeight 恒 0），这里用自定义属性模拟滚动几何；
 * 只锁行为，不模拟真实滚动/惯性的时序（那部分只能在 Electron 里验）。
 *
 * 锁四件事：
 * ① 初始/内容增长时吸附到底；
 * ② 用户主动上滚后内容再增长不强制滚动；
 * ③ 回到底部阈值内重新吸附；
 * ④ unmount 时 ResizeObserver.disconnect 被调用（无监听/观察器泄漏）。
 */
import { act, type RefObject } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useStickToBottom } from "./useStickToBottom";

interface ScrollBox {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/** 用可变盒子模拟滚动几何；scrollTop 的 setter 按浏览器语义夹到 [0, scrollHeight-clientHeight]。 */
function createScroller(initial: Partial<ScrollBox> = {}) {
  const box: ScrollBox = { scrollTop: 0, scrollHeight: 500, clientHeight: 100, ...initial };
  const el = document.createElement("div");
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => box.scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => box.clientHeight });
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => box.scrollTop,
    set: (value: number) => {
      const max = Math.max(0, box.scrollHeight - box.clientHeight);
      box.scrollTop = Math.max(0, Math.min(value, max));
    },
  });
  return { el, box };
}

let disconnectSpy: Mock<() => void>;

/** jsdom 没有 ResizeObserver：最小桩，只记录 disconnect。 */
class ResizeObserverStub {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = () => {
    disconnectSpy();
  };
}

function Harness({ scrollRef, signal, enabled }: {
  scrollRef: RefObject<HTMLDivElement | null>;
  signal: number;
  enabled: boolean;
}) {
  useStickToBottom({ scrollRef, contentSignal: signal, enabled });
  return null;
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot> | null = null;

function render(ref: RefObject<HTMLDivElement | null>, signal: number, enabled = true): void {
  act(() => {
    root!.render(<Harness scrollRef={ref} signal={signal} enabled={enabled} />);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  disconnectSpy = vi.fn();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

describe("useStickToBottom", () => {
  it("初始与内容增长时吸附到底", () => {
    const { el, box } = createScroller();
    const ref = { current: el };

    render(ref, 1);
    expect(box.scrollTop).toBe(400); // 500 - 100

    box.scrollHeight = 700;
    render(ref, 2);
    expect(box.scrollTop).toBe(600); // 700 - 100
  });

  it("用户主动上滚后，内容再增长不强制滚动", () => {
    const { el, box } = createScroller();
    const ref = { current: el };
    render(ref, 1);
    expect(box.scrollTop).toBe(400);

    // 用户往上滚（wheel 向上）⇒ 立即脱离跟随。
    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
    box.scrollTop = 40;
    el.dispatchEvent(new Event("scroll"));

    box.scrollHeight = 900;
    render(ref, 2);
    expect(box.scrollTop).toBe(40);
  });

  it("回到底部阈值内重新吸附", () => {
    const { el, box } = createScroller();
    const ref = { current: el };
    render(ref, 1);

    el.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, bubbles: true }));
    box.scrollTop = 40;
    el.dispatchEvent(new Event("scroll"));

    // 回到距底 60px（阈值 80px 内）。
    box.scrollTop = 900 - 100 - 60;
    el.dispatchEvent(new Event("scroll"));
    box.scrollHeight = 1200;
    render(ref, 2);
    expect(box.scrollTop).toBe(1100); // 1200 - 100
  });

  it("卸载时清理 ResizeObserver（disconnect 被调用）", () => {
    const { el } = createScroller();
    const ref = { current: el };
    render(ref, 1);
    expect(disconnectSpy).not.toHaveBeenCalled();

    act(() => {
      root!.unmount();
    });
    root = null;
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
  });
});
