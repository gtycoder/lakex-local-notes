/**
 * 多维表正文（core/bitable）：字段取值/展示/搜索/列级统计/附件值：把记录值渲染成人类可读文本的唯一实现。
 *
 * 由 core/bitableDoc.ts 按域拆出（261112 R1-S1，纯搬移：导出名/行为未变）。
 * 对外 API 仍由 ../bitableDoc.ts 门面 re-export；本文件只被同目录模块与门面 import。
 */
import { isAssetFilename } from "../assetNaming.js";
import { formatDateTime as formatDateTimeCore, formatYmd } from "../dateFormat.js";
import { contrastTextColor } from "../colorPalette.js";
import type { BitableAttachment, BitableDisplayContext, BitableField, BitableFieldType, BitableRecord, BitableStatType, BitableTable, BitableView } from "./types.js";
import { BITABLE_FIELD_TYPES, nowIso } from "./types.js";

/** 数字格式：返回展示文本；非法数字原样返回。 */
export function formatBitableNumber(value: unknown, format: string | undefined): string {
  const raw = String(value ?? "");
  if (!format) return raw;
  const num = typeof value === "number" ? value : Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(num)) return raw;
  const grouped = (min: number, max: number): string =>
    num.toLocaleString("en-US", { minimumFractionDigits: min, maximumFractionDigits: max });
  if (format === "thousands") return grouped(0, 6);
  if (format === "decimal0") return grouped(0, 0);
  if (format === "decimal1") return grouped(1, 1);
  if (format === "decimal2") return grouped(2, 2);
  return raw;
}

/** 日期格式：存储形状 YYYY-MM-DD，按 field.format 输出展示文本；非法日期原样返回。 */
export function formatBitableDate(value: unknown, format: string | undefined): string {
  const raw = typeof value === "string" ? value : "";
  const matched = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!matched) return raw;
  const year = matched[1];
  const month = matched[2];
  const day = matched[3];
  if (format === "slash") return year + "/" + month + "/" + day;
  if (format === "md") return String(Number(month)) + "月" + String(Number(day)) + "日";
  if (format === "cny") return year + "年" + String(Number(month)) + "月" + String(Number(day)) + "日";
  return year + "-" + month + "-" + day;
}

/** 当前字段是否有「显示格式」可选（日期 / 数字）。 */
export function fieldSupportsFormat(type: string): boolean {
  return type === "date" || type === "number";
}

/** 数值类字段（排序/筛选/统计按数值口径走）：数字 + 评分 + 进度。 */
export function isNumericFieldType(type: string): boolean {
  return type === "number" || type === "rating" || type === "progress";
}

/** 系统时间字段（只读，值取记录时间戳，不写 values）：创建时间 / 修改时间。 */
export function isSystemTimeField(type: string): boolean {
  return type === "createdTime" || type === "updatedTime";
}

export function isKnownFieldType(type: string): type is BitableFieldType {
  return (BITABLE_FIELD_TYPES as readonly string[]).includes(type);
}

const LEGACY_OPTION_COLOR_HEX: Record<string, string> = {
  gray: "#e8e8e8",
  blue: "#d6e6fb",
  green: "#d3f0df",
  orange: "#fde4d3",
  red: "#f8d6cf",
  purple: "#eadcf7",
};

/** 选项颜色 → hex（hex 原样返回，旧命名色键映射，未知返回 undefined）。 */
export function optionColorHex(color: string | undefined): string | undefined {
  if (!color) return undefined;
  return color.startsWith("#") ? color : LEGACY_OPTION_COLOR_HEX[color];
}

/** 选项 chip 动态样式（背景=选项色，文字自动取对比色）。 */
export function optionChipStyle(color: string | undefined): { backgroundColor?: string; color?: string } {
  const hex = optionColorHex(color);
  return hex ? { backgroundColor: hex, color: contrastTextColor(hex) } : {};
}

