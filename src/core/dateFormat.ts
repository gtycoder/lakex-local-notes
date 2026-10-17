/**
 * 纯本地时间格式化（C1-5）——**单一来源**，无 locale 副作用。
 *
 * 为什么不用 toLocaleString：同一份时间在不同系统会变成 2026/8/4、含秒、或不同分隔符；
 * 列表/属性面板需要**逐字符稳定**的输出（也便于快照对拍）。
 * 时间口径 = **本地时区**（日期格、系统时间字段都已定本地，见 bitableDoc 的注释）。
 *
 * 「列表措辞」单独一个函数（formatListTime）：今天/昨天/本周/上周/本月/上月/今年/跨年默认，
 * 优先级与周起点（周一）写死，产品口径见 HANDOFF 261017(七)。
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

/** MM-DD HH:mm */
export function formatMdHm(date: Date): string {
  return formatMd(date) + " " + formatHm(date);
}

/** YYYY-MM-DD */
export function formatYmd(date: Date): string {
  return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

/** YYYY-MM-DD HH:mm；withSeconds 用于「同一分钟内可能有多份」的历史快照。 */
export function formatDateTime(date: Date, withSeconds = false): string {
  const base = formatYmd(date) + " " + formatHm(date);
  return withSeconds ? base + ":" + pad2(date.getSeconds()) : base;
}

/** 同一个**本地日历日**（替代各处 d.toDateString() === now.toDateString() 的重复写法）。 */
export function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const WEEKDAY_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const startOfLocalDay = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** 本周一 00:00（周一为一周起点，中文习惯）。 */
const startOfLocalWeek = (d: Date): Date => {
  const start = startOfLocalDay(d);
  const offset = (start.getDay() + 6) % 7;
  start.setDate(start.getDate() - offset);
  return start;
};
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 列表时间措辞（Q10/B，261017 用户定稿）——**单一来源**。
 *
 * 今天 HH:mm / 昨天 HH:mm / 本周X / 上周X / 本月D日 / 上月D日 / 其余默认 YYYY-MM-DD。
 * `withClock`：卡片/需要时刻的地方带 HH:mm；紧凑列表不带（今天/昨天例外，始终带 HH:mm）。
 * 优先级 = 今天 → 昨天 → 本周 → 上周 → 本月 → 上月 → 默认绝对（跨年/今年更早都走默认；年初的"上周"不会被默认吞掉）。
 * 261017 用户调整：**去掉「今年更早」分类**（原 M月D日），统一回默认 YYYY-MM-DD。
 * 非法日期返回 ""（调用方自己决定占位）。
 */
export function formatListTime(date: Date, now: Date = new Date(), withClock = false): string {
  if (Number.isNaN(date.getTime()) || Number.isNaN(now.getTime())) return "";
  const clock = withClock ? " " + formatHm(date) : "";
  if (sameLocalDay(date, now)) return "今天 " + formatHm(date);
  const today = startOfLocalDay(now);
  const yesterday = new Date(today.getTime() - DAY_MS);
  if (sameLocalDay(date, yesterday)) return "昨天 " + formatHm(date);
  const thisWeek = startOfLocalWeek(now);
  const lastWeek = new Date(thisWeek.getTime() - 7 * DAY_MS);
  const day = startOfLocalDay(date);
  if (day >= thisWeek && day < new Date(today.getTime() + DAY_MS)) return "本" + WEEKDAY_CN[date.getDay()] + clock;
  if (day >= lastWeek && day < thisWeek) return "上" + WEEKDAY_CN[date.getDay()] + clock;
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const dateMonthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  if (dateMonthStart.getTime() === thisMonthStart.getTime()) return "本月" + date.getDate() + "日" + clock;
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  if (date.getFullYear() === prevMonth.getFullYear() && date.getMonth() === prevMonth.getMonth()) {
    return "上月" + date.getDate() + "日" + clock;
  }
  return formatYmd(date) + clock;
}
