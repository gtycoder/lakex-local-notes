// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoSave } from "./useAutoSave";

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.useFakeTimers();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

type Api = { schedule: (id: string, title: string, content: string) => void; flush: (id?: string) => Promise<void> };

function mount(save: (id: string, title: string, content: string) => void | Promise<void>): Api {
  const api = {} as Api;
  function Harness() {
    const auto = useAutoSave(save as never);
    useEffect(() => {
      api.schedule = auto.schedule as Api["schedule"];
      api.flush = auto.flush as Api["flush"];
    }, [auto]);
    return null;
  }
  act(() => root.render(createElement(Harness)));
  return api;
}

describe("useAutoSave（移动端自动保存）", () => {
  it("防抖 1s 后真的落盘（回归：曾把 pending 先删掉导致 drain 静默 no-op）", async () => {
    const save = vi.fn();
    const api = mount(save);
    act(() => api.schedule("n1", "标题", "内容"));
    expect(save).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("n1", "标题", "内容", undefined);
  });

  it("连续输入只保存最后一版；flush 立即保存挂起内容", async () => {
    const save = vi.fn();
    const api = mount(save);
    act(() => api.schedule("n1", "标题", "第一版"));
    act(() => { vi.advanceTimersByTime(400); });
    act(() => api.schedule("n1", "标题", "第二版"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][2]).toBe("第二版");

    act(() => api.schedule("n1", "标题", "第三版"));
    await act(async () => { await api.flush(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][2]).toBe("第三版");
  });

  it("flush(id) 必须等在途保存落完（否则旧快照会覆盖新内容）", async () => {
    let release: () => void = () => {};
    const save = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const api = mount(save);
    act(() => api.schedule("n1", "标题", "旧内容"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(save).toHaveBeenCalledTimes(1);
    let flushed = false;
    const pending = api.flush("n1").then(() => { flushed = true; });
    await act(async () => { await Promise.resolve(); });
    expect(flushed).toBe(false);
    await act(async () => { release(); await pending; });
    expect(flushed).toBe(true);
  });

  it("保存失败不丢内容：重新 flush 会再试一次", async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValue(undefined);
    const api = mount(save);
    act(() => api.schedule("n1", "标题", "内容"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { await api.flush(); });
    expect(save).toHaveBeenCalledTimes(2);
  });
});
