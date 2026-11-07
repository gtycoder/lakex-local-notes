/**
 * 「创建副本」结果 → 用户可见提示（261107 单一来源）。
 * 桌面（components/app/duplicateNotesFeedback）与移动（mobile/ui/duplicateNotesResult）都只保留薄封装。
 */
import { DUPLICATE_NOTES_REASON_LABELS, type DuplicateNotesReason } from "./duplicateNotes";

export interface DuplicateNotesResultLike {
  ok: boolean;
  results?: ReadonlyArray<{ id: string; ok: boolean; reason?: DuplicateNotesReason }>;
  summary?: { done: number };
  reason?: DuplicateNotesReason;
  message?: string;
}

export interface DuplicateNotice {
  kind: "success" | "partial" | "error";
  text: string;
  failedIds: string[];
}

export function duplicateReasonLabel(reason: DuplicateNotesReason | undefined | null): string {
  return (reason && DUPLICATE_NOTES_REASON_LABELS[reason]) || "未知原因";
}

function reasonSummary(failed: ReadonlyArray<{ reason?: DuplicateNotesReason }>): string {
  // 单条失败不再重复「1 项：1 项：」；多条按原因计数（最多 2 类）。
  if (failed.length === 1) return duplicateReasonLabel(failed[0]?.reason);
  const counts = new Map<DuplicateNotesReason, number>();
  for (const item of failed) {
    const reason = item.reason ?? "failed";
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([reason, count]) => count + " 项：" + duplicateReasonLabel(reason))
    .join("；");
}

export function duplicateNotesNotice(result: DuplicateNotesResultLike): DuplicateNotice {
  const failed = (result.results ?? []).filter((item) => !item.ok);
  const failedIds = failed.map((item) => item.id);
  const done = result.summary?.done ?? 0;
  if (result.ok) return { kind: "success", text: "已创建 " + done + " 个副本", failedIds };
  if (done > 0) {
    return { kind: "partial", text: "已创建 " + done + " 个副本，失败 " + failed.length + " 项：" + reasonSummary(failed), failedIds };
  }
  const overall = result.reason ? duplicateReasonLabel(result.reason) : "";
  const detail = failed.length > 0 ? reasonSummary(failed) : overall;
  return { kind: "error", text: "未创建副本" + (detail ? "：" + detail : ""), failedIds };
}
