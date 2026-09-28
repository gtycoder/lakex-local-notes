/**
 * 多维表文档（kind = "bitable"）正文格式、序列化与视图求值 —— 桌面/移动端共享的单一事实源。
 *
 * 存储位置：bitables/{noteId}.bitable.json（本地）/ objects/{noteId}-{hash}.lake（S3，内容寻址）。
 * 正文是纯文本 JSON，天然复用「正文对象 + manifest.contentHash」的整条同步/GC/历史/回收站管线。
 *
 * 产品口径见 docs/STORAGE-LAYERS.md（v1）：
 * - 一个文档可含多张数据表（tables[]）——为后期「多数据表联合」预留（这是产品的硬要求）；
 * - 三层归属：文档 ⊃ 数据表 ⊃（字段 / 记录 / 视图）；视图只是配置投影，不存数据；
 * - v1 字段 7 种：文本(主字段) / 数字 / 单选 / 多选 / 日期 / 图片和附件 / 关联(占位)；
 * - 字段类型用**开放字符串**（未知类型只读展示、不清空），以后加类型不需要 bump 格式版本；
 * - 值按 fieldId 存（不按列序）；附件字段存 filename，直接复用 assets/{noteId}/{filename} 资产管线。
 *
 * 边界：本文件属 src/core（禁平台/第三方依赖），故不 import 任何 UI/Electron 模块；只依赖同层 core。
 */
import { extOf, isAssetFilename, isImageExtension } from "./assetNaming.js";

export const BITABLE_DOC_KIND = "bitable" as const;
export const BITABLE_DOC_VERSION = 1 as const;

/** v1 实现的字段类型（开放字符串：读到未知 type 只读展示、不清空）。 */
export type BitableFieldType =
  | "text" | "number" | "select" | "multiSelect" | "date" | "attachment" | "image"
  | "boolean" | "link" | "rating" | "progress" | "createdTime" | "updatedTime"
  | "relation";

/** 字段类型选择器的顺序（v1 只暴露这 7 种）。 */
export const BITABLE_FIELD_TYPES: readonly BitableFieldType[] = [
  "text",
  "number",
  "select",
  "multiSelect",
  "date",
  "attachment",
  "image",
  "boolean",
  "link",
  "rating",
  "progress",
  "createdTime",
  "updatedTime",
  "relation",
] as const;

export const BITABLE_FIELD_TYPE_LABEL: Record<BitableFieldType, string> = {
  text: "文本",
  number: "数字",
  select: "单选",
  multiSelect: "多选",
  date: "日期",
  attachment: "附件",
  image: "图片",
  boolean: "布尔值",
  link: "链接",
  rating: "评分",
  progress: "进度",
  createdTime: "创建时间",
  updatedTime: "修改时间",
  relation: "关联",
};

/** 单选/多选选项。 */
export interface BitableFieldOption {
  id: string;
  name: string;
  color?: string;
}

/** 关联占位：v1 只记录目标表，不联动、单元格不可填值。 */
export interface BitableRelation {
  tableId?: string;
  multiple?: boolean;
}

export interface BitableField {
  id: string;
  name: string;
  /** 开放字符串（可能是不认识的类型）；用 isKnownFieldType 判断。 */
  type: string;
  options?: BitableFieldOption[];
  required?: boolean;
  defaultValue?: unknown;
  /** 日期字段专用：新建记录时自动填「记录创建时间」，而不是写死的 defaultValue
   *  （对齐云端「添加新记录的创建时间」）。 */
  dateAutoFill?: boolean;
  relation?: BitableRelation;
  /** 进度字段专用：进度条颜色（调色板 hex；缺省走主题强调色）。 */
  progressColor?: string;
  /** 表格视图默认列宽（视图可覆盖；v1 直接写字段上）。 */
  width?: number;
  [key: string]: unknown;
}

