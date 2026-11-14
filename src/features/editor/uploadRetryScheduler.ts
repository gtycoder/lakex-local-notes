/**
 * 失败图后台补拉的调度判据（261114 二批）。
 *
 * 用户口径：「不到迫不得已不能直接失败，要多试几次」。主进程一次失败后，uploadJournal 记 error + attempts；
 * 桌面 EditorTab 与移动端 LakeEditor(journalRecovery) 共用本模块决定「还该不该再试、等多久」。
 * 只做纯计算（无定时器），实际 setTimeout 由宿主负责，便于单测。
 */
import { MAX_UPLOAD_AUTO_RETRIES, uploadRetryDelayMs, type UploadJournalEntry } from "./uploadJournal";

/** 该失败项还要不要自动补拉；要 → 返回等待毫秒数，不要 → null。 */
export function uploadRetryDelayForEntry(entry: UploadJournalEntry): number | null {
  if (entry.status !== "error") return null;
  if (!entry.url) return null;
  const attempts = entry.attempts ?? 1;
  if (attempts > MAX_UPLOAD_AUTO_RETRIES) return null;
  return uploadRetryDelayMs(attempts);
}
