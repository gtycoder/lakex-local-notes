// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FUniver } from "@univerjs/presets";

import { useSheetChromeState } from "./useSheetChromeState";

type Api = ReturnType<typeof useSheetChromeState>;
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let api: Api;
let univer: FUniver;
let workbook: Record<string, unknown>;
let range: Record<string, unknown>;

function Harness() {
  api = useSheetChromeState(() => univer);
  return null;
}

const render = () => {
  act(() => root.render(createElement(Harness)));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const sheetA = { getSheetId: () => "s1", getSheetName: () => "工作表 1" };
  const sheetB = { getSheetId: () => "s2", getSheetName: () => "工作表 2" };
  workbook = {
    getId: () => "book",
    getSheets: () => [sheetA, sheetB],
    getActiveSheet: () => sheetA,
    setActiveSheet: vi.fn(),
    getActiveRange: () => range,
  };
  range = {
    getCellStyleData: () => ({ bl: 1, it: 1, ul: { s: 1 }, st: { s: 1 }, cl: { rgb: "#E5484D" }, bg: { rgb: "rgb(229, 72, 77)" } }),
    getHorizontalAlignment: () => "center",
    getVerticalAlignment: () => "middle",
    getFontSize: () => 16,
    getNumberFormat: () => "0.00",
    getRow: () => 2,
    getColumn: () => 1,
    getValue: () => "季度预算",
  };
  univer = {
    getActiveWorkbook: () => workbook,
    executeCommand: vi.fn(async () => true),
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

describe("useSheetChromeState", () => {
  it("读取选区格式与工作表页签，活动表来自 facade", () => {
    render();
    act(() => { api.refreshCellFormat(); api.refreshSheetChrome(); });
    expect(api.cellFormat).toEqual({
      bold: true, italic: true, underline: true, strike: true,
      align: "center", valign: "middle", size: 16, numfmt: "0.00",
      address: "B3", value: "季度预算",
      fontColor: "#E5484D", bgColor: "rgb(229, 72, 77)",
    });
    expect(api.sheets).toEqual([
      { id: "s1", name: "工作表 1" },
      { id: "s2", name: "工作表 2" },
    ]);
    expect(api.activeSheetId).toBe("s1");
  });

  it("切换工作表走 facade，并刷新活动表状态", () => {
    render();
    act(() => api.selectSheet("s2"));
    expect(workbook.setActiveSheet).toHaveBeenCalledWith("s2");
  });

  it("缩放命令写入内核，百分比在 10%～400% 内收敛", () => {
    render();
    act(() => api.zoomBy(0.1));
    expect(univer.executeCommand).toHaveBeenCalledWith("sheet.command.change-zoom-ratio", { delta: 0.1 });
    expect(api.zoomPercent).toBe(110);
    act(() => api.zoomBy(10));
    expect(api.zoomPercent).toBe(400);
    act(() => api.zoomBy(-100));
    expect(api.zoomPercent).toBe(10);
  });
});