export interface BitableRecord {
  id: string;
  /** 按 fieldId 存值；加字段/改字段顺序不动已有记录。 */
  values: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * 已知视图类型（**开放集合**，模型里 `BitableView.type` 是 string）。
 * 看板用 kanban 不用 board：`kind="board"` 和 `src/features/board/` 已经是 Drawnix 画板文档，
 * 撞名会在路由/存储/配置三处产生歧义（用户 260928 要求命名更具辨识度）。
 * 以后加视图类型只往这里加一项，**不 bump 格式版本**；旧版本读到未知 type 原样保留、按表格回退。
 */
export type BitableViewType = "grid" | "form" | "kanban" | "gallery" | "calendar";

/** 新建视图菜单的类型顺序（= 正文 JSON 里 type 的已知取值）。 */
export const BITABLE_VIEW_TYPES: readonly BitableViewType[] = ["grid", "form", "kanban", "gallery", "calendar"] as const;

export const BITABLE_VIEW_TYPE_LABEL: Record<BitableViewType, string> = {
  grid: "表格视图",
  form: "表单视图",
  kanban: "看板视图",
  gallery: "画册视图",
  calendar: "日历视图",
};

/**
 * **已实现正文渲染**的视图类型（与「认识」分开）：
 * 未实现的已知类型 / 未知类型都走 BitableViewFallback 安全回退（表格继续渲染、数据不动）。
 * 新增一个视图实现后，把它加到这里 + 在 BitableEditor 的视图分派里加一个分支。
 */
export const BITABLE_IMPLEMENTED_VIEW_TYPES: readonly string[] = ["grid", "form", "kanban", "gallery", "calendar"];

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

/** 新建视图的默认名（与新建菜单文案同源）。 */
export function defaultViewName(type: string): string {
  return isKnownViewType(type) ? BITABLE_VIEW_TYPE_LABEL[type] : "视图";
}

export type BitableFilterOperator =
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "isEmpty"
  | "isNotEmpty"
  | "gt"
  | "lt"
  | "gte"
  | "lte";

export interface BitableFilterRule {
  fieldId: string;
  operator: BitableFilterOperator;
  value?: string;
}

export interface BitableSortRule {
  fieldId: string;
  desc?: boolean;
  /** T04 语义排序：单选/多选按**选项顺序**排（desc 只决定正逆）；缺省 = 按展示值字典序（原有行为）。 */
  mode?: "optionOrder";
}

/** 排序方式（UI 单一入口；asc/desc = 原有字典序，optionOrder/optionReverse = 选项语义序）。 */
export type BitableSortMode = "asc" | "desc" | "optionOrder" | "optionReverse";

export const BITABLE_SORT_MODE_LABEL: Record<BitableSortMode, string> = {
  asc: "升序", desc: "降序", optionOrder: "选项顺序", optionReverse: "选项逆序",
};

/** 该字段可选的排序方式：单选/多选多给选项语义序（T04）。 */
export function sortModesForField(field: BitableField): BitableSortMode[] {
  return field.type === "select" || field.type === "multiSelect" ? ["asc", "desc", "optionOrder", "optionReverse"] : ["asc", "desc"];
}

/** 排序方式显示文案：日期字段用日期语义（早→晚 / 晚→早），口径不变。 */
export function sortModeLabel(field: BitableField, mode: BitableSortMode): string {
  if (field.type === "date" && (mode === "asc" || mode === "desc")) return mode === "desc" ? "晚→早" : "早→晚";
  return BITABLE_SORT_MODE_LABEL[mode];
}

/** 分组规则（云端为单级；模型留数组以便后续多级）。 */
export interface BitableGroupRule {
  fieldId: string;
  desc?: boolean;
}

/** 行高：预设档位或自定义像素。 */
export type BitableRowHeight = "low" | "medium" | "high" | "xhigh" | number;

export interface BitableView {
  id: string;
  name: string;
  /** **开放字符串**：新版本写入的未知类型在本版本里必须原样保留（只回退显示，不清空、不降级成 grid）。 */
  type: string;
  filters?: BitableFilterRule[];
  sorts?: BitableSortRule[];
  /** 分组（云端单级；UI 只用第 0 条）。 */
  groups?: BitableGroupRule[];
  /** 列级统计（视图级：fieldId → 统计类型；缺省 = 该列不统计）。 */
  columnStats?: Record<string, string>;
  /** 高亮重复值的列（视图级；列菜单「高亮重复值」）。 */
  highlightDuplicateFieldIds?: string[];
  /** 列文字颜色（视图级：fieldId → 颜色值）。 */
  columnTextColors?: Record<string, string>;
  rowHeight?: BitableRowHeight;
  fieldOrder?: string[];
  hiddenFieldIds?: string[];
  /**
   * form 视图专有：进表单的字段（**顺序即表单题目顺序**）。
   * 未配置（undefined / 空数组）= 表单尚未建好 ⇒ UI 默认进「编辑表单」；配置过则默认进「预览表单」。
   */
  formFieldIds?: string[];
  /** form 视图专有：逐字段描述（必填取字段自身的 required）。 */
  formDescriptions?: Record<string, string>;
  /** form 视图专有：表单标题（缺省回落视图名）。 */
  formTitle?: string;
  /** form 视图专有：表单描述（预览里显示的说明）。 */
  formDescription?: string;
  /** kanban 视图专有：分组用的**单选**字段 id（选项即分栏）。 */
  kanbanGroupFieldId?: string;
  /** kanban 视图专有：卡片上显示的字段；缺省 = 视图列顺序里排除主字段与分组字段的全部。 */
  kanbanFieldIds?: string[];
  /** kanban 视图专有：卡片是否显示字段名（缺省 true）。 */
  kanbanShowFieldNames?: boolean;
  /** gallery 视图专有：封面用的附件字段（缺省 = 无封面）。 */
  galleryCoverFieldId?: string;
  /** gallery 视图专有：常规 / 紧凑（缺省 regular）。 */
  gallerySize?: "regular" | "compact";
  /** gallery 视图专有：封面裁剪 cover / 适应 contain（缺省 cover）。 */
  galleryFit?: "cover" | "contain";
  /** gallery 视图专有：卡片是否显示字段名（缺省 true）。 */
  galleryShowFieldNames?: boolean;
  /** gallery 视图专有：卡片上显示的字段；缺省 = 视图列顺序里排除主字段与封面字段的全部。 */
  galleryFieldIds?: string[];
  /** calendar 视图专有：开始日期字段（缺省 = 未配置，日历给配置提示）。 */
  calendarStartFieldId?: string;
  /** calendar 视图专有：结束日期字段（可选；为空 = 单日日程）。 */
  calendarEndFieldId?: string;
  /** calendar 视图专有：标题字段（缺省 = 主字段）。 */
  calendarTitleFieldId?: string;
  /** calendar 视图专有：颜色字段（第一版仅单选）。 */
  calendarColorFieldId?: string;
  [key: string]: unknown;
}

export interface BitableTable {
  id: string;
  name: string;
  /** 顺序 = 列顺序；fields[0] = 主字段（记录标题）。 */
  fields: BitableField[];
  records: BitableRecord[];
  views: BitableView[];
  activeViewId: string;
  [key: string]: unknown;
}

export interface BitableDoc {
  kind: typeof BITABLE_DOC_KIND;
  version: typeof BITABLE_DOC_VERSION;
  /** 左侧数据表列表的顺序 = tables 顺序。 */
  tables: BitableTable[];
  activeTableId: string;
}

// ---- id / 时间 ----

/** 兼容 Web/Node 的 UUID（与 syncEngine 同口径；src/core 禁 node: 导入）。 */
function randomUUID(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 生成带前缀的内部 id（表/字段/选项/记录/视图）。 */
export function newBitableId(prefix: string): string {
  return prefix + randomUUID().replace(/-/g, "").slice(0, 12);
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 数值类字段（排序/筛选/统计按数值口径走）：数字 + 评分 + 进度。 */
export function isNumericFieldType(type: string): boolean {
  return type === "number" || type === "rating" || type === "progress";
}

/** 系统时间字段（只读，值取记录时间戳，不写 values）：创建时间 / 修改时间。 */
export function isSystemTimeField(type: string): boolean {
  return type === "createdTime" || type === "updatedTime";
}

/** 评分固定 5 星；进度固定 0–100。 */
export const BITABLE_RATING_MAX = 5;
export const BITABLE_PROGRESS_MAX = 100;

export function isKnownFieldType(type: string): type is BitableFieldType {
  return (BITABLE_FIELD_TYPES as readonly string[]).includes(type);
}

// ---- 工厂 ----

/** 选项调色板（柔和色，对齐云端；存 hex）。默认新建选项自动取其中一个色。 */
export const BITABLE_OPTION_PALETTE = [
  "#d3f0df", "#fdf3c7", "#d6e6fb", "#f7d9e3", "#eadcf7", "#fde4d3",
  "#cdeef0", "#e6e0f8", "#f2e6d8", "#d9f0e2", "#e3f0c8", "#f8d6cf",
  "#d5e8f4", "#efe0f0", "#e8f3d6", "#f6e2c9", "#d9e2f5", "#f0d9d9",
] as const;

/** 兼容别名（旧命名色键与 hex 通用；新代码用 BITABLE_OPTION_PALETTE）。 */
export const BITABLE_OPTION_COLORS = BITABLE_OPTION_PALETTE;

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

/** 选项 chip 动态样式（背景=选项色，文字用深中性色）。 */
export function optionChipStyle(color: string | undefined): { backgroundColor?: string; color?: string } {
  const hex = optionColorHex(color);
  return hex ? { backgroundColor: hex, color: "#1f1f1f" } : {};
}

/** 新建选项时按调色板轮转取色（可显式传 colors 覆盖）。 */
export function createBitableFieldOptions(names: string[], colors?: Array<string | undefined>): BitableFieldOption[] {
  return names.map((name, index) => ({
    id: newBitableId("opt"),
    name,
    color: colors?.[index] ?? BITABLE_OPTION_PALETTE[index % BITABLE_OPTION_PALETTE.length],
  }));
}

export function createBitableField(type: BitableFieldType, name?: string, id = newBitableId("fld")): BitableField {
  const field: BitableField = { id, name: name ?? BITABLE_FIELD_TYPE_LABEL[type], type };
  if (type === "select" || type === "multiSelect") field.options = [];
  if (type === "relation") field.relation = {};
  return field;
}

export function createBitableView(type: BitableViewType, name?: string, id = newBitableId("vew")): BitableView {
  const view: BitableView = { id, name: name ?? defaultViewName(type), type };
  if (type === "grid") view.rowHeight = "low";
  return view;
}

export function createBitableRecord(id = newBitableId("rec")): BitableRecord {
  const ts = nowIso();
  return { id, values: {}, createdAt: ts, updatedAt: ts };
}

export function createDefaultBitableTable(name = "数据表 1", id = newBitableId("tbl")): BitableTable {
  const primary = createBitableField("text", "文本");
  const status = createBitableField("select", "单选");
  status.options = createBitableFieldOptions(["待开始", "进行中", "已完成"], ["#d3f0df", "#fdf3c7", "#d6e6fb"]);
  const date = createBitableField("date", "日期");
  const grid = createBitableView("grid", "表格视图");
  return { id, name, fields: [primary, status, date], records: [], views: [grid], activeViewId: grid.id };
}

/** 新建多维表文档的正文（1 张默认数据表；随后由编辑器保存覆盖）。 */
export function emptyBitableBody(): string {
  const table = createDefaultBitableTable();
  return bitablesToBody([table], table.id);
}

// ---- 序列化 / 解析 ----

/** tables + activeTableId → 正文 JSON（紧凑、不 pretty-print）。 */
export function bitablesToBody(tables: BitableTable[], activeTableId?: string): string {
  const doc: BitableDoc = {
    kind: BITABLE_DOC_KIND,
    version: BITABLE_DOC_VERSION,
    tables,
    activeTableId: activeTableId && tables.some((t) => t.id === activeTableId) ? activeTableId : tables[0]?.id ?? "",
  };
  return JSON.stringify(doc);
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((v): v is string => typeof v === "string");
}

function normalizeField(raw: unknown): BitableField | null {
  if (!raw || typeof raw !== "object") return null;
  const field = raw as Partial<BitableField>;
  if (typeof field.id !== "string" || typeof field.name !== "string" || typeof field.type !== "string") return null;
  const next: BitableField = { ...(raw as BitableField), id: field.id, name: field.name, type: field.type };
  if (Array.isArray(field.options)) {
    next.options = (field.options as unknown[])
      .filter((o): o is BitableFieldOption => !!o && typeof o === "object" && typeof (o as BitableFieldOption).id === "string" && typeof (o as BitableFieldOption).name === "string")
      .map((o) => ({ ...o }));
  }
  return next;
}

function normalizeRecord(raw: unknown): BitableRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Partial<BitableRecord>;
  if (typeof rec.id !== "string") return null;
  const ts = typeof rec.createdAt === "string" ? rec.createdAt : nowIso();
  return {
    ...(raw as BitableRecord),
    id: rec.id,
    values: rec.values && typeof rec.values === "object" ? { ...rec.values } : {},
    createdAt: ts,
    updatedAt: typeof rec.updatedAt === "string" ? rec.updatedAt : ts,
  };
}

function normalizeView(raw: unknown): BitableView | null {
  if (!raw || typeof raw !== "object") return null;
  const view = raw as Partial<BitableView>;
  if (typeof view.id !== "string" || typeof view.name !== "string") return null;
  // 未知 type 原样保留：把 kanban/gallery/calendar 降级成 grid，等于旧版本打开一次就静默改写正文。
  // 只有真正缺 type 的脏数据才回落到 grid。
  const type = typeof view.type === "string" && view.type ? view.type : "grid";
  const next: BitableView = { ...(raw as BitableView), id: view.id, name: view.name, type };
  const fieldOrder = asStringArray(view.fieldOrder);
  if (fieldOrder) next.fieldOrder = fieldOrder; else delete next.fieldOrder;
  const hidden = asStringArray(view.hiddenFieldIds);
  if (hidden) next.hiddenFieldIds = hidden; else delete next.hiddenFieldIds;
  const formFields = asStringArray(view.formFieldIds);
  if (formFields) next.formFieldIds = formFields; else delete next.formFieldIds;
  const kanbanFields = asStringArray(view.kanbanFieldIds);
  if (kanbanFields) next.kanbanFieldIds = kanbanFields; else delete next.kanbanFieldIds;
  const galleryFields = asStringArray(view.galleryFieldIds);
  if (galleryFields) next.galleryFieldIds = galleryFields; else delete next.galleryFieldIds;
  if (typeof view.formTitle !== "string") delete next.formTitle;
  if (typeof view.formDescription !== "string") delete next.formDescription;
  if (view.gallerySize !== "regular" && view.gallerySize !== "compact") delete next.gallerySize;
  if (view.galleryFit !== "cover" && view.galleryFit !== "contain") delete next.galleryFit;
  if (!Array.isArray(view.filters)) delete next.filters;
  if (!Array.isArray(view.sorts)) delete next.sorts;
  if (!Array.isArray(view.groups)) delete next.groups;
  if (!Array.isArray(view.highlightDuplicateFieldIds)) delete next.highlightDuplicateFieldIds;
  if (!view.columnStats || typeof view.columnStats !== "object") delete next.columnStats;
  if (!view.columnTextColors || typeof view.columnTextColors !== "object") delete next.columnTextColors;
  return next;
}

function normalizeTable(raw: unknown): BitableTable | null {
  if (!raw || typeof raw !== "object") return null;
  const table = raw as Partial<BitableTable>;
  if (typeof table.id !== "string") return null;
  const fields = Array.isArray(table.fields) ? table.fields.map(normalizeField).filter((f): f is BitableField => !!f) : [];
  if (fields.length === 0) return null;
  const records = Array.isArray(table.records) ? table.records.map(normalizeRecord).filter((r): r is BitableRecord => !!r) : [];
  const views = Array.isArray(table.views) ? table.views.map(normalizeView).filter((v): v is BitableView => !!v) : [];
  if (views.length === 0) views.push(createBitableView("grid", "表格视图"));
  const activeViewId = typeof table.activeViewId === "string" && views.some((v) => v.id === table.activeViewId) ? table.activeViewId : views[0].id;
  return {
    ...(raw as BitableTable),
    id: table.id,
    name: typeof table.name === "string" && table.name ? table.name : "数据表",
    fields,
    records,
    views,
    activeViewId,
  };
}

/** 解析多维表正文；非法/空/版本不符返回 null（调用方按「空表」处理，不抛错）。 */
export function parseBitableBody(content: string | null | undefined): BitableDoc | null {
  if (!content) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const doc = parsed as Partial<BitableDoc>;
  if (doc.kind !== BITABLE_DOC_KIND || doc.version !== BITABLE_DOC_VERSION || !Array.isArray(doc.tables)) return null;
  const tables = doc.tables.map(normalizeTable).filter((t): t is BitableTable => !!t);
  if (tables.length === 0) return null;
  const activeTableId = typeof doc.activeTableId === "string" && tables.some((t) => t.id === doc.activeTableId) ? doc.activeTableId : tables[0].id;
  return { kind: BITABLE_DOC_KIND, version: BITABLE_DOC_VERSION, tables, activeTableId };
}

// ---- 列级统计（T01；纯函数，表格底部一行用） ----

/**
 * 列统计类型：通用（所有字段）+ 数字/日期专属。count = 记录总数（只看当前视图筛选后的集合）。
 * 视图只存**配置**（view.columnStats），值每次现算，绝不写回记录。
 */
export type BitableStatType =
  | "count" | "filled" | "empty" | "unique" | "filledPct" | "emptyPct"
  | "sum" | "avg" | "min" | "max"
  | "earliest" | "latest" | "range";

export const BITABLE_STAT_LABEL: Record<BitableStatType, string> = {
  count: "记录总数", filled: "已填写", empty: "未填写", unique: "唯一数",
  filledPct: "已填写占比", emptyPct: "未填写占比",
  sum: "求和", avg: "平均", min: "最小", max: "最大",
  earliest: "最早", latest: "最晚", range: "时间范围",
};

const GENERIC_STATS: readonly BitableStatType[] = ["count", "filled", "empty", "unique", "filledPct", "emptyPct"];

/** 某字段可选的统计类型（列菜单用）：通用 + 数字/日期专属。 */
export function statsForField(field: BitableField): BitableStatType[] {
  const out = [...GENERIC_STATS];
  if (isNumericFieldType(field.type)) out.push("sum", "avg", "min", "max");
  if (field.type === "date") out.push("earliest", "latest", "range");
  return out;
}

/** 视图中配置的统计类型（未配置 / 不认识 → undefined = 不统计）。 */
export function statForField(view: BitableView | undefined, fieldId: string): BitableStatType | undefined {
  const stat = view?.columnStats?.[fieldId];
  return typeof stat === "string" && stat in BITABLE_STAT_LABEL ? (stat as BitableStatType) : undefined;
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
export function computeColumnStat(field: BitableField, records: BitableRecord[], stat: BitableStatType): string {
  const total = records.length;
  if (stat === "count") return String(total);
  const texts = records.map((record) => bitableDisplayValue(field, record.values[field.id]).trim());
  const filledCount = texts.filter((text) => text !== "").length;
  if (stat === "filled") return String(filledCount);
  if (stat === "empty") return String(total - filledCount);
  if (stat === "unique") return String(new Set(texts.filter((text) => text !== "")).size);
  if (stat === "filledPct") return statPct(filledCount, total);
  if (stat === "emptyPct") return statPct(total - filledCount, total);
  if (isNumericFieldType(field.type)) {
    const nums = records
      .map((record) => {
        const text = bitableDisplayValue(field, record.values[field.id]).trim();
        if (text === "") return Number.NaN;   // 空格子不能当 0 参与求和/平均
        const raw = record.values[field.id];
        return typeof raw === "number" ? raw : Number(text);
      })
      .filter((n) => Number.isFinite(n));
    if (nums.length === 0) return "—";
    if (stat === "sum") return formatStatNumber(nums.reduce((a, b) => a + b, 0));
    if (stat === "avg") return formatStatNumber(nums.reduce((a, b) => a + b, 0) / nums.length);
    if (stat === "min") return formatStatNumber(Math.min(...nums));
    if (stat === "max") return formatStatNumber(Math.max(...nums));
    return "—";
  }
  if (field.type === "date") {
    const days = records
      .map((record) => dateValueOf(record.values[field.id]))
      .filter((day) => day !== "")
      .sort();
    if (days.length === 0) return "—";
    if (stat === "earliest") return days[0];
    if (stat === "latest") return days[days.length - 1];
    if (stat === "range") return String(localDateDiff(days[days.length - 1], days[0]) + 1) + " 天";
  }
  return "—";
}

// ---- 值展示 / 搜索 ----

/**
 * 附件单元格的值形状：`{ file, name, size }[]`（对齐 Lake 文件卡的 src/name/size）。
 * - `file` = **磁盘名**：`note-assets/{noteId}/{file}` 的真实文件名。上传落盘时名字是生成的
 *   `{13位时间戳}_{8位hex}.{扩展名}`，只有它能定位/打开文件，也是同步声明与 GC 保护的依据。
 * - `name` = **展示名**：用户上传时的原始文件名（"鞠磊8.27音频.mp3"），只在界面展示。
 * - `size` = **字节数**：与 Lake 卡片 data.size 同口径，用于预览标题展示。
 * 两者必须分开存：`uploadResource` 返回的 `filename` 是展示名、磁盘名只在 `url` 末段，
 * 早前把展示名当路径写进单元格 ⇒ 除图片外全部 404（打不开/播放器灰）。
 */
export interface BitableAttachment {
  file: string;
  name: string;
  size: number;
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

function optionName(field: BitableField, value: unknown): string {
  const options = field.options ?? [];
  const byId = options.find((o) => o.id === value);
  if (byId) return byId.name;
  const byName = options.find((o) => o.name === value);
  if (byName) return byName.name;
  return typeof value === "string" ? value : "";
}

/** 字段值 → 人类可读文本（列表/搜索/记录标题统一口径）。 */
export function bitableDisplayValue(field: BitableField, value: unknown): string {
  if (value == null) return "";
  switch (field.type) {
    case "select":
      return optionName(field, value);
    case "multiSelect":
      return Array.isArray(value) ? value.map((v) => optionName(field, v)).filter(Boolean).join(", ") : "";
    case "attachment":
    case "image":
      return bitableAttachments(value).map((a) => a.name).join(", ");
    case "relation":
      return "";
    case "number":
    case "rating":
    case "progress":
      return String(value);
    case "boolean":
      return value === true ? "是" : value === false ? "否" : "";
    case "link":
      return typeof value === "string" ? value : "";
    case "createdTime":
    case "updatedTime":
      // 值由 bitableFieldText(record, field) 注入记录时间戳；直接给 ISO 也兜底格式化
      return typeof value === "string" ? localDateTimeString(value) : "";
    default:
      return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  }
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
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/** ISO 时间戳 → 本地 `YYYY-MM-DD HH:mm`（系统时间字段展示口径，绝不走 UTC）。 */
export function localDateTimeString(at: string | number | Date): string {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  return localDateString(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

/** 字段取值（含系统字段）：创建/修改时间读记录时间戳，其余读 values。 */
export function bitableFieldValue(record: BitableRecord, field: BitableField): unknown {
  if (field.type === "createdTime") return record.createdAt;
  if (field.type === "updatedTime") return record.updatedAt;
  return record.values[field.id];
}

/** 字段展示文本（记录级，含系统时间）——卡片/单元格/搜索/标题统一走它。 */
export function bitableFieldText(record: BitableRecord, field: BitableField): string {
  return bitableDisplayValue(field, bitableFieldValue(record, field));
}

/** 记录标题 = 主字段（fields[0]）的展示值；未填 → 「未命名记录」（对齐云端）。 */
export function bitableRecordTitle(table: BitableTable, record: BitableRecord): string {
  const primary = table.fields[0];
  if (!primary) return "未命名记录";
  return bitableFieldText(record, primary) || "未命名记录";
}

/**
 * 多维表正文 → 供全文搜索的纯文本（表名 + 每条记录各字段展示值）。
 * 与 Lake 的 lakeHtmlToPlain 职责对应：非文档类型的正文不能喂给 HTML 解析器。
 */
export function bitableToSearchText(content: string | null | undefined, maxChars = 20000): string {
  const doc = parseBitableBody(content);
  if (!doc) return "";
  const parts: string[] = [];
  const size = () => parts.join("\n").length;
  for (const table of doc.tables) {
    parts.push("[" + table.name + "]");
    for (const record of table.records) {
      const cells: string[] = [];
      for (const field of table.fields) {
        const text = bitableFieldText(record, field);
        if (text) cells.push(text);
      }
      if (cells.length > 0) parts.push(cells.join("\t"));
      if (size() > maxChars) break;
    }
    if (size() > maxChars) break;
  }
  const text = parts.join("\n");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

// ---- 看板视图求值（V02；纯函数，UI 与测试共用） ----

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

export interface BitableKanbanColumn {
  /** 稳定列 key：option id，未分组为 ""。 */
  key: string;
  label: string;
  /** 选项色（未分组无）。 */
  color?: string;
  /** null = 未分组列；把卡片拖到这里 = 清空该单选字段的值。 */
  optionId: string | null;
  records: BitableRecord[];
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

// ---- 画册视图求值（V03；纯函数，UI 与测试共用） ----

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

// ---- 日历视图求值（V04；纯函数，**全部走本地日期语义**，绝不经过 UTC） ----

/** 日历可用的日期字段。 */
export function bitableDateFields(table: BitableTable): BitableField[] {
  return table.fields.filter((f) => f.type === "date");
}

/** 配置 id → 字段（可选限定类型）；空/不存在/类型不符 → undefined。 */
function fieldById(table: BitableTable, id: unknown, type?: string): BitableField | undefined {
  if (typeof id !== "string" || !id) return undefined;
  const field = table.fields.find((f) => f.id === id);
  if (!field) return undefined;
  return !type || field.type === type ? field : undefined;
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

/** 日期格的值域是 `YYYY-MM-DD`；兼容历史 ISO 值（按**本地**时区折算），非法 → ""。 */
function dateValueOf(value: unknown): string {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? "" : localDateString(parsed);
}

export interface BitableCalendarEvent {
  recordId: string;
  title: string;
  /** 本地日期 `YYYY-MM-DD`（含头含尾，单日 = start === end）。 */
  start: string;
  end: string;
  /** 颜色字段（单选）解析出的选项色。 */
  color?: string;
  optionId?: string;
}

/** 记录 → 日程投影：没有开始日期 / 日期非法的记录不上日历（不猜、不报错）。 */
export function calendarEvents(table: BitableTable, view: BitableView | undefined, records: BitableRecord[]): BitableCalendarEvent[] {
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
      title: (titleField ? bitableDisplayValue(titleField, record.values[titleField.id]) : "") || "未命名记录",
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

/** 两个本地日期的整天差（to - from）。 */
export function localDateDiff(to: string, from: string): number {
  const [ty, tm, td] = to.split("-").map(Number);
  const [fy, fm, fd] = from.split("-").map(Number);
  if (![ty, tm, td, fy, fm, fd].every((n) => Number.isFinite(n))) return 0;
  return Math.round((new Date(ty, tm - 1, td).getTime() - new Date(fy, fm - 1, fd).getTime()) / 86400000);
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

// ---- 视图求值（纯函数，UI 与测试共用） ----

/** 未隐藏字段按 fieldOrder 排好序（fieldOrder 未列出的字段按原始顺序追加）。 */
export function orderedTableFields(table: BitableTable, view: BitableView | undefined): BitableField[] {
  const hidden = new Set(view?.hiddenFieldIds ?? []);
  const visible = table.fields.filter((f) => !hidden.has(f.id));
  const order = view?.fieldOrder;
  if (!order || order.length === 0) return visible;
  const rank = new Map(order.map((id, index) => [id, index] as const));
  return [...visible].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

/** 排序比较（含 T04 语义排序）：选项语义序下，空值/指向已删选项的值**恒排最后**（与分组口径一致）。 */
function compareSortValues(field: BitableField, a: unknown, b: unknown, rule: BitableSortRule): number {
  if (rule.mode === "optionOrder" && (field.type === "select" || field.type === "multiSelect")) {
    const indexOf = (value: unknown): number => {
      const first = field.type === "multiSelect" ? (Array.isArray(value) ? value[0] : undefined) : value;
      const index = (field.options ?? []).findIndex((option) => option.id === first);
      return index < 0 ? Number.MAX_SAFE_INTEGER : index;
    };
    const ia = indexOf(a);
    const ib = indexOf(b);
    if (ia === Number.MAX_SAFE_INTEGER || ib === Number.MAX_SAFE_INTEGER) {
      if (ia === ib) return 0;
      return ia === Number.MAX_SAFE_INTEGER ? 1 : -1;
    }
    const cmp = ia - ib;
    return rule.desc ? -cmp : cmp;
  }
  const cmp = compareValues(field, a, b);
  return rule.desc ? -cmp : cmp;
}

function compareValues(field: BitableField, a: unknown, b: unknown): number {
  const sa = bitableDisplayValue(field, a);
  const sb = bitableDisplayValue(field, b);
  if (isNumericFieldType(field.type)) {
    const na = typeof a === "number" ? a : Number(sa);
    const nb = typeof b === "number" ? b : Number(sb);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  }
  if (field.type === "date") return sa < sb ? -1 : sa > sb ? 1 : 0;
  return sa.localeCompare(sb, "zh-Hans-CN");
}

export function evaluateFilter(field: BitableField, value: unknown, rule: BitableFilterRule): boolean {
  const display = bitableDisplayValue(field, value);
  const target = rule.value ?? "";
  switch (rule.operator) {
    case "isEmpty":
      return display.trim() === "";
    case "isNotEmpty":
      return display.trim() !== "";
    case "contains":
      return display.includes(target);
    case "notContains":
      return !display.includes(target);
    case "equals":
      return display === target;
    case "notEquals":
      return display !== target;
    case "gt":
    case "lt":
    case "gte":
    case "lte": {
      const a = Number(display);
      const b = Number(target);
      const useNumber = Number.isFinite(a) && Number.isFinite(b);
      const left: string | number = useNumber ? a : display;
      const right: string | number = useNumber ? b : target;
      if (rule.operator === "gt") return left > right;
      if (rule.operator === "lt") return left < right;
      if (rule.operator === "gte") return left >= right;
      return left <= right;
    }
    default:
      return true;
  }
}

/** 某个字段类型可用的筛选操作符（v1 全类型共用一套，按类型给主要项）。 */
export function filterOperatorsFor(field: BitableField): BitableFilterOperator[] {
  if (isNumericFieldType(field.type) || field.type === "date") return ["equals", "notEquals", "gt", "lt", "gte", "lte", "isEmpty", "isNotEmpty"];
  if (field.type === "boolean") return ["equals", "notEquals", "isEmpty", "isNotEmpty"];
  return ["contains", "notContains", "equals", "notEquals", "isEmpty", "isNotEmpty"];
}

export const BITABLE_FILTER_OPERATOR_LABEL: Record<BitableFilterOperator, string> = {
  contains: "包含",
  notContains: "不包含",
  equals: "等于",
  notEquals: "不等于",
  isEmpty: "为空",
  isNotEmpty: "不为空",
  gt: "大于",
  lt: "小于",
  gte: "大于等于",
  lte: "小于等于",
};

/** 对记录套用视图的筛选 + 排序（返回新数组，不改原值）。 */
export function applyViewToRecords(table: BitableTable, view: BitableView | undefined): BitableRecord[] {
  const fieldById = new Map(table.fields.map((f) => [f.id, f] as const));
  let records = [...table.records];
  const filters = view?.filters ?? [];
  if (filters.length > 0) {
    records = records.filter((record) =>
      filters.every((rule) => {
        const field = fieldById.get(rule.fieldId);
        if (!field) return true;
        return evaluateFilter(field, record.values[field.id], rule);
      }),
    );
  }
  const sorts = view?.sorts ?? [];
  if (sorts.length > 0) {
    records = records
      .map((record, index) => ({ record, index }))
      .sort((a, b) => {
        for (const rule of sorts) {
          const field = fieldById.get(rule.fieldId);
          if (!field) continue;
          const cmp = compareSortValues(field, a.record.values[field.id], b.record.values[field.id], rule);
          if (cmp !== 0) return cmp;
        }
        return a.index - b.index;
      })
      .map((x) => x.record);
  }
  return records;
}

/** 分组用的组键：单选取选项名、多选取选项名拼接、其余取展示值；空 = ""。 */
function groupKeyOf(field: BitableField, value: unknown): string {
  if (field.type === "select") {
    const opt = (field.options ?? []).find((o) => o.id === value);
    return opt ? opt.name : "";
  }
  if (field.type === "multiSelect") {
    const ids = Array.isArray(value) ? value : [];
    return ids
      .map((id) => (field.options ?? []).find((o) => o.id === id)?.name)
      .filter((name): name is string => !!name)
      .join("、");
  }
  return bitableDisplayValue(field, value).trim();
}

/** 分组最多允许的级数（T03；对齐云端三级）。 */
export const BITABLE_MAX_GROUPS = 3;

export interface BitableGroupNode {
  /** 折叠态用的稳定 key（含层级前缀 fieldId:值 逐级拼接）。 */
  key: string;
  label: string;
  /** 0 起：第几级分组。 */
  level: number;
  /** 该节点（含子级）的记录条数。 */
  count: number;
  /** 归属本组的记录（含被下级再细分的那些；叶子节点直接渲染它们）。 */
  records: BitableRecord[];
  children: BitableGroupNode[];
}

/**
 * **多级分组**（T03）：按 rules 逐级细分返回树。
 * - 组键/标签口径与单级分组完全一致（单选取选项名、多选取选项名拼接、其余取展示值；空 = "(空)"）。
 * - 组内保持传入顺序（= 筛选 + 排序后的顺序）；每级都按该级字段排序，空值组恒最后。
 * - 无有效规则（字段被删/为空）→ 返回空数组（调用方按"未分组"拍平，区别于 groupRecords 的单组语义）。
 */
export function groupRecordsTree(table: BitableTable, records: BitableRecord[], rules: BitableGroupRule[] | undefined): BitableGroupNode[] {
  const active = (rules ?? []).filter((rule) => table.fields.some((field) => field.id === rule.fieldId));
  if (active.length === 0) return [];
  const build = (list: BitableRecord[], level: number, prefix: string): BitableGroupNode[] => {
    const rule = active[level];
    const field = table.fields.find((item) => item.id === rule.fieldId)!;
    const buckets = new Map<string, BitableRecord[]>();
    for (const record of list) {
      const key = groupKeyOf(field, record.values[field.id]);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(record); else buckets.set(key, [record]);
    }
    const keys = [...buckets.keys()].sort((a, b) => {
      if ((a === "") !== (b === "")) return a === "" ? 1 : -1;   // 空值组恒最后
      const cmp = compareValues(field, buckets.get(a)![0].values[field.id], buckets.get(b)![0].values[field.id]);
      return rule.desc ? -cmp : cmp;
    });
    return keys.map((key) => {
      const groupRecordsList = buckets.get(key)!;
      const nodeKey = (prefix ? prefix + "/" : "") + rule.fieldId + ":" + key;
      return {
        key: nodeKey,
        label: key || "(空)",
        level,
        count: groupRecordsList.length,
        records: groupRecordsList,
        children: level + 1 < active.length ? build(groupRecordsList, level + 1, nodeKey) : [],
      };
    });
  };
  return build(records, 0, "");
}

/**
 * 按分组规则把记录分组（组内保持传入顺序，组间按组值排序；空值组排最后）。
 * 无规则/字段不存在时返回单个"未分组"组（key/label 为空），调用方可直接拍平。
 */
export function groupRecords(
  table: BitableTable,
  records: BitableRecord[],
  rule: BitableGroupRule | undefined,
): Array<{ key: string; label: string; records: BitableRecord[] }> {
  if (!rule) return [{ key: "", label: "", records }];
  const field = table.fields.find((f) => f.id === rule.fieldId);
  if (!field) return [{ key: "", label: "", records }];
  const groups = new Map<string, BitableRecord[]>();
  for (const record of records) {
    const key = groupKeyOf(field, record.values[field.id]);
    const list = groups.get(key);
    if (list) list.push(record);
    else groups.set(key, [record]);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    if ((a === "") !== (b === "")) return a === "" ? 1 : -1; // 空值组排最后
    const cmp = compareValues(field, groups.get(a)![0].values[field.id], groups.get(b)![0].values[field.id]);
    return rule.desc ? -cmp : cmp;
  });
  return keys.map((key) => ({ key, label: key || "(空)", records: groups.get(key)! }));
}

/** 某列出现次数 > 1 的展示值集合（忽略空值）—— 供「高亮重复值」判定。 */
export function duplicateValues(field: BitableField, records: BitableRecord[]): Set<string> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = bitableDisplayValue(field, record.values[field.id]).trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value));
}
