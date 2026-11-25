/**
 * 上传日志自愈 / 补拉的**共享订阅效果**（docs/audit-261125/02-desktop-ui.md D-02 收口）。
 *
 * 收口对象 = 桌面 EditorTab 与共享 LakeEditor 各写过一份的「订阅 uploadJournal → error 按退避补拉
 * → 晚到结果触发重建」效果（两份近乎逐字复制 = 判据/退避预算的漂移源）。rebuild tick 留在各宿主
 * （EditorTab 的 rebuildTick / LakeEditor 的 recoveryTick）；挂载期回填（repairUploadCards /
 * resumePendingDocumentImageUploads）也留在各宿主，本文件只管「订阅 → 何时重建 / 何时补拉」。
 *
 * 判据背景（AGENTS §4「图片上传必须可恢复」）：晚到结果只有在正文仍存在同一 taskId 的未解决图卡时
 * 才值得重建一次（正常上传不触发）；失败项按退避（见 uploadRetryScheduler）后台补拉，attempts
 * 由 journal 累计、超预算才真正判失败。
 */
import { useEffect, useRef } from "react";
import { retryFailedDocumentImageUploads } from "./lakeRuntime";
import { hasUnresolvedImageTask } from "./uploadCardRepair";
import { subscribeUploadJournal } from "./uploadJournal";
import { uploadRetryDelayForEntry } from "./uploadRetryScheduler";

export interface UploadJournalRecoveryOptions {
  /** 只处理本篇的日志条目。 */
  noteId: string;
  /** false = 不订阅（LakeEditor 的 journalRecovery×mode 判据早退；EditorTab 恒 true）。 */
  enabled: boolean;
  /** 判定「正文里还有没有未解决图卡」时现取正文（各宿主的 latestDocumentRef）。 */
  getLatestDocument: () => string;
  /** 正文里仍有未解决图卡时触发一次重建（回填由各宿主的 rebuild tick 驱动）。 */
  onNeedRebuild: () => void;
}

/**
 * 订阅本体（判据单一来源）：返回挂载期 cleanup（订阅 + 补拉定时器一起收）。
 * enabled=false 时无订阅、无定时器，cleanup 为 no-op。
 */
export function attachUploadJournalRecovery({ noteId, enabled, getLatestDocument, onNeedRebuild }: UploadJournalRecoveryOptions): () => void {
  if (!enabled) return () => { /* 未启用：无订阅、无定时器 */ };
  const timers = new Set<number>();
  const off = subscribeUploadJournal((entry) => {
    if (entry.noteId !== noteId) return;
    if (entry.status === "error") {
      const delay = uploadRetryDelayForEntry(entry);
      if (delay != null) {
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          retryFailedDocumentImageUploads(noteId);
        }, delay);
        timers.add(timer);
      }
    }
    if (entry.status === "pending") return;
    if (!hasUnresolvedImageTask(getLatestDocument(), entry.taskId)) return;
    onNeedRebuild();
  });
  return () => {
    off();
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
  };
}

/**
 * 宿主一行接入：enabled/noteId 变化时重订阅；回调经 ref 取当次值，不进依赖
 * （否则每帧重订阅）。效果返回 attachUploadJournalRecovery 的 cleanup。
 */
export function useUploadJournalRecovery(options: UploadJournalRecoveryOptions): void {
  const { noteId, enabled } = options;
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => attachUploadJournalRecovery({
    noteId,
    enabled,
    getLatestDocument: () => latest.current.getLatestDocument(),
    onNeedRebuild: () => latest.current.onNeedRebuild(),
  }), [enabled, noteId]);
}
