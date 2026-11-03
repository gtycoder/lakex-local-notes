/**
 * 移动端多维表的视图页签（261030 P0，对齐钉钉：文档页顶部「表单 | 表格」）。
 *
 * 口径：
 * - 页签 = 该表的全部视图；文案按类型收敛成短标签（表单 / 表格 / 看板 / 画册 / 日历；261103 四批：
 *   表格视图的页签从「内容」改成「表格」）；**同类型第 n 个（n>1）自动编号**（261103 六批 B2：
 *   第二个 grid 显示「表格 2」，不再回落到用户命名/两个同名页签）——只改展示，不改存储名；
 * - **默认视图 = 第一个表单视图**（用户 261030：进来默认选中表单）；没有表单视图才用正文的 activeViewId；
 * - 设备本地导航（`bitableNavStore.viewIds`）的优先级高于这条默认规则（用户手动切过就记住）。
 */
import type { BitableTable, BitableView } from "../../core/bitableDoc.js";

/** 视图类型 → 页签短标签；未知类型原样用视图名（不让用户看到空白页签）。 */
export function mobileViewTabLabel(view: BitableView): string {
  switch (view.type) {
    case "form": return "表单";
    case "grid": return "表格";
    case "kanban": return "看板";
    case "gallery": return "画册";
    case "calendar": return "日历";
    default: return view.name;
  }
}

/** 默认视图：第一个表单视图 → 正文 activeViewId → 第一个视图。 */
export function resolveMobileDefaultViewId(table: BitableTable): string {
  const form = table.views.find((view) => view.type === "form");
  if (form) return form.id;
  const active = table.views.find((view) => view.id === table.activeViewId);
  return active?.id ?? table.views[0]?.id ?? "";
}

/**
 * 页签数据：短标签 + **同类型自动编号**（261103 六批 B2，纯函数、只改展示）。
 * 规则：按视图在表里的顺序给同基名的页签编号——第 1 个「表格」、第 2 个「表格 2」、第 3 个「表格 3」；
 * 未知类型同样按「视图名」分组编号。**不改 view.name（存储名保持原样）**，不读 records。
 */
export function mobileViewTabs(table: BitableTable): Array<{ view: BitableView; label: string }> {
  const seen = new Map<string, number>();
  return table.views.map((view) => {
    const base = mobileViewTabLabel(view);
    const ordinal = (seen.get(base) ?? 0) + 1;
    seen.set(base, ordinal);
    return { view, label: ordinal > 1 ? base + " " + ordinal : base };
  });
}
