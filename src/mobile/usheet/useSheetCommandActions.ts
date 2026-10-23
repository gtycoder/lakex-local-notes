import { useCallback } from "react";
import type { FUniver } from "@univerjs/presets";
import type { FRange, FWorkbook, FWorksheet } from "@univerjs/sheets/facade";
import { showToast } from "../ui/toastBus";
import { decimalStepMessage, stepNumberFormatDecimals } from "./usheetDecimals";
import { USHEET_QUICK_FORMULA_IDS, planUsheetQuickFormula } from "./usheetFormulaQuick";
import { USHEET_LAYOUT_ACTIONS, applyUsheetLayoutAction } from "./usheetLayoutActions";
import { USHEET_NUMFMT_IDS, applyUsheetNumberFormat } from "./usheetNumfmt";
import { USHEET_BORDER_IDS, applyUsheetBorder } from "./usheetBorders";
import { blockFailureMessage, planSortRange, resolveSheetBlock, type SortFilterSheet } from "./usheetSortPlan";

/** 表格工具条命令 facade：只做命令分派，不拥有容器、保存或编辑态。 */
export function useSheetCommandActions(opts: {
  editing: boolean;
  getUniverAPI: () => FUniver | null;
  refreshCellFormat: () => void;
}) {
  const { editing, getUniverAPI, refreshCellFormat } = opts;

  const sheetAccessor = useCallback((sheet: FWorksheet): SortFilterSheet => ({
    maxRows: sheet.getMaxRows(),
    maxColumns: sheet.getMaxColumns(),
    getValue: (row, column) => sheet.getRange(row, column).getValue(),
  }), []);

  const withActiveRange = useCallback((fn: (range: FRange, sheet: FWorksheet, workbook: FWorkbook) => void) => {
    try {
      const workbook = getUniverAPI()?.getActiveWorkbook();
      if (!workbook) return;
      const sheet = workbook.getActiveSheet();
      const range = workbook.getActiveRange();
      if (!sheet || !range) return;
      fn(range, sheet, workbook);
      refreshCellFormat();
    } catch (error) {
      console.warn("[mobile-usheet] 工具条动作失败", error);
    }
  }, [getUniverAPI, refreshCellFormat]);

  const stepDecimals = useCallback((delta: 1 | -1) => {
    withActiveRange((range) => {
      const target = range as unknown as { getNumberFormat?: () => string | undefined; setNumberFormat?: (pattern: string) => unknown };
      if (typeof target.setNumberFormat !== "function") {
        showToast("当前表格内核不支持数字格式", { type: "error" });
        return;
      }
      const step = stepNumberFormatDecimals(target.getNumberFormat?.() ?? "", delta);
      if (!step.ok) {
        showToast(decimalStepMessage(step.reason), { type: "error" });
        return;
      }
      target.setNumberFormat(step.pattern);
    });
  }, [withActiveRange]);

  const toggleFormatPainter = useCallback(() => {
    void getUniverAPI()?.executeCommand("sheet.command.set-once-format-painter");
    refreshCellFormat();
  }, [getUniverAPI, refreshCellFormat]);

  const runSort = useCallback((direction: "asc" | "desc") => {
    const api = getUniverAPI();
    const workbook = api?.getActiveWorkbook();
    const sheet = workbook?.getActiveSheet();
    const range = workbook?.getActiveRange();
    if (!api || !workbook || !sheet || !range) return;
    const resolved = planSortRange(
      { startRow: range.getRow(), endRow: range.getLastRow(), startColumn: range.getColumn(), endColumn: range.getLastColumn() },
      sheetAccessor(sheet),
      direction,
    );
    if (!resolved.ok) {
      showToast(blockFailureMessage(resolved.reason), { type: "error" });
      return;
    }
    void api.executeCommand("sheet.command.sort-range", {
      unitId: workbook.getId(),
      subUnitId: sheet.getSheetId(),
      range: resolved.plan.range,
      orderRules: resolved.plan.orderRules,
      hasTitle: resolved.plan.hasTitle,
    }).then((ok) => {
      if (!ok) showToast("排序失败：这个区域无法排序", { type: "error" });
    });
  }, [getUniverAPI, sheetAccessor]);

  const openFilter = useCallback(() => {
    const api = getUniverAPI();
    const workbook = api?.getActiveWorkbook();
    const sheet = workbook?.getActiveSheet();
    const range = workbook?.getActiveRange();
    if (!api || !workbook || !sheet || !range) return;
    const resolved = resolveSheetBlock(
      { startRow: range.getRow(), endRow: range.getLastRow(), startColumn: range.getColumn(), endColumn: range.getLastColumn() },
      sheetAccessor(sheet),
    );
    if (!resolved.ok) {
      showToast(blockFailureMessage(resolved.reason), { type: "error" });
      return;
    }
    const { block } = resolved;
    const unitId = workbook.getId();
    const subUnitId = sheet.getSheetId();
    const column = range.getColumn();
    void (async () => {
      await api.executeCommand("sheet.command.set-filter-range", {
        unitId,
        subUnitId,
        range: block,
      });
      const opened = await api.executeCommand("sheet.operation.open-filter-panel", { unitId, subUnitId, col: column });
      if (!opened) showToast("筛选面板打不开：这个区域可能不足两行", { type: "error" });
    })();
  }, [getUniverAPI, sheetAccessor]);

  const openFindDialog = useCallback(() => {
    const api = getUniverAPI();
    if (!api) return;
    const commandId = editing ? "ui.operation.open-replace-dialog" : "ui.operation.open-find-dialog";
    void api.executeCommand(commandId).then((ok) => {
      if (!ok) showToast("查找面板打不开", { type: "error" });
    });
  }, [editing, getUniverAPI]);

  const runHistory = useCallback((kind: "undo" | "redo") => {
    const workbook = getUniverAPI()?.getActiveWorkbook();
    if (!workbook) return;
    try {
      if (kind === "undo") workbook.undo();
      else workbook.redo();
      refreshCellFormat();
    } catch (error) {
      console.warn("[mobile-usheet] 撤销/重做失败", error);
    }
  }, [getUniverAPI, refreshCellFormat]);

  const dispatchMenu = useCallback((id: string) => {
    const api = getUniverAPI();
    if (id === "row-above") withActiveRange((range, sheet) => sheet.insertRowsBefore(range.getRow(), 1));
    else if (id === "row-below") withActiveRange((range, sheet) => sheet.insertRowsAfter(range.getRow(), 1));
    else if (id === "col-left") withActiveRange((range, sheet) => sheet.insertColumnsBefore(range.getColumn(), 1));
    else if (id === "col-right") withActiveRange((range, sheet) => sheet.insertColumnsAfter(range.getColumn(), 1));
    else if (id === "merge") withActiveRange((range) => range.merge({ defaultMerge: true }));
    else if (id === "bold") withActiveRange((range) => {
      const style = range.getCellStyleData() as { bl?: number } | null;
      range.setFontWeight(style?.bl === 1 ? "normal" : "bold");
    });
    else if (id === "italic") withActiveRange((range) => {
      const style = range.getCellStyleData() as { it?: number } | null;
      range.setFontStyle(style?.it === 1 ? "normal" : "italic");
    });
    else if (id === "underline") withActiveRange((range) => {
      const style = range.getCellStyleData() as { ul?: { s?: number } } | null;
      range.setFontLine(style?.ul?.s === 1 ? "none" : "underline");
    });
    else if (id === "strike") withActiveRange((range) => {
      const style = range.getCellStyleData() as { st?: { s?: number } } | null;
      range.setFontLine(style?.st?.s === 1 ? "none" : "line-through");
    });
    else if (id === "align-left") withActiveRange((range) => range.setHorizontalAlignment("left"));
    else if (id === "align-center") withActiveRange((range) => range.setHorizontalAlignment("center"));
    else if (id === "align-right") withActiveRange((range) => range.setHorizontalAlignment("normal"));
    // 261023 T 面板：垂直对齐 / 字号 / 清除字色与填充（id 前缀与通用 font-/fill- 区分，必须先判）。
    else if (id === "valign-top") withActiveRange((range) => { range.setVerticalAlignment("top"); });
    else if (id === "valign-middle") withActiveRange((range) => { range.setVerticalAlignment("middle"); });
    else if (id === "valign-bottom") withActiveRange((range) => { range.setVerticalAlignment("bottom"); });
    else if (id === "font-default") withActiveRange((range) => { range.setFontColor(null as unknown as string); });
    else if (id === "fill-none") withActiveRange((range) => { range.setBackgroundColor(null as unknown as string); });
    else if (id.startsWith("fontsize-")) {
      const size = Number(id.slice("fontsize-".length));
      if (Number.isFinite(size)) withActiveRange((range) => { (range as unknown as { setFontSize?: (n: number) => unknown }).setFontSize?.(size); });
    }
    else if (id.startsWith("font-")) withActiveRange((range) => range.setFontColor(id.slice("font-".length)));
    else if (id.startsWith("fill-")) withActiveRange((range) => range.setBackgroundColor(id.slice("fill-".length)));
    else if (id === "find") openFindDialog();
    else if (USHEET_BORDER_IDS.has(id)) {
      withActiveRange((range) => {
        const style = api?.Enum.BorderStyleTypes.THIN;
        const applied = applyUsheetBorder(range as unknown as { setBorder?: (type: string, style: number, color?: string) => unknown }, id, style ?? 1);
        if (!applied) showToast("当前表格内核不支持边框", { type: "error" });
      });
    }
    else if (id === "sort-asc") runSort("asc");
    else if (id === "sort-desc") runSort("desc");
    else if (id === "filter") openFilter();
    else if (id === "link") { void api?.executeCommand("sheet.operation.insert-hyper-link"); }
    else if (id === "clear-style") withActiveRange((range) => { range.clearFormat(); });
    else if (id === "decimals" || id === "decimal-up") stepDecimals(1);
    else if (id === "decimal-down") stepDecimals(-1);
    else if (id === "clear-text") withActiveRange((range) => {
      range.setFontWeight(null).setFontStyle(null).setFontLine(null).setFontColor(null);
    });
    else if (id === "delete-row") withActiveRange((range, sheet) => { sheet.deleteRow(range.getRow()); });
    else if (id === "delete-col") withActiveRange((range, sheet) => { sheet.deleteColumn(range.getColumn()); });
    else if (USHEET_LAYOUT_ACTIONS.has(id)) withActiveRange((range, sheet) => { applyUsheetLayoutAction(id, range, sheet); });
    else if (USHEET_QUICK_FORMULA_IDS.has(id)) {
      withActiveRange((range, sheet) => {
        const single = range.getRow() === range.getLastRow() && range.getColumn() === range.getLastColumn();
        if (!single) { showToast("请先只选中一个单元格（公式要写在这个格里）", { type: "error" }); return; }
        const plan = planUsheetQuickFormula(id, { row: range.getRow(), col: range.getColumn() },
          (row, col) => sheet.getRange(row, col).getValue());
        if (!plan) { showToast("这个单元格上方没有可统计的连续数值", { type: "error" }); return; }
        sheet.getRange(plan.targetRow, plan.targetColumn).setFormula(plan.formula);
      });
    }
    else if (USHEET_NUMFMT_IDS.has(id)) {
      withActiveRange((range) => {
        const applied = applyUsheetNumberFormat(range as unknown as { setNumberFormat?: (pattern: string) => unknown }, id);
        if (!applied) showToast("当前表格内核不支持数字格式", { type: "error" });
      });
    }
  }, [getUniverAPI, openFilter, openFindDialog, runSort, stepDecimals, withActiveRange]);

  return { withActiveRange, stepDecimals, toggleFormatPainter, openFilter, openFindDialog, runHistory, dispatchMenu };
}
