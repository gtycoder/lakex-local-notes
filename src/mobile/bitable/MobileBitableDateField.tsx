/**
 * 移动端多维表的**自有日期选择**（261030 用户点单：不要系统日期弹窗）。
 *
 * 为什么自研：系统 `<input type="date">` 在每个 Android 版本/ROM 上样式与交互都不同（实测本机是 Material 绿色日历弹窗），
 * 与我们的设计系统完全脱节，也无法统一「今天/清除/确定」语义。这里用 core 的 `calendarMonthDays`（本地日期、周一起始）
 * 画月历，外壳走 `MobileSheet` 原语；表单与记录面板共用，日期值仍是正文里的 `YYYY-MM-DD`。
 */
import { useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { calendarMonthDays, localDateString } from "../../core/bitableDoc.js";
import { MobileSheet } from "../ui/MobileSheet";
import { dismissKeyboard } from "../ui/dismissKeyboard";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function monthOf(date: string): { year: number; month: number } {
  const [y, m] = date.split("-").map(Number);
  if (Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12) return { year: y, month: m };
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export interface MobileBitableDateFieldProps {
  value: unknown;
  onChange: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
}

export function MobileBitableDateField({ value, onChange, ariaLabel, placeholder = "选择日期" }: MobileBitableDateFieldProps) {
  const today = localDateString(new Date());
  const current = typeof value === "string" ? value.slice(0, 10) : "";
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(current);
  const [cursor, setCursor] = useState(() => monthOf(current || today));

  const openSheet = () => {
    dismissKeyboard();
    const base = current || today;
    setDraft(base);
    setCursor(monthOf(base));
    setOpen(true);
  };
  const shiftMonth = (delta: number) => {
    const next = new Date(cursor.year, cursor.month - 1 + delta, 1);
    setCursor({ year: next.getFullYear(), month: next.getMonth() + 1 });
  };
  const days = calendarMonthDays(cursor.year, cursor.month);

  return (
    <>
      <button type="button" className="mbt-date-trigger" aria-label={ariaLabel} onClick={openSheet}>
        <span className={current ? "mbt-date-trigger__value" : "mbt-date-trigger__value is-empty"}>{current || placeholder}</span>
        <CalendarDays size={15} aria-hidden="true" />
      </button>
      <MobileSheet
        open={open}
        title="选择日期"
        onClose={() => setOpen(false)}
        bodyClassName="mbt-date-sheet mb-sheet__body--form"
        footer={
          <div className="mb-sheet__foot">
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { onChange(""); setOpen(false); }}>清除</button>
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { setDraft(today); setCursor(monthOf(today)); }}>今天</button>
            <button type="button" className="mb-btn mb-btn--primary mb-flex1" onClick={() => { onChange(draft); setOpen(false); }}>确定</button>
          </div>
        }
      >
        <header className="mbt-date-head">
          <button type="button" className="mb-iconbtn" aria-label="上个月" onClick={() => shiftMonth(-1)}><ChevronLeft size={17} /></button>
          <span className="mbt-date-title">{cursor.year} 年 {cursor.month} 月</span>
          <button type="button" className="mb-iconbtn" aria-label="下个月" onClick={() => shiftMonth(1)}><ChevronRight size={17} /></button>
        </header>
        <div className="mbt-calendar-week" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
        <div className="mbt-calendar-grid" role="grid" aria-label="选择日期">
          {days.map((cell) => {
            const classes = ["mbt-calendar-day"];
            if (!cell.inMonth) classes.push("is-out");
            if (cell.date === today) classes.push("is-today");
            if (cell.date === draft) classes.push("is-on");
            return (
              <button key={cell.date} type="button" role="gridcell" className={classes.join(" ")}
                aria-label={cell.date} aria-pressed={cell.date === draft}
                onClick={() => { setDraft(cell.date); setCursor(monthOf(cell.date)); }}>
                <span className="mbt-calendar-day__num">{cell.day}</span>
              </button>
            );
          })}
        </div>
      </MobileSheet>
    </>
  );
}

export default MobileBitableDateField;
