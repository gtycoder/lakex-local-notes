/**
 * 多维表「表单」的纯逻辑单一来源（261030 从桌面 BitableFormView + 移动端 mobileBitableForm 收敛）。
 *
 * 为什么上收 core：两端都要「题目顺序 = formFieldIds」「必填按展示值判空」「提交补齐默认值」这三件事，
 * 之前桌面一套、移动端一套（语义已经分叉：移动端提交会补默认值，桌面不补）。这里一次定义，
 * 两端只负责渲染与调用；任何表单语义改动只改这一处 + 两端的渲染测试。
 *
 * 约束：纯函数、无 React / 无 node:；不改正文格式；表单编辑（增删题目）仍属两端各自的 UI 行为。
 */
import {
  bitableDisplayValue,
  defaultRecordValues,
  isAiFieldType,
  isSystemTimeField,
  type BitableDisplayContext,
  type BitableField,
  type BitableTable,
  type BitableView,
} from "./bitableDoc.js";

/** 表单可录入字段：排除系统时间（值来自记录时间戳）与 AI 字段（值由生成产生），保持表字段顺序。 */
export function formableBitableFields(table: BitableTable): BitableField[] {
  return table.fields.filter((field) => !isSystemTimeField(field.type) && !isAiFieldType(field.type));
}

/**
 * 表单题目：`view.formFieldIds` 里仍然存在的字段按配置顺序（**不是表字段顺序**）；
 * 未配置（undefined / 空数组）= 表单尚未建好 ⇒ 收入全部可填写字段；
 * 配置了但全部失效（字段被删）⇒ 同样回落全量，避免渲染出一个空表单。
 */
export function bitableFormFields(table: BitableTable, view: BitableView | undefined): BitableField[] {
  const formable = formableBitableFields(table);
  const ids = view?.formFieldIds;
  if (!Array.isArray(ids) || ids.length === 0) return formable;
  const included = ids
    .map((id) => formable.find((field) => field.id === id))
    .filter((field): field is BitableField => !!field);
  return included.length > 0 ? included : formable;
}

/** 表单草稿初值：复用 core 的字段默认值（日期等预设值不会在提交时丢）。 */
export function bitableFormDraftDefaults(table: BitableTable): Record<string, unknown> {
  return defaultRecordValues(table);
}

/** 必填但没填的字段（展示值口径与两端一致：空白 / 空数组 / 空选项都算没填）。 */
export function missingRequiredBitableFields(
  fields: readonly BitableField[],
  draft: Record<string, unknown>,
  ctx?: BitableDisplayContext,
): BitableField[] {
  return fields.filter((field) => field.required && bitableDisplayValue(field, draft[field.id], ctx).trim() === "");
}

/**
 * 提交值：表默认值 + 草稿（未知字段键丢弃，避免脏 body）。
 * 两端都走这一份，保证「表单没展示的字段」在新增记录里取默认值而不是空。
 */
export function bitableFormValues(table: BitableTable, draft: Record<string, unknown>): Record<string, unknown> {
  const known = new Set(table.fields.map((field) => field.id));
  const values: Record<string, unknown> = { ...defaultRecordValues(table) };
  for (const [fieldId, value] of Object.entries(draft)) {
    if (known.has(fieldId)) values[fieldId] = value;
  }
  return values;
}
