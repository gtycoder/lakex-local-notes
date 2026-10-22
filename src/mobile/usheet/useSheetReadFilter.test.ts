// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("../ui/toastBus", () => ({ showToast: toast.showToast }));

import { useSheetReadFilter, type SheetReadFilterTarget } from "./useSheetReadFilter";

type Api = ReturnType<typeof useSheetReadFilter>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let api: Api;
let target: SheetReadFilterTarget;
type TargetResult = { ok: true; target: SheetReadFilterTarget } | { ok: false; reason?: string };

function Harness({ content, getTarget }: { content: string; getTarget: () => TargetResult }) {
  api = useSheetReadFilter({ content, getTarget });
  return null;
}

const render = (content = "{}", getTarget: () => TargetResult = () => ({ ok: true as const, target })) => {
  act(() => root.render(createElement(Harness, { content, getTarget })));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  toast.showToast.mockClear();
  const executeCommand = vi.fn(async () => true);
  const syncExecuteCommand = vi.fn();
  target = {
    api: { executeCommand, syncExecuteCommand },
    unitId: "book",
    subUnitId: "sheet",
    column: 2,
    block: { startRow: 0, startColumn: 0, endRow: 10, endColumn: 3 },
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("useSheetReadFilter", () => {
  it("应用读态筛选后，在 capture 前同步摘除运行时筛选", async () => {
    render();
    act(() => api.apply());
    expect(api.active).toBe(true);
    expect(target.api.executeCommand).toHaveBeenNthCalledWith(1, "sheet.command.set-filter-range", expect.objectContaining({ unitId: "book", subUnitId: "sheet" }));
    await act(async () => { await Promise.resolve(); });
    expect(target.api.executeCommand).toHaveBeenNthCalledWith(2, "sheet.operation.open-filter-panel", { unitId: "book", subUnitId: "sheet", col: 2 });

    act(() => api.restore());
    expect(api.active).toBe(false);
    expect(target.api.syncExecuteCommand).toHaveBeenCalledWith("sheet.command.remove-sheet-filter", { unitId: "book", subUnitId: "sheet" });
  });

  it("正文已有持久筛选时入口禁用且不发命令", () => {
    render(JSON.stringify({
      kind: "usheet",
      version: 1,
      workbook: {
        id: "w",
        sheetOrder: ["s1"],
        sheets: { s1: { id: "s1" } },
        resources: [{ name: "SHEET_FILTER_PLUGIN", data: '{"s1":{"ref":{"startRow":0,"endRow":9,"startColumn":0,"endColumn":1},"filterColumns":[]}}' }],
      },
    }));
    expect(api.availability.enabled).toBe(false);
    act(() => api.apply());
    expect(target.api.executeCommand).not.toHaveBeenCalled();
  });

  it("数据块不可用时显示明确原因", () => {
    render("{}", () => ({ ok: false, reason: "没有可用数据区域" }));
    act(() => api.apply());
    expect(toast.showToast).toHaveBeenCalledWith("没有可用数据区域", { type: "error" });
  });
});
