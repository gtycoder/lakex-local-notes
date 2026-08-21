import { useCallback, type Dispatch, type SetStateAction } from "react";
import { native } from "../lib/native";
import { getNativeErrorCode } from "../lib/nativeErrors";
import type { SettingsCategory } from "../components/SettingsPanel";
import type { SyncToastData } from "../components/SyncToast";
import type { SyncProgress, SyncStatus } from "../lib/types";

interface SyncControllerInput {
  setSync: Dispatch<SetStateAction<SyncStatus>>;
  setCloudConfigured: Dispatch<SetStateAction<boolean>>;
  setSyncProgress: Dispatch<SetStateAction<SyncProgress | null>>;
  setSyncToast: Dispatch<SetStateAction<SyncToastData | null>>;
  setConflictSnapshotNotice: Dispatch<SetStateAction<Array<{ noteId: string; title: string }>>>;
  setSettingsCategory: Dispatch<SetStateAction<SettingsCategory>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  showSyncToast: (data: SyncToastData) => void;
  refreshPendingSummary: () => void;
}

/** Owns the user-triggered sync feedback loop; App keeps only its state ownership. */
export function useSyncController({
  setSync,
  setCloudConfigured,
  setSyncProgress,
  setSyncToast,
  setConflictSnapshotNotice,
  setSettingsCategory,
  setSettingsOpen,
  showSyncToast,
  refreshPendingSummary,
}: SyncControllerInput): () => Promise<void> {
  return useCallback(async () => {
    setSyncProgress(null);
    showSyncToast({ kind: "busy", title: "正在同步", message: "准备同步...", progress: { phase: "connect", message: "准备同步..." } });
    const unsubscribe = native.onSyncProgress((progress) => {
      setSyncProgress(progress);
      if (progress.error) {
        setSync((current) => ({ ...current, phase: "error", message: progress.error || "同步失败" }));
        showSyncToast({ kind: "error", title: "同步失败", message: progress.error || "同步失败" });
        return;
      }
      setSync((current) => ({ ...current, phase: "syncing", message: progress.message }));
      setSyncToast((current) => current && current.kind === "busy" ? { ...current, progress, message: progress.message } : current);
    });
    try {
      const settings = await native.getS3Settings();
      setCloudConfigured(Boolean(settings));
      const openSettings = () => { setSettingsCategory("sync"); setSettingsOpen(true); };
      if (!settings) {
        setSync((current) => ({ ...current, phase: "idle", message: "尚未配置云同步" }));
        showSyncToast({ kind: "unavailable", title: "尚未配置云同步", message: "请先配置 S3，完成后即可开始同步。", onConfigure: openSettings });
        return;
      }
      const result = await native.syncNow();
      const lakeMessage = `Lake：上传 ${result.uploaded}，下载 ${result.downloaded}，冲突 ${result.conflicts}`;
      const quickMessage = result.quickNotes?.error
        ? "；小记同步失败（Lake 已完成）"
        : result.quickNotes ? `；小记：上传 ${result.quickNotes.uploaded}，下载 ${result.quickNotes.downloaded}，冲突 ${result.quickNotes.conflicts}` : "";
      const resultMessage = `同步完成：${lakeMessage}${quickMessage}`;
      const superseded = result.supersededNotes && result.supersededNotes.length > 0
        ? `远端修改已覆盖本地 ${result.supersededNotes.length} 篇（${result.supersededNotes.slice(0, 3).map((n) => `「${n.title}」`).join("、")}${result.supersededNotes.length > 3 ? " 等" : ""}），本地修改已存入该文档的历史版本。`
        : "";
      setSync((current) => ({ ...current, phase: result.quickNotes?.error ? "error" : "success", message: resultMessage, lastSyncedAt: result.completedAt, pendingChanges: 0 }));
      refreshPendingSummary();
      if (result.supersededNotes.length > 0) {
        setConflictSnapshotNotice(result.supersededNotes.map((item) => ({ noteId: item.id, title: item.title })));
        window.setTimeout(() => setConflictSnapshotNotice([]), 12000);
      }
      showSyncToast({ kind: result.quickNotes?.error ? "error" : "ok", title: "同步完成", message: `${lakeMessage}${quickMessage}`, detail: superseded || undefined });
    } catch (error) {
      // V5 Phase 3：CANCELLED（用户取消同步）不弹 toast，仅归位 idle 状态
      if (getNativeErrorCode(error) === "CANCELLED") {
        setSync((current) => ({ ...current, phase: "idle", message: "同步已取消" }));
        return;
      }
      if (getNativeErrorCode(error) === "NOT_CONFIGURED") {
        setSync((current) => ({ ...current, phase: "idle", message: "尚未配置云同步" }));
        showSyncToast({ kind: "unavailable", title: "尚未配置云同步", message: "请先配置 S3，完成后即可开始同步。", onConfigure: () => { setSettingsCategory("sync"); setSettingsOpen(true); } });
      } else {
        const errorMessage = "同步失败，请检查网络或 S3 配置";
        setSync((current) => ({ ...current, phase: "error", message: errorMessage }));
        showSyncToast({ kind: "error", title: "同步失败", message: errorMessage });
      }
    } finally {
      unsubscribe();
    }
  }, [setSync, setCloudConfigured, setSyncProgress, setSyncToast, setConflictSnapshotNotice, setSettingsCategory, setSettingsOpen, showSyncToast, refreshPendingSummary]);
}
