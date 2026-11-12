/**
 * 多维表正文（core/bitable）：文档模型：类型、常量、id/时间原语、字段类型守卫（本目录的叶子模块，其余模块都依赖它）。
 *
 * 由 core/bitableDoc.ts 按域拆出（261112 R1-S1，纯搬移：导出名/行为未变）。
 * 对外 API 仍由 ../bitableDoc.ts 门面 re-export；本文件只被同目录模块与门面 import。
 */
import { randomUuid } from "../randomId.js";
import { DEFAULT_LIGHT_COLORS } from "../colorPalette.js";
import type { AiChatMessage } from "../aiProviders.js";

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
  /** 字段级显示格式（日期 / 数字；空/缺省 = 原样）。只影响展示，不改存储值。 */
  format?: string;
  [key: string]: unknown;
}

/** 字段级「显示格式」（261030）：只影响展示（单元格/卡片/表单/日历/搜索文本），不改存储值。 */
export const BITABLE_DATE_FORMAT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "2026-06-09" },
  { value: "slash", label: "2026/06/09" },
  { value: "md", label: "6月9日" },
  { value: "cny", label: "2026年6月9日" },
];

export const BITABLE_NUMBER_FORMAT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "原样" },
  { value: "thousands", label: "1,234" },
  { value: "decimal0", label: "整数（四舍五入）" },
  { value: "decimal1", label: "1 位小数" },
  { value: "decimal2", label: "2 位小数" },
];

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

/** 分组规则（当前产品只支持一级；持久化仍保留数组形态以避免正文结构 churn）。 */
export interface BitableGroupRule {
  fieldId: string;
  desc?: boolean;
}

/** 行高：预设档位或自定义像素。 */
export type BitableRowHeight = "low" | "medium" | "high" | "xhigh" | number;

/** 行高面板的可选档位（桌面/移动共用；「低」= 云端 --lt-size-grid-row-height）。 */
export const BITABLE_ROW_HEIGHT_OPTIONS: ReadonlyArray<{ value: BitableRowHeight; label: string }> = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

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

/** 生成带前缀的内部 id（表/字段/选项/记录/视图）。 */
export function newBitableId(prefix: string): string {
  return prefix + randomUuid().replace(/-/g, "").slice(0, 12);
}

/** 内部共享（跨模块用，**不**由门面 re-export）。 */
export function nowIso(): string {
  return new Date().toISOString();
}

/** 评分固定 5 星；进度固定 0–100。 */
export const BITABLE_RATING_MAX = 5;

export const BITABLE_PROGRESS_MAX = 100;

/** 新建选项/进度默认取的浅色档；选择器本身用全量内核实色卡。 */
export const BITABLE_OPTION_PALETTE = DEFAULT_LIGHT_COLORS;

/** 兼容别名（旧命名色键与 hex 通用；新代码用 BITABLE_OPTION_PALETTE）。 */
export const BITABLE_OPTION_COLORS = BITABLE_OPTION_PALETTE;

/** 选项/进度条无颜色时的默认灰（组件与填充规则共用；此前 BitableEditor 复制了字面量）。 */
export const BITABLE_DEFAULT_OPTION_COLOR = "#e8e8e8";

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
 * **关联解析上下文**：把「同一文档的 tables」带进展示层。
 * 关联字段只存目标记录 id ⇒ 任何解释都必须有目标表；不传上下文时关联一律展示为空。
 * 表格 / 记录详情 / 看板 / 画册 / 日历 / 表单 / 移动端 / 搜索共用这一套口径，
 * 任何 UI 都不得自己解析目标记录（专项 §6.4）。
 */
export interface BitableDisplayContext {
  tables: readonly BitableTable[];
}

export type BitableAiMessagesResult =
  | { ok: true; messages: AiChatMessage[] }
  | { ok: false; error: string };

/** 组装 AI 字段请求的附加选项：附件内容（图片 / PDF）需要资产寻址。 */
export interface BuildAiFieldOptions {
  /** 当前文档 id；缺省（或字段未开启附件内容）则不发送任何附件内容。 */
  noteId?: string;
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

export type BitableFilterValueKind = "none" | "text" | "number" | "date" | "select" | "multiSelect" | "boolean" | "file";

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