/** 展示文案（文案逐字对齐云端 config 的 text）。 */
export const BITABLE_STAT_LABEL: Record<BitableStatType, string> = {
  count: "记录总数",
  filled: "已填写数", empty: "未填写数", unique: "唯一数",
  percentFilled: "已填写占比", percentEmpty: "未填写占比", percentUnique: "唯一数占比",
  checked: "已勾选", unchecked: "未勾选", percentChecked: "已勾选占比", percentUnchecked: "未勾选占比",
  sum: "求和", average: "平均值", median: "中位数", max: "最大值", min: "最小值",
  earliestDate: "最早时间", latestDate: "最晚时间", dateRange: "时间范围（日）", monthRange: "时间范围（月）",
};

/**
 * 汇总格里的**展示文案**（与选择器里的选项文案分开）。
 *
 * 260929 用户定稿：选了「记录总数」时格子里显示 `共 N 条`（云端原文是 `N 条记录`）。
 * 其余口径沿用「口径名 值」。选项列表仍走 `BITABLE_STAT_LABEL`（云端逐字原文）——
 * 两者语义不同，所以不能共用一个串。
 */
export function statDisplayText(stat: BitableStatType, value: string): string {
  if (stat === "count") return "共 " + value + " 条";
  return BITABLE_STAT_LABEL[stat] + " " + value;
}

/** 云端的「通用类」字段（bundle 里的 e0e）：文本/单选/多选/数字/评分/进度/日期/图片/附件/链接/创建·修改时间…，**复选框不在内**。 */
const GENERIC_STATS: readonly BitableStatType[] = ["filled", "empty", "unique", "percentFilled", "percentEmpty", "percentUnique"];

const CHECKBOX_STATS: readonly BitableStatType[] = ["checked", "unchecked", "percentChecked", "percentUnchecked"];

/** 某字段可选的统计类型（严格按云端的 types 限制）。「不展示」由调用方用 null 表达，不在此列表。 */
export function statsForField(field: BitableField): BitableStatType[] {
  if (field.type === "boolean") return ["count", ...CHECKBOX_STATS];
  const out: BitableStatType[] = ["count", ...GENERIC_STATS];
  if (field.type === "number") out.push("sum", "average", "median", "max", "min");
  else if (isNumericFieldType(field.type)) out.push("max", "min");   // 评分 / 进度：只有最大最小（云端口径）
  if (field.type === "date" || isSystemTimeField(field.type)) out.push("earliestDate", "latestDate", "dateRange", "monthRange");
  return out;
}

/** 视图中配置的统计类型（未配置 / 不认识 → undefined = 不统计）。 */
export function statForField(view: BitableView | undefined, fieldId: string): BitableStatType | undefined {
  const stat = view?.columnStats?.[fieldId];
  // hasOwnProperty：`stat in LABEL` 会命中 Object.prototype（脏正文里的 "toString" 之类会穿透）
  return typeof stat === "string" && Object.prototype.hasOwnProperty.call(BITABLE_STAT_LABEL, stat) ? (stat as BitableStatType) : undefined;
}

function formatStatNumber(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}

function statPct(part: number, total: number): string {
  if (total <= 0) return "0%";
  return String(Math.round((part / total) * 1000) / 10) + "%";
}

/**
 * 计算一列的统计值。**入参必须是当前视图筛选后的记录**（排序不影响集合，故统计天然与排序无关）。
 * 空值 / 非法值一律跳过；附件、关联等非数值类型不会崩（只走通用口径）。
 */
/** 两个本地日期（YYYY-MM-DD）之间的**月跨度**（可为 0）。 */
export function localMonthDiff(later: string, earlier: string): number {
  const y = (s: string) => Number(s.slice(0, 4));
  const m = (s: string) => Number(s.slice(5, 7));
  return (y(later) * 12 + m(later)) - (y(earlier) * 12 + m(earlier));
}

