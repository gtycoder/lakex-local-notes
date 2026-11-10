/**
 * 移动端多维表「日历」视图（261030 P2；261110 月历格子改共享原语）。
 *
 * 日期语义全部来自 core（`calendarEvents` / `calendarEventsByDay` 含跨日展开；月份 42 格由
 * `ui/MonthCalendar` 用 core 的 `calendarMonthDays` 画 —— 与日期 Sheet、日记日历同一份视觉）。
 * 本文件只做「月历 + 选中日列表」；只读/编辑只影响点日程后去哪（详情页 / 记录面板）。
 */
import { useMemo, useState } from "react";
import {
  calendarEvents, calendarEventsByDay, calendarStartField, localDateString,
  type BitableCalendarEvent, type BitableDisplayContext, type BitableRecord, type BitableTable, type BitableView,
} from "../../core/bitableDoc.js";
import { MonthCalendar } from "../ui/MonthCalendar";

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
      <MonthCalendar
        year={cursor.year}
        month={cursor.month}
        selected={selected}
        today={today}
        onShiftMonth={shiftMonth}
        onPick={setSelected}
        hasDot={(dateKey) => (byDay.get(dateKey)?.length ?? 0) > 0}
      />
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
