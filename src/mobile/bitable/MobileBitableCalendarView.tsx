/**
 * 移动端多维表「日历」视图（261030 P2）。
 *
 * 日期语义全部来自 core（`calendarMonthDays` 本地日期、周一起始；`calendarEvents` / `calendarEventsByDay`
 * 含跨日展开）——移动端只做「月历 + 选中日列表」。只读/编辑只影响点日程后去哪（详情页 / 记录面板）。
 */
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  calendarEvents, calendarEventsByDay, calendarMonthDays, calendarStartField, localDateString,
  type BitableCalendarEvent, type BitableDisplayContext, type BitableRecord, type BitableTable, type BitableView,
} from "../../core/bitableDoc.js";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

export interface MobileBitableCalendarViewProps {
  table: BitableTable;
  view: BitableView;
  records: BitableRecord[];
  ctx: BitableDisplayContext;
  onOpen: (recordId: string) => void;
}

export function MobileBitableCalendarView({ table, view, records, ctx, onOpen }: MobileBitableCalendarViewProps) {
  const today = localDateString(new Date());
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [selected, setSelected] = useState(today);
  const startField = calendarStartField(table, view);
  const byDay = useMemo(() => calendarEventsByDay(calendarEvents(table, view, records, ctx)), [table, view, records, ctx]);
  const days = useMemo(() => calendarMonthDays(cursor.year, cursor.month), [cursor]);
  const selectedEvents: BitableCalendarEvent[] = byDay.get(selected) ?? [];

  if (!startField) {
    return <div className="mbt-view-empty">日历视图还没选开始日期字段：到桌面「视图配置 → 日历」里选一个日期字段。</div>;
  }

  const shiftMonth = (delta: number) => {
    const next = new Date(cursor.year, cursor.month - 1 + delta, 1);
    setCursor({ year: next.getFullYear(), month: next.getMonth() + 1 });
  };

  return (
    <div className="mbt-calendar">
      <header className="mbt-calendar-head">
        <button type="button" className="mb-iconbtn" aria-label="上个月" onClick={() => shiftMonth(-1)}><ChevronLeft size={17} /></button>
        <span className="mbt-calendar-title">{cursor.year} 年 {cursor.month} 月</span>
        <button type="button" className="mb-iconbtn" aria-label="下个月" onClick={() => shiftMonth(1)}><ChevronRight size={17} /></button>
      </header>
      <div className="mbt-calendar-week" aria-hidden="true">
        {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
      </div>
      <div className="mbt-calendar-grid" role="grid" aria-label="月历">
        {days.map((cell) => {
          const events = byDay.get(cell.date) ?? [];
          const classes = ["mbt-calendar-day"];
          if (!cell.inMonth) classes.push("is-out");
          if (cell.date === today) classes.push("is-today");
          if (cell.date === selected) classes.push("is-on");
          return (
            <button key={cell.date} type="button" className={classes.join(" ")} role="gridcell"
              aria-label={cell.date + (events.length ? "，" + events.length + " 个日程" : "")}
              onClick={() => setSelected(cell.date)}>
              <span className="mbt-calendar-day__num">{cell.day}</span>
              {events.length > 0 && <span className="mbt-calendar-day__dot" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="mbt-calendar-list">
        <div className="mbt-calendar-list__head">{selected} · {selectedEvents.length} 个日程</div>
        {selectedEvents.length === 0 && <div className="mbt-calendar-empty">这一天没有日程</div>}
        {selectedEvents.map((event) => (
          <button key={event.recordId + "@" + event.start} type="button" className="mbt-calendar-event" onClick={() => onOpen(event.recordId)}>
            <span className="mbt-calendar-event__bar" style={event.color ? { background: event.color } : undefined} aria-hidden="true" />
            <span className="mbt-calendar-event__title">{event.title}</span>
            <span className="mbt-calendar-event__meta">{event.start === event.end ? "" : event.start.slice(5) + " → " + event.end.slice(5)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default MobileBitableCalendarView;
