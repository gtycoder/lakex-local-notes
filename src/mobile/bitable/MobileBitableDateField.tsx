/**
 * 移动端多维表的**自有日期选择**（261030 用户点单：不要系统日期弹窗）。
 *
 * 为什么自研：系统 `<input type="date">` 在每个 Android 版本/ROM 上样式与交互都不同（实测本机是 Material 绿色日历弹窗），
 * 与我们的设计系统完全脱节，也无法统一「今天/清除/确定」语义。
 * 月历格子 = 共享原语 `ui/MonthCalendar`（261110 收编，日记页的「日历新建」用同一份），
 * 本文件只剩「触发器 + Sheet 外壳 + 今天/清除/确定」这套多维表语义；日期值仍是正文里的 `YYYY-MM-DD`。
 */
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { localDateString } from "../../core/bitableDoc.js";
import { MobileSheet } from "../ui/MobileSheet";
import { MonthCalendar } from "../ui/MonthCalendar";
import { dismissKeyboard } from "../ui/dismissKeyboard";

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
  const pickDay = (dateKey: string) => {
    setDraft(dateKey);
    setCursor(monthOf(dateKey));
  };

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
        bodyClassName="mb-sheet__body--form"
        footer={
          <div className="mb-sheet__foot">
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { onChange(""); setOpen(false); }}>清除</button>
            <button type="button" className="mb-btn mb-btn--secondary mb-btn--sm" onClick={() => { setDraft(today); setCursor(monthOf(today)); }}>今天</button>
            <button type="button" className="mb-btn mb-btn--primary mb-flex1" onClick={() => { onChange(draft); setOpen(false); }}>确定</button>
          </div>
        }
      >
        <MonthCalendar
          year={cursor.year}
          month={cursor.month}
          selected={draft}
          today={today}
          onShiftMonth={shiftMonth}
          onPick={pickDay}
        />
      </MobileSheet>
    </>
  );
}

export default MobileBitableDateField;
