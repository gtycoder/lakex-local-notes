/**
 * 数据表级操作（新建 / 改名 / 删除 / 复制 / 拖拽排序）。表级写入全部走 core（移动端抽屉 ⋮ 同一语义）。
 *
 * 261112 R1-S2：从 BitableEditor.tsx **原样搬出**（纯搬移：语句/依赖数组/行为零变化）。
 * 组件作用域的依赖通过参数显式传入（hook 不反向 import 容器）。
 */
import { useCallback } from "react";
import { createDefaultBitableTable } from "../../core/bitableDoc.js";
import { deleteBitableTable, duplicateBitableTable, renameBitableTable } from "../../core/bitableMutations.js";
import type { MoveItem, UpdateDoc } from "./bitableEditorModel";
export function useBitableTables(deps: {
  updateDoc: UpdateDoc;
  moveItem: MoveItem;
}) {
  const { updateDoc, moveItem } = deps;
  // ---- 表 ----
  const addTable = useCallback(() => {
    updateDoc((prev) => {
      const table = createDefaultBitableTable("数据表 " + (prev.tables.length + 1));
      return { ...prev, tables: [...prev.tables, table], activeTableId: table.id };
    });
  }, [updateDoc]);
  // 表级写入统一走 core（移动端抽屉 ⋮ 与桌面这里同一份语义）
  const renameTable = useCallback((id: string, name: string) => {
    updateDoc((prev) => renameBitableTable(prev, id, name));
  }, [updateDoc]);
  const deleteTable = useCallback((id: string) => {
    updateDoc((prev) => deleteBitableTable(prev, id));
  }, [updateDoc]);
  const duplicateTable = useCallback((id: string) => {
    updateDoc((prev) => {
      const result = duplicateBitableTable(prev, id);
      if (result.doc === prev || !result.tableId) return prev;
      return { ...result.doc, activeTableId: result.tableId };
    });
  }, [updateDoc]);
  const reorderTables = useCallback((fromId: string, toId: string) => {
    updateDoc((prev) => ({ ...prev, tables: moveItem(prev.tables, fromId, toId, (t) => t.id) }));
  }, [updateDoc]);

  return { addTable, renameTable, deleteTable, duplicateTable, reorderTables };
}
