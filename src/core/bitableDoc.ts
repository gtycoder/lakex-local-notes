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
import { contrastTextColor, DEFAULT_LIGHT_COLORS, isHexColor } from "./colorPalette.js";
import type { AiChatMessage, AiContentPart } from "./aiProviders.js";

export const BITABLE_DOC_KIND = "bitable" as const;
export const BITABLE_DOC_VERSION = 1 as const;

/** v1 实现的字段类型（开放字符串：读到未知 type 只读展示、不清空）。 */
export type BitableFieldType =
  | "text" | "number" | "select" | "multiSelect" | "date" | "attachment" | "image"
  | "boolean" | "link" | "rating" | "progress" | "createdTime" | "updatedTime"
  | "relationOneWay" | "relationTwoWay" | "ai" | "markdown";

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
  "relationOneWay",
  "relationTwoWay",
  "ai",
  "markdown",
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
  relationOneWay: "单向关联",
  relationTwoWay: "双向关联",
  ai: "AI 字段",
  markdown: "Markdown",
};

/** 单选/多选选项。 */
export interface BitableFieldOption {
  id: string;
  name: string;
  color?: string;
}

/**
 * 关联字段配置：**同一文档内**不同数据表之间的记录关系。
 * 只保存目标记录 id（不复制目标数据），因此所有解释都必须有目标表上下文（见 BitableDisplayContext）。
 */
export interface BitableRelation {
  /** 目标数据表 id（同一文档内；缺省 = 未配置，界面显示为空）。 */
  tableId?: string;
  /** 是否允许添加多个记录（默认 true；关闭后单元格最多保留一条）。 */
  allowMultiple?: boolean;
  /**
   * **数据范围（260929 用户追加）**：绑定目标表的一个**视图**；缺省 = 从目标表全部记录里选。
   * 只约束「选择器能选到什么」，不改变已有值的展示（已选中的记录即使被视图过滤掉也照常显示）。
   */
  viewId?: string;
  /** 双向关联的对侧字段 id（T02B.3）。 */
  pairedFieldId?: string;
}

/** 新建关联字段的默认配置：允许多个记录（对齐飞书「默认勾选」）。方向由字段类型决定。 */
export const BITABLE_RELATION_DEFAULT: Readonly<BitableRelation> = { allowMultiple: true };

export type BitableRelationFieldType = "relationOneWay" | "relationTwoWay";

/** 是否为关联字段类型（单向/双向共用值模型与展示）。 */
export function isRelationFieldType(type: string): type is BitableRelationFieldType {
  return type === "relationOneWay" || type === "relationTwoWay";
}

/**
 * AI 字段配置（261003 用户定稿：**全项目只做一个 AI 字段类型**）。
 * - `prompt`：自定义命令（**字段变量直接写在命令里**，形如 `{{字段名}}`，可用「插入字段」插入多个）；
 *   生成时每个变量**原位替换**为当前行该字段的展示值，命令原样作为 user message（不再把字段值拼到末尾）。
 * - 结果作为**文本快照**写进 `record.values`；**不自动重跑**，生成 / 重新生成都是手动触发的显式命令。
 * - 字段重命名会**联动改写**同表 AI 命令里的 `{{旧名}}`；字段删除后变量保留（编辑器提示未找到、生成按空处理）。
 */
export interface BitableAiConfig {
  prompt: string;
  /** 把被引用字段里的图片 / PDF 作为内容块一并发送（多模态；缺省关闭）。 */
  includeAttachments?: boolean;
}

/** 是否为 AI 字段类型。 */
export function isAiFieldType(type: string): type is "ai" {
  return type === "ai";
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
  /** AI 字段专用配置（仅 type === "ai" 有意义）。 */
  ai?: BitableAiConfig;
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

/** 筛选条件连接符；一个条件组内统一使用同一个连接符（对齐远端 lake packet）。 */
export type BitableFilterJoin = "and" | "or";

/** 筛选操作符（字段类型对应的子集由 filterOperatorsFor 决定；命名对齐远端 lake）。 */
export type BitableFilterOperator =
  | "equalTo"
  | "notEqualTo"
  | "greaterThan"
  | "greaterThanOrEqualTo"
  | "lessThan"
  | "lessThanOrEqualTo"
  | "isEmpty"
  | "isNotEmpty"
  | "startsWith"
  | "notStartsWith"
  | "endsWith"
  | "notEndsWith"
  | "contains"
  | "notContains"
  | "is"
  | "isNot"
  | "isEmptySelect"
  | "isNotEmptySelect"
  | "isExactly"
  | "hasAnyOf"
  | "hasAllOf"
  | "hasNoneOf";

/** 日期筛选的右侧值：具体日期或远端 lake 支持的动态日期。 */
export type BitableDateFilterMode =
  | "custom"
  | "today"
  | "tomorrow"
  | "yesterday"
  | "thisWeek"
  | "lastWeek"
  | "nextWeek"
  | "lastMonth"
  | "thisMonth"
  | "nextMonth"
  | "thisYear"
  | "last7days"
  | "next7days"
  | "last30days"
  | "next30days";

export type BitableFilterValue = string | string[] | boolean;

export interface BitableFilterRule {
  id?: string;
  fieldId: string;
  operator: BitableFilterOperator;
  value?: BitableFilterValue;
  /** 仅日期类字段使用；缺省按 custom 处理。 */
  valueMode?: BitableDateFilterMode;
}

/** 可递归的筛选分组；根组的连接符存在 BitableView.filterOperator。 */
export interface BitableFilterGroup {
  id?: string;
  operator: BitableFilterJoin;
  filters: BitableFilterNode[];
}

export type BitableFilterNode = BitableFilterRule | BitableFilterGroup;

/** 远端 lake 的分组上限：根组外最多再套 2 层。 */
export const BITABLE_FILTER_MAX_GROUP_DEPTH = 2;

/** 填色模式（对齐钉钉当前四类；语义为展示投影，不写记录值）。 */
export type BitableFillMode = "cell" | "row" | "rowSide" | "column";

export const BITABLE_FILL_MODE_LABEL: Record<BitableFillMode, string> = {
  cell: "单元格",
  row: "整行",
  rowSide: "行侧",
  column: "整列",
};

/** 规则上限与钉钉当前实现一致；超过后 UI 禁止继续追加。 */
export const BITABLE_FILL_MAX_RULES = 40;
/** 「无背景色」的持久哨兵：规则保留条件/顺序，但不参与填色投影。 */
export const BITABLE_FILL_NO_COLOR = "transparent" as const;

/**
 * 一行一色、一行一条件：
 * - cell 的条件字段就是被着色字段（对齐钉钉 formatFieldId = condition.fieldId）；
 * - row / rowSide 只存条件，分别作用于整行背景和行首色条；
 * - column 没有条件，只存目标列。
 */
export type BitableFillRule =
  | { id: string; mode: "cell"; color: string; condition: BitableFilterRule }
  | { id: string; mode: "row"; color: string; condition: BitableFilterRule }
  | { id: string; mode: "rowSide"; color: string; condition: BitableFilterRule }
  | { id: string; mode: "column"; color: string; fieldId: string };

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
  if ((field.type === "date" || isSystemTimeField(field.type)) && (mode === "asc" || mode === "desc")) return mode === "desc" ? "晚→早" : "早→晚";
  return BITABLE_SORT_MODE_LABEL[mode];
}

