// @vitest-environment jsdom
import { act, createElement, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSavePipelineGlue } from "./useSavePipelineGlue";

let api: ReturnType<typeof useSavePipelineGlue> | null = null;
function Harness() {
  const openTabsRef = useRef([]);
  const editorsRef = useRef(new Map());
  api = useSavePipelineGlue({
    setNotes: () => {}, setTreeNodes: () => {}, setSync: () => {}, setOpenTabs: () => {},
    setDraftEntries: () => {}, setError: () => {}, openTabsRef, editorsRef,
  } as never);
  return null;
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); api = null; });

describe("useSavePipelineGlue 捕获注册表（审计 F15）", () => {
  it("Sheet/Board 注册的按需序列化优先于（缺失的）Lake 实例", () => {
    act(() => root.render(createElement(Harness)));
    act(() => { api!.handleCaptureReady("n1", () => "<sheet-body/>"); });
    expect(api!.handleCaptureContent("n1")).toBe("<sheet-body/>");
  });

  it("卸载（注册 null）后不再命中；capture 返回 null 时也回退", () => {
    act(() => root.render(createElement(Harness)));
    act(() => { api!.handleCaptureReady("n2", () => "<b/>"); });
    act(() => { api!.handleCaptureReady("n2", null); });
    expect(api!.handleCaptureContent("n2")).toBeUndefined();
    act(() => { api!.handleCaptureReady("n3", () => null); });
    expect(api!.handleCaptureContent("n3")).toBeUndefined();
  });
});
