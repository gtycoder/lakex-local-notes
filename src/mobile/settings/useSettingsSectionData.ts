import { useCallback, useEffect, useState } from "react";
import type { AppInfo, CacheSummary } from "../../core/ports";
import type { HistoryMobileSettings } from "../bridge";
import { bridge } from "../bridge";
import { getNativeErrorMessage, reportNativeActionError } from "../../lib/nativeErrors";
import { mobileAppInfoPort } from "../native/appInfoPort";
import { mobileCachePort } from "../native/cachePort";
import { showToast } from "../ui/toastBus";
import { notifyHistorySettingsChanged } from "../lib/historySettingsSync";

type OrphanAsset = { id: number; noteId: string; filename: string; size: number; mimeType: string };
type Diagnostics = {
  noteCount: number;
  folderCount: number;
  quickNoteCount: number;
  resourceCount: number;
  orphanCount: number;
  gcPendingCount: number;
  snapshotCount: number;
  dbBytes: number;
};

/** 设置子页的数据所有者：历史设置、资源清理、缓存统计、关于/诊断。 */
export function useSettingsSectionData(sections: {
  historyOpen: boolean;
  resourcesOpen: boolean;
  cacheOpen: boolean;
  aboutOpen: boolean;
}) {
  const { historyOpen, resourcesOpen, cacheOpen, aboutOpen } = sections;
  const [history, setHistory] = useState<HistoryMobileSettings | null>(null);
  const [orphans, setOrphans] = useState<OrphanAsset[]>([]);
  const [orphanBusy, setOrphanBusy] = useState(false);
  const [gcMsg, setGcMsg] = useState("");
  const [cacheMsg, setCacheMsg] = useState("");
  const [cacheSummary, setCacheSummary] = useState<CacheSummary | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);

  const updateHistory = useCallback((patch: Partial<HistoryMobileSettings>) => {
    setHistory((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      void bridge.saveHistorySettings(next)
        .then(() => {
          // MOB-17：落盘成功后广播，定时快照等订阅方据此重挂（不必重启 App）。
          notifyHistorySettingsChanged(next);
        })
        .catch(() => {
          // 乐观 UI 不能停留在未落盘的值；失败后重新读取真实设置并明确提示。
          void bridge.getHistorySettings().then(setHistory).catch((error) => {
            reportNativeActionError("回读历史设置", error);
            setHistory(current);
          });
          showToast("历史设置保存失败，已恢复原值", { type: "error" });
        });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!historyOpen) return;
    void bridge.getHistorySettings().then(setHistory).catch((error) => reportNativeActionError("读取历史设置", error));
  }, [historyOpen]);

  useEffect(() => {
    if (!resourcesOpen) return;
    void bridge.listOrphanAssets().then(setOrphans).catch((error) => {
      reportNativeActionError("读取孤儿资源", error);
      setOrphans([]);
    });
  }, [resourcesOpen]);

  useEffect(() => {
    if (!aboutOpen) return;
    void mobileAppInfoPort.getAppInfo().then(setAppInfo).catch((error) => reportNativeActionError("读取应用信息", error));
    void bridge.getDiagnostics().then(setDiagnostics).catch((error) => reportNativeActionError("读取诊断信息", error));
  }, [aboutOpen]);

  useEffect(() => {
    if (!cacheOpen) return;
    void mobileCachePort.getCacheSummary().then(setCacheSummary).catch((error) => reportNativeActionError("读取缓存统计", error));
  }, [cacheOpen]);

  const cleanOrphans = useCallback(async () => {
    setOrphanBusy(true);
    try {
      await bridge.cleanOrphanAssets();
      setOrphans([]);
    } catch (error) {
      setOrphans([]);
      reportNativeActionError("清理孤儿资源", error);
    } finally {
      setOrphanBusy(false);
    }
  }, []);

  const deleteOrphan = useCallback(async (id: number) => {
    try {
      await bridge.deleteOrphanAsset(id);
      setOrphans((current) => current.filter((item) => item.id !== id));
    } catch (error) {
      reportNativeActionError("删除孤儿资源", error);
    }
  }, []);

  const cleanCloud = useCallback(async () => {
    setGcMsg("清理中…");
    setOrphanBusy(true);
    try {
      const result = await bridge.gcDeepCleanup();
      setGcMsg(`已清理 ${result.deletedCount} 个对象（候选 ${result.candidateCount}）`);
    } catch (error) {
      setGcMsg("清理失败：" + getNativeErrorMessage(error));
      reportNativeActionError("云端清理", error);
    } finally {
      setOrphanBusy(false);
    }
  }, []);

  const clearCache = useCallback(async () => {
    setCacheMsg("清理中…");
    try {
      const result = await mobileCachePort.clearDerivedCaches();
      setCacheMsg("已清理：blob " + (result.cleared.runtimeBlobBytes ?? 0) + " 项");
    } catch (error) {
      setCacheMsg("清理失败：" + (error as Error).message);
    }
    void mobileCachePort.getCacheSummary().then(setCacheSummary).catch((error) => reportNativeActionError("读取缓存统计", error));
  }, []);

  return {
    history,
    updateHistory,
    orphans,
    orphanBusy,
    gcMsg,
    cleanOrphans,
    deleteOrphan,
    cleanCloud,
    cacheMsg,
    cacheSummary,
    clearCache,
    appInfo,
    diagnostics,
  };
}
