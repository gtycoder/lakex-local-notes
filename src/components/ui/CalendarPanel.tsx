/**
 * 月历选择面板（**唯一实现**）：多维表日期字段 与 日记「按日期新建」共用。
 *
 * 视觉原语 = kit.css 的 `.ln-calendar*`（从 bitable 的 `.bt-date-*` 上收，261109）；
 * 本组件不写样式、不做定位 —— 调用方用 Overlay/Popover/Menu 包一层即可。
 */
import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { localDateString } from "../../core/bitableDoc";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"] as const;

export interface CalendarPanelProps {
  /** 当前值（`YYYY-MM-DD`；空串 = 未选）。 */
  value: string;
  /** 选中某天（`YYYY-MM-DD`）。 */
  onPick: (dateKey: string) => void;
  /** 不传 = 不显示「清除」。 */
  onClear?: () => void;
}

export function CalendarPanel({ value, onPick, onClear }: CalendarPanelProps) {
  const initial = value ? new Date(value + "T00:00:00") : new Date();
  const [cursor, setCursor] = useState(() => (Number.isNaN(initial.getTime()) ? new Date() : initial));
  useEffect(() => {
    if (!value) return;
    const next = new Date(value + "T00:00:00");
    if (!Number.isNaN(next.getTime())) setCursor(next);
  }, [value]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [];
  for (let i = 0; i < startWeekday; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(day);
  const dateKeyOf = (day: number) => localDateString(new Date(year, month, day));

  return (
    <div className="ln-calendar" role="group" aria-label="选择日期">
      <div className="ln-calendar__head">
        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="上个月" onClick={() => setCursor(new Date(year, month - 1, 1))}>
          <ChevronLeft size={14} />
        </button>
        <span>{year} 年 {month + 1} 月</span>
        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="下个月" onClick={() => setCursor(new Date(year, month + 1, 1))}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="ln-calendar__week">{WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
      <div className="ln-calendar__grid">
        {cells.map((day, index) => day === null
          ? <span key={"e" + index} className="ln-calendar__empty" />
          : (
            <button
              key={day}
              type="button"
              className={"ln-calendar__day" + (value === dateKeyOf(day) ? " is-selected" : "")}
              onClick={() => onPick(dateKeyOf(day))}
            >
              {day}
            </button>
          ))}
      </div>
      <div className="ln-calendar__foot">
        <button type="button" className="ln-btn ln-btn--link ln-btn--compact" onClick={() => onPick(localDateString(new Date()))}>今天</button>
        {onClear && <button type="button" className="ln-btn ln-btn--link ln-btn--compact" onClick={onClear}>清除</button>}
      </div>
    </div>
  );
}
