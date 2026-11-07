
/**
 * 「创建副本」结果 → 用户可见文案（261106 副本；桌面单条右键 / 多选右键 / 多选浮动条共用一套原因口径）。
 *
 * 契约来源：src/lib/types.ts 的 DuplicateNotesResultShape（core 纯逻辑 src/core/duplicateNotes.ts，
 * 桌面 IPC `duplicate_notes` 与移动端 `bridge.duplicateNotes` 同形同结果）。
 * 这里只做「逐条 reason → 中文」与「成功/部分失败摘要」，不碰 IPC。
 */
import type { DuplicateNotesReasonShape, DuplicateNotesResultShape } from "../../lib/types";
import { DUPLICATE_NOTES_REASON_LABELS } from "../../core/duplicateNotes";
import { duplicateNotesNotice } from "../../core/duplicateNotesReport";

/** 逐条拒绝原因 → 可读说明（261107：标签单源在 core，移动端复用同一份）。 */
export const DUPLICATE_NOTES_REASON_TEXT = DUPLICATE_NOTES_REASON_LABELS;

export function duplicateNotesReasonText(reason: DuplicateNotesReasonShape | undefined | null): string {
  return (reason && DUPLICATE_NOTES_REASON_TEXT[reason]) || "未知原因";
}

export interface DuplicateNotesNotice {
  /** success = 全部成功；partial = 有失败条目；error = 整批未执行。 */
  kind: "success" | "partial" | "error";
  /** 一行可见文案（条数 + 原因摘要）。 */
  text: string;
  /** 失败条目 id（调用方保留它们的选中态，方便重试）。 */
  failedIds: string[];
}

/**
 * 把「创建副本」结果收敛成可读提示：
 * 成功只说条数（「已创建 N 个副本」），部分失败追加失败条数与原因，整批未执行说「未创建副本：原因」。
 * 部分失败的原因按出现次数归并（最多列 2 类，避免提示条过长）。
 */
export function duplicateNotesResultNotice(result: DuplicateNotesResultShape): DuplicateNotesNotice {
  return duplicateNotesNotice(result);
}

/** 失败原因摘要（兼容旧导出；实现已收口到 core）。 */
export function duplicateReasonSummary(failed: ReadonlyArray<{ reason?: DuplicateNotesReasonShape }>): string {
  return duplicateNotesNotice({ ok: false, results: failed.map((item) => ({ id: "", ok: false, reason: item.reason })) }).text;
}