export function computeColumnStat(field: BitableField, records: BitableRecord[], stat: BitableStatType): string {
  const total = records.length;
  if (stat === "count") return String(total);
  // 复选框：已勾选 / 未勾选（未勾选 = 总数 − 已勾选）
  if (stat === "checked" || stat === "unchecked" || stat === "percentChecked" || stat === "percentUnchecked") {
    const checked = records.filter((record) => bitableFieldValue(record, field) === true).length;
    if (stat === "checked") return String(checked);
    if (stat === "unchecked") return String(total - checked);
    return stat === "percentChecked" ? statPct(checked, total) : statPct(total - checked, total);
  }
  const texts = records.map((record) => bitableRawDisplayValue(field, bitableFieldValue(record, field)).trim());
  const filledCount = texts.filter((text) => text !== "").length;
  const uniqueCount = new Set(texts.filter((text) => text !== "")).size;
  if (stat === "filled") return String(filledCount);
  if (stat === "empty") return String(total - filledCount);
  if (stat === "unique") return String(uniqueCount);
  if (stat === "percentFilled") return statPct(filledCount, total);
  if (stat === "percentEmpty") return statPct(total - filledCount, total);
  if (stat === "percentUnique") return statPct(uniqueCount, total);
  if (isNumericFieldType(field.type)) {
    const nums = records
      .map((record) => {
        const text = bitableRawDisplayValue(field, bitableFieldValue(record, field)).trim();
        if (text === "") return Number.NaN;   // 空格子不能当 0 参与求和/平均
        const raw = bitableFieldValue(record, field);
        return typeof raw === "number" ? raw : Number(text);
      })
      .filter((n) => Number.isFinite(n));
    if (nums.length === 0) return "—";
    if (stat === "sum") return formatStatNumber(nums.reduce((a, b) => a + b, 0));
    if (stat === "average") return formatStatNumber(nums.reduce((a, b) => a + b, 0) / nums.length);
    if (stat === "median") {
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return formatStatNumber(sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
    }
    if (stat === "min") return formatStatNumber(Math.min(...nums));
    if (stat === "max") return formatStatNumber(Math.max(...nums));
    return "—";
  }
  if (field.type === "date" || isSystemTimeField(field.type)) {
    const days = records
      .map((record) => dateValueOf(bitableFieldValue(record, field)))
      .filter((day) => day !== "")
      .sort();
    if (days.length === 0) return "—";
    if (stat === "earliestDate") return days[0];
    if (stat === "latestDate") return days[days.length - 1];
    if (stat === "dateRange") return String(localDateDiff(days[days.length - 1], days[0]) + 1) + " 天";
    if (stat === "monthRange") return String(localMonthDiff(days[days.length - 1], days[0]) + 1) + " 月";
  }
  return "—";
}

/**
 * 展示名守卫：**落盘名（13位时间戳_8位hex.扩展名）绝不进 UI**（用户 260928）。
 * 缺展示名、或展示名本身就是磁盘名（历史脏值 / 解析兜底）→ 一律回落到中性文案。
 */
function bitableDisplayName(raw: unknown, fallback: string): string {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (text && !isAssetFilename(text)) return text;
  return isAssetFilename(fallback) ? "附件" : (fallback || "附件");
}

/** 解析附件单元格值：非法条目直接丢弃；展示名缺失或就是落盘名 → 中性文案（不暴露磁盘名）。 */
export function bitableAttachments(value: unknown): BitableAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: BitableAttachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { file, name, size } = item as Partial<BitableAttachment>;
    if (typeof file !== "string" || !file) continue;
    out.push({
      file,
      name: bitableDisplayName(name, file),
      size: typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : 0,
    });
  }
  return out;
}

/** 移除某个附件（按**磁盘名**匹配）——单元格 / 记录详情 / 表单共用的唯一删除口径。 */
export function removeBitableAttachment(value: unknown, file: string): BitableAttachment[] {
  return bitableAttachments(value).filter((a) => a.file !== file);
}

/** 按给定顺序重排附件（拖拽排序用）。`orderedFiles` 未覆盖的条目按原序补回——绝不因一次拖拽丢附件。 */
export function reorderBitableAttachments(value: unknown, orderedFiles: string[]): BitableAttachment[] {
  const items = bitableAttachments(value);
  const byFile = new Map(items.map((a) => [a.file, a]));
  const out: BitableAttachment[] = [];
  for (const file of orderedFiles) {
    const item = byFile.get(file);
    if (item && !out.includes(item)) out.push(item);
  }
  for (const item of items) if (!out.includes(item)) out.push(item);
  return out;
}

