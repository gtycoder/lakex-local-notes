/**
 * 移动端列表时间的**统一包装**（261107 架构整理）：底层始终是 core/dateFormat.formatListTime
 * （跨端同一套「今天/昨天 HH:mm，更早 MM-DD」措辞），这里只负责坏日期兜底与默认参数。
 *
 * 收口前有 5 份逐字重复的 try/catch 包装（HomePage、NotebookGrid、TagsHomeTab、TagQuickNoteCard、
 * 以及 workspace 历史列表），坏日期兜底策略不一致（有的回 iso、有的回空串）。统一口径 = 空串。
 */
import { formatListTime } from "../../core/dateFormat";

/** 列表/卡片时间（默认不带时钟；withClock=true 时带 HH:mm）。坏值返回空串。 */
export function formatUpdatedAt(iso: string | undefined, withClock = false): string {
  if (!iso) return "";
  try { return formatListTime(new Date(iso), new Date(), withClock); } catch { return ""; }
}

/** 相对（今天/昨天）形态；列表副标题用。 */
export function formatRelativeTime(iso: string | undefined): string {
  return formatUpdatedAt(iso);
}

/** 带时钟的完整形态（首页小记卡/文档卡日期）。 */
export function formatDateOnly(iso: string | undefined): string {
  return formatUpdatedAt(iso, true);
}
