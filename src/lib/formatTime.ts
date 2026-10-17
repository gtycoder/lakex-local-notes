/**
 * 细节/绝对时间（回收站、历史版本、同步状态）：固定 `YYYY-MM-DD HH:mm`（历史可带秒）。
 *
 * 261017（C1-5/Q10）：从 toLocaleString 改为 core/dateFormat 单一来源 —— 原实现在不同系统
 * 会显示成 2026/8/4、含秒、或 10/17/2026 6:40 PM，与其它入口不一致。
 * **列表时间措辞**不在这里：见 `core/dateFormat.formatListTime`（今天/昨天/本周/上周/本月/上月/今年）。
 */
import { formatDateTime as formatDateTimeCore } from "../core/dateFormat";

export function formatDateTime(value: string | number | Date, withSeconds = false): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatDateTimeCore(date, withSeconds);
}