/** 改某个附件的**展示名**（磁盘名不变）；名称清空视为放弃编辑，原样返回。 */
export function renameBitableAttachment(value: unknown, file: string, name: string): BitableAttachment[] {
  const items = bitableAttachments(value);
  const clean = name.trim();
  if (!clean) return items;
  return items.map((a) => (a.file === file ? { ...a, name: clean } : a));
}

/** 附件卡片网格的几何常量（与 `bitableEditor.css` 的 `.bt-attach-card*` 保持一致）。 */
export const ATTACHMENT_GRID = {
  /** 单卡宽度（CSS `minmax(148px, 1fr)` 的下限）。 */
  cardWidth: 148,
  /** 单卡高度 = 附件区 92 + 名称行。 */
  cardHeight: 121,
  gap: 8,
  /** 展开面板默认最多显示的行数（超出由投放区自身滚动）。 */
  maxRows: 3,
  maxCols: 6,
} as const;

/**
 * 附件卡片网格的列数（展开面板自适应用）：
 * 数量少时先铺满一行（≤3 列，避免"2 个附件竖成一列"的窄高条），再多则**只增列以保持 ≤3 行**，
 * 上限 6 列（再多就交给滚动，面板不会无限变宽）。
 */
export function attachmentGridColumns(count: number): number {
  if (!Number.isFinite(count) || count <= 0) return 1;
  const rows3 = Math.ceil(count / ATTACHMENT_GRID.maxRows);
  return Math.min(ATTACHMENT_GRID.maxCols, Math.max(Math.min(count, 3), rows3));
}

/** 关联单元格值 → 目标记录 id 数组（去重、保序；非法条目丢弃）。单条模式也存单元素数组。 */
export function relationRecordIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item === "" || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** 关联字段的目标数据表（同一文档内；未配置 / 目标表已删 → undefined，界面显示为空、**不级联清理来源字段**）。 */
export function relationTargetTable(ctx: BitableDisplayContext | undefined, field: BitableField): BitableTable | undefined {
  const tableId = field.relation?.tableId;
  if (!tableId || !ctx) return undefined;
  return ctx.tables.find((table) => table.id === tableId);
}

/**
 * 目标记录 id → 记录索引：按 `records` **数组引用**缓存（正文是不可变快照，编辑必换新数组）。
 * 关联列逐格解析时不再每格重建 Map（AR-F6；专项 §17.3：来源 R 行 × 目标 T 行 = O(R×T)）。
 * WeakMap 随旧快照一起回收，不进 localStorage、不留长期缓存。
 */
const relationRecordsIndex = new WeakMap<readonly BitableRecord[], Map<string, BitableRecord>>();

function recordIndexFor(records: readonly BitableRecord[]): Map<string, BitableRecord> {
  let index = relationRecordsIndex.get(records);
  if (!index) {
    index = new Map(records.map((record) => [record.id, record] as const));
    relationRecordsIndex.set(records, index);
  }
  return index;
}

/** 关联单元格 → 现存目标记录（按存值顺序；已删 / 失效目标跳过，内部 id 原样保留、恢复后自动重现）。 */
export function relationTargetRecords(ctx: BitableDisplayContext | undefined, field: BitableField, value: unknown): BitableRecord[] {
  const target = relationTargetTable(ctx, field);
  if (!target) return [];
  const byId = recordIndexFor(target.records);
  return relationRecordIds(value)
    .map((id) => byId.get(id))
    .filter((record): record is BitableRecord => !!record);
}

/**
 * 关联字段绑定的**数据范围视图**（`relation.viewId` 指向目标表的某个视图）。
 * 未配置 / 目标表缺失 / 视图已被删 → undefined（回落「目标表全部记录」，不级联、不报错）。
 */
