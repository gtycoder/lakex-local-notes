/**
 * 移动端多维表「表单填写」的薄封装（261030 P0；261030 二轮把语义上收到 core）。
 *
 * 表单语义（可填字段 / 题目顺序 / 必填判空 / 提交值）**单一来源 = src/core/bitableForm.ts**，
 * 桌面 `BitableFormView` 与移动端共用；本文件只保留移动端需要的「把草稿写进表」这一步。
 * 移动端 P0 只做填写：不做表单编辑态 / 分享 / 二维码。
 */
import { addBitableRecordWithValues } from "../../core/bitableMutations";
import { bitableFormValues } from "../../core/bitableForm";
import type { BitableDoc } from "../../core/bitableDoc.js";

/**
 * 提交：把草稿写进表（新增记录）。
 * 提交值 = 表默认值 + 草稿（core 的 bitableFormValues），关联镜像走 `addBitableRecordWithValues` 唯一写入口。
 */
export function submitMobileForm(doc: BitableDoc, tableId: string, draft: Record<string, unknown>): { doc: BitableDoc; recordId: string } {
  const table = doc.tables.find((item) => item.id === tableId);
  if (!table) return { doc, recordId: "" };
  const { tables, recordId } = addBitableRecordWithValues(doc.tables, tableId, bitableFormValues(table, draft));
  return { doc: { ...doc, tables }, recordId };
}
