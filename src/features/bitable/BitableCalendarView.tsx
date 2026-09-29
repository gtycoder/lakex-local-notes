/**
 * 多维表日历视图（V04）。
 *
 * 月视图优先：记录按**开始日期字段**落到 42 格月网格；可选结束日期把日程展开成跨天，标题字段/颜色字段（仅单选）可配。
 * 日期比较与平移全部走 src/core/bitableDoc.ts 的**本地日期**纯函数（绝不经过 UTC，避免东八区差一天）。
 * 拖拽日程到某天 = **保持时长整体平移**（结束为空则只动开始日期）；写值由上层统一落 doc。
 * 本组件不做农历/节假日/重复日程/提醒（产品确认不做）。
 */
import { useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import {
  bitableDateFields, calendarEvents, calendarEventsByDay, calendarMonthDays, calendarMovePatch, calendarStartField,
  localDateString, optionChipStyle,
  type BitableDisplayContext, type BitableRecord, type BitableTable, type BitableView,
} from "../../core/bitableDoc.js";
import "./bitableCalendarView.css";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"] as const;
/** 单格最多显示几条日程（其余以 +N 收起，避免撑破月网格）。 */
const MAX_CHIPS_PER_DAY = 3;

export interface BitableCalendarViewProps {
  table: BitableTable;
  view: BitableView;
  /** 已按视图筛选/排序（含搜索）的记录。 */
  records: BitableRecord[];
  readOnly: boolean;
  onOpenRecord: (recordId: string) => void;
  /** 拖拽后的值补丁（开始 + 结束一起平移）由上层统一写记录。 */
  onSetValues: (recordId: string, patch: Record<string, unknown>) => void;
  /** 关联解析上下文（同一文档的 tables；标题字段可能是关联）。 */
  ctx?: BitableDisplayContext;
}

export function BitableCalendarView({ table, view, records, readOnly, onOpenRecord, onSetValues, ctx }: BitableCalendarViewProps) {
  const today = localDateString(new Date());
  /** 当前展示的月份是**本机展示态**，不写正文。 */
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const startField = calendarStartField(table, view);
  const byDay = useMemo(() => calendarEventsByDay(calendarEvents(table, view, records, ctx)), [table, view, records, ctx]);
  const days = useMemo(() => calendarMonthDays(cursor.year, cursor.month), [cursor]);

  if (!startField) {
    return (
      <div className="bt-calendar-empty">
        <CalendarDays size={18} />
        <p>
          {bitableDateFields(table).length > 0
            ? "日历还没有开始日期字段——点工具栏「日历配置」选择一个日期字段。"
            : "这张表还没有日期字段，无法按日期排布；先在表格视图里新增一个日期字段。"}
        </p>
      </div>
    );
  }

  const stepMonth = (delta: number) => setCursor((prev) => {
    const next = new Date(prev.year, prev.month - 1 + delta, 1);
    return { year: next.getFullYear(), month: next.getMonth() + 1 };
  });

  return (
    <div className="bt-calendar">
      <header className="bt-calendar-head">
        <button type="button" className="bt-icon-btn" aria-label="上一月" onClick={() => stepMonth(-1)}><ChevronLeft size={15} /></button>
        <span className="bt-calendar-title">{cursor.year} 年 {cursor.month} 月</span>
        <button type="button" className="bt-icon-btn" aria-label="下一月" onClick={() => stepMonth(1)}><ChevronRight size={15} /></button>
        <button type="button" className="bt-tool-btn" onClick={() => setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) })}>今天</button>
      </header>
      <div className="bt-calendar-week">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
      <div className="bt-calendar-grid">
        {days.map((day) => {
          const events = byDay.get(day.date) ?? [];
          return (
            <div key={day.date}
              className={"bt-cal-day" + (day.inMonth ? "" : " is-out") + (day.date === today ? " is-today" : "")}
              onDragOver={(event) => { if (!readOnly && draggingId) event.preventDefault(); }}
              onDrop={(event) => {
                if (readOnly || !draggingId) return;
                event.preventDefault();
                const record = records.find((r) => r.id === draggingId);
                if (record) onSetValues(draggingId, calendarMovePatch(table, view, record, day.date));
                setDraggingId(null);
              }}>
              <span className="bt-cal-day-num">{day.day}</span>
              <div className="bt-cal-events">
                {events.slice(0, MAX_CHIPS_PER_DAY).map((event) => (
                  <button key={event.recordId + "@" + day.date} type="button" className="bt-cal-event"
                    style={event.optionId ? optionChipStyle(event.color) : undefined}
                    draggable={!readOnly}
                    onDragStart={() => setDraggingId(event.recordId)}
                    onDragEnd={() => setDraggingId(null)}
                    onClick={() => onOpenRecord(event.recordId)}
                    title={event.title}>
                    {event.title}
                  </button>
                ))}
                {events.length > MAX_CHIPS_PER_DAY && <span className="bt-cal-more">+{events.length - MAX_CHIPS_PER_DAY}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
