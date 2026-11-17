/**
 * 移动端多维表「列头快捷操作」纯逻辑（261117 P1-4）——排序/筛选的写回合成，落在**现有视图状态模型**上。
 *
 * 语义不新造（AGENTS §3#19 / §4「表格语义」）：
 * - 排序规则/筛选规则的形状、排序方式、操作符与默认值全部来自 core（`applySortMode` / `createBitableFilterRule`），
 *   与「视图配置」面板同一套；这里只回答「一次列头点击怎么合成 view 的 patch」。
 * - 排序 = 文档数据（view.sorts 随正文同步）、筛选 = 视图配置数据（view.filters）——两者都走同一个
 *   视图配置写路径（viewer 的 updateView），**只在文档编辑态可用**（只读态写正文违反「打开 = 只读」）。
 *
 * 列头「升序/降序」的槽位语义（本批定）：该列**已有规则 ⇒ 只换排序方式**（不动优先级）；
 * **没有 ⇒ 插到最前当主排序键**（与表格软件「按此列排序」一致——追加为次排序键在已有排序时
 * 记录顺序看起来"没反应"）。多键排序的增删细调仍在「视图配置」面板。
 */
import {
  applySortMode,
  createBitableFilterRule,
  sortModeOf,
  type BitableField,
  type BitableSortMode,
  type BitableView,
} from "../../core/bitableDoc.js";

/** 该字段当前的排序方式（没有规则 ⇒ null）；菜单据此标「当前」（读取走 core `sortModeOf` 同一映射）。 */
export function quickSortMode(view: BitableView, fieldId: string): BitableSortMode | null {
  const rule = (view.sorts ?? []).find((item) => item.fieldId === fieldId);
  return rule ? sortModeOf(rule) : null;
}

/**
 * 列头「升序/降序」写回：已有规则换排序方式（原位），没有则**插到最前**当主排序键。
 * 字段已删 / 空字段 id ⇒ null（调用方不写）。
 */
export function quickSortPatch(view: BitableView, fieldId: string, mode: BitableSortMode): Partial<BitableView> | null {
  if (!fieldId) return null;
  const sorts = view.sorts ?? [];
  if (sorts.some((rule) => rule.fieldId === fieldId)) {
    return { sorts: sorts.map((rule) => (rule.fieldId === fieldId ? applySortMode(rule, mode) : rule)) };
  }
  return { sorts: [applySortMode({ fieldId }, mode), ...sorts] };
}

/** 「清除排序」：删掉该列的排序规则；该列没有规则 ⇒ null（不产生空写入）。 */
export function quickSortClearPatch(view: BitableView, fieldId: string): Partial<BitableView> | null {
  const sorts = view.sorts ?? [];
  if (!sorts.some((rule) => rule.fieldId === fieldId)) return null;
  return { sorts: sorts.filter((rule) => rule.fieldId !== fieldId) };
}

/**
 * 「筛选此字段」：按共享默认（core `createBitableFilterRule`）追加一条该字段的规则——
 * 操作符/默认值/日期语义与「视图配置」点「+ 字段」完全同一来源；**不造第二套条件 UI**，
 * 值的细化交给共享筛选编辑器（视图配置「筛选」页签，AGENTS §3#19）。字段不可筛选 ⇒ null。
 */
export function quickFilterPatch(view: BitableView, field: BitableField, canFilter: boolean): Partial<BitableView> | null {
  if (!canFilter) return null;
  return { filters: [...(view.filters ?? []), createBitableFilterRule(field)] };
}
