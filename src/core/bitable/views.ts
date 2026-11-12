/**
 * 多维表正文（core/bitable）：视图求值：视图类型判定 + 看板 / 画册 / 日历（全部本地日期语义，绝不经过 UTC）。
 *
 * 由 core/bitableDoc.ts 按域拆出（261112 R1-S1，纯搬移：导出名/行为未变）。
 * 对外 API 仍由 ../bitableDoc.ts 门面 re-export；本文件只被同目录模块与门面 import。
 */
import { extOf, isImageExtension } from "../assetNaming.js";
import type { BitableAttachment, BitableCalendarEvent, BitableDisplayContext, BitableField, BitableKanbanColumn, BitableRecord, BitableTable, BitableView, BitableViewType } from "./types.js";
import { BITABLE_IMPLEMENTED_VIEW_TYPES, BITABLE_VIEW_TYPES, BITABLE_VIEW_TYPE_LABEL } from "./types.js";
import { bitableAttachments, bitableDisplayValue, dateValueOf, fieldById, localDateDiff, localDateString, orderedTableFields } from "./values.js";

/** 本版本是否已实现该视图类型的正文渲染。 */
export function isImplementedViewType(type: string): boolean {
  return BITABLE_IMPLEMENTED_VIEW_TYPES.includes(type);
}

/** 是否是我们认识的视图类型（未知类型只回退显示，绝不改写成 grid）。 */
export function isKnownViewType(type: string): type is BitableViewType {
  return (BITABLE_VIEW_TYPES as readonly string[]).includes(type);
}

/** 视图类型 → 展示名；未知类型原样返回它的 type，好让 UI 说清「不认识的是哪一个」。 */
export function viewTypeLabel(type: string): string {
  return isKnownViewType(type) ? BITABLE_VIEW_TYPE_LABEL[type] : type;
}

/**
 * 新建视图的**默认名** = 短名（261103 四批）：表格 / 表单 / 看板 / 画册 / 日历；未知类型叫「视图」。
 * 长名（表格视图…，BITABLE_VIEW_TYPE_LABEL）仍用于新建菜单与回退提示——两套文案各有用途，
 * 别把 BITABLE_VIEW_TYPE_LABEL 改短（那会让菜单变成「表格」这种缺宾语的文案）。
 */
export function defaultViewName(type: string): string {
  switch (type) {
    case "grid": return "表格";
    case "form": return "表单";
    case "kanban": return "看板";
    case "gallery": return "画册";
    case "calendar": return "日历";
    default: return "视图";
  }
}

/** 看板可用的分组字段 = 单选字段（多选/其他类型不做看板分组）。 */
export function bitableSelectFields(table: BitableTable): BitableField[] {
  return table.fields.filter((f) => f.type === "select");
}

/** 视图配置的看板分组字段；未配置 / 字段已删 / 类型不再是单选 → undefined（UI 给配置提示）。 */
export function kanbanGroupField(table: BitableTable, view: BitableView | undefined): BitableField | undefined {
  const id = view?.kanbanGroupFieldId;
  if (typeof id !== "string" || !id) return undefined;
  const field = table.fields.find((f) => f.id === id);
  return field && field.type === "select" ? field : undefined;
}

/** 可以作为看板卡片字段的候选（视图列顺序；主字段是标题、分组字段是分栏，都不在其中）。 */
export function kanbanCardFieldCandidates(table: BitableTable, view: BitableView | undefined): BitableField[] {
  const groupId = kanbanGroupField(table, view)?.id;
  return cardCandidates(table, view, groupId ? [groupId] : []);
}

/** 看板卡片上**实际**显示的字段：未配置 = 全部候选；配置过 = 按视图列顺序取交集。 */
export function kanbanCardFields(table: BitableTable, view: BitableView | undefined): BitableField[] {
  return pickCardFields(kanbanCardFieldCandidates(table, view), view?.kanbanFieldIds);
}

/**
 * 看板分栏：**选项即分栏**——按选项顺序给出**全部**选项（空栏目也保留，否则没法把卡片拖进空分组），
 * 末尾固定一个「未分组」栏（值为空 / 非字符串 / 指向已删选项的记录都落在这里）。
 * 传入的 `records` 必须已按视图筛选+排序：组内顺序 = 传入顺序（看板不额外排序，第一版也不做手动排序）。
 * 未配置分组字段（或表里没有单选字段）→ 返回空数组，由 UI 给「先选分组字段」的提示。
 */
