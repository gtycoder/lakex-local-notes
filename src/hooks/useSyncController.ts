import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { native } from "../lib/native";
import { getNativeErrorCode, getNativeErrorMessage, getNativeSyncErrorInfo } from "../lib/nativeErrors";
import type { SettingsCategory } from "../components/app/SettingsPanel";
import type { SyncToastData } from "../components/app/SyncToast";
import type { SyncStatus } from "../lib/types";
import type { NoticeState } from "../desktop/desktopTypes";
import { canTouchNetwork, cloudStateHint, cloudStateOf } from "../core/cloudState.js";
import {
  SYNC_EPOCH_MISMATCH_ACTION_LABEL, SYNC_EPOCH_MISMATCH_MESSAGE, SYNC_EPOCH_MISMATCH_TITLE,
  SYNC_RETRYABLE_TITLE, SYNC_RETRY_DELAY_MS, SYNC_RETRY_SUCCEEDED_MESSAGE,
  retryableRetryMessage, retryableStatusMessage,
} from "../lib/syncFailureText";

interface SyncControllerInput {
  setSync: Dispatch<SetStateAction<SyncStatus>>;
  setCloudConfigured: Dispatch<SetStateAction<boolean>>;
  setCloudEnabled: Dispatch<SetStateAction<boolean>>;
  setSyncToast: Dispatch<SetStateAction<SyncToastData | null>>;
  setConflictSnapshotNotice: Dispatch<SetStateAction<Array<{ noteId: string; title: string }>>>;
  setSettingsCategory: Dispatch<SetStateAction<SettingsCategory>>;
  setSettingsOpen: Dispatch<SetStateAction<boolean>>;
  showSyncToast: (data: SyncToastData) => void;
  /** 手动同步完成且存在被覆盖留档时，发即时状态栏提示（与自动同步路径同一函数）。 */
  showNoticeWithAction: (text: string, action: NoticeState["action"]) => void;
  setHistoryNoteId: Dispatch<SetStateAction<string | null>>;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
}

