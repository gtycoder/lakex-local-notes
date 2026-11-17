/**
 * 移动端多维表表单「填写草稿」的设备本地存储（261118 P1-5）。
 *
 * 现场：收集表填一半被切走 / 刷新 / 杀进程 ⇒ 草稿只在内存（useState draft），全部丢失。
 * 与 `mobileBitableViewPrefs` / `bitableNavStore` 同一口径：**只写 localStorage、不进正文、
 * 不标脏、不进 S3**（设备本地，换设备各记各的）。
 *
 * 三条语义（宁可丢草稿不给错值）：
 * - **恢复**：打开表单时按 key（noteId + viewId）回填未提交草稿 —— 挂载时**同步**完成，
 *   不进 effect、不 focus()，键盘/焦点稳定（不抢焦点）；
 * - **清空**：提交成功后删草稿（提交失败保留，用户不用重填）；
 * - **丢弃**：表单题目指纹（题目 id:type 有序集合）与落盘时不一致 ⇒ 删旧草稿、不回填
 *   （formFieldIds 变 / 字段类型变 ⇒ 旧值可能是错值）。
 */
import type { BitableField } from "../../core/bitableDoc.js";
import { writeLocalStorage } from "../../lib/localStorageSafe";

/** 设备本地键前缀（lakex-local-notes-mobile. 族；不进 S3）。 */
export const MOBILE_BITABLE_FORM_DRAFT_KEY_PREFIX = "lakex-local-notes-mobile.bitable-form-draft.";

/** 草稿 key = noteId + viewId（同一文档不同表单视图各记各的）。 */
export function mobileFormDraftKey(noteId: string, viewId: string): string {
  return MOBILE_BITABLE_FORM_DRAFT_KEY_PREFIX + noteId + "." + viewId;
}

/** 表单题目指纹：题目 id + 类型的有序集合（顺序 = 题目顺序）。 */
export function mobileFormDraftSignature(fields: readonly BitableField[]): string {
  return fields.map((field) => field.id + ":" + field.type).join("|");
}

interface StoredFormDraft {
  signature: string;
  values: Record<string, unknown>;
}

/**
 * 读草稿：没存过 / 坏值 / 指纹不匹配 ⇒ null。
 * 坏值与过期草稿**顺手删掉**（弃用旧草稿：宁可丢草稿不给错值）；读删除都是幂等的，
 * StrictMode 双跑也不会出错。
 */
export function readMobileFormDraft(
  noteId: string,
  viewId: string,
  fields: readonly BitableField[],
): Record<string, unknown> | null {
  const key = mobileFormDraftKey(noteId, viewId);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null; // 存储不可用：当没存过
  }
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearMobileFormDraft(noteId, viewId);
    return null;
  }
  const stored = parsed as Partial<StoredFormDraft> | null;
  if (
    !stored || typeof stored !== "object" ||
    typeof stored.signature !== "string" ||
    !stored.values || typeof stored.values !== "object" || Array.isArray(stored.values)
  ) {
    clearMobileFormDraft(noteId, viewId);
    return null;
  }
  if (stored.signature !== mobileFormDraftSignature(fields)) {
    clearMobileFormDraft(noteId, viewId);
    return null;
  }
  return stored.values;
}

/** 写草稿（每次用户改动即落盘；值都是表单控件的纯数据，JSON 安全）。 */
export function writeMobileFormDraft(
  noteId: string,
  viewId: string,
  fields: readonly BitableField[],
  values: Record<string, unknown>,
): void {
  const payload: StoredFormDraft = { signature: mobileFormDraftSignature(fields), values };
  try {
    writeLocalStorage(mobileFormDraftKey(noteId, viewId), JSON.stringify(payload));
  } catch {
    // 值不可序列化（不该发生）：宁可不落草稿也不抛进渲染。
  }
}

/** 删草稿（提交成功后 / 弃用过期草稿时）；幂等。 */
export function clearMobileFormDraft(noteId: string, viewId: string): void {
  try {
    localStorage.removeItem(mobileFormDraftKey(noteId, viewId));
  } catch {
    // 存储不可用：本来也没有草稿可清
  }
}