export function kanbanColumns(table: BitableTable, view: BitableView | undefined, records: BitableRecord[]): BitableKanbanColumn[] {
  const field = kanbanGroupField(table, view);
  if (!field) return [];
  const options = field.options ?? [];
  const byOption = new Map<string, BitableRecord[]>(options.map((option) => [option.id, []]));
  const ungrouped: BitableRecord[] = [];
  for (const record of records) {
    const value = record.values[field.id];
    const bucket = typeof value === "string" ? byOption.get(value) : undefined;
    if (bucket) bucket.push(record);
    else ungrouped.push(record);
  }
  return [
    ...options.map((option) => ({
      key: option.id,
      label: option.name,
      color: option.color,
      optionId: option.id,
      records: byOption.get(option.id)!,
    })),
    { key: "", label: "未分组", optionId: null, records: ungrouped },
  ];
}

/** 附件类字段（值模型完全相同：`{file,name,size}[]`）。image 只是在**上传侧**限定图片。 */
export function isAttachmentLikeField(type: string): boolean {
  return type === "attachment" || type === "image";
}

/** 画册封面可用的附件类字段（附件 / 图片）。 */
export function bitableAttachmentFields(table: BitableTable): BitableField[] {
  return table.fields.filter((f) => isAttachmentLikeField(f.type));
}

/** 卡片字段候选的公共口径：视图列顺序里排除主字段（当标题）与 excluded。 */
function cardCandidates(table: BitableTable, view: BitableView | undefined, excluded: readonly string[]): BitableField[] {
  const primaryId = table.fields[0]?.id;
  const skip = new Set(excluded);
  return orderedTableFields(table, view).filter((f) => f.id !== primaryId && !skip.has(f.id));
}

/** 未配置 = 全部候选；配置过 = 按视图列顺序取交集（顺序始终由视图决定）。 */
function pickCardFields(candidates: BitableField[], configured: string[] | undefined): BitableField[] {
  if (!Array.isArray(configured)) return candidates;
  const wanted = new Set(configured);
  return candidates.filter((f) => wanted.has(f.id));
}

/** 视图配置的画册封面字段；未配置 / 字段已删 / 类型不再是附件 → undefined（= 无封面）。 */
export function galleryCoverField(table: BitableTable, view: BitableView | undefined): BitableField | undefined {
  const id = view?.galleryCoverFieldId;
  if (typeof id !== "string" || !id) return undefined;
  const field = table.fields.find((f) => f.id === id);
  return field && isAttachmentLikeField(field.type) ? field : undefined;
}

/** 可以作为画册卡片字段的候选（排除主字段与封面字段）。 */
export function galleryCardFieldCandidates(table: BitableTable, view: BitableView | undefined): BitableField[] {
  const coverId = galleryCoverField(table, view)?.id;
  return cardCandidates(table, view, coverId ? [coverId] : []);
}

export function galleryCardFields(table: BitableTable, view: BitableView | undefined): BitableField[] {
  return pickCardFields(galleryCardFieldCandidates(table, view), view?.galleryFieldIds);
}

/**
 * 封面图：取封面字段里**第一个图片附件**（"多图附件按第一个可用图片显示"）；
 * 非图片（音频/PDF…）跳过、没有可用图片 → undefined（卡片走「无封面」回退）。
 */
export function galleryCoverImage(table: BitableTable, view: BitableView | undefined, record: BitableRecord): BitableAttachment | undefined {
  const field = galleryCoverField(table, view);
  if (!field) return undefined;
  return bitableAttachments(record.values[field.id]).find((attachment) => isImageExtension(extOf(attachment.file)));
}

/** 日历可用的日期字段。 */
export function bitableDateFields(table: BitableTable): BitableField[] {
  return table.fields.filter((f) => f.type === "date");
}

export function calendarStartField(table: BitableTable, view: BitableView | undefined): BitableField | undefined {
  return fieldById(table, view?.calendarStartFieldId, "date");
}

export function calendarEndField(table: BitableTable, view: BitableView | undefined): BitableField | undefined {
  return fieldById(table, view?.calendarEndFieldId, "date");
}

