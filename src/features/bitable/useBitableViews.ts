/**
 * 视图级操作（新建 / 删除 / 复制 / 改名 / 切换），写入全部走 core（桌面与移动端同一语义）。
 *
 * 261112 R1-S2：从 BitableEditor.tsx **原样搬出**（纯搬移：语句/依赖数组/行为零变化）。
 * 组件作用域的依赖通过参数显式传入（hook 不反向 import 容器）。
 */
import { useCallback } from "react";
import type { BitableViewType } from "../../core/bitableDoc.js";
import { addBitableView, deleteBitableView, duplicateBitableView, renameBitableView } from "../../core/bitableMutations.js";
import type { BitableChromeMenuApi } from "./useBitableChromeMenu";
import type { DocRef, MoveItem, NavigateDoc, PatchActiveTable, UpdateDoc } from "./bitableEditorModel";
export function useBitableViews(deps: {
  updateDoc: UpdateDoc;
  patchActiveTable: PatchActiveTable;
  navigateDoc: NavigateDoc;
  docRef: DocRef;
  moveItem: MoveItem;
  chrome: Pick<BitableChromeMenuApi, "setViewMenu" | "setViewEditor">;
}) {
  const { updateDoc, patchActiveTable, navigateDoc, docRef, moveItem, chrome } = deps;
  const { setViewMenu, setViewEditor } = chrome;
  const reorderViews = useCallback((fromId: string, toId: string) => {
    patchActiveTable((table) => ({ ...table, views: moveItem(table.views, fromId, toId, (v) => v.id) }));
  }, [patchActiveTable]);

  // ---- 视图 ----
  const addView = useCallback((type: BitableViewType) => {
    // 视图只存投影配置、不复制记录；默认配置（看板第一个单选 / 画册第一个附件 / 日历第一个日期 /
    // 表单不预选字段）收口在 core 的 addBitableView，移动端共用同一份（261030 单一来源）。
    updateDoc((prev) => {
      const result = addBitableView(prev, prev.activeTableId, type);
      if (result.doc === prev) return prev;
      // 新建后切到新视图（设备本地导航：正文序列化恒写第一个视图，不因导航变化标脏）
      return {
        ...result.doc,
        tables: result.doc.tables.map((table) => (table.id === prev.activeTableId ? { ...table, activeViewId: result.viewId } : table)),
      };
    });
  }, [updateDoc]);
  // 视图 mutation 收口 core（261102）：桌面 / 移动端同一份语义。
  const deleteView = useCallback((viewId: string) => {
    const tableId = docRef.current.activeTableId;
    updateDoc((prev) => deleteBitableView(prev, tableId, viewId));
    setViewMenu(null);
  }, [updateDoc]);
  const copyView = useCallback((viewId: string) => {
    const tableId = docRef.current.activeTableId;
    updateDoc((prev) => duplicateBitableView(prev, tableId, viewId).doc);
    setViewMenu(null);
  }, [updateDoc]);
  /** 重命名视图：空名兜底「视图」与旧对话框行为逐字一致（见 core renameBitableView）。 */
  const renameView = useCallback((viewId: string, name: string) => {
    const tableId = docRef.current.activeTableId;
    updateDoc((prev) => renameBitableView(prev, tableId, viewId, name));
    setViewEditor(null);
  }, [updateDoc]);
  const setActiveView = useCallback((viewId: string) => {
    navigateDoc((prev) => ({ ...prev, tables: prev.tables.map((table) => table.id === prev.activeTableId ? { ...table, activeViewId: viewId } : table) }));
  }, [navigateDoc]);


  return { reorderViews, addView, deleteView, copyView, renameView, setActiveView };
}
