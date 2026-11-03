/**
 * 只读态「视图状态摘要」（261103 六批 B1）——纯函数，给头部第 2 行的只读 chip 供文案与初始页签。
 *
 * 口径：
 * - 只汇总**视图配置**（筛选 / 排序 / 分组），不读 records、不碰布局偏好（布局是设备本地，不算"视图状态"）；
 * - 三者都为空 ⇒ 返回 ""（头部不渲染空 chip）；
 * - 文案与只读面板同口径：已筛选 n（n = 筛选**规则数**，嵌套分组里的规则也累计）/ 已排序 n / 已分组 n；
 * - 只改展示，不写正文。
 */
import { bitableFilterRuleCount, type BitableView } from "../../core/bitableDoc.js";

export type MobileBitableViewStateTab = "filter" | "sort" | "group";

/** 只读 chip 文案；没有任何筛选/排序/分组时返回 ""。 */
export function bitableViewStateSummary(view: BitableView): string {
  const parts: string[] = [];
  const filterCount = bitableFilterRuleCount(view.filters);
  if (filterCount > 0) parts.push("已筛选 " + filterCount);
  const sortCount = view.sorts?.length ?? 0;
  if (sortCount > 0) parts.push("已排序 " + sortCount);
  const groupCount = view.groups?.length ?? 0;
  if (groupCount > 0) parts.push("已分组 " + groupCount);
  return parts.join(" · ");
}

/** 点开只读面板时应落到哪个页签（优先筛选）；没有任何状态时返回 null。 */
export function bitableViewStateTab(view: BitableView): MobileBitableViewStateTab | null {
  if (bitableFilterRuleCount(view.filters) > 0) return "filter";
  if ((view.sorts?.length ?? 0) > 0) return "sort";
  if ((view.groups?.length ?? 0) > 0) return "group";
  return null;
}
