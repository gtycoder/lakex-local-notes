// @vitest-environment jsdom
/**
 * useAsyncAction 行为护栏（261028 DT-13）：设置面板 10 组手写 `busy/msg` 收敛成原语后的语义锁。
 *
 * 锁的四条：
 * · busy 覆盖**整个**异步窗口（开始即真、结束必假，失败也一样）；
 * · 成功文案 / 失败文案口径不变（失败 = 调用方前缀 + native 错误信息，去掉 IPC 码前缀）；
 * · busy 期间重入直接忽略（迁移前各处的 `if (xBusy) return` 由 hook 兜住）；
 * · 共享 channel（主进程状态栏那种「谁最后写谁显示」的单条提示）仍能被同一个 hook 读写。
 */
import { act, createElement, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAsyncAction, type AsyncAction } from "./useAsyncAction";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const apiRef: { current: AsyncAction | null } = { current: null };
const channelRef: { current: string | null } = { current: null };

function Harness() {
  const api = useAsyncAction();
  useEffect(() => { apiRef.current = api; });
  return null;
}

/** 共享通道版：文案不在 hook 内部，而是落在调用方那条 state 上（模拟 settings 的 syncMsg）。 */
function ChannelHarness() {
  const [message, setMessage] = useState<string | null>(null);
  const api = useAsyncAction({ channel: { message, setMessage } });
  useEffect(() => { apiRef.current = api; channelRef.current = message; });
  return null;
}

const render = (element: ReturnType<typeof createElement>) => act(() => root.render(element));

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  apiRef.current = null;
  channelRef.current = null;
  render(createElement(Harness));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
});

describe("useAsyncAction：busy / 文案 / 错误", () => {
  it("busy 覆盖整个异步窗口；成功文案支持由结果派生", async () => {
    let resolveAction!: (value: string) => void;
    const action = () => new Promise<string>((resolve) => { resolveAction = resolve; });
    let done: Promise<string | undefined> | undefined;
    act(() => { done = apiRef.current!.run(action, { success: (text) => `完成：${text}` }); });
    expect(apiRef.current!.busy).toBe(true);
    expect(apiRef.current!.message).toBeNull();
    await act(async () => { resolveAction("a"); await done; });
    expect(apiRef.current!.busy).toBe(false);
    expect(apiRef.current!.message).toBe("完成：a");
    expect(apiRef.current!.error).toBeNull();
    expect(await done).toBe("a");
  });

  it("失败 = 前缀 + native 错误信息（IPC 码前缀被剥掉），busy 复位", async () => {
    const failure = Object.assign(new Error("[LAKE_IPC_CODE:NOT_FOUND] 备份目录不可写"), { code: "NOT_FOUND" });
    await act(async () => {
      await apiRef.current!.run(async () => { throw failure; }, { errorPrefix: "备份失败：" });
    });
    expect(apiRef.current!.busy).toBe(false);
    expect(apiRef.current!.error).toBe("备份失败：备份目录不可写");
    // 内部文案通道（无 channel 时 message 只承载成功提示，不重复承载错误）
    expect(apiRef.current!.message).toBeNull();
  });

  it("成功返回 null 文案 = 不写提示（取消系统框这类早退）", async () => {
    let result: null | undefined = undefined;
    await act(async () => { result = await apiRef.current!.run(async () => null, { success: (text) => text }); });
    expect(result).toBeNull();
    expect(apiRef.current!.message).toBeNull();
    expect(apiRef.current!.busy).toBe(false);
  });

  it("busy 期间重入被忽略（不会并发跑第二份，也不会把 busy 提前复位）", async () => {
    let resolveFirst!: (value: number) => void;
    const first = new Promise<number>((resolve) => { resolveFirst = resolve; });
    let firstDone: Promise<number | undefined> | undefined;
    act(() => { firstDone = apiRef.current!.run(() => first); });
    let secondCalls = 0;
    let secondResult: number | undefined = 999;
    await act(async () => {
      secondResult = await apiRef.current!.run(async () => { secondCalls += 1; return 2; });
    });
    expect(secondCalls).toBe(0);
    expect(secondResult).toBeUndefined();
    expect(apiRef.current!.busy).toBe(true);
    await act(async () => { resolveFirst(1); await firstDone; });
    expect(await firstDone).toBe(1);
    expect(apiRef.current!.busy).toBe(false);
  });

  it("reset 只清提示、不动 busy", async () => {
    let resolveAction!: () => void;
    const action = () => new Promise<void>((resolve) => { resolveAction = resolve; });
    let done: Promise<void | undefined> | undefined;
    act(() => { done = apiRef.current!.run(action, { success: "已保存" }); });
    await act(async () => { resolveAction(); await done; });
    expect(apiRef.current!.message).toBe("已保存");
    act(() => apiRef.current!.reset());
    expect(apiRef.current!.message).toBeNull();
    expect(apiRef.current!.error).toBeNull();
    expect(apiRef.current!.busy).toBe(false);
  });
});

describe("useAsyncAction：共享文案通道（状态栏那种单条提示）", () => {
  beforeEach(() => { render(createElement(ChannelHarness)); });

  it("成功与失败都写进调用方那条通道（保持「谁最后写谁显示」）", async () => {
    await act(async () => { await apiRef.current!.run(async () => "x", { success: "同步策略已保存" }); });
    expect(channelRef.current).toBe("同步策略已保存");
    expect(apiRef.current!.message).toBe("同步策略已保存");

    // 下一次动作开始前先清空通道，再写新结果
    await act(async () => { await apiRef.current!.run(async () => { throw new Error("网络不可用"); }); });
    expect(channelRef.current).toBe("网络不可用");
    expect(apiRef.current!.error).toBe("网络不可用");
  });

  it("setMessage 直接写通道（浏览器端不支持这类早退提示）", () => {
    act(() => apiRef.current!.setMessage("浏览器端暂不支持整库备份（请在桌面端操作）"));
    expect(channelRef.current).toBe("浏览器端暂不支持整库备份（请在桌面端操作）");
    expect(apiRef.current!.busy).toBe(false);
  });
});