/** 标题字段：未配置回落到主字段（记录标题口径与表格一致）。 */
export function calendarTitleField(table: BitableTable, view: BitableView | undefined): BitableField | undefined {
  return fieldById(table, view?.calendarTitleFieldId) ?? table.fields[0];
}

/** 颜色字段：第一版只认单选。 */
export function calendarColorField(table: BitableTable, view: BitableView | undefined): BitableField | undefined {
  return fieldById(table, view?.calendarColorFieldId, "select");
}

/** 记录 → 日程投影：没有开始日期 / 日期非法的记录不上日历（不猜、不报错）。 */
export function calendarEvents(table: BitableTable, view: BitableView | undefined, records: BitableRecord[], ctx?: BitableDisplayContext): BitableCalendarEvent[] {
  const startField = calendarStartField(table, view);
  if (!startField) return [];
  const endField = calendarEndField(table, view);
  const titleField = calendarTitleField(table, view);
  const colorField = calendarColorField(table, view);
  const events: BitableCalendarEvent[] = [];
  for (const record of records) {
    const start = dateValueOf(record.values[startField.id]);
    if (!start) continue;
    const rawEnd = endField ? dateValueOf(record.values[endField.id]) : "";
    // 结束为空 / 早于开始 → 单日（"开始/结束相同时正常显示单日"）
    const end = rawEnd && rawEnd >= start ? rawEnd : start;
    let color: string | undefined;
    let optionId: string | undefined;
    if (colorField) {
      const value = record.values[colorField.id];
      const option = typeof value === "string" ? (colorField.options ?? []).find((o) => o.id === value) : undefined;
      if (option) { color = option.color; optionId = option.id; }
    }
    events.push({
      recordId: record.id,
      title: (titleField ? bitableDisplayValue(titleField, record.values[titleField.id], ctx) : "") || "未命名记录",
      start, end, color, optionId,
    });
  }
  return events;
}

/** 月历的 42 格（**周一起始**）：本地日期语义，跨月/跨年都不会偏一天。 */
export function calendarMonthDays(year: number, month: number): Array<{ date: string; day: number; inMonth: boolean }> {
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7;   // 周一 = 0
  const days: Array<{ date: string; day: number; inMonth: boolean }> = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(year, month - 1, 1 - offset + i);
    days.push({ date: localDateString(d), day: d.getDate(), inMonth: d.getMonth() === month - 1 });
  }
  return days;
}

/** 本地日期 ±N 天（跨月/跨年/夏令时都安全）。 */
export function shiftLocalDate(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  if (![y, m, d].every((n) => Number.isFinite(n))) return date;
  return localDateString(new Date(y, m - 1, d + days));
}

/** 跨天日程按天展开（同一天可出现多条），月视图取用；单条最多展开 366 天防脏数据。 */
export function calendarEventsByDay(events: BitableCalendarEvent[]): Map<string, BitableCalendarEvent[]> {
  const byDay = new Map<string, BitableCalendarEvent[]>();
  for (const event of events) {
    const span = Math.min(366, Math.max(0, localDateDiff(event.end, event.start)));
    for (let i = 0; i <= span; i += 1) {
      const day = shiftLocalDate(event.start, i);
      const list = byDay.get(day);
      if (list) list.push(event); else byDay.set(day, [event]);
    }
  }
  return byDay;
}

/**
 * 拖拽日程到 `targetDate` 的值补丁：**保持时长整体平移**；
 * 结束日期为空（单日日程）只动开始日期，绝不凭空写一个结束日期。写值由调用方统一落 doc。
 */
export function calendarMovePatch(table: BitableTable, view: BitableView | undefined, record: BitableRecord, targetDate: string): Record<string, unknown> {
  const startField = calendarStartField(table, view);
  if (!startField) return {};
  const start = dateValueOf(record.values[startField.id]);
  if (!start) return {};
  const delta = localDateDiff(targetDate, start);
  if (delta === 0) return {};
  const patch: Record<string, unknown> = { [startField.id]: shiftLocalDate(start, delta) };
  const endField = calendarEndField(table, view);
  const end = endField ? dateValueOf(record.values[endField.id]) : "";
  if (endField && end) patch[endField.id] = shiftLocalDate(end, delta);
  return patch;
}
