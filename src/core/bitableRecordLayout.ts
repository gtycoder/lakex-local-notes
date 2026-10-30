/**
 * 多维表「记录展示方式」布局（表格 / 卡片）—— 纯核心，无 DOM / 无存储。
 *
 * 背景（261030）：移动端按钉钉复刻——表格视图可以切换成卡片列表（同一份记录、同一套筛选排序分组），
 * 卡片可配置 封面 / 1~2 列 / 主标题 / 副标题 / 展示字段。
 * **配置存设备本地**（用户 261030 定：仅展示类配置一律本地，不写正文、不进 S3、不改数据），
 * 所以这里只放「默认值推导 + 归一 + 解析字段」，读写 storage 在移动端 prefs 层。
 *
 * 约束：
 * - 纯函数、无 React / node: 依赖；不 bump 正文格式版本（正文里没有这个配置）；
 * - 默认值 = 与现有只读表格一致的观感（mode table、1 列、无封面、主标题 = 主字段）；
 * - 字段解析必须容错：配置里引用了已被删除的字段时自动回落，绝不因脏配置渲染成空卡。
 */
import {
  isAttachmentLikeField,
  orderedTableFields,
  type BitableField,
  type BitableTable,
  type BitableView,
} from "./bitableDoc.js";

export type BitableRecordLayoutMode = "table" | "card";

/** 卡片列数：只支持 1 / 2（用户 261030：3 列在手机上放不下，不做）。 */
export type BitableCardColumns = 1 | 2;

/**
 * 设备本地的持久化形状（**部分覆盖**语义）：只存用户改过的键，
 * 其余走 resolve 的默认值——这样表字段增减后默认展示字段会自动跟随，不留下过期快照。
 */
export interface BitableRecordLayoutPrefs {
  mode?: BitableRecordLayoutMode;
  columns?: BitableCardColumns;
  cover?: boolean;
  /** 卡片主标题字段；缺省 = 数据表主字段（fields[0]）。 */
  titleFieldId?: string;
  /** 卡片副标题字段；缺省 = 不显示。 */
  subtitleFieldId?: string;
  /** 卡片正文展示字段（顺序即卡片内顺序）；缺省 = 可见字段去掉主/副标题。 */
  fieldIds?: string[];
}

export interface BitableResolvedRecordLayout {
  mode: BitableRecordLayoutMode;
  columns: BitableCardColumns;
  cover: boolean;
  titleField: BitableField | null;
  subtitleField: BitableField | null;
  /** 卡片正文行（已排除主/副标题；只含当前视图可见字段）。 */
  fields: BitableField[];
  /** 封面字段（第一个附件/图片字段，且必须出现在正文行里）；无则 null。 */
  coverField: BitableField | null;
}

export const BITABLE_RECORD_LAYOUT_DEFAULTS = {
  mode: "table",
  columns: 1,
  cover: false,
} as const satisfies Pick<BitableResolvedRecordLayout, "mode" | "columns" | "cover">;

function fieldById(table: BitableTable, fieldId: string | undefined): BitableField | null {
  if (!fieldId) return null;
  return table.fields.find((field) => field.id === fieldId) ?? null;
}

/** 某视图下默认的卡片正文行：可见字段去掉主/副标题。 */
export function defaultCardFieldIds(table: BitableTable, view: BitableView | undefined, titleFieldId: string, subtitleFieldId?: string): string[] {
  return orderedTableFields(table, view)
    .map((field) => field.id)
    .filter((id) => id !== titleFieldId && id !== subtitleFieldId);
}

/**
 * 归一持久化形状：未知 mode/columns 丢弃、列数夹到 1/2、id 去空串。
 * 脏数据一律降级为「缺省」而不是整体丢弃（能救的键要救）。
 */
