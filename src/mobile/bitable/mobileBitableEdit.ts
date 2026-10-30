/**
 * 移动端多维表编辑的**纯逻辑单一来源**（261020 P0）。
 *
 * 为什么单独一层：组件只决定「什么时候调用、调用谁」，正文语义（canonical 序列化 / 字段与记录写入 /
 * 选项创建 / 分页窗口）全部收在这里，便于单测护栏，也让将来桌面复用同一批函数。
 *
 * 三条口径（对齐桌面与 docs/BITABLE-VIEWPORT.md）：
 * 1. **正文序列化恒写 canonical 导航**（第一张表 / 第一个视图）——多表/多视图切换是**设备本地 UI 状态**，
 *    不写正文、不落盘、不进 S3（与桌面 `useBitableSession.serializeBody` 同一份语义）。
 * 2. 记录全集留在模型里，**窗口只决定挂载多少行**（分页 + 显式「加载更多」，不静默裁剪）。
 * 3. 所有写操作走 core 纯函数（`bitableMutations`），无变化时返回原引用（不产生空写入/空撤销步）。
 */
import {
  BITABLE_FIELD_TYPE_LABEL,
  BITABLE_PROGRESS_MAX,
  BITABLE_RATING_MAX,
  bitablesToBody,
  createBitableField,
  createBitableFieldOptions,
  type BitableDoc,
  type BitableField,
  type BitableFieldType,
  type BitableRecord,
  type BitableTable,
} from "../../core/bitableDoc.js";
import {
  addBitableField,
  addBitableRecord,
  deleteBitableField,
  deleteBitableRecords,
  renameBitableField,
  setBitableCellValue,
} from "../../core/bitableMutations.js";

/** 正文序列化：导航字段一律写默认（第一表 / 第一视图）——归一收口在 core（`bitablesToBody` → `canonicalBitableNav`，CORE-05）。 */
export function serializeBitableBody(tables: BitableTable[]): string {
  return bitablesToBody(tables);
}

/** 移动端 P0 允许**新建/编辑**的字段类型（其余类型只读展示并给出理由，见 mobileFieldNote）。 */
export const MOBILE_EDITABLE_FIELD_TYPES: readonly BitableFieldType[] = [
  "text", "number", "date", "select", "multiSelect", "boolean", "link", "rating", "progress",
  // 261030 P1：附件/图片改为可上传（系统选择器 → bridge.uploadResource，映射与桌面一致）
  "attachment", "image",
] as const;

export function isMobileEditableField(field: BitableField): boolean {
  return (MOBILE_EDITABLE_FIELD_TYPES as readonly string[]).includes(field.type);
}

/** 只读字段的**明确理由**（触屏没有 hover，必须写在面板上，不能静默不可点）。 */
export function mobileFieldNote(field: BitableField): string {
  if (isMobileEditableField(field)) return BITABLE_FIELD_TYPE_LABEL[field.type as BitableFieldType] ?? "";
  switch (field.type) {
    case "createdTime": return "创建时间：自动生成，不可编辑";
    case "updatedTime": return "修改时间：自动生成，不可编辑";
    case "relationOneWay":
    case "relationTwoWay": return "关联字段：移动端暂只读，请在桌面编辑";
    case "ai": return "AI 字段：移动端暂只读，请在桌面生成";
    case "markdown": return "Markdown 字段：移动端暂只读，请在桌面编辑";
    default: return "该字段类型暂不支持在移动端编辑";
  }
}

/** 单元格写值（关联走 core 的双向镜像）。 */
export function setMobileCell(doc: BitableDoc, tableId: string, recordId: string, fieldId: string, value: unknown): BitableDoc {
  return setBitableCellValue(doc, tableId, recordId, fieldId, value);
}

/** 新增字段（名称缺省用类型名；追加到末尾）。 */
export function addMobileField(doc: BitableDoc, tableId: string, type: BitableFieldType, name?: string): BitableDoc {
  const label = name?.trim() || BITABLE_FIELD_TYPE_LABEL[type] || "字段";
  return addBitableField(doc, tableId, createBitableField(type, label));
}

export function renameMobileField(doc: BitableDoc, tableId: string, fieldId: string, name: string): BitableDoc {
  return renameBitableField(doc, tableId, fieldId, name);
}

/** 删除字段（core 会解除双向配对并清空全部视图里指向它的配置；只剩一个字段时拒绝并返回原 doc）。 */
export function deleteMobileField(doc: BitableDoc, tableId: string, fieldId: string): BitableDoc {
  return deleteBitableField(doc, tableId, fieldId);
}

export function addMobileRecord(doc: BitableDoc, tableId: string): { doc: BitableDoc; recordId: string } {
  return addBitableRecord(doc, tableId);
}

export function deleteMobileRecord(doc: BitableDoc, tableId: string, recordId: string): BitableDoc {
  return deleteBitableRecords(doc, tableId, [recordId]);
}

/**
 * 单选/多选：按名称取选项，没有就建（与桌面 addOption 同一行为：同名复用、色板轮转）。
 * 返回新 doc 与选项 id；记录值由调用方用 setMobileCell 写（多选需自行拼数组）。
 */
export function addMobileOption(doc: BitableDoc, tableId: string, fieldId: string, name: string): { doc: BitableDoc; optionId: string | null } {
  const table = doc.tables.find((t) => t.id === tableId);
  const field = table?.fields.find((f) => f.id === fieldId);
  const trimmed = name.trim();
  if (!table || !field || !trimmed || (field.type !== "select" && field.type !== "multiSelect")) {
    return { doc, optionId: null };
  }
  const existing = (field.options ?? []).find((option) => option.name === trimmed);
  if (existing) return { doc, optionId: existing.id };
  const options = field.options ?? [];
  const created = createBitableFieldOptions([trimmed])[0];
  return {
    doc: {
      ...doc,
      tables: doc.tables.map((t) => (t.id !== tableId ? t : {
        ...t,
        fields: t.fields.map((f) => (f.id === fieldId ? { ...f, options: [...options, created] } : f)),
      })),
    },
    optionId: created.id,
  };
}

/** 分页窗口：完整模型不动，只切出要挂载的那一段（footer 显示 已显示/总数）。 */
export function recordWindow(records: readonly BitableRecord[], visibleCount: number): {
  visible: BitableRecord[];
  total: number;
  remaining: number;
} {
  const total = records.length;
  const limit = Math.max(0, Math.min(total, Math.floor(visibleCount)));
  return { visible: records.slice(0, limit), total, remaining: total - limit };
}

/** 日期输入框取值（正文里存 `YYYY-MM-DD` 字符串）。 */
export function dateInputValue(value: unknown): string {
  return typeof value === "string" ? value.slice(0, 10) : "";
}

/** 数字/进度输入框取值（正文里数字类字段存字符串，见桌面 TextCell 口径）。 */
export function textInputValue(value: unknown): string {
  if (value == null) return "";
  return typeof value === "string" ? value : String(value);
}

/** 评分：0 表示未评分（与桌面「点同一颗星取消」一致）。 */
export function ratingValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(BITABLE_RATING_MAX, Math.round(value))) : 0;
}

/** 进度：0–100 整数；空值按 0 展示，但写回时允许空串表示清空。 */
export function progressValue(value: unknown): number {
  if (value === "" || value == null) return 0;
  const raw = Number(value);
  return Number.isFinite(raw) ? Math.max(0, Math.min(BITABLE_PROGRESS_MAX, Math.round(raw))) : 0;
}

/** 单选/多选当前选中的选项 id 列表（统一数组语义）。 */
export function selectedOptionIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return typeof value === "string" && value ? [value] : [];
}