/** 排序方式 ↔ (mode, desc) 的**单一映射**（UI 只认「排序方式」一个下拉；T04 语义排序）。 */
export function sortModeOf(rule: BitableSortRule): BitableSortMode {
  if (rule.mode === "optionOrder") return rule.desc ? "optionReverse" : "optionOrder";
  return rule.desc ? "desc" : "asc";
}

/** 把「排序方式」写回规则（选项序 = optionOrder + desc 的正逆）。 */
export function applySortMode(rule: BitableSortRule, mode: BitableSortMode): BitableSortRule {
  if (mode === "optionOrder") return { ...rule, mode: "optionOrder", desc: false };
  if (mode === "optionReverse") return { ...rule, mode: "optionOrder", desc: true };
  return { fieldId: rule.fieldId, desc: mode === "desc" };
}

/** 换字段时丢掉该字段不支持的语义排序（只有单选/多选有「选项顺序」）。 */
export function changeSortField(fields: readonly BitableField[], rule: BitableSortRule, fieldId: string): BitableSortRule {
  const field = fields.find((item) => item.id === fieldId);
  const keep = rule.mode === "optionOrder" && (field?.type === "select" || field?.type === "multiSelect");
  return { fieldId, desc: rule.desc, ...(keep ? { mode: "optionOrder" as const } : {}) };
}

/** 分组规则（当前产品只支持一级；持久化仍保留数组形态以避免正文结构 churn）。 */
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
  /** 根筛选组 = 顶层规则/分组的顺序；根连接符见 filterOperator。 */
  filters?: BitableFilterNode[];
  /** 根筛选组的连接符；缺省 and。 */
  filterOperator?: BitableFilterJoin;
  sorts?: BitableSortRule[];
  /** 分组（云端单级；UI 只用第 0 条）。 */
  groups?: BitableGroupRule[];
  /** 列级统计（视图级：fieldId → 统计类型；缺省 = 该列不统计）。 */
  columnStats?: Record<string, string>;
  /** 高亮重复值的列（视图级；列菜单「高亮重复值」）。 */
  highlightDuplicateFieldIds?: string[];
  /** 条件填色（视图级；规则顺序参与钉钉同款候选混色）。 */
  fillRules?: BitableFillRule[];
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

/** 新建选项/进度默认取的浅色档；选择器本身用全量内核实色卡。 */
export const BITABLE_OPTION_PALETTE = DEFAULT_LIGHT_COLORS;

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

