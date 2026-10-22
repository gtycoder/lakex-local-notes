// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useEditorCommandDispatcher } from "./useEditorCommandDispatcher";

type Dispatcher = ReturnType<typeof useEditorCommandDispatcher>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let dispatcher: Dispatcher;
let editor: HTMLDivElement;
let exec: ReturnType<typeof vi.fn>;
let refreshActive: ReturnType<typeof vi.fn>;
let dismissIme: ReturnType<typeof vi.fn>;
let closePanel: ReturnType<typeof vi.fn>;

function Harness() {
  dispatcher = useEditorCommandDispatcher({
    exec: exec as (command: string, ...args: unknown[]) => unknown,
    refreshActive: refreshActive as () => void,
    dismissIme: dismissIme as () => void,
    closePanel: closePanel as () => void,
  });
  return createElement("div", { ref: (node: HTMLDivElement | null) => { if (node) editor = node; }, contentEditable: true, suppressContentEditableWarning: true }, "hello world");
}

const selectText = (start: number, end: number) => {
  const text = editor.firstChild!;
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  const selection = document.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  exec = vi.fn();
  refreshActive = vi.fn();
  dismissIme = vi.fn();
  closePanel = vi.fn();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(createElement(Harness)));
  Object.defineProperty(editor, "isContentEditable", { configurable: true, get: () => true });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useEditorCommandDispatcher", () => {
  it("普通行内命令立即执行并刷新命令状态", () => {
    act(() => dispatcher.runInline("bold"));
    expect(exec).toHaveBeenCalledWith("bold");
    expect(refreshActive).toHaveBeenCalledTimes(1);
  });

  it("输入法组合中先 blur 提交，再等一拍聚焦并执行命令", () => {
    vi.useFakeTimers();
    editor.focus();
    act(() => { document.dispatchEvent(new Event("compositionstart", { bubbles: true })); });
    act(() => dispatcher.runInline("undo"));
    expect(exec).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(60));
    expect(exec).toHaveBeenCalledWith("undo");
    expect(refreshActive).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(editor);
  });

  it("面板命令先还原正文选区，执行后收输入法并保持面板打开", () => {
    selectText(0, 5);
    act(() => dispatcher.snapshotSelection());
    document.getSelection()!.removeAllRanges();
    let selectedAtExec = "";
    exec.mockImplementation(() => { selectedAtExec = document.getSelection()?.toString() ?? ""; });

    act(() => dispatcher.runPanel("bold"));
    expect(selectedAtExec).toBe("hello");
    expect(dismissIme).toHaveBeenCalledTimes(1);
    expect(refreshActive).toHaveBeenCalledTimes(1);
    expect(closePanel).not.toHaveBeenCalled();
  });

  it("两步命令执行后关闭面板", () => {
    act(() => dispatcher.runPanelAndClose("paintFormat"));
    expect(exec).toHaveBeenCalledWith("paintFormat");
    expect(closePanel).toHaveBeenCalledTimes(1);
  });
});
