/**
 * 列表行里的「日期 + 时间」格式（单一来源）。
 *
 * 默认**到分钟**：秒在列表里是噪声，而且会把行内时间挤到换行/省略号（用户 261006 报回收站看不到时间）。
 * 需要秒的场合（历史快照，同一分钟内可能有多份）显式传 `true`。
 */
export function formatDateTime(value: string | number | Date, withSeconds = false): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, withSeconds
    ? { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }
    : { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
