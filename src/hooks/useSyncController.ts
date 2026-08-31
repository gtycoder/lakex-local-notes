import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { native } from "../lib/native";
import { getNativeErrorCode } from "../lib/nativeErrors";
import type { SettingsCategory } from "../components/SettingsPanel";
import type { SyncToastData } from "../components/SyncToast";
import type { SyncStatus } from "../lib/types";

interface SyncControllerInput {
  setSync: Dispatch<SetStateAction<SyncStatus>>;
  setCloudConfigured: Dispatch<SetStateAction<boolean>>;
  setSyncToast: Dispatch<SetStateAction<SyncToastData | null>>;
  setConflictSnapshotNotice: Dispatch<SetStateAction<Array<{ noteId: string; title: string }>>>;
  setSettingsCategory: Dispatch<SetStateAction<SettingsCategory>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  showSyncToast: (data: SyncToastData) => void;
}

/** Owns the user-triggered sync feedback loop; App keeps only its state ownership. */
export function useSyncController({
  setSync,
  setCloudConfigured,
  setSyncToast,
  setConflictSnapshotNotice,
  setSettingsCategory,
  setSettingsOpen,
  showSyncToast,
}: SyncControllerInput): () => Promise<void> {
  // P2-6：12s 冲突提醒定时器句柄——重复触发清旧、卸载清尾
  const conflictTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (conflictTimerRef.current !== null) window.clearTimeout(conflictTimerRef.current);
  }, []);
  return useCallback(async () => {
    // 对齐思源：同步过程只在状态栏按钮上反映（syncing 转圈/完成还原），成功不打扰；
    // 仅失败与未配置需要用户介入时才弹 toast。
    const unsubscribe = native.onSyncProgress((progress) => {
      if (progress.error) {
        setSync((current) => ({ ...current, phase: "error", message: progress.error || "同步失败" }));
        showSyncToast({ kind: "error", title: "同步失败", message: progress.error || "同步失败" });
        return;
      }
      setSync((current) => ({ ...current, phase: "syncing", message: progress.message }));
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
      const quickFailed = Boolean(result.quickNotes?.error);
      const resultMessage = quickFailed
        ? "同步完成：Lake 已完成；小记同步失败"
        : `同步完成：Lake 上传 ${result.uploaded}，下载 ${result.downloaded}${result.quickNotes ? `；小记 上传 ${result.quickNotes.uploaded}，下载 ${result.quickNotes.downloaded}` : ""}`;
      setSync((current) => ({ ...current, phase: quickFailed ? "error" : "success", message: resultMessage, lastSyncedAt: result.completedAt, pendingChanges: 0 }));
      if (result.supersededNotes.length > 0) {
        setConflictSnapshotNotice(result.supersededNotes.map((item) => ({ noteId: item.id, title: item.title })));
        if (conflictTimerRef.current !== null) window.clearTimeout(conflictTimerRef.current);
        conflictTimerRef.current = window.setTimeout(() => {
          conflictTimerRef.current = null;
          setConflictSnapshotNotice([]);
        }, 12000);
      }
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
  }, [setSync, setCloudConfigured, setSyncToast, setConflictSnapshotNotice, setSettingsCategory, setSettingsOpen, showSyncToast]);
}
