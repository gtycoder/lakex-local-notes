/**
 * 纯本地时间格式化（C1-5 第一步）——**单一来源**，无 locale 副作用。
 *
 * 为什么不用 toLocaleString：同一份时间在不同系统会变成 2026/8/4、含秒、或不同分隔符；
 * 列表/属性面板需要**逐字符稳定**的输出（也便于快照对拍）。
 * 时间口径 = **本地时区**（日期格、系统时间字段都已定本地，见 bitableDoc 的注释）。
 *
 * 不在这里放「今天/昨天/相对时间」策略：那属产品语义，仍由各入口持有；
 * 这里只提供它需要的原子格式化与同日判定。
 */

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** HH:mm */
export function formatHm(date: Date): string {
  return pad2(date.getHours()) + ":" + pad2(date.getMinutes());
}

/** MM-DD */
export function formatMd(date: Date): string {
  return pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

/** MM-DD HH:mm（小记卡片/列表时间戳口径） */
export function formatMdHm(date: Date): string {
  return formatMd(date) + " " + formatHm(date);
}

/** YYYY-MM-DD */
export function formatYmd(date: Date): string {
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

/** YYYY-MM-DD HH:mm（属性面板/设置页/小记转正式笔记标题口径） */
export function formatDateTime(date: Date): string {
  return formatYmd(date) + " " + formatHm(date);
}

/** 同一个**本地日历日**（替代各处 d.toDateString() === now.toDateString() 的重复写法）。 */
export function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
