/**
 * 记录级操作（新建 / 分组内新建 / 删除 / 拖拽排序）。删除与写值全部走 core（移动端同一函数）。
 *
 * 261112 R1-S2：从 BitableEditor.tsx **原样搬出**（纯搬移：语句/依赖数组/行为零变化）。
 * 组件作用域的依赖通过参数显式传入（hook 不反向 import 容器）。
 */
import { useCallback } from "react";
import { createBitableRecord } from "../../core/bitableDoc.js";
import { addBitableRecord, deleteBitableRecords } from "../../core/bitableMutations.js";
import type { BitableChromeMenuApi } from "./useBitableChromeMenu";
import type { DocRef, MoveItem, PatchActiveTable, UpdateDoc } from "./bitableEditorModel";
export function useBitableRecords(deps: {
  updateDoc: UpdateDoc;
  patchActiveTable: PatchActiveTable;
  docRef: DocRef;
  moveItem: MoveItem;
  chrome: Pick<BitableChromeMenuApi, "setSelectedRecordIds" | "setDrawerRecordId">;
}) {
  const { updateDoc, patchActiveTable, docRef, moveItem, chrome } = deps;
  const { setSelectedRecordIds, setDrawerRecordId } = chrome;
  // ---- 记录 ----
  const addRecord = useCallback(() => {
    const record = createBitableRecord();
    // createdAt 传进去：日期字段若配了「添加记录时间」，填的就是这条记录自己的创建日
    updateDoc((prev) => addBitableRecord(prev, prev.activeTableId, { record }).doc);
    return record.id;
  }, [updateDoc]);
  /** 复刻云端：分组下方的圆 + 直接**加进本组**（给新记录预置该分组字段的值；空值组则不写值）。 */
  const addRecordInGroup = useCallback((fieldId: string, value: unknown) => {
    const record = createBitableRecord();
    updateDoc((prev) => addBitableRecord(prev, prev.activeTableId, { record, fieldId, value }).doc);
    return record.id;
  }, [updateDoc]);

  const deleteRecords = useCallback((ids: string[]) => {
    const set = new Set(ids);
    // 261020：删记录上收 core 单一来源（移动端多维表编辑用同一函数）。
    const tableId = docRef.current.activeTableId;
    updateDoc((prev) => deleteBitableRecords(prev, tableId, ids));
    setSelectedRecordIds(new Set());
    setDrawerRecordId((current) => (current && set.has(current) ? null : current));
  }, [updateDoc]);
  const reorderRecords = useCallback((fromId: string, toId: string) => {
    patchActiveTable((table) => ({ ...table, records: moveItem(table.records, fromId, toId, (r) => r.id) }));
  }, [patchActiveTable]);

  return { addRecord, addRecordInGroup, deleteRecords, reorderRecords };
}
