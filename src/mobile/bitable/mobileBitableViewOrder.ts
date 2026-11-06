/**
 * 移动端多维表「视图顺序」纯逻辑（261105 P1 剩余 parity 小项：视图拖拽排序）。
 *
 * 语义（与桌面 `features/bitable/BitableEditor` 的 reorderViews 同一结果）：
 * - **视图顺序 = 文档数据**（正文 `tables[].views` 数组顺序，随 S3 同步）；不是设备本地偏好，
 *   所以不能像布局`mobileBitableViewPrefs` 那样只写 localStorage；
 * - 拖拽只改 views 顺序：`activeViewId` / `records` / `fields` 一律不动 —— 正文序列化时导航由
 *   core `canonicalBitableNav` 归一成「第一个视图」，所以顺序变化不会额外写一次"纯导航"；
 * - **顺序没变 ⇒ 返回原对象引用**：viewer 的 `commit` 靠引用判断"无变化不写盘"。
 *
 * 拖拽手势本身不在这里（复用 mobile 唯一长按实现 `ui/useLongPress`，见 `useBitableViewOrderDrag`）。
 */
import type { BitableDoc, BitableTable, BitableView } from "../../core/bitableDoc.js";

/** 落点：拖到目标行中线上方 = before，下方 = after（与标签管理/目录树同一判据）。 */
export type ViewDropPosition = "before" | "after";

/**
 * id 列表 + 一次拖拽 → 新顺序。**无变化/非法输入返回原数组引用**（调用方据此短路）。
 *
 * 落点索引在**移除源项之后**重算：`after` = 目标之后、`before` = 目标之前；
 * 结果与桌面 `moveItem(items, fromId, toId)` 对同一意图给出的槽位一致。
 */
export function moveViewIds(
  ids: readonly string[],
  fromId: string,
  overId: string,
  position: ViewDropPosition,
): readonly string[] {
  if (fromId === overId) return ids;
  const from = ids.indexOf(fromId);
  const over = ids.indexOf(overId);
  if (from < 0 || over < 0) return ids;
  const next = [...ids];
  next.splice(from, 1);
  const overAfterRemoval = next.indexOf(overId);
  if (overAfterRemoval < 0) return ids;
  const insertAt = position === "after" ? overAfterRemoval + 1 : overAfterRemoval;
  // 落回原位（before 目标且本就在目标前 / after 目标且本就在目标后）= 无变化。
  if (insertAt === from) return ids;
  next.splice(insertAt, 0, fromId);
  return next;
}

/**
 * 把新顺序套回文档：`orderedIds` 里认不出的 id 忽略，文档里没列到的视图**按原相对顺序追加在末尾**
 * （对远端/旧数据防御：任何情况下都不丢视图）。顺序未变 ⇒ 返回原 doc 引用。
 */
export function applyBitableViewOrder(
  doc: BitableDoc,
  tableId: string,
  orderedIds: readonly string[],
): BitableDoc {
  const table = doc.tables.find((item) => item.id === tableId);
  if (!table) return doc;
  const remaining = new Map<string, BitableView>(table.views.map((view) => [view.id, view] as const));
  const ordered: BitableView[] = [];
  for (const id of orderedIds) {
    const view = remaining.get(id);
    if (!view) continue;
    ordered.push(view);
    remaining.delete(id);
  }
  if (remaining.size > 0) {
    for (const view of table.views) {
      if (remaining.delete(view.id)) ordered.push(view);
    }
  }
  if (ordered.length === table.views.length && ordered.every((view, index) => view === table.views[index])) return doc;
  return {
    ...doc,
    tables: doc.tables.map((item) => (item.id === tableId ? { ...item, views: ordered } : item)),
  };
}

/** 一次拖拽的完整纯变换（viewer 一行调用）：无变化返回原 doc 引用。 */
export function reorderBitableViewsByDrag(
  doc: BitableDoc,
  tableId: string,
  fromId: string,
  overId: string,
  position: ViewDropPosition,
): BitableDoc {
  const table: BitableTable | undefined = doc.tables.find((item) => item.id === tableId);
  if (!table) return doc;
  const ids = table.views.map((view) => view.id);
  const next = moveViewIds(ids, fromId, overId, position);
  if (next === ids) return doc;
  return applyBitableViewOrder(doc, tableId, next);
}
