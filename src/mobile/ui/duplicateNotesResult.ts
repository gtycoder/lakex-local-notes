/**
 * 「创建副本」结果 → 移动端可读文案（261106 副本）。
 *
 * 契约来源：src/lib/types.ts 的 DuplicateNotesResultShape（core 纯逻辑 src/core/duplicateNotes.ts，
 * 桌面 IPC `duplicate_notes` 与移动端 `bridge.duplicateNotes` 同形同结果）。
 * 语义与桌面 src/components/app/duplicateNotesFeedback.ts 同一套（移动端不引桌面 UI 组件，文案同源人工对齐）：
 * 成功只说条数（「已创建 N 个副本」），部分失败追加失败条数与原因，整批未执行说「未创建副本：原因」。
 */
import type { DuplicateNotesReasonShape, DuplicateNotesResultShape } from "../../lib/types";
import { DUPLICATE_NOTES_REASON_LABELS } from "../../core/duplicateNotes";

/** 逐条拒绝原因 → 可读说明（261107：标签单源在 core，桌面复用同一份）。 */
export const DUPLICATE_REASON_LABELS = DUPLICATE_NOTES_REASON_LABELS;

export function duplicateReasonLabel(reason: DuplicateNotesReasonShape | undefined | null): string {
  return (reason && DUPLICATE_REASON_LABELS[reason]) || "未知原因";
}

export interface DuplicateNotice {
  /** success = 全部成功；partial = 有失败条目；error = 整批未执行。 */
  kind: "success" | "partial" | "error";
  /** 一行可见文案。 */
  text: string;
  /** 失败条目 id（调用方保留这些条的选中态，方便重试）。 */
  failedIds: string[];
}

/** 失败原因摘要：按原因计数（最多列 2 类，避免提示条过长）；同原因多条时才带条数。 */
function reasonSummary(failed: ReadonlyArray<{ reason?: DuplicateNotesReasonShape }>): string {
  const counts = new Map<DuplicateNotesReasonShape, number>();
  for (const item of failed) {
    const reason = item.reason ?? "failed";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([reason, count]) => duplicateReasonLabel(reason) + (count > 1 ? " " + count + " 项" : ""))
    .join("、");
}

export function duplicateResultNotice(result: DuplicateNotesResultShape): DuplicateNotice {
  const failed = (result.results ?? []).filter((item) => !item.ok);
  const failedIds = failed.map((item) => item.id);
  const done = result.summary?.done ?? 0;
  if (result.ok) return { kind: "success", text: "已创建 " + done + " 个副本", failedIds };
  if (done > 0) {
    return {
      kind: "partial",
      text: "已创建 " + done + " 个副本，失败 " + failed.length + " 项：" + reasonSummary(failed),
      failedIds,
    };
  }
  const overall = result.reason ? duplicateReasonLabel(result.reason) : "";
  const detail = failed.length > 0 ? reasonSummary(failed) : overall;
  return { kind: "error", text: "未创建副本" + (detail ? "：" + detail : ""), failedIds };
}
