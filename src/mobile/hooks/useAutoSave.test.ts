// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoSave } from "./useAutoSave";

type Api = { schedule: (id: string, title: string, content: string, plain?: string) => void; flush: (id?: string) => void; cancel: (id?: string) => void };
let api: Api | null = null;
function Harness({ save }: { save: (id: string, title: string, content: string, plain?: string) => void }) {
  api = useAutoSave(save);
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
  it("flush 保存所有挂起文档，而不是取消", () => {
    const save = vi.fn();
    act(() => root.render(createElement(Harness, { save })));
    act(() => { api!.schedule("a", "ta", "ca"); api!.schedule("b", "tb", "cb"); });
    expect(save).not.toHaveBeenCalled();
    act(() => { api!.flush(); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith("a", "ta", "ca", undefined);
    expect(save).toHaveBeenCalledWith("b", "tb", "cb", undefined);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("flush(id) 只保存该文档；cancel 丢弃不写", () => {
    const save = vi.fn();
    act(() => root.render(createElement(Harness, { save })));
    act(() => { api!.schedule("a", "ta", "ca"); api!.schedule("b", "tb", "cb"); });
    act(() => { api!.flush("a"); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("a", "ta", "ca", undefined);
    act(() => { api!.cancel("b"); vi.advanceTimersByTime(2000); });
    expect(save).toHaveBeenCalledTimes(1);
  });
});