export function relationTargetView(ctx: BitableDisplayContext | undefined, field: BitableField): BitableView | undefined {
  const table = relationTargetTable(ctx, field);
  const viewId = field.relation?.viewId;
  if (!table || typeof viewId !== "string" || !viewId) return undefined;
  return table.views.find((view) => view.id === viewId);
}

function optionName(field: BitableField, value: unknown): string {
  const options = field.options ?? [];
  const byId = options.find((o) => o.id === value);
  if (byId) return byId.name;
  const byName = options.find((o) => o.name === value);
  if (byName) return byName.name;
  return typeof value === "string" ? value : "";
}

/**
 * 字段值 → 人类可读文本（列表/搜索/记录标题统一口径）。
 * `ctx` 只在**关联字段**需要：它提供同一文档的 tables 以解析目标记录主字段；不传则关联展示为空。
 */
function bitableValueText(field: BitableField, value: unknown, ctx: BitableDisplayContext | undefined, formatted: boolean): string {
  if (value == null) return "";
  switch (field.type) {
    case "select":
      return optionName(field, value);
    case "multiSelect":
      return Array.isArray(value) ? value.map((v) => optionName(field, v)).filter(Boolean).join(", ") : "";
    case "attachment":
    case "image":
      return bitableAttachments(value).map((a) => a.name).join(", ");
    case "relationOneWay":
    case "relationTwoWay": {
      const target = relationTargetTable(ctx, field);
      const primary = target?.fields[0];
      if (!target || !primary) return "";
      // 只解析**一层**：目标表主字段若也是关联则展示为空 —— 避免两张表互相引用时无限递归。
      return relationTargetRecords(ctx, field, value)
        .map((record) => bitableFieldText(record, primary))
        .filter(Boolean)
        .join(", ");
    }
    case "number":
      return formatted ? formatBitableNumber(value, typeof field.format === "string" ? field.format : undefined) : String(value);
    case "rating":
    case "progress":
      return String(value);
    case "date":
      return formatted ? formatBitableDate(value, typeof field.format === "string" ? field.format : undefined) : (typeof value === "string" ? value.slice(0, 10) : "");
    case "boolean":
      return value === true ? "是" : value === false ? "否" : "";
    case "link":
      return typeof value === "string" ? value : "";
    case "createdTime":
    case "updatedTime":
      // 管线里值 = 本地日期串（bitableFieldValue）；单元格/卡片展示走 bitableFieldText 到分钟
      return typeof value === "string" ? value : "";
    default:
      return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  }
}

/**
 * 展示文本（UI 用）：日期/数字按 field.format 输出。
 * **语义计算不要用它** —— 排序/分组/筛选/统计/查重一律用 bitableRawDisplayValue（261030：改显示格式不能改数据语义）。
 */
export function bitableDisplayValue(field: BitableField, value: unknown, ctx?: BitableDisplayContext): string {
  return bitableValueText(field, value, ctx, true);
}

/** 原始展示文本（忽略 field.format；供排序/分组/筛选/统计/查重等语义计算）。 */
export function bitableRawDisplayValue(field: BitableField, value: unknown, ctx?: BitableDisplayContext): string {
  return bitableValueText(field, value, ctx, false);
}

/**
 * 字段默认值集合（只收集 defaultValue 非空的字段）——新建记录 / 表单预填用。
 * 单选默认值存 option id；值形状与单元格一致。
 */
/** 新建记录的预填值。`at` = 建记录的 ISO 时间戳（「添加记录时间」型日期字段按它填当天）。 */
export function defaultRecordValues(table: BitableTable, at: string = nowIso()): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of table.fields) {
    const value = field.defaultValue;
    if (field.type === "date" && field.dateAutoFill) {
      // 日期格存 `YYYY-MM-DD`（与 DatePicker 同域），按**本地**日期取（UTC 在东八区晚上会差一天）
      values[field.id] = localDateString(at);
      continue;
    }
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    values[field.id] = value;
  }
  return values;
}

/** 时间戳 → **本地**日期 `YYYY-MM-DD`。
 *  日期格的值域就是 `YYYY-MM-DD`（DatePicker 同口径），且必须走本地时区：
 *  `toISOString().slice(0,10)` 在 UTC+8 的 00:00–08:00 会算成前一天。 */