/** Owns the user-triggered sync feedback loop; App keeps only its state ownership. */
export function useSyncController({
  setSync,
  setCloudConfigured,
  setCloudEnabled,
  setSyncToast,
  setConflictSnapshotNotice,
  setSettingsCategory,
  setSettingsOpen,
  showSyncToast,
  showNoticeWithAction,
  setHistoryNoteId,
  setHistoryOpen,
}: SyncControllerInput): () => Promise<void> {
  // P2-6：12s 冲突提醒定时器句柄——重复触发清旧、卸载清尾
  const conflictTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (conflictTimerRef.current !== null) window.clearTimeout(conflictTimerRef.current);
  }, []);
  return useCallback(async () => {
    const openSettings = () => { setSettingsCategory("sync"); setSettingsOpen(true); };
    // 对齐思源：同步过程只在状态栏按钮上反映（syncing 转圈/完成还原），成功不打扰；
    // 仅失败与未配置需要用户介入时才弹 toast。
    const unsubscribe = native.onSyncProgress((progress) => {
      if (progress.error) {
        // 261028 P1：广播里带了分类 ⇒ 可重试的不当硬失败（与自动同步路径 useSyncProgress 同口径）。
        const info = getNativeSyncErrorInfo({ syncCode: progress.errorCode, syncClass: progress.errorClass });
        if (info?.className === "retryable") {
          setSync((current) => ({ ...current, phase: "idle", message: retryableStatusMessage(info.code) }));
          return;
        }
        if (info?.className === "action-required" && info.code === "epoch-mismatch") {
          setSync((current) => ({ ...current, phase: "error", message: SYNC_EPOCH_MISMATCH_MESSAGE }));
          showSyncToast({ kind: "error", title: SYNC_EPOCH_MISMATCH_TITLE, message: SYNC_EPOCH_MISMATCH_MESSAGE, action: { label: SYNC_EPOCH_MISMATCH_ACTION_LABEL, onClick: openSettings } });
          return;
        }
        setSync((current) => ({ ...current, phase: "error", message: progress.error || "同步失败" }));
        showSyncToast({ kind: "error", title: "同步失败", message: progress.error || "同步失败" });
        return;
      }
      setSync((current) => ({ ...current, phase: "syncing", message: progress.message }));
    });
    try {
      const settings = await native.getS3Settings();
      setCloudConfigured(Boolean(settings));
      // 单一判据（core/cloudState）：没配置 / 关了云同步 ⇒ **一个请求都不发**
      //（用户 261006：关闭云同步 = 当作纯离线本地空间；手动点同步也一样）。
      const cfg = await native.getSyncSettings();
      setCloudEnabled(cfg.enabled);
      const state = cloudStateOf(Boolean(settings), cfg);
      if (state === "offline") {
        setSync((current) => ({ ...current, phase: "idle", message: "云同步已关闭" }));
        showSyncToast({ kind: "unavailable", title: "云同步已关闭", message: cloudStateHint("offline") ?? "当前按纯本地空间工作，不会联网。", onConfigure: openSettings });
        return;
      }
      if (!canTouchNetwork(state)) {
        setSync((current) => ({ ...current, phase: "idle", message: "尚未配置云同步" }));
        showSyncToast({ kind: "unavailable", title: "尚未配置云同步", message: "请先配置 S3，完成后即可开始同步。", onConfigure: openSettings });
        return;
      }
      // 261028 P1：可重试失败（典型 = 另一台设备持有发布锁）自动再跑一次；
      // autoRetried 是**本次调用内**的局部标志（只有一次重试，不会递归/无限重试）。
      let autoRetried = false;
      for (;;) {
        try {
          const result = await native.syncNow();
          const quickFailed = Boolean(result.quickNotes?.error);
          const resultMessage = quickFailed
            ? "同步完成：Lake 已完成；小记同步失败"
            : `同步完成：Lake 上传 ${result.uploaded}，下载 ${result.downloaded}${result.quickNotes ? `；小记 上传 ${result.quickNotes.uploaded}，下载 ${result.quickNotes.downloaded}` : ""}`;
          setSync((current) => ({ ...current, phase: quickFailed ? "error" : "success", message: resultMessage, lastSyncedAt: result.completedAt, pendingChanges: 0 }));
          // 重试成功：把「正在重试」的常驻 busy toast 换成短提示（普通成功仍不打扰）。
          // 小记同步失败时状态已置 error，不再报「已成功」，避免自相矛盾。
          if (autoRetried) {
            showSyncToast(quickFailed
              ? { kind: "unavailable", title: "同步完成，小记同步失败", message: resultMessage }
              : { kind: "ok", title: "同步完成", message: SYNC_RETRY_SUCCEEDED_MESSAGE });
          }
          if (result.supersededNotes.length > 0) {
            setConflictSnapshotNotice(result.supersededNotes.map((item) => ({ noteId: item.id, title: item.title })));
            // 手动同步与自动同步（useSyncProgress）对齐：完成即提示，可点“查看历史”直达该快照。
            const first = result.supersededNotes[0];
            showNoticeWithAction(`远端修改已覆盖本地 ${result.supersededNotes.length} 篇（已存历史）`, {
              label: "查看历史",
              onClick: () => { setHistoryNoteId(first.id); setHistoryOpen(true); },
            });
            if (conflictTimerRef.current !== null) window.clearTimeout(conflictTimerRef.current);
            conflictTimerRef.current = window.setTimeout(() => {
              conflictTimerRef.current = null;
              setConflictSnapshotNotice([]);
            }, 12000);
          }
          return;
        } catch (error) {
          // V5 Phase 3：CANCELLED（用户取消同步）不弹 toast，仅归位 idle 状态
          if (getNativeErrorCode(error) === "CANCELLED") {
            // 重试期间挂的是常驻 busy toast：取消后必须收掉，否则会一直转圈。
            if (autoRetried) setSyncToast(null);
            setSync((current) => ({ ...current, phase: "idle", message: "同步已取消" }));
            return;
          }
          if (getNativeErrorCode(error) === "NOT_CONFIGURED") {
            setSync((current) => ({ ...current, phase: "idle", message: "尚未配置云同步" }));
            showSyncToast({ kind: "unavailable", title: "尚未配置云同步", message: "请先配置 S3，完成后即可开始同步。", onConfigure: openSettings });
            return;
          }
          const detail = getNativeErrorMessage(error).trim();
          const syncError = getNativeSyncErrorInfo(error);
          // 可重试（锁被另一台设备占用等）：不当硬失败；等 2.5s 再跑一次（仅一次）。
          if (syncError?.className === "retryable" && !autoRetried) {
            autoRetried = true;
            setSync((current) => ({ ...current, phase: "syncing", message: retryableStatusMessage(syncError.code) }));
            // busy 常驻（不自动消失）：重试结束会被下面的 ok/error 覆盖，避免 2.5s 空档像「卡住」。
            showSyncToast({ kind: "busy", title: SYNC_RETRYABLE_TITLE, message: retryableRetryMessage(syncError.code, detail) });
            await new Promise<void>((resolve) => { window.setTimeout(resolve, SYNC_RETRY_DELAY_MS); });
            continue;
          }
          // epoch 不一致：本机与云端不是同一套数据，必须人工处理 ⇒ 直接给「从云端恢复」的指路入口。
          if (syncError?.className === "action-required" && syncError.code === "epoch-mismatch") {
            setSync((current) => ({ ...current, phase: "error", message: SYNC_EPOCH_MISMATCH_MESSAGE }));
            showSyncToast({ kind: "error", title: SYNC_EPOCH_MISMATCH_TITLE, message: SYNC_EPOCH_MISMATCH_MESSAGE, action: { label: SYNC_EPOCH_MISMATCH_ACTION_LABEL, onClick: openSettings } });
            return;
          }
          // 真实原因必须可见（审计 260918 F2/D1）：留档失败、清单不可读等同样走这条路径，
          // 统一成"检查网络或 S3 配置"会把用户引向错误方向（自动同步路径本就广播真实 error 文案）。
          const errorMessage = detail ? `同步失败：${detail}` : "同步失败，请检查网络或 S3 配置";
          setSync((current) => ({ ...current, phase: "error", message: errorMessage }));
          showSyncToast({ kind: "error", title: "同步失败", message: errorMessage });
          return;
        }
      }
    } finally {
      unsubscribe();
    }
  }, [setSync, setCloudConfigured, setSyncToast, setConflictSnapshotNotice, setSettingsCategory, setSettingsOpen, showSyncToast, showNoticeWithAction, setHistoryNoteId, setHistoryOpen]);
}
