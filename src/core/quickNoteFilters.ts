/**
 * 小记快捷筛选：时间档 + 自定范围（按**创建时间**，与「时间线」语义一致）。
 * 纯函数、两端共用；标签包含/排除复用 `quickNoteTags` 的 `selection` 筛选。
 */

export type QuickNoteTimeFilter =
  | { kind: "any" }
  | { kind: "today" }
  | { kind: "last7" }
  | { kind: "last30" }
  | { kind: "lastYearToday" }
  | { kind: "custom"; from: string; to: string };

export const QUICK_NOTE_TIME_OPTIONS: ReadonlyArray<{ id: QuickNoteTimeFilter["kind"]; label: string }> = [
  { id: "any", label: "全部时间" },
  { id: "today", label: "今天" },
  { id: "last7", label: "近 7 天" },
  { id: "last30", label: "近 30 天" },
  { id: "lastYearToday", label: "去年今日" },
  { id: "custom", label: "自定范围" },
];

export function isQuickNoteTimeFilterActive(filter: QuickNoteTimeFilter): boolean {
  return filter.kind !== "any";
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** `yyyy-mm-dd` → 本地当天 00:00；非法返回 null。 */
function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 创建时间是否落在筛选范围内；非法时间只在「全部时间」下放行。 */
export function matchesQuickNoteTimeFilter(createdAt: string, filter: QuickNoteTimeFilter, now = new Date()): boolean {
  if (filter.kind === "any") return true;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  const today = startOfLocalDay(now);
  if (filter.kind === "today") return created >= today && created < new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (filter.kind === "last7" || filter.kind === "last30") {
    const days = filter.kind === "last7" ? 7 : 30;
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
    return created >= from;
  }
  if (filter.kind === "lastYearToday") {
    const target = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
    // 2/29 → 去年无此日时按 2/28 处理（Date 会溢出到 3/1，需显式回退）。
    if (target.getMonth() !== today.getMonth()) target.setDate(0);
    return created.getFullYear() === target.getFullYear()
      && created.getMonth() === target.getMonth()
      && created.getDate() === target.getDate();
  }
  const from = filter.from ? parseLocalDate(filter.from) : null;
  const to = filter.to ? parseLocalDate(filter.to) : null;
  if (filter.from && !from) return false;
  if (filter.to && !to) return false;
  if (from && created < from) return false;
  if (to && created >= new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1)) return false;
  return true;
}

/** 人读文案（筛选按钮 title / 激活提示）。 */
export function quickNoteTimeFilterLabel(filter: QuickNoteTimeFilter): string {
  if (filter.kind === "custom") {
    if (filter.from && filter.to) return `${filter.from} 至 ${filter.to}`;
    if (filter.from) return `${filter.from} 起`;
    if (filter.to) return `至 ${filter.to}`;
    return "自定范围";
  }
  return QUICK_NOTE_TIME_OPTIONS.find((option) => option.id === filter.kind)?.label ?? "全部时间";
}
