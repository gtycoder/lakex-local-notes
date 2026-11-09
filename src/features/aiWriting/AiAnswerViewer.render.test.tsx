// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * AI 写作答案的内核只读渲染（v1.1）：锁四件事——
 * ① 只读 viewer + Markdown 直接交给内核（setDocument("text/markdown")，不先转 lake）；
 * ② 内核出内容后才回调 onReady（父级据此撤掉 MarkdownView 兜底）；
 * ③ 卸载销毁实例（长会话滚动后不残留）；
 * ④ 渲染失败只回调、不把异常抛给消息组件（保证正文仍能显示）。
 */
const h = vi.hoisted(() => ({
  createLakeDocument: vi.fn(),
  destroyLakeEditor: vi.fn(),
}));

vi.mock("./../../features/editor/lakeRuntime", () => ({
  createLakeDocument: h.createLakeDocument,
  destroyLakeEditor: h.destroyLakeEditor,
}));

import { AiAnswerViewer } from "./AiAnswerViewer";

let host: HTMLDivElement;
let rootEl: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  h.createLakeDocument.mockReset();
  h.destroyLakeEditor.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  rootEl = createRoot(host);
});

afterEach(() => {
  act(() => rootEl.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function render(markdown: string, props: { onReady?: () => void; onError?: (message: string) => void } = {}) {
  act(() => { rootEl.render(createElement(AiAnswerViewer, { markdown, ...props })); });
}

describe("AiAnswerViewer", () => {
  it("挂只读 viewer，Markdown 直接交给内核解析；内核出内容后回调 onReady", () => {
    const onReady = vi.fn();
    const setDocument = vi.fn();
    h.createLakeDocument.mockImplementation((element: HTMLElement) => {
      const body = document.createElement("div");
      body.className = "ne-viewer-body";
      body.textContent = "渲染后的正文";
      element.append(body);
      return { setDocument };
    });
    render("## 标题", { onReady });

    expect(h.createLakeDocument).toHaveBeenCalledTimes(1);
    const [element, mode, , tocEnabled, noteId, , prefs] = h.createLakeDocument.mock.calls[0];
    expect(mode).toBe("viewer");
    expect(tocEnabled).toBe(false);
    expect(noteId).toBe("ai-writing-answer");
    expect(prefs).toMatchObject({ disableNativeToc: true, disableVirtualRendering: true, showToolbar: false });
    expect(element).toBe(host.querySelector(".aiw-answer-viewer"));
    expect(setDocument).toHaveBeenCalledWith("text/markdown", "## 标题");

    act(() => { vi.advanceTimersByTime(200); });
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("内核一直不出内容：超上限回调 onError（父级继续用 MarkdownView），绝不回调 onReady", () => {
    const onReady = vi.fn();
    const onError = vi.fn();
    h.createLakeDocument.mockReturnValue({ setDocument: vi.fn() });
    render("正文", { onReady, onError });
    act(() => { vi.advanceTimersByTime(200); });
    expect(onReady).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(6200); });
    expect(onReady).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0][0])).toContain("内核渲染超时");
  });

  it("卸载销毁内核实例", () => {
    h.createLakeDocument.mockReturnValue({ setDocument: vi.fn() });
    render("正文");
    act(() => rootEl.render(createElement("div")));
    expect(h.destroyLakeEditor).toHaveBeenCalledTimes(1);
  });

  it("渲染失败只回调 onError，不向宿主抛异常", () => {
    const onError = vi.fn();
    const onReady = vi.fn();
    h.createLakeDocument.mockImplementation(() => { throw new Error("内核炸了"); });
    expect(() => render("正文", { onReady, onError })).not.toThrow();
    expect(onError).toHaveBeenCalledWith("内核炸了");
    expect(onReady).not.toHaveBeenCalled();
  });

  it("切换正文重新 setDocument（同一实例内复用）", () => {
    const setDocument = vi.fn();
    h.createLakeDocument.mockReturnValue({ setDocument });
    render("一");
    render("二");
    // 实例只建一次；正文变化 = 再 setDocument（组件依赖 markdown 的 effect）。
    expect(h.createLakeDocument).toHaveBeenCalledTimes(1);
    expect(setDocument).toHaveBeenLastCalledWith("text/markdown", "二");
  });
});
