import { useCallback, useState } from "react";
import type { FUniver } from "@univerjs/presets";
import type { MobileSheetTab } from "./MobileSheetFooter";

export interface SheetCellFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  align: "left" | "center" | "normal" | "general";
  numfmt: string;
}

const EMPTY_CELL_FORMAT: SheetCellFormat = {
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  align: "general",
  numfmt: "",
};

/** 表格 chrome 的本机视图状态：选区格式、工作表页签、活动表、缩放与格式刷高亮。 */
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
      const style = range.getCellStyleData() as { bl?: number; it?: number; ul?: { s?: number }; st?: { s?: number } } | null;
      const align = range.getHorizontalAlignment();
      const numfmt = (range as unknown as { getNumberFormat?: () => string | undefined }).getNumberFormat?.() ?? "";
      const next: SheetCellFormat = {
        bold: style?.bl === 1,
        italic: style?.it === 1,
        underline: style?.ul?.s === 1,
        strike: style?.st?.s === 1,
        align: (align === "left" || align === "center" || align === "normal" ? align : "general"),
        numfmt,
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
