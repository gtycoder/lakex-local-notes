/**
 * 移动端多维表「视图字段顺序」纯逻辑（261117 P1-4：字段拖拽重排）。
 *
 * 语义与桌面 `features/bitable/useBitableFields.reorderPanelFields` 同一结果（不新造语义）：
 * - **列顺序是视图级配置**：只写当前视图的 `fieldOrder`，不动 table.fields 的全局顺序、不动其它视图；
 * - 基准顺序 = `orderedAllTableFields`（fieldOrder 应用到**全部字段**，含隐藏字段 —— 与网格列顺序 /
 *   关联选择器 / 表格配置面板同一来源）；
 * - 写回的 fieldOrder 是**完整排列**（漏列的字段按原相对顺序追加在末尾，任何情况下都不丢字段）；
 * - **顺序没变 ⇒ 返回原 doc 引用**：viewer 的 `commit` 靠引用判断"无变化不写盘"。
 *
 * 拖拽手势不在这里（共用 `useBitableOrderDrag`，261111 惯例）；落点语义复用 `mobileBitableViewOrder`
 * 的 `moveViewIds`（id 列表 + 一次拖拽 → 新顺序，视图/字段两个列表同一套槽位判据）。
 */
import { orderedAllTableFields, type BitableDoc } from "../../core/bitableDoc.js";
import { moveViewIds, type ViewDropPosition } from "./mobileBitableViewOrder";

/**
 * 把新顺序套回**当前视图**的 fieldOrder：`orderedIds` 里认不出的 id 忽略，文档里没列到的字段
 * **按 table.fields 原相对顺序追加在末尾**（对远端/旧数据防御：任何情况下都不丢字段）。
 * 顺序未变 ⇒ 返回原 doc 引用。
 */
export function applyBitableFieldOrder(
  doc: BitableDoc,
  tableId: string,
  viewId: string,
  orderedIds: readonly string[],
): BitableDoc {
  const table = doc.tables.find((item) => item.id === tableId);
  const view = table?.views.find((item) => item.id === viewId);
  if (!table || !view) return doc;
  const known = new Set(table.fields.map((field) => field.id));
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of orderedIds) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  for (const field of table.fields) {
    if (!seen.has(field.id)) order.push(field.id);
  }
  const before = orderedAllTableFields(table, view).map((field) => field.id);
  if (order.length === before.length && order.every((id, index) => id === before[index])) return doc;
  return {
    ...doc,
    tables: doc.tables.map((item) => (item.id !== tableId ? item : {
      ...item,
      views: item.views.map((candidate) => (candidate.id === viewId ? { ...candidate, fieldOrder: order } : candidate)),
    })),
  };
}

/** 一次拖拽的完整纯变换（viewer 一行调用）：无变化返回原 doc 引用。 */
export function reorderBitableFieldsByDrag(
  doc: BitableDoc,
  tableId: string,
  viewId: string,
  fromId: string,
  overId: string,
  position: ViewDropPosition,
): BitableDoc {
  const table = doc.tables.find((item) => item.id === tableId);
  const view = table?.views.find((item) => item.id === viewId);
  if (!table || !view) return doc;
  const ids = orderedAllTableFields(table, view).map((field) => field.id);
  const next = moveViewIds(ids, fromId, overId, position);
  if (next === ids) return doc;
  return applyBitableFieldOrder(doc, tableId, viewId, next);
}
