/**
 * CSV 导入（D01）：选文件 → 解析 → 映射对话框 → 追加到当前活动表；结果（新增/丢弃/跳过）留在对话框里展示。
 *
 * 261112 R1-S2：从 BitableEditor.tsx **原样搬出**（纯搬移：语句/依赖数组/行为零变化）。
 * 组件作用域的依赖通过参数显式传入（hook 不反向 import 容器）。
 */
import { useCallback } from "react";
import { defaultCsvMapping, importCsvRows, parseCsv } from "../../core/bitableCsv.js";
import { native } from "../../lib/native";
import { reportNativeActionError } from "../../lib/nativeErrors";
import type { BitableChromeMenuApi } from "./useBitableChromeMenu";
import type { BitableTable } from "../../core/bitableDoc.js";
import type { DocRef, ReadOnlyRef, UpdateDoc } from "./bitableEditorModel";
export function useBitableImport(deps: {
  readOnlyRef: ReadOnlyRef;
  activeTable: BitableTable;
  docRef: DocRef;
  updateDoc: UpdateDoc;
  chrome: Pick<BitableChromeMenuApi, "csvImport" | "setCsvImport" | "setCsvResult">;
}) {
  const { readOnlyRef, activeTable, docRef, updateDoc, chrome } = deps;
  const { csvImport, setCsvImport, setCsvResult } = chrome;
  // ---- CSV 导入（D01）----
  /** 选文件 → 解析 → 打开映射对话框（只读会话直接拒绝）。 */
  const startCsvImport = useCallback(async () => {
    if (readOnlyRef.current) return;
    try {
      const picked = await native.pickImportCsv();
      if (!picked) return;
      const parsed = parseCsv(picked.content);
      const header = parsed[0] ?? [];
      setCsvResult(null);
      setCsvImport({ fileName: picked.name, header, rows: parsed.slice(1), mapping: defaultCsvMapping(activeTable, header) });
    } catch (reason) {
      reportNativeActionError("导入 CSV", reason);
    }
  }, [activeTable]);
  /** 确认导入：追加到当前活动表；结果（新增/丢弃/跳过 + 原因）留在对话框里展示，不悄悄吞错。 */
  const confirmCsvImport = useCallback(() => {
    if (!csvImport) return;
    const current = docRef.current;
    const result = importCsvRows(current, activeTable.id, [csvImport.header, ...csvImport.rows], csvImport.mapping, { hasHeader: true });
    if (result.doc !== current) updateDoc(() => result.doc);
    setCsvResult(result);
  }, [csvImport, activeTable.id, updateDoc]);

  return { startCsvImport, confirmCsvImport };
}
