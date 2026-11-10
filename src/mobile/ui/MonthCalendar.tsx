/**
 * 月历格子原语（261110，**唯一来源**）。
 *
 * 为什么抽出来：移动端原本只有多维表日期字段自带一份月历（.mbt-date-head / .mbt-calendar-* 写在
 * mobileBitable.css 里）。261110 日记页要「日历 = 选任意日期新建」，同一个交互语义不允许再写第二套
 * 视觉（AGENTS §3#14），也不能引桌面 `ln-calendar`（两端 UI 不共享）⇒ 把它收成本原语：
 * 日期语义全部来自 `core/bitableDoc.calendarMonthDays`（本地日期、周一起始、42 格），
 * 本文件只做「月头 + 星期行 + 42 格」的投影，页面各自由 `MobileSheet` 包裹（浮层原语不在这层）。
 *
 * 用法：多维表日期 Sheet（选值 → 确定）与日记日历 Sheet（点即新建）共用；月历视图的日程点由
 * `hasDot` 传进来（本文件不碰日程模型）。取值全走移动端令牌（ui-metrics 硬指标）。
 */
import { ChevronLeft, ChevronRight } from "lucide-react";
import { calendarMonthDays } from "../../core/bitableDoc.js";
// 本原语的样式只在用它的小块里加载（多维表/日记都是按需 chunk）⇒ 不进移动端首屏 CSS 预算。
import "./monthCalendar.css";

/** 周一 → 周日（与 calendarMonthDays 的起始口径一致）。 */
const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

export interface MonthCalendarProps {
  /** 当前显示的年份（日历格子的月份由 month 给，两者共同决定 42 格）。 */
  year: number;
  /** 当前显示的月份（1-12）。 */
  month: number;
  /** 选中日期键（YYYY-MM-DD）；null = 未选。 */
  selected: string | null;
  /** 今天（本地日期键）：只用于高亮，不参与选择判据。 */
  today: string;
  /** 翻月（-1 / +1）：游标由调用方持有（选日期后是否跟着跳月是调用方的语义）。 */
  onShiftMonth: (delta: number) => void;
  /** 点某一格（含跨月的补格）：交由调用方决定是"选中草稿"还是"直接新建"。 */
  onPick: (dateKey: string) => void;
  /** 哪些日期需要打点（多维表月历视图的"这一天有日程"）；不传 = 不打点。 */
  hasDot?: (dateKey: string) => boolean;
}

export function MonthCalendar({ year, month, selected, today, onShiftMonth, onPick, hasDot }: MonthCalendarProps) {
  const days = calendarMonthDays(year, month);
  return (
    <>
      <header className="mb-calendar-head">
        <button type="button" className="mb-iconbtn" aria-label="上个月" onClick={() => onShiftMonth(-1)}>
          <ChevronLeft size={17} />
        </button>
        <span className="mb-calendar-title">{year} 年 {month} 月</span>
        <button type="button" className="mb-iconbtn" aria-label="下个月" onClick={() => onShiftMonth(1)}>
          <ChevronRight size={17} />
        </button>
      </header>
      <div className="mb-calendar-week" aria-hidden="true">
        {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="mb-calendar-grid" role="grid" aria-label="选择日期">
        {days.map((cell) => {
          const classes = ["mb-calendar-day"];
          if (!cell.inMonth) classes.push("is-out");
          if (cell.date === today) classes.push("is-today");
          if (cell.date === selected) classes.push("is-on");
          const dotted = hasDot ? hasDot(cell.date) : false;
          return (
            <button
              key={cell.date}
              type="button"
              role="gridcell"
              className={classes.join(" ")}
              aria-label={cell.date}
              aria-pressed={cell.date === selected}
              onClick={() => onPick(cell.date)}
            >
              <span className="mb-calendar-day__num">{cell.day}</span>
              {dotted && <span className="mb-calendar-day__dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </>
  );
}

export default MonthCalendar;