/** 选项 chip 动态样式（背景=选项色，文字自动取对比色）。 */
export function optionChipStyle(color: string | undefined): { backgroundColor?: string; color?: string } {
  const hex = optionColorHex(color);
  return hex ? { backgroundColor: hex, color: contrastTextColor(hex) } : {};
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
  if (isRelationFieldType(type)) field.relation = { ...BITABLE_RELATION_DEFAULT };
  if (type === "ai") field.ai = { prompt: "" };
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

/**
 * 新建数据表的**产品默认**（260929 用户口径）：**只有 1 列文本 + 3 行空白记录**。
 * 原先预置的「单选 / 日期」两列已取消——用户不需要猜我们要什么样的表结构，加列由用户自己加。
 * （新建多维表文档时的首张表走同一函数，口径一致。）
 */
export function createDefaultBitableTable(name = "数据表 1", id = newBitableId("tbl")): BitableTable {
  const primary = createBitableField("text", "文本");
  const grid = createBitableView("grid", "表格视图");
  const records = [createBitableRecord(), createBitableRecord(), createBitableRecord()];
  return { id, name, fields: [primary], records, views: [grid], activeViewId: grid.id };
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

const BITABLE_FILTER_OPERATORS = new Set<BitableFilterOperator>([
  "equalTo", "notEqualTo", "greaterThan", "greaterThanOrEqualTo", "lessThan", "lessThanOrEqualTo",
  "isEmpty", "isNotEmpty", "startsWith", "notStartsWith", "endsWith", "notEndsWith", "contains", "notContains",
  "is", "isNot", "isEmptySelect", "isNotEmptySelect", "isExactly", "hasAnyOf", "hasAllOf", "hasNoneOf",
]);

const BITABLE_DATE_FILTER_MODE_SET = new Set<BitableDateFilterMode>([
  "custom", "today", "tomorrow", "yesterday", "thisWeek", "lastWeek", "nextWeek", "lastMonth", "thisMonth",
  "nextMonth", "thisYear", "last7days", "next7days", "last30days", "next30days",
]);

function normalizeFilterValue(value: unknown): BitableFilterValue | undefined {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return undefined;
}

function normalizeFilterNode(raw: unknown, depth: number): BitableFilterNode | null {
  if (!raw || typeof raw !== "object") return null;
  const node = raw as { id?: unknown; fieldId?: unknown; operator?: unknown; value?: unknown; valueMode?: unknown; filters?: unknown };
  if (Array.isArray(node.filters)) {
    if (depth > BITABLE_FILTER_MAX_GROUP_DEPTH) return null;
    const children = node.filters.map((child) => normalizeFilterNode(child, depth + 1)).filter((child): child is BitableFilterNode => !!child);
    if (children.length === 0) return null;
    return {
      ...(typeof node.id === "string" ? { id: node.id } : {}),
      operator: node.operator === "or" ? "or" : "and",
      filters: children,
    };
  }
  if (typeof node.fieldId !== "string" || typeof node.operator !== "string" || !BITABLE_FILTER_OPERATORS.has(node.operator as BitableFilterOperator)) return null;
  const next: BitableFilterRule = {
    ...(typeof node.id === "string" ? { id: node.id } : {}),
    fieldId: node.fieldId,
    operator: node.operator as BitableFilterOperator,
  };
  const value = normalizeFilterValue(node.value);
  if (value !== undefined) next.value = value;
  if (typeof node.valueMode === "string" && BITABLE_DATE_FILTER_MODE_SET.has(node.valueMode as BitableDateFilterMode)) {
    next.valueMode = node.valueMode as BitableDateFilterMode;
  }
  return next;
}

function normalizeFilters(raw: unknown): BitableFilterNode[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw.map((node) => normalizeFilterNode(node, 1)).filter((node): node is BitableFilterNode => !!node);
}

function normalizeFillRule(raw: unknown): BitableFillRule | null {
  if (!raw || typeof raw !== "object") return null;
  const rule = raw as { id?: unknown; mode?: unknown; color?: unknown; fieldId?: unknown; condition?: unknown };
  if (typeof rule.id !== "string" || !rule.id) return null;
  if (rule.mode !== "cell" && rule.mode !== "row" && rule.mode !== "rowSide" && rule.mode !== "column") return null;
  if (rule.color !== BITABLE_FILL_NO_COLOR && !isHexColor(rule.color)) return null;
  const color = rule.color;
  if (rule.mode === "column") {
    if (typeof rule.fieldId !== "string" || !rule.fieldId) return null;
    return { id: rule.id, mode: "column", color, fieldId: rule.fieldId };
  }
  const condition = normalizeFilterNode(rule.condition, 1);
  if (!condition || isBitableFilterGroup(condition)) return null;
  return { id: rule.id, mode: rule.mode, color, condition };
}

function normalizeFillRules(raw: unknown): BitableFillRule[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  return raw
    .map(normalizeFillRule)
    .filter((rule): rule is BitableFillRule => !!rule)
    .slice(0, BITABLE_FILL_MAX_RULES);
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
  // 关联配置归一：只保留认识的键，多选补默认（方向由 relationOneWay / relationTwoWay 类型决定）。
  if (isRelationFieldType(field.type)) {
    const rel = field.relation && typeof field.relation === "object" ? field.relation : {};
    const relation: BitableRelation = { allowMultiple: rel.allowMultiple !== false };
    if (typeof rel.tableId === "string" && rel.tableId) relation.tableId = rel.tableId;
    if (typeof rel.viewId === "string" && rel.viewId) relation.viewId = rel.viewId;
    if (typeof rel.pairedFieldId === "string" && rel.pairedFieldId) relation.pairedFieldId = rel.pairedFieldId;
    next.relation = relation;
  } else {
    delete next.relation;
  }
  // AI 配置归一（261003）：只保留 prompt（字段变量写在命令里）；非 AI 字段一律不带配置。
  if (isAiFieldType(field.type)) {
    const rawAi = field.ai && typeof field.ai === "object" ? (field.ai as Partial<BitableAiConfig>) : {};
    next.ai = {
      prompt: typeof rawAi.prompt === "string" ? rawAi.prompt : "",
      ...(rawAi.includeAttachments === true ? { includeAttachments: true } : {}),
    };
  } else {
    delete next.ai;
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
  const filters = normalizeFilters(view.filters);
  if (filters && filters.length > 0) next.filters = filters; else delete next.filters;
  if (next.filters && (view.filterOperator === "or" || view.filterOperator === "and")) next.filterOperator = view.filterOperator;
  else delete next.filterOperator;
  if (!Array.isArray(view.sorts)) delete next.sorts;
  if (Array.isArray(view.groups)) next.groups = view.groups.slice(0, 1);
  else delete next.groups;
  if (!Array.isArray(view.highlightDuplicateFieldIds)) delete next.highlightDuplicateFieldIds;
  const fillRules = normalizeFillRules(view.fillRules);
  if (fillRules && fillRules.length > 0) next.fillRules = fillRules; else delete next.fillRules;
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
 * 列统计类型 —— **逐字对齐云端 lake 的配置表**（出处：语雀前端 lakex_table_yq bundle 里的 stats 定义，
 * 每项都带 types 限制；260929 用 browser-skill 直接读其前端资源抄下，见专项 §13）：
 *   count                                                        记录总数（所有字段）
 *   filled/empty/unique/percentFilled/percentEmpty/percentUnique  通用类（**不含复选框**）
 *   checked/unchecked/percentChecked/percentUnchecked            仅复选框
 *   sum/average/median                                           仅数字
 *   max/min                                                      数字 / 评分 / 进度
 *   earliestDate/latestDate/dateRange(日)/monthRange(月)          日期 / 创建时间 / 修改时间
 * 视图只存**配置**（view.columnStats），值每次现算、绝不写回记录；**未配置 = 不展示**。
 */
export type BitableStatType =
  | "count" | "filled" | "empty" | "unique" | "percentFilled" | "percentEmpty" | "percentUnique"
  | "checked" | "unchecked" | "percentChecked" | "percentUnchecked"
  | "sum" | "average" | "median" | "max" | "min"
  | "earliestDate" | "latestDate" | "dateRange" | "monthRange";

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
  const texts = records.map((record) => bitableDisplayValue(field, bitableFieldValue(record, field)).trim());
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
        const text = bitableDisplayValue(field, bitableFieldValue(record, field)).trim();
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

/**
 * **关联解析上下文**：把「同一文档的 tables」带进展示层。
 * 关联字段只存目标记录 id ⇒ 任何解释都必须有目标表；不传上下文时关联一律展示为空。
 * 表格 / 记录详情 / 看板 / 画册 / 日历 / 表单 / 移动端 / 搜索共用这一套口径，
 * 任何 UI 都不得自己解析目标记录（专项 §6.4）。
 */
export interface BitableDisplayContext {
  tables: readonly BitableTable[];
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

/**
 * 关联选择器的**草稿**切换（纯函数；UI 只改本机草稿，点「确认」才写正文）：
 * - `allowMultiple`：该目标记录来回切换（增删）；
 * - 单条模式：选中即替换，再点当前同一条即取消。
 */
export function toggleRelationDraft(draft: readonly string[], recordId: string, allowMultiple: boolean): string[] {
  const next = [...draft];
  if (!allowMultiple) return next.length === 1 && next[0] === recordId ? [] : [recordId];
  const index = next.indexOf(recordId);
  if (index >= 0) next.splice(index, 1);
  else next.push(recordId);
  return next;
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

/** 目标表的默认视图：优先第一个表格视图，其次第一个视图；没有视图则为 undefined。 */
export function defaultGridView(table: BitableTable): BitableView | undefined {
  return table.views.find((view) => view.type === "grid") ?? table.views[0];
}

/**
 * 关联选择器展示的字段：
 * - 绑定视图：像正式表格视图一样应用 fieldOrder + hiddenFieldIds；
 * - 未绑定视图：应用目标表默认视图的 fieldOrder，但不隐藏字段、不过滤记录。
 * 每次由当前 `ctx` 重新计算，因此后加字段会在下次打开时动态进入候选列。
 */
export function relationPickerFields(ctx: BitableDisplayContext | undefined, field: BitableField): BitableField[] {
  const target = relationTargetTable(ctx, field);
  if (!target) return [];
  const boundView = relationTargetView(ctx, field);
  if (boundView) return orderedTableFields(target, boundView);
  return orderedAllTableFields(target, defaultGridView(target));
}

/**
 * **关联选择器能选的记录**：绑定了数据范围视图就走该视图的筛选 + 排序（`applyViewToRecords`），
 * 否则就是目标表全部记录。只影响「能选什么」，不影响已有值的展示解析。
 */
export function relationCandidateRecords(ctx: BitableDisplayContext | undefined, field: BitableField): BitableRecord[] {
  const target = relationTargetTable(ctx, field);
  if (!target) return [];
  const view = relationTargetView(ctx, field);
  return view ? applyViewToRecords(target, view) : [...target.records];
}

// ---- 双向关联（T02B.3；全部纯函数，操作 tables 数组并返回新数组） ----

/** 反向字段默认名：**来源表名 + 来源字段名**（专项 §2.4；创建后允许像普通字段一样重命名）。 */
export function relationReverseFieldName(sourceTable: BitableTable, field: BitableField): string {
  return sourceTable.name + field.name;
}

/** 把字段降级为单向：保留 tableId / allowMultiple，清掉 pairedFieldId。 */
function asOneWay(field: BitableField): BitableField {
  if (!isRelationFieldType(field.type) || !field.relation) return field;
  const relation: BitableRelation = { ...field.relation };
  delete relation.pairedFieldId;
  return { ...field, type: "relationOneWay", relation };
}

/**
 * **建立双向关联**（T02B.3）：在目标表创建反向字段、两侧写 `pairedFieldId`、类型改为 `relationTwoWay`，
 * 并把来源表**已有值**镜像到反向侧（所以「A 关联 B 后，B 反向出现 A」对历史数据也成立）。
 * 返回新的 tables；来源字段非关联 / 目标表缺失 / 已配对时原样返回（幂等）。
 */
export function createRelationPair(tables: readonly BitableTable[], sourceTableId: string, fieldId: string): BitableTable[] {
  const source = tables.find((table) => table.id === sourceTableId);
  const field = source?.fields.find((f) => f.id === fieldId);
  if (!source || !field || field.type !== "relationTwoWay") return [...tables];
  const target = relationTargetTable({ tables }, field);
  if (!target) return [...tables];
  const pairedId = field.relation?.pairedFieldId;
  if (typeof pairedId === "string" && target.fields.some((f) => f.id === pairedId)) return [...tables];
  const reverse: BitableField = {
    id: newBitableId("fld"),
    name: relationReverseFieldName(source, field),
    type: "relationTwoWay",
    relation: { tableId: sourceTableId, allowMultiple: field.relation?.allowMultiple !== false, pairedFieldId: field.id },
  };
  return tables.map((table) => {
    if (table.id === sourceTableId) {
      return { ...table, fields: table.fields.map((f) => (f.id === fieldId ? { ...f, type: "relationTwoWay", relation: { ...f.relation, pairedFieldId: reverse.id } } : f)) };
    }
    if (table.id !== target.id) return table;
    // 反向侧：凡被来源记录引用过的目标记录，都补上来源记录 id（历史值一次性对齐）
    const records = table.records.map((record) => {
      const refs = source.records.filter((r) => relationRecordIds(r.values[fieldId]).includes(record.id)).map((r) => r.id);
      if (refs.length === 0) return record;
      const current = relationRecordIds(record.values[reverse.id]);
      const merged = [...current];
      for (const id of refs) if (!merged.includes(id)) merged.push(id);
      if (merged.length === current.length) return record;
      return { ...record, values: { ...record.values, [reverse.id]: merged } };
    });
    return { ...table, fields: [...table.fields, reverse], records };
  });
}

/**
 * **解除双向配对**（删除一侧字段前 / 把「双向」改回「单向」）：清掉对侧的 `pairedFieldId` 并降级为单向，
 * **两侧数据都原样保留**（专项 §2.4：删一侧保留另一侧字段和数据）。
 */
export function unpairRelationFields(tables: readonly BitableTable[], tableId: string, fieldId: string): BitableTable[] {
  const table = tables.find((t) => t.id === tableId);
  const field = table?.fields.find((f) => f.id === fieldId);
  if (!field) return [...tables];
  const reverse = tables
    .flatMap((t) => t.fields)
    .find((candidate) => candidate.id !== fieldId && candidate.relation?.pairedFieldId === fieldId);
  const pairedId = field.relation?.pairedFieldId ?? reverse?.id;
  return tables.map((t) => {
    let next = t;
    if (t.id === tableId && isRelationFieldType(field.type)) next = { ...next, fields: next.fields.map((f) => (f.id === fieldId ? asOneWay(f) : f)) };
    if (typeof pairedId === "string") next = { ...next, fields: next.fields.map((f) => (f.id === pairedId ? asOneWay(f) : f)) };
    return next;
  });
}

/**
 * **双向关联的唯一写入口**：把 `recordId` 的关联值设为 `nextIds`，并把增删差集镜像到对侧反向字段
 * （新增目标 → 对侧记录加上来源 id；移除目标 → 对侧记录去掉来源 id）。只改 id 集合、不复制数据。
 * 非双向（无 pairedFieldId）时等价于普通写值。
 */
export function applyRelationMirror(tables: readonly BitableTable[], tableId: string, fieldId: string, recordId: string, nextIds: readonly string[]): BitableTable[] {
  const source = tables.find((t) => t.id === tableId);
  const field = source?.fields.find((f) => f.id === fieldId);
  if (!source || !field) return [...tables];
  const prev = relationRecordIds(source.records.find((r) => r.id === recordId)?.values[fieldId]);
  const next = relationRecordIds(nextIds);
  const pairedId = field.type === "relationTwoWay" ? field.relation?.pairedFieldId : undefined;
  const pairedTable = typeof pairedId === "string" ? tables.find((t) => t.fields.some((f) => f.id === pairedId)) : undefined;
  const added = next.filter((id) => !prev.includes(id));
  const removed = prev.filter((id) => !next.includes(id));
  return tables.map((t) => {
    if (t.id === tableId) {
      return { ...t, records: t.records.map((r) => (r.id === recordId ? { ...r, values: { ...r.values, [fieldId]: next }, updatedAt: nowIso() } : r)) };
    }
    if (field.type !== "relationTwoWay" || !pairedTable || t.id !== pairedTable.id || typeof pairedId !== "string") return t;
    return {
      ...t,
      records: t.records.map((record) => {
        const shouldAdd = added.includes(record.id);
        const shouldRemove = removed.includes(record.id);
        if (!shouldAdd && !shouldRemove) return record;
        const current = relationRecordIds(record.values[pairedId]);
        const merged = shouldAdd ? (current.includes(recordId) ? current : [...current, recordId]) : current.filter((id) => id !== recordId);
        if (merged.length === current.length && merged.every((id, index) => id === current[index])) return record;
        return { ...record, values: { ...record.values, [pairedId]: merged }, updatedAt: nowIso() };
      }),
    };
  });
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
export function bitableDisplayValue(field: BitableField, value: unknown, ctx?: BitableDisplayContext): string {
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
    case "rating":
    case "progress":
      return String(value);
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
 * 多维表正文 → 供全文搜索的纯文本（表名 + 每条记录各字段展示值）。
 * 与 Lake 的 lakeHtmlToPlain 职责对应：非文档类型的正文不能喂给 HTML 解析器。
 */
export function bitableToSearchText(content: string | null | undefined, maxChars = 20000): string {
  const doc = parseBitableBody(content);
  if (!doc) return "";
  const ctx: BitableDisplayContext = { tables: doc.tables };
  const parts: string[] = [];
  const size = () => parts.join("\n").length;
  for (const table of doc.tables) {
    parts.push("[" + table.name + "]");
    for (const record of table.records) {
      const cells: string[] = [];
      for (const field of table.fields) {
        const text = bitableFieldText(record, field, ctx);
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

// ---- AI 字段（261003；纯函数，编辑器与测试共用） ----

/** AI 字段系统提示（单一来源）：命令里的字段变量已替换成当前行的值，只输出结果本身。 */
export const BITABLE_AI_SYSTEM_PROMPT =
  "你是数据表字段的 AI 生成助手。严格按用户给出的命令生成该字段的内容；命令里的字段变量已经被替换成当前记录对应字段的值。只输出结果本身：不要解释、不要前后缀、不要引号或代码块。";

/** 单次请求字符上限（主进程 ai_chat 入参上限 20 万，留出余量；与画板 AI 同口径）。 */
export const BITABLE_AI_MAX_CHARS = 190000;

export type BitableAiMessagesResult =
  | { ok: true; messages: AiChatMessage[] }
  | { ok: false; error: string };

/** 命令里的字段变量：`{{字段名}}`（两端可含空白）。 */
const AI_TOKEN_SOURCE = "\\{\\{([^{}]+)\\}\\}";

/** 命令里引用的字段名（去重、按首次出现顺序；不做字段存在性判断——UI 用它提示「未找到字段」）。 */
export function aiPromptFieldNames(prompt: string): string[] {
  const names: string[] = [];
  const re = new RegExp(AI_TOKEN_SOURCE, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(prompt)) !== null) {
    const name = match[1].trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** AI 字段一并发送的附件上限（与主进程 aiChatMessages 护栏同口径）。 */
export const AI_FIELD_MAX_IMAGES = 10;
export const AI_FIELD_MAX_DOCUMENTS = 5;

/** 组装 AI 字段请求的附加选项：附件内容（图片 / PDF）需要资产寻址。 */
export interface BuildAiFieldOptions {
  /** 当前文档 id；缺省（或字段未开启附件内容）则不发送任何附件内容。 */
  noteId?: string;
}

/**
 * 组装一次 AI 字段生成请求（**单一来源**，纯函数）：
 * 固定系统提示 + 命令（`{{字段名}}` **原位替换**为当前行该字段的展示值——值走 bitableFieldText 口径，
 * 空值 / 字段不存在 / 自引用按「（空）」）。
 * 字段开启 `includeAttachments` 且给了 noteId 时，被引用字段里的图片 / PDF **额外**作为内容块发送
 * （图片 → image 块、PDF → document 块，由主进程解析；其余附件类型仍只出展示名）。
 * 未配置 / 命令里没有变量 / 变量全失效 / 附件超量 / 超长 → 返回可展示的错误。
 */
export function buildAiFieldMessages(doc: BitableDoc, tableId: string, recordId: string, fieldId: string, options: BuildAiFieldOptions = {}): BitableAiMessagesResult {
  const table = doc.tables.find((t) => t.id === tableId);
  const field = table?.fields.find((f) => f.id === fieldId);
  const record = table?.records.find((r) => r.id === recordId);
  if (!table || !field || !record) return { ok: false, error: "找不到目标字段或记录" };
  if (!isAiFieldType(field.type)) return { ok: false, error: "这个字段不是 AI 字段" };
  const prompt = field.ai?.prompt.trim() ?? "";
  if (!prompt) return { ok: false, error: "AI 字段还没有配置命令：请在「编辑字段」里写命令，并用「插入字段」加入字段变量" };
  if (aiPromptFieldNames(prompt).length === 0) return { ok: false, error: "命令里还没有字段变量：请用「插入字段」把要参考的字段插入到命令里" };
  const ctx: BitableDisplayContext = { tables: doc.tables };
  let resolved = 0;
  const text = prompt.replace(new RegExp(AI_TOKEN_SOURCE, "g"), (_raw, inner: string) => {
    const ref = table.fields.find((f) => f.id !== field.id && f.name === String(inner).trim());
    if (!ref) return "（空）";
    resolved += 1;
    return bitableFieldText(record, ref, ctx).trim() || "（空）";
  });
  if (resolved === 0) return { ok: false, error: "命令里引用的字段都不存在了：请用「插入字段」重新添加" };
  const noteId = typeof options.noteId === "string" ? options.noteId : "";
  const parts: AiContentPart[] = [];
  if (field.ai?.includeAttachments === true && noteId) {
    const seen = new Set<string>();
    let images = 0;
    let documents = 0;
    for (const name of aiPromptFieldNames(prompt)) {
      const ref = table.fields.find((f) => f.id !== field.id && f.name === name);
      if (!ref || (ref.type !== "image" && ref.type !== "attachment")) continue;
      for (const attachment of bitableAttachments(record.values[ref.id])) {
        if (seen.has(attachment.file)) continue;
        seen.add(attachment.file);
        const asset = { noteId, filename: attachment.file, name: attachment.name };
        if (isImageExtension(extOf(attachment.file))) {
          if (images >= AI_FIELD_MAX_IMAGES) return { ok: false, error: "这一行引用的图片超过上限（" + AI_FIELD_MAX_IMAGES + " 张）" };
          images += 1;
          parts.push({ type: "image", asset });
        } else if (extOf(attachment.file).replace(/^\./, "").toLowerCase() === "pdf") {
          if (documents >= AI_FIELD_MAX_DOCUMENTS) return { ok: false, error: "这一行引用的 PDF 超过上限（" + AI_FIELD_MAX_DOCUMENTS + " 个）" };
          documents += 1;
          parts.push({ type: "document", asset });
        }
      }
    }
  }
  const total = BITABLE_AI_SYSTEM_PROMPT.length + text.length;
  if (total > BITABLE_AI_MAX_CHARS) return { ok: false, error: "上下文太长（" + total + " 字符），请精简命令" };
  const userContent: AiChatMessage["content"] = parts.length > 0 ? [{ type: "text", text }, ...parts] : text;
  return { ok: true, messages: [{ role: "system", content: BITABLE_AI_SYSTEM_PROMPT }, { role: "user", content: userContent }] };
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
  if (field.type === "date" || isSystemTimeField(field.type)) return sa < sb ? -1 : sa > sb ? 1 : 0;
  return sa.localeCompare(sb, "zh-Hans-CN");
}

export type BitableFilterValueKind = "none" | "text" | "number" | "date" | "select" | "multiSelect" | "boolean" | "file";

const BITABLE_FILTER_EMPTY_OPERATORS = new Set<BitableFilterOperator>(["isEmpty", "isNotEmpty", "isEmptySelect", "isNotEmptySelect"]);

export function isBitableFilterGroup(node: BitableFilterNode): node is BitableFilterGroup {
  return !!node && typeof node === "object" && Array.isArray((node as BitableFilterGroup).filters);
}

/** 当前筛选树里的规则数（分组不计入；用于工具栏「N个筛选」徽标）。 */
export function bitableFilterRuleCount(filters: readonly BitableFilterNode[] | undefined): number {
  if (!filters?.length) return 0;
  return filters.reduce((count, node) => count + (isBitableFilterGroup(node) ? bitableFilterRuleCount(node.filters) : 1), 0);
}

/** 某个操作符右侧值 UI 的类型；none = 该操作符不需要值。 */
export function filterValueKindFor(field: BitableField, operator: BitableFilterOperator): BitableFilterValueKind {
  if (BITABLE_FILTER_EMPTY_OPERATORS.has(operator)) return "none";
  if (field.type === "date" || isSystemTimeField(field.type)) return "date";
  if (isNumericFieldType(field.type)) return "number";
  if (field.type === "select") return "select";
  if (field.type === "multiSelect" || isRelationFieldType(field.type)) return "multiSelect";
  if (field.type === "boolean") return "boolean";
  if (field.type === "attachment" || field.type === "image") return "file";
  if (field.type === "text" || field.type === "link" || field.type === "ai" || field.type === "markdown") return "text";
  return "none";
}

/** 某个字段类型可用的筛选操作符（逐项对齐远端 lake 的类型分组）。 */
export function filterOperatorsFor(field: BitableField): BitableFilterOperator[] {
  if (field.type === "text" || field.type === "link" || field.type === "ai" || field.type === "markdown") {
    return ["startsWith", "notStartsWith", "endsWith", "notEndsWith", "contains", "notContains", "isEmpty", "isNotEmpty"];
  }
  if (isNumericFieldType(field.type)) {
    return ["equalTo", "notEqualTo", "greaterThan", "greaterThanOrEqualTo", "lessThan", "lessThanOrEqualTo", "isEmpty", "isNotEmpty"];
  }
  if (field.type === "date" || isSystemTimeField(field.type)) {
    return ["equalTo", "lessThan", "greaterThan", "isEmpty", "isNotEmpty"];
  }
  if (field.type === "select") return ["is", "isNot", "isEmptySelect", "isNotEmptySelect"];
  if (field.type === "multiSelect" || isRelationFieldType(field.type)) {
    return ["isExactly", "isNot", "hasAnyOf", "hasAllOf", "hasNoneOf", "isEmptySelect", "isNotEmptySelect"];
  }
  if (field.type === "boolean") return ["equalTo"];
  if (field.type === "attachment" || field.type === "image") return ["isEmpty", "isNotEmpty"];
  return [];
}

export const BITABLE_FILTER_OPERATOR_LABEL: Record<BitableFilterOperator, string> = {
  equalTo: "等于",
  notEqualTo: "不等于",
  greaterThan: "大于",
  greaterThanOrEqualTo: "大于等于",
  lessThan: "小于",
  lessThanOrEqualTo: "小于等于",
  isEmpty: "为空",
  isNotEmpty: "非空",
  startsWith: "开头是",
  notStartsWith: "开头不是",
  endsWith: "结尾是",
  notEndsWith: "结尾不是",
  contains: "包含",
  notContains: "不包含",
  is: "是",
  isNot: "不是",
  isEmptySelect: "为空",
  isNotEmptySelect: "非空",
  isExactly: "是",
  hasAnyOf: "包含一个",
  hasAllOf: "包含所有",
  hasNoneOf: "不包含",
};

/** 操作符展示文案（日期类把小于/大于改为远端 lake 的早于/晚于）。 */
export function filterOperatorLabel(field: BitableField, operator: BitableFilterOperator): string {
  if (field.type === "date" || isSystemTimeField(field.type)) {
    if (operator === "lessThan") return "早于";
    if (operator === "greaterThan") return "晚于";
  }
  return BITABLE_FILTER_OPERATOR_LABEL[operator];
}

export const BITABLE_DATE_FILTER_MODE_LABEL: Record<BitableDateFilterMode, string> = {
  custom: "具体日期",
  today: "今天",
  tomorrow: "明天",
  yesterday: "昨天",
  thisWeek: "本周",
  lastWeek: "上周",
  nextWeek: "下周",
  lastMonth: "上月",
  thisMonth: "本月",
  nextMonth: "下月",
  thisYear: "本年",
  last7days: "过去7天内",
  next7days: "未来7天内",
  last30days: "过去30天内",
  next30days: "未来30天内",
};

const BITABLE_DATE_FILTER_MODES: BitableDateFilterMode[] = [
  "custom", "today", "tomorrow", "yesterday", "thisWeek", "lastWeek", "nextWeek", "lastMonth", "thisMonth",
  "nextMonth", "thisYear", "last7days", "next7days", "last30days", "next30days",
];

/** 日期规则右侧可选模式；与远端 bundle 的 matchFuncs 一致：滚动 7/30 天只用于“等于”。 */
export function dateFilterModesFor(operator: BitableFilterOperator): BitableDateFilterMode[] {
  if (operator === "equalTo") return BITABLE_DATE_FILTER_MODES;
  return ["custom", "today", "tomorrow", "yesterday", "thisWeek", "lastWeek", "nextWeek", "lastMonth", "thisMonth", "nextMonth", "thisYear"];
}

export function defaultFilterValueFor(field: BitableField, operator: BitableFilterOperator): BitableFilterValue | undefined {
  const kind = filterValueKindFor(field, operator);
  if (kind === "none") return undefined;
  if (kind === "boolean") return undefined;
  if (kind === "select") return "";
  if (kind === "multiSelect") return [];
  return "";
}

/** 新建一条默认规则（默认字段必须可筛选）。 */
export function createBitableFilterRule(field: BitableField, id = newBitableId("flt")): BitableFilterRule {
  const operator = filterOperatorsFor(field)[0] ?? "isEmpty";
  const rule: BitableFilterRule = { id, fieldId: field.id, operator };
  const value = defaultFilterValueFor(field, operator);
  if (value !== undefined) rule.value = value;
  if (field.type === "date" || isSystemTimeField(field.type)) rule.valueMode = "custom";
  return rule;
}

export function createBitableFilterGroup(id = newBitableId("fgr"), operator: BitableFilterJoin = "or"): BitableFilterGroup {
  return { id, operator, filters: [] };
}

function startOfLocalDay(at: Date): Date { return new Date(at.getFullYear(), at.getMonth(), at.getDate()); }
function endOfLocalDay(at: Date): Date { return new Date(at.getFullYear(), at.getMonth(), at.getDate(), 23, 59, 59, 999); }
function startOfLocalWeek(at: Date): Date {
  const day = (at.getDay() + 6) % 7; // 周一为一周起点，与日历视图一致
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() - day);
}
function addLocalDays(at: Date, days: number): Date {
  return new Date(at.getFullYear(), at.getMonth(), at.getDate() + days, at.getHours(), at.getMinutes(), at.getSeconds(), at.getMilliseconds());
}

/** 动态日期 → 本地日期闭区间；custom 返回 null。 */
export function dateFilterRangeFor(mode: BitableDateFilterMode, now: Date = new Date()): { start: string; end: string } | null {
  if (mode === "custom") return null;
  if (mode === "today") return { start: localDateString(startOfLocalDay(now)), end: localDateString(endOfLocalDay(now)) };
  if (mode === "tomorrow") { const d = addLocalDays(now, 1); return { start: localDateString(startOfLocalDay(d)), end: localDateString(endOfLocalDay(d)) }; }
  if (mode === "yesterday") { const d = addLocalDays(now, -1); return { start: localDateString(startOfLocalDay(d)), end: localDateString(endOfLocalDay(d)) }; }
  if (mode === "thisWeek") { const s = startOfLocalWeek(now); return { start: localDateString(s), end: localDateString(addLocalDays(s, 6)) }; }
  if (mode === "lastWeek") { const s = addLocalDays(startOfLocalWeek(now), -7); return { start: localDateString(s), end: localDateString(addLocalDays(s, 6)) }; }
  if (mode === "nextWeek") { const s = addLocalDays(startOfLocalWeek(now), 7); return { start: localDateString(s), end: localDateString(addLocalDays(s, 6)) }; }
  if (mode === "thisMonth") return { start: localDateString(new Date(now.getFullYear(), now.getMonth(), 1)), end: localDateString(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
  if (mode === "lastMonth") return { start: localDateString(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: localDateString(new Date(now.getFullYear(), now.getMonth(), 0)) };
  if (mode === "nextMonth") return { start: localDateString(new Date(now.getFullYear(), now.getMonth() + 1, 1)), end: localDateString(new Date(now.getFullYear(), now.getMonth() + 2, 0)) };
  if (mode === "thisYear") return { start: localDateString(new Date(now.getFullYear(), 0, 1)), end: localDateString(new Date(now.getFullYear(), 11, 31)) };
  if (mode === "last7days") return { start: localDateString(addLocalDays(now, -7)), end: localDateString(now) };
  if (mode === "next7days") return { start: localDateString(now), end: localDateString(addLocalDays(now, 7)) };
  if (mode === "last30days") return { start: localDateString(addLocalDays(now, -30)), end: localDateString(now) };
  return { start: localDateString(now), end: localDateString(addLocalDays(now, 30)) };
}

function ruleExpectedIsEmpty(rule: BitableFilterRule): boolean {
  if (rule.value === undefined || rule.value === null) return true;
  if (typeof rule.value === "string") return rule.value === "";
  if (Array.isArray(rule.value)) return rule.value.length === 0;
  return false;
}

function textMatches(actual: string, expected: string, operator: BitableFilterOperator): boolean {
  const a = actual.toLowerCase();
  const b = expected.toLowerCase();
  if (operator === "startsWith") return a.startsWith(b);
  if (operator === "notStartsWith") return !a.startsWith(b);
  if (operator === "endsWith") return a.endsWith(b);
  if (operator === "notEndsWith") return !a.endsWith(b);
  if (operator === "contains") return a.includes(b);
  if (operator === "notContains") return !a.includes(b);
  return true;
}

function numericMatches(actual: unknown, expected: string, operator: BitableFilterOperator, zeroWhenEmpty = false): boolean {
  if (operator === "isEmpty") return actual == null || actual === "";
  if (operator === "isNotEmpty") return !(actual == null || actual === "");
  const a = actual === "" || actual == null ? (zeroWhenEmpty ? 0 : NaN) : Number(actual);
  const b = Number(expected);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (operator === "equalTo") return a === b;
  if (operator === "notEqualTo") return a !== b;
  if (operator === "greaterThan") return a > b;
  if (operator === "greaterThanOrEqualTo") return a >= b;
  if (operator === "lessThan") return a < b;
  if (operator === "lessThanOrEqualTo") return a <= b;
  return true;
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((value, index) => value === sb[index]);
}

function multiMatches(actualValues: string[], expectedValues: string[], operator: BitableFilterOperator): boolean {
  if (operator === "isEmptySelect") return actualValues.length === 0;
  if (operator === "isNotEmptySelect") return actualValues.length > 0;
  if (operator === "isExactly") return sameStringSet(actualValues, expectedValues);
  if (operator === "isNot") return !sameStringSet(actualValues, expectedValues);
  if (operator === "hasAnyOf") return expectedValues.some((value) => actualValues.includes(value));
  if (operator === "hasAllOf") return expectedValues.every((value) => actualValues.includes(value));
  if (operator === "hasNoneOf") return expectedValues.every((value) => !actualValues.includes(value));
  return true;
}

function dateMatches(actual: unknown, rule: BitableFilterRule, now: Date): boolean {
  const day = dateValueOf(actual);
  if (rule.operator === "isEmpty") return day === "";
  if (rule.operator === "isNotEmpty") return day !== "";
  if (!day) return false;
  const mode = rule.valueMode ?? "custom";
  let start = "";
  let end = "";
  if (mode === "custom") {
    start = dateValueOf(rule.value);
    end = start;
  } else {
    const range = dateFilterRangeFor(mode, now);
    if (range) { start = range.start; end = range.end; }
  }
  if (!start) return false;
  if (rule.operator === "equalTo") return day >= start && day <= end;
  if (rule.operator === "lessThan") return day < start;
  if (rule.operator === "greaterThan") return day > end;
  return true;
}

/** 单条规则求值（公开供条件着色等复用；值不完整时视为“未配置”，不拦截记录）。 */
export function evaluateFilter(field: BitableField, value: unknown, rule: BitableFilterRule, now: Date = new Date()): boolean {
  const operator = rule.operator;
  const kind = filterValueKindFor(field, operator);
  if (kind !== "none" && ruleExpectedIsEmpty(rule)) return true;
  if (operator === "isEmpty" || operator === "isEmptySelect") {
    if (field.type === "attachment" || field.type === "image") return bitableAttachments(value).length === 0;
    if (field.type === "multiSelect" || isRelationFieldType(field.type)) return relationRecordIds(value).length === 0;
    if (field.type === "boolean") return value == null;
    return value == null || value === "";
  }
  if (operator === "isNotEmpty" || operator === "isNotEmptySelect") return !evaluateFilter(field, value, { ...rule, operator: operator === "isNotEmptySelect" ? "isEmptySelect" : "isEmpty" }, now);
  if (field.type === "date" || isSystemTimeField(field.type)) return dateMatches(value, rule, now);
  if (field.type === "text" || field.type === "link") return textMatches(bitableDisplayValue(field, value), String(rule.value ?? ""), operator);
  if (isNumericFieldType(field.type)) return numericMatches(value, String(rule.value ?? ""), operator, field.type === "rating" || field.type === "progress");
  if (field.type === "boolean") {
    const actual = value === true || value === "true";
    const expected = rule.value === true || rule.value === "true";
    return operator === "equalTo" ? actual === expected : true;
  }
  if (field.type === "select") {
    const actual = Array.isArray(value) ? value[0] : value;
    const expected = String(rule.value ?? "");
    return operator === "is" ? actual === expected : operator === "isNot" ? actual !== expected : true;
  }
  if (field.type === "multiSelect" || isRelationFieldType(field.type)) {
    return multiMatches(relationRecordIds(value), Array.isArray(rule.value) ? rule.value : typeof rule.value === "string" ? rule.value.split(",").filter(Boolean) : [], operator);
  }
  if (field.type === "attachment" || field.type === "image") {
    return bitableAttachments(value).length > 0;
  }
  return true;
}

/** 递归求值一个筛选组（组内统一 AND/OR）。 */
export function evaluateFilterGroup(
  group: BitableFilterGroup,
  record: BitableRecord,
  fieldById: ReadonlyMap<string, BitableField>,
  now: Date = new Date(),
): boolean {
  if (group.filters.length === 0) return true;
  const check = (node: BitableFilterNode): boolean => evaluateFilterNode(node, record, fieldById, now);
  return group.operator === "or" ? group.filters.some(check) : group.filters.every(check);
}

export function evaluateFilterNode(
  node: BitableFilterNode,
  record: BitableRecord,
  fieldById: ReadonlyMap<string, BitableField>,
  now: Date = new Date(),
): boolean {
  if (isBitableFilterGroup(node)) return evaluateFilterGroup(node, record, fieldById, now);
  const field = fieldById.get(node.fieldId);
  if (!field) return true;
  return evaluateFilter(field, bitableFieldValue(record, field), node, now);
}

/** 筛选规则是否已经填完值；未填完的规则在筛选里视为“不拦截”，在填色里必须视为“未配置”。 */
export function isBitableFilterRuleConfigured(field: BitableField, rule: BitableFilterRule): boolean {
  if (!filterOperatorsFor(field).includes(rule.operator)) return false;
  return filterValueKindFor(field, rule.operator) === "none" || !ruleExpectedIsEmpty(rule);
}

export interface BitableFillMatch {
  /** 规则在 view.fillRules 里的原始下标，用于复刻钉钉的候选顺序。 */
  ruleIndex: number;
  color: string;
}

export interface BitableFillProjection {
  /** `recordId:fieldId` → 首个命中的 cell 规则。 */
  cell: Map<string, BitableFillMatch>;
  /** recordId → 首个命中的 row 规则。 */
  row: Map<string, BitableFillMatch>;
  /** recordId → 首个命中的 rowSide 规则（独立于背景通道）。 */
  rowSide: Map<string, BitableFillMatch>;
  /** fieldId → 首个命中的 column 规则。 */
  column: Map<string, BitableFillMatch>;
}

function fillCellKey(recordId: string, fieldId: string): string {
  return recordId + ":" + fieldId;
}

/**
 * 对齐钉钉当前实现：
 * - 每种模式在规则数组中取首个命中项；column 取首个指向该列的规则；
 * - cell / row / column 三个候选再按原始下标倒序交给背景层混色；
 * - rowSide 走独立通道。
 */
export function buildBitableFillProjection(
  table: BitableTable,
  view: BitableView | undefined,
  records: readonly BitableRecord[],
  options?: { now?: Date },
): BitableFillProjection {
  const rules = view?.fillRules ?? [];
  const fieldById = new Map(table.fields.map((field) => [field.id, field] as const));
  const now = options?.now ?? new Date();
  const projection: BitableFillProjection = {
    cell: new Map(),
    row: new Map(),
    rowSide: new Map(),
    column: new Map(),
  };

  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules[index];
    if (rule.color === BITABLE_FILL_NO_COLOR) continue;
    if (rule.mode !== "column" || projection.column.has(rule.fieldId)) continue;
    projection.column.set(rule.fieldId, { ruleIndex: index, color: rule.color });
  }

  for (const record of records) {
    let rowMatched = false;
    let sideMatched = false;
    for (let index = 0; index < rules.length; index += 1) {
      const rule = rules[index];
      if (rule.color === BITABLE_FILL_NO_COLOR) continue;
      if (rule.mode === "column") continue;
      const field = fieldById.get(rule.condition.fieldId);
      if (!field || !isBitableFilterRuleConfigured(field, rule.condition)) continue;
      if (!evaluateFilter(field, bitableFieldValue(record, field), rule.condition, now)) continue;

      if (rule.mode === "row" && !rowMatched) {
        projection.row.set(record.id, { ruleIndex: index, color: rule.color });
        rowMatched = true;
      } else if (rule.mode === "rowSide" && !sideMatched) {
        projection.rowSide.set(record.id, { ruleIndex: index, color: rule.color });
        sideMatched = true;
      } else if (rule.mode === "cell") {
        const key = fillCellKey(record.id, rule.condition.fieldId);
        if (!projection.cell.has(key)) projection.cell.set(key, { ruleIndex: index, color: rule.color });
      }
    }
  }

  return projection;
}

/**
 * 返回 CSS background-image 的层序（顶层在前）。
 * 钉钉的 mix_colors 先放后置规则为底色，再把前置规则叠上去；CSS 的首层正好是最上层，
 * 因此这里把候选按 ruleIndex 升序返回，视觉结果与钉钉一致。
 */
export function bitableFillBackgroundTokens(
  projection: BitableFillProjection,
  recordId: string,
  fieldId: string,
): string[] {
  const matches = [
    projection.cell.get(fillCellKey(recordId, fieldId)),
    projection.row.get(recordId),
    projection.column.get(fieldId),
  ].filter((match): match is BitableFillMatch => !!match);
  if (matches.length === 0) return [];
  matches.sort((a, b) => b.ruleIndex - a.ruleIndex);
  return matches.reverse().map((match) => match.color);
}

export function stripFillRulesForField(rules: readonly BitableFillRule[] | undefined, fieldId: string): BitableFillRule[] {
  if (!rules?.length) return [];
  return rules.filter((rule) => (rule.mode === "column" ? rule.fieldId !== fieldId : rule.condition.fieldId !== fieldId));
}

export function createBitableFillRule(
  mode: BitableFillMode,
  fields: readonly BitableField[],
  color = DEFAULT_LIGHT_COLORS[0],
  preferredFieldId?: string,
): BitableFillRule | null {
  const id = newBitableId("fil");
  if (mode === "column") {
    const field = fields.find((item) => item.id === preferredFieldId) ?? fields[0];
    return field ? { id, mode, color, fieldId: field.id } : null;
  }
  const filterFields = fields.filter((field) => filterOperatorsFor(field).length > 0);
  const field = filterFields.find((item) => item.id === preferredFieldId) ?? filterFields[0];
  return field ? { id, mode, color, condition: createBitableFilterRule(field) } : null;
}

/** 对记录套用视图的筛选 + 排序（返回新数组，不改原值）。 */
export function applyViewToRecords(table: BitableTable, view: BitableView | undefined, options?: { now?: Date }): BitableRecord[] {
  const fieldById = new Map(table.fields.map((f) => [f.id, f] as const));
  let records = [...table.records];
  const filters = view?.filters ?? [];
  if (filters.length > 0) {
    const group: BitableFilterGroup = { operator: view?.filterOperator ?? "and", filters };
    const now = options?.now ?? new Date();
    records = records.filter((record) => evaluateFilterGroup(group, record, fieldById, now));
  }
  const sorts = view?.sorts ?? [];
  if (sorts.length > 0) {
    records = records
      .map((record, index) => ({ record, index }))
      .sort((a, b) => {
        for (const rule of sorts) {
          const field = fieldById.get(rule.fieldId);
          if (!field) continue;
          const cmp = compareSortValues(field, bitableFieldValue(a.record, field), bitableFieldValue(b.record, field), rule);
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
    const key = groupKeyOf(field, bitableFieldValue(record, field));
    const list = groups.get(key);
    if (list) list.push(record);
    else groups.set(key, [record]);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    if ((a === "") !== (b === "")) return a === "" ? 1 : -1; // 空值组排最后
    const cmp = compareValues(field, bitableFieldValue(groups.get(a)![0], field), bitableFieldValue(groups.get(b)![0], field));
    return rule.desc ? -cmp : cmp;
  });
  return keys.map((key) => ({ key, label: key || "(空)", records: groups.get(key)! }));
}

/** 某列出现次数 > 1 的展示值集合（忽略空值）—— 供「高亮重复值」判定。 */
export function duplicateValues(field: BitableField, records: BitableRecord[]): Set<string> {
  const counts = new Map<string, number>();
  for (const record of records) {
    const value = bitableDisplayValue(field, bitableFieldValue(record, field)).trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([value]) => value));
}
