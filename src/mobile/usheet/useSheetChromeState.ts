import { useCallback, useState } from "react";
import type { FUniver } from "@univerjs/presets";

/** 工作表页签（顶部 sheet 行用）。 */
export interface MobileSheetTab {
  id: string;
  name: string;
}

export interface SheetCellFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  align: "left" | "center" | "normal" | "general";
  /** 垂直对齐（261023：T 面板的第二条对齐白条）。 */
  valign: "top" | "middle" | "bottom" | "general";
  /** 字号（px；261023：T 面板字号白条）。 */
  size: number;
  numfmt: string;
  /** 当前活动单元格地址（如 A1）；公式栏左侧地址位用。 */
  address: string;
  /** 当前活动单元格的「显示值」；公式栏输入框用。 */
  value: string;
  /** 字体颜色（内核 style.cl.rgb；空 = 默认色）。T 面板色板反显用。 */
  fontColor: string;
  /** 单元格背景色（内核 style.bg.rgb；空 = 无填充）。T 面板色板反显用。 */
  bgColor: string;
}

const EMPTY_CELL_FORMAT: SheetCellFormat = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  align: "general",
  valign: "general",
  size: 14,
  numfmt: "",
  address: "A1",
  value: "",
  fontColor: "",
  bgColor: "",
};

function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** 表格 chrome 的本机视图状态：选区格式/地址/值、工作表页签、活动表、缩放与格式刷高亮。 */
export function useSheetChromeState(getUniverAPI: () => FUniver | null) {
  const [cellFormat, setCellFormat] = useState<SheetCellFormat>(EMPTY_CELL_FORMAT);
  const [sheets, setSheets] = useState<MobileSheetTab[]>([]);
  const [activeSheetId, setActiveSheetId] = useState("");
  const [zoomPercent, setZoomPercent] = useState(100);
  const [painterStatus, setPainterStatus] = useState(0);

  const refreshCellFormat = useCallback(() => {
    try {
      const range = getUniverAPI()?.getActiveWorkbook()?.getActiveRange();
      if (!range) return;
      const style = range.getCellStyleData() as {
        bl?: number; it?: number; ul?: { s?: number }; st?: { s?: number };
        cl?: { rgb?: string }; bg?: { rgb?: string };
      } | null;
      const align = range.getHorizontalAlignment();
      const valignRaw = (range as unknown as { getVerticalAlignment?: () => string }).getVerticalAlignment?.() ?? "general";
      const sizeRaw = (range as unknown as { getFontSize?: () => number | null }).getFontSize?.() ?? 0;
      const numfmt = (range as unknown as { getNumberFormat?: () => string | undefined }).getNumberFormat?.() ?? "";
      const row = range.getRow();
      const col = range.getColumn();
      let value = "";
      try {
        const raw = (range as unknown as { getValue?: () => unknown }).getValue?.();
        value = raw === null || raw === undefined ? "" : String(raw);
      } catch { value = ""; }
      const next: SheetCellFormat = {
        bold: style?.bl === 1,
        italic: style?.it === 1,
        underline: style?.ul?.s === 1,
        strike: style?.st?.s === 1,
        align: (align === "left" || align === "center" || align === "normal" ? align : "general"),
        valign: (valignRaw === "top" || valignRaw === "middle" || valignRaw === "bottom" ? valignRaw : "general"),
        size: sizeRaw && Number.isFinite(sizeRaw) ? Math.round(sizeRaw) : 14,
        numfmt,
        address: columnName(col) + String(row + 1),
        value,
        fontColor: style?.cl?.rgb ?? "",
        bgColor: style?.bg?.rgb ?? "",
      };
      setCellFormat((prev) => Object.keys(next).every((key) => prev[key as keyof SheetCellFormat] === next[key as keyof SheetCellFormat]) ? prev : next);
    } catch {
      // 选区内没有可读样式时保持原状态。
    }
  }, [getUniverAPI]);

  const refreshSheetChrome = useCallback(() => {
    const workbook = getUniverAPI()?.getActiveWorkbook();
    if (!workbook) return;
    try {
      const next = workbook.getSheets().map((sheet) => ({ id: sheet.getSheetId(), name: sheet.getSheetName() }));
      setSheets((prev) => (prev.length === next.length && prev.every((item, index) => item.id === next[index].id && item.name === next[index].name) ? prev : next));
      setActiveSheetId(workbook.getActiveSheet()?.getSheetId() ?? "");
    } catch {
      // 实例销毁中忽略。
    }
  }, [getUniverAPI]);

  const selectSheet = useCallback((sheetId: string) => {
    const workbook = getUniverAPI()?.getActiveWorkbook();
    if (!workbook) return;
    try {
      workbook.setActiveSheet(sheetId);
      refreshSheetChrome();
      refreshCellFormat();
    } catch (error) {
      console.warn("[mobile-usheet] 切换工作表失败", error);
    }
  }, [getUniverAPI, refreshCellFormat, refreshSheetChrome]);

  const zoomBy = useCallback((delta: number) => {
    const api = getUniverAPI();
    if (!api) return;
    try {
      void api.executeCommand("sheet.command.change-zoom-ratio", { delta });
      setZoomPercent((prev) => Math.min(400, Math.max(10, Math.round(prev + delta * 100))));
    } catch (error) {
      console.warn("[mobile-usheet] 缩放失败", error);
    }
  }, [getUniverAPI]);

  return {
    cellFormat,
    sheets,
    activeSheetId,
    zoomPercent,
    painterStatus,
    setPainterStatus,
    refreshCellFormat,
    refreshSheetChrome,
    selectSheet,
    zoomBy,
  };
}