export function localDateString(at: string | number | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return formatYmd(d);
}

/** ISO 时间戳 → 本地 `YYYY-MM-DD HH:mm`（系统时间字段展示口径，绝不走 UTC）。 */
export function localDateTimeString(at: string | number | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return formatDateTimeCore(d);
}

/**
 * **管线取值**（筛选 / 排序 / 分组 / 统计的唯一口径，含系统字段）：
 * 创建 / 修改时间读记录时间戳，并按**本地日期** `YYYY-MM-DD` 输出——与 date 字段同域，
 * 于是时间字段天然获得「gt/lt/... 比较、最早/最晚/时间范围、按天分组」全部口径。
 */
export function bitableFieldValue(record: BitableRecord, field: BitableField): unknown {
  if (field.type === "createdTime") return localDateString(record.createdAt);
  if (field.type === "updatedTime") return localDateString(record.updatedAt);
  return record.values[field.id];
}

/** 字段**展示文本**（记录级，含系统时间）：系统时间展示到分钟；其余走展示值口径（关联字段需 ctx）。 */
export function bitableFieldText(record: BitableRecord, field: BitableField, ctx?: BitableDisplayContext): string {
  if (field.type === "createdTime") return localDateTimeString(record.createdAt);
  if (field.type === "updatedTime") return localDateTimeString(record.updatedAt);
  return bitableDisplayValue(field, record.values[field.id], ctx);
}

/** 记录标题 = 主字段（fields[0]）的展示值；未填 → 「未命名记录」（对齐云端，关联字段需 ctx）。 */
export function bitableRecordTitle(table: BitableTable, record: BitableRecord, ctx?: BitableDisplayContext): string {
  const primary = table.fields[0];
  if (!primary) return "未命名记录";
  return bitableFieldText(record, primary, ctx) || "未命名记录";
}

/**
 * 配置 id → 字段（可选限定类型）；空/不存在/类型不符 → undefined。
 * 内部共享：跨模块用，**不**由门面 re-export（门面只 re-export 拆分前的公开符号）。
 */
export function fieldById(table: BitableTable, id: unknown, type?: string): BitableField | undefined {
  if (typeof id !== "string" || !id) return undefined;
  const field = table.fields.find((f) => f.id === id);
  if (!field) return undefined;
  return !type || field.type === type ? field : undefined;
}

/**
 * 日期格的值域是 `YYYY-MM-DD`；兼容历史 ISO 值（按**本地**时区折算），非法 → ""。
 * 内部共享：跨模块用，**不**由门面 re-export（门面只 re-export 拆分前的公开符号）。
 */
export function dateValueOf(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : localDateString(parsed);
}

/** 两个本地日期的整天差（to - from）。 */
export function localDateDiff(to: string, from: string): number {
  const [ty, tm, td] = to.split("-").map(Number);
  const [fy, fm, fd] = from.split("-").map(Number);
  if (![ty, tm, td, fy, fm, fd].every((n) => Number.isFinite(n))) return 0;
  return Math.round((new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86400000);
}

function orderFieldsByView(fields: readonly BitableField[], view: BitableView | undefined): BitableField[] {
  const order = view?.fieldOrder;
  if (!order || order.length === 0) return [...fields];
  const rank = new Map(order.map((id, index) => [id, index] as const));
  return [...fields].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

/** 未隐藏字段按 fieldOrder 排好序（fieldOrder 未列出的字段按原始顺序追加）。 */
export function orderedTableFields(table: BitableTable, view: BitableView | undefined): BitableField[] {
  const hidden = new Set(view?.hiddenFieldIds ?? []);
  return orderFieldsByView(table.fields.filter((f) => !hidden.has(f.id)), view);
}

/** 全部字段按 fieldOrder 排好序，但**不应用 hiddenFieldIds**（“全部记录”只看顺序）。 */
export function orderedAllTableFields(table: BitableTable, view: BitableView | undefined): BitableField[] {
  return orderFieldsByView(table.fields, view);
}