export function normalizeRecordLayoutPrefs(raw: unknown): BitableRecordLayoutPrefs {
  if (!raw || typeof raw !== "object") return {};
  const source = raw as Record<string, unknown>;
  const prefs: BitableRecordLayoutPrefs = {};
  if (source.mode === "table" || source.mode === "card") prefs.mode = source.mode;
  if (source.columns === 1 || source.columns === 2) prefs.columns = source.columns;
  if (typeof source.cover === "boolean") prefs.cover = source.cover;
  if (typeof source.titleFieldId === "string" && source.titleFieldId) prefs.titleFieldId = source.titleFieldId;
  if (typeof source.subtitleFieldId === "string" && source.subtitleFieldId) prefs.subtitleFieldId = source.subtitleFieldId;
  if (Array.isArray(source.fieldIds)) {
    const ids = source.fieldIds.filter((id): id is string => typeof id === "string" && id.length > 0);
    // 重复 id 只留第一次出现（顺序即卡片行顺序）
    prefs.fieldIds = [...new Set(ids)];
  }
  return prefs;
}

/** 合并一次修改（列数/模式已被类型约束；这里只做运行期兜底）。 */
export function withRecordLayoutPrefs(
  prefs: BitableRecordLayoutPrefs,
  patch: Partial<BitableRecordLayoutPrefs>,
): BitableRecordLayoutPrefs {
  const next: BitableRecordLayoutPrefs = { ...prefs, ...patch };
  if (next.columns !== 1 && next.columns !== 2) next.columns = 1;
  if (next.mode !== "table" && next.mode !== "card") next.mode = "table";
  if (!next.titleFieldId) delete next.titleFieldId;
  if (!next.subtitleFieldId) delete next.subtitleFieldId;
  if (next.fieldIds) next.fieldIds = [...new Set(next.fieldIds.filter((id) => id.length > 0))];
  return next;
}

/**
 * 解析成可渲染的形状。
 * - 主标题：配置字段 → 主字段 → 第一可见字段（三档回落，永远有标题）；
 * - 副标题：配置字段（且必须存在）否则 null；
 * - 正文行：配置字段里仍然存在的（顺序保留）→ 为空则用默认；
 * - 封面：只认「正文行里的附件/图片字段」，取第一个；没开封面开关时也返回（UI 自己判断显示）。
 */
export function resolveRecordLayout(table: BitableTable, view: BitableView | undefined, prefs: BitableRecordLayoutPrefs): BitableResolvedRecordLayout {
  const visible = orderedTableFields(table, view);
  const visibleIds = new Set(visible.map((field) => field.id));
  const primary = table.fields[0] ?? null;

  const titleField = fieldById(table, prefs.titleFieldId) ?? primary ?? visible[0] ?? null;
  const titleFieldId = titleField?.id ?? "";

  const configuredSubtitle = fieldById(table, prefs.subtitleFieldId);
  const subtitleField = configuredSubtitle && configuredSubtitle.id !== titleFieldId ? configuredSubtitle : null;

  // fieldIds 是**部分覆盖**语义：undefined = 用默认；显式 [] = 用户把展示字段全关了（尊重）；
  // 非空但全部失效（字段被删）⇒ 回落默认，避免只因为删字段就把卡片内容清空。
  const explicitEmpty = Array.isArray(prefs.fieldIds) && prefs.fieldIds.length === 0;
  const preferred = (prefs.fieldIds ?? []).filter((id) => id !== titleFieldId && id !== subtitleField?.id && visibleIds.has(id));
  const fallback = defaultCardFieldIds(table, view, titleFieldId, subtitleField?.id);
  const fieldIds = explicitEmpty ? [] : (preferred.length > 0 ? preferred : fallback);
  const fields = fieldIds.map((id) => fieldById(table, id)).filter((field): field is BitableField => !!field);

  const coverField = fields.find((field) => isAttachmentLikeField(field.type)) ?? null;

  return {
    mode: prefs.mode ?? BITABLE_RECORD_LAYOUT_DEFAULTS.mode,
    columns: prefs.columns ?? BITABLE_RECORD_LAYOUT_DEFAULTS.columns,
    cover: prefs.cover ?? BITABLE_RECORD_LAYOUT_DEFAULTS.cover,
    titleField,
    subtitleField,
    fields,
    coverField,
  };
}
