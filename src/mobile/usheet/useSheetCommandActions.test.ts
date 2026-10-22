// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FUniver } from "@univerjs/presets";

const toast = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("../ui/toastBus", () => ({ showToast: toast.showToast }));

import { useSheetCommandActions } from "./useSheetCommandActions";

type Api = ReturnType<typeof useSheetCommandActions>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let api: Api;
let univer: FUniver;
let range: Record<string, ReturnType<typeof vi.fn>>;
let refresh: ReturnType<typeof vi.fn>;

function Harness({ editing }: { editing: boolean }) {
  api = useSheetCommandActions({
    editing,
    getUniverAPI: () => univer,
    getHost: () => host,
    refreshCellFormat: refresh as () => void,
  });
  return null;
}

const render = (editing = true) => {
  act(() => root.render(createElement(Harness, { editing })));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  toast.showToast.mockClear();
  refresh = vi.fn();
  range = {
    getCellStyleData: vi.fn(() => ({ bl: 0 })),
    setFontWeight: vi.fn(),
    setFontStyle: vi.fn(),
    setFontLine: vi.fn(),
    setFontColor: vi.fn(),
    setBackgroundColor: vi.fn(),
    clearFormat: vi.fn(),
    setHorizontalAlignment: vi.fn(),
    getRow: vi.fn(() => 1),
    getLastRow: vi.fn(() => 1),
    getColumn: vi.fn(() => 1),
    getLastColumn: vi.fn(() => 1),
    merge: vi.fn(),
  };
  const sheet = {
    getSheetId: () => "s1",
    getMaxRows: () => 20,
    getMaxColumns: () => 10,
    getRange: () => range,
    insertRowsBefore: vi.fn(),
    insertRowsAfter: vi.fn(),
    insertColumnsBefore: vi.fn(),
    insertColumnsAfter: vi.fn(),
    deleteRow: vi.fn(),
    deleteColumn: vi.fn(),
  };
  const workbook = {
    getId: () => "book",
    getActiveSheet: () => sheet,
    getActiveRange: () => range,
    undo: vi.fn(),
    redo: vi.fn(),
  };
  univer = {
    getActiveWorkbook: () => workbook,
    executeCommand: vi.fn(async () => true),
    Enum: { BorderStyleTypes: { THIN: 1 } },
  } as unknown as FUniver;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useSheetCommandActions", () => {
  it("格式命令作用于当前选区并刷新高亮", () => {
    render();
    act(() => api.dispatchMenu("bold"));
    expect(range.setFontWeight).toHaveBeenCalledWith("bold");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("编辑态查找打开替换对话框，阅读态只打开查找", () => {
    render(true);
    act(() => api.openFindDialog());
    expect(univer.executeCommand).toHaveBeenCalledWith("ui.operation.open-replace-dialog");

    render(false);
    act(() => api.openFindDialog());
    expect(univer.executeCommand).toHaveBeenCalledWith("ui.operation.open-find-dialog");
  });

  it("more-tools 命中官方移动工具按钮", () => {
    const click = vi.fn();
    const button = document.createElement("button");
    button.setAttribute("aria-label", "打开表格工具");
    button.click = click;
    render();
    host.append(button);
    act(() => api.dispatchMenu("more-tools"));
    expect(click).toHaveBeenCalledTimes(1);
  });
});
