/**
 * 多维表「只读单元格」共享语义（C1-6，261017）。
 *
 * 背景：移动端只读视图曾把桌面已有的 readOnly 分支（附件/评分/进度/链接/关联/布尔/选项）重写一遍；
 * 两端共享的应是**展示语义**（clamp、href、失效判定、chip 文本），不是样式。
 * 本模块只依赖 core/bitableDoc 的纯函数，零 React/DOM；桌面与移动各自用自己的类名渲染。
 */
import {
  BITABLE_PROGRESS_MAX,
  BITABLE_RATING_MAX,
  bitableAttachments,
  bitableRecordTitle,
  relationRecordIds,
  relationTargetRecords,
  relationTargetTable,
  type BitableDisplayContext,
  type BitableField,
  type BitableFieldOption,
  type BitableTable,
} from "./bitableDoc.js";
import { extOf, isImageExtension } from "./assetNaming.js";

export interface ReadOnlyAttachmentItem {
  file: string;
  name: string;
  /** 图片字段专用展示：扩展名是图片（移动端画缩略图，桌面走自己的缩略图管线）。 */
  image: boolean;
}

export function readOnlyAttachments(value: unknown): ReadOnlyAttachmentItem[] {
  return bitableAttachments(value).map(({ file, name }) => ({ file, name, image: isImageExtension(extOf(file)) }));
}

/** 单选/多选：按**存储顺序**取已选选项（与两端既有渲染同源；不是选项配置顺序）。 */
export function readOnlyOptions(field: BitableField, value: unknown): BitableFieldOption[] {
  const ids = Array.isArray(value) ? value : [value];
  return ids
    .map((id) => (field.options ?? []).find((option) => option.id === id))
    .filter((option): option is BitableFieldOption => !!option);
}

export function readOnlyBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

export interface ReadOnlyLink {
  text: string;
  /** 非 http(s) 为 null（只当文本展示）。 */
  href: string | null;
}

export function readOnlyLink(value: unknown): ReadOnlyLink {
  const text = typeof value === "string" ? value.trim() : "";
  return { text, href: /^https?:\/\//i.test(text) ? text : null };
}

/** 评分：0..5 的整数（非法/空值按 0 处理，与桌面 readOnly 分支一致）。 */
export function readOnlyRating(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(BITABLE_RATING_MAX, Math.round(value)));
}

/** 进度：0..100 的整数（非法/空值按 0 处理，与桌面 readOnly 分支一致）。 */
export function readOnlyProgress(value: unknown): number {
  const raw = typeof value === "number" ? value : Number(value);
  return Number.isFinite(raw) ? Math.max(0, Math.min(BITABLE_PROGRESS_MAX, Math.round(raw))) : 0;
}

export interface ReadOnlyRelation {
  target: BitableTable | undefined;
  /** 目标表/目标记录失效（关联 id 仍保留，恢复后自动重现）。 */
  invalid: boolean;
  chips: Array<{ id: string; label: string }>;
}

export function readOnlyRelation(ctx: BitableDisplayContext | undefined, field: BitableField, value: unknown): ReadOnlyRelation {
  const target = relationTargetTable(ctx, field);
  const ids = relationRecordIds(value);
  const records = relationTargetRecords(ctx, field, value);
  if (!target || records.length === 0) return { target, invalid: ids.length > 0, chips: [] };
  return {
    target,
    invalid: false,
    chips: records.map((record) => ({ id: record.id, label: bitableRecordTitle(target, record, ctx) })),
  };
}
