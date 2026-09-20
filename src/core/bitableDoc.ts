/**
 * 多维表文档（kind = "bitable"）正文格式、序列化与视图求值 —— 桌面/移动端共享的单一事实源。
 *
 * 存储位置：bitables/{noteId}.bitable.json（本地）/ objects/{noteId}-{hash}.lake（S3，内容寻址）。
 * 正文是纯文本 JSON，天然复用「正文对象 + manifest.contentHash」的整条同步/GC/历史/回收站管线。
 *
 * 产品口径见 docs/BITABLE-PRODUCT-SPEC-260919.md（v1）：
 * - 一个文档可含多张数据表（tables[]）——为后期「多数据表联合」预留（这是产品的硬要求）；
 * - 三层归属：文档 ⊃ 数据表 ⊃（字段 / 记录 / 视图）；视图只是配置投影，不存数据；
 * - v1 字段 7 种：文本(主字段) / 数字 / 单选 / 多选 / 日期 / 图片和附件 / 关联(占位)；
 * - 字段类型用**开放字符串**（未知类型只读展示、不清空），以后加类型不需要 bump 格式版本；
 * - 值按 fieldId 存（不按列序）；附件字段存 filename，直接复用 assets/{noteId}/{filename} 资产管线。
 *
 * 边界：本文件属 src/core（禁平台/第三方依赖），故不 import 任何 UI/Electron 模块。
 */

export const BITABLE_DOC_KIND = "bitable" as const;
export const BITABLE_DOC_VERSION = 1 as const;

/** v1 实现的字段类型（开放字符串：读到未知 type 只读展示、不清空）。 */
export type BitableFieldType = "text" | "number" | "select" | "multiSelect" | "date" | "attachment" | "relation";

/** 字段类型选择器的顺序（v1 只暴露这 7 种）。 */
export const BITABLE_FIELD_TYPES: readonly BitableFieldType[] = [
  "text",
  "number",
  "select",
  "multiSelect",
  "date",
  "attachment",
  "relation",
] as const;

export const BITABLE_FIELD_TYPE_LABEL: Record<BitableFieldType, string> = {
  text: "文本",
  number: "数字",
  select: "单选",
  multiSelect: "多选",
  date: "日期",
  attachment: "图片和附件",
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
  relation?: BitableRelation;
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

export type BitableViewType = "grid" | "form";

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
}

/** 行高：预设档位或自定义像素。 */
export type BitableRowHeight = "low" | "medium" | "high" | "xhigh" | number;

export interface BitableView {
  id: string;
  name: string;
  type: BitableViewType;
  filters?: BitableFilterRule[];
  sorts?: BitableSortRule[];
  rowHeight?: BitableRowHeight;
  fieldOrder?: string[];
  hiddenFieldIds?: string[];
  /** form 视图专有：进表单的字段 + 逐字段描述（必填取字段自身的 required）。 */
  formFieldIds?: string[];
  formDescriptions?: Record<string, string>;
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
  const view: BitableView = { id, name: name ?? (type === "form" ? "表单" : "表格视图"), type };
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
  const type: BitableViewType = view.type === "form" ? "form" : "grid";
  const next: BitableView = { ...(raw as BitableView), id: view.id, name: view.name, type };
  const fieldOrder = asStringArray(view.fieldOrder);
  if (fieldOrder) next.fieldOrder = fieldOrder; else delete next.fieldOrder;
  const hidden = asStringArray(view.hiddenFieldIds);
  if (hidden) next.hiddenFieldIds = hidden; else delete next.hiddenFieldIds;
  const formFields = asStringArray(view.formFieldIds);
  if (formFields) next.formFieldIds = formFields; else delete next.formFieldIds;
  if (!Array.isArray(view.filters)) delete next.filters;
  if (!Array.isArray(view.sorts)) delete next.sorts;
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

// ---- 值展示 / 搜索 ----

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
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").join(", ") : "";
    case "relation":
      return "";
    case "number":
      return typeof value === "number" ? String(value) : String(value);
    default:
      return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : "";
  }
}

/**
 * 字段默认值集合（只收集 defaultValue 非空的字段）——新建记录 / 表单预填用。
 * 单选默认值存 option id；值形状与单元格一致。
 */
export function defaultRecordValues(table: BitableTable): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of table.fields) {
    const value = field.defaultValue;
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    values[field.id] = value;
  }
  return values;
}

/** 记录标题 = 主字段（fields[0]）的展示值；未填 → 「未命名记录」（对齐云端）。 */
export function bitableRecordTitle(table: BitableTable, record: BitableRecord): string {
  const primary = table.fields[0];
  if (!primary) return "未命名记录";
  return bitableDisplayValue(primary, record.values[primary.id]) || "未命名记录";
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
        const text = bitableDisplayValue(field, record.values[field.id]);
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

function compareValues(field: BitableField, a: unknown, b: unknown): number {
  const sa = bitableDisplayValue(field, a);
  const sb = bitableDisplayValue(field, b);
  if (field.type === "number") {
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
  if (field.type === "number" || field.type === "date") return ["equals", "notEquals", "gt", "lt", "gte", "lte", "isEmpty", "isNotEmpty"];
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
          const cmp = compareValues(field, a.record.values[field.id], b.record.values[field.id]);
          if (cmp !== 0) return rule.desc ? -cmp : cmp;
        }
        return a.index - b.index;
      })
      .map((x) => x.record);
  }
  return records;
}
