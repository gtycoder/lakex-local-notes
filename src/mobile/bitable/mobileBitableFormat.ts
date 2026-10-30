/**
 * 移动端多维表的分组标签展示（261030）。
 *
 * core 的分组标签 = 字段展示值原文（日期字段就是 `2026-06-09`）；钉钉移动端显示「06月09日」。
 * 只在移动端展示层格式化，**不动 core**（桌面分组头与桌面快照仍走原文，避免为一个观感改两端契约）。
 */
import type { BitableField } from "../../core/bitableDoc.js";
import type { CloudState } from "../../core/cloudState.js";

const DATE_LABEL = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 空值组标签（core 用 "(空)"）→ 人话；日期 → 「M月D日」（跨年带年份）。其余原样。 */
export function formatGroupLabel(field: BitableField | undefined, label: string, now: Date = new Date()): string {
  if (label === "(空)") return "未填写";
  if (!field || field.type !== "date") return label;
  const matched = DATE_LABEL.exec(label);
  if (!matched) return label;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return label;
  return year === now.getFullYear() ? month + "月" + day + "日" : year + "年" + month + "月" + day + "日";
}

/**
 * 表单提交后的落点说明（261030 P1）：**如实**说明有没有云同步，不写"已同步"。
 * 提交只保证「写进本机正文文件」；云同步是后台行为（auto）或要用户手动（manual）/根本没配（unconfigured/offline）。
 */
export function submitStateText(state: CloudState | null): string {
  switch (state) {
    case "auto": return "已保存在本机，稍后自动同步";
    case "manual": return "已保存在本机（手动同步）";
    case "offline": return "已保存在本机（云同步已关闭）";
    case "unconfigured": return "已保存在本机（未启用云同步）";
    default: return "只读文档里，提交是唯一的写入";
  }
}
