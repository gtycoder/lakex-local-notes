// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoSave } from "./useAutoSave";

type Save = (id: string, title: string, content: string, plain?: string) => void | Promise<void>;
type Api = { schedule: (id: string, title: string, content: string, plain?: string) => void; flush: (id?: string) => Promise<void>; cancel: (id?: string) => void };
let api: Api | null = null;
function Harness({ save, onError }: { save: Save; onError?: (id: string, error: unknown) => void }) {
  api = useAutoSave(save, { onError });
  return null;
}
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); api = null; });

describe("useAutoSave flush（审计 F05）", () => {
  it("flush 保存所有挂起文档并等待真实落盘", async () => {
    const save = vi.fn();
    act(() => root.render(createElement(Harness, { save })));
    act(() => { api!.schedule("a", "ta", "ca"); api!.schedule("b", "tb", "cb"); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => { await api!.flush(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith("a", "ta", "ca", undefined);
    expect(save).toHaveBeenCalledWith("b", "tb", "cb", undefined);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("flush(id) 只保存该文档；cancel 丢弃不写", async () => {
    const save = vi.fn();
    act(() => root.render(createElement(Harness, { save })));
    act(() => { api!.schedule("a", "ta", "ca"); api!.schedule("b", "tb", "cb"); });
    await act(async () => { await api!.flush("a"); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("a", "ta", "ca", undefined);
    act(() => { api!.cancel("b"); vi.advanceTimersByTime(2000); });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("同文档单飞：在途时合并新版本，旧请求结束后只再落最新版本", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const save = vi.fn()
      .mockImplementationOnce(async () => { await gate; })
      .mockResolvedValue(undefined);
    act(() => root.render(createElement(Harness, { save })));
    act(() => { api!.schedule("a", "t1", "c1"); });
    const first = api!.flush("a");
    await Promise.resolve();
    act(() => { api!.schedule("a", "t2", "c2"); });
    const second = api!.flush("a");
    expect(save).toHaveBeenCalledTimes(1);
    release();
    await act(async () => { await Promise.all([first, second]); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith("a", "t2", "c2", undefined);
  });

  it("保存失败会 reject、上报，并保留快照供重试", async () => {
    const onError = vi.fn();
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    act(() => root.render(createElement(Harness, { save, onError })));
    act(() => { api!.schedule("a", "t", "c"); });
    await act(async () => { await expect(api!.flush("a")).rejects.toThrow("disk full"); });
    expect(onError).toHaveBeenCalledWith("a", expect.any(Error));
    await act(async () => { await api!.flush("a"); });
    expect(save).toHaveBeenCalledTimes(2);
  });
});
