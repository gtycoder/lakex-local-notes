/**
 * 移动端多维表的视图页签（261030 P0，对齐钉钉：文档页顶部「表单 | 内容」）。
 *
 * 口径：
 * - 页签 = 该表的全部视图；文案按类型收敛成短标签（表单 / 内容 / 看板 / 画册 / 日历），
 *   同类型重复时改用视图名（否则两个「内容」分不清）；
 * - **默认视图 = 第一个表单视图**（用户 261030：进来默认选中表单）；没有表单视图才用正文的 activeViewId；
 * - 设备本地导航（`bitableNavStore.viewIds`）的优先级高于这条默认规则（用户手动切过就记住）。
 */
import type { BitableTable, BitableView } from "../../core/bitableDoc.js";

/** 视图类型 → 页签短标签；未知类型原样用视图名（不让用户看到空白页签）。 */
export function mobileViewTabLabel(view: BitableView): string {
  switch (view.type) {
    case "form": return "表单";
    case "grid": return "内容";
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

/** 页签数据：短标签 + 重名时回落视图名。 */
export function mobileViewTabs(table: BitableTable): Array<{ view: BitableView; label: string }> {
  const labels = table.views.map(mobileViewTabLabel);
  return table.views.map((view, index) => ({
    view,
    label: labels.filter((label) => label === labels[index]).length > 1 ? view.name : labels[index],
  }));
}
