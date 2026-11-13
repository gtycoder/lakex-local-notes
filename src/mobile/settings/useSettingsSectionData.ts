import { useCallback, useEffect, useState } from "react";
import type { AppInfo, CacheSummary } from "../../core/ports";
import type { HistoryMobileSettings } from "../bridge";
import { bridge } from "../bridge";
import { getNativeErrorMessage, reportNativeActionError } from "../../lib/nativeErrors";
import { mobileAppInfoPort } from "../native/appInfoPort";
import { mobileCachePort } from "../native/cachePort";
import { nativeCleanupUpdateFiles } from "../native/updateManager";
import { showToast } from "../ui/toastBus";
import { notifyHistorySettingsChanged } from "../lib/historySettingsSync";
import { formatBytes } from "../../lib/formatBytes";

/** 未引用的本地文件（资源管理「查看」明细面板与清理动作共用）。 */
export type OrphanAsset = { id: number; noteId: string; filename: string; size: number; mimeType: string };
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
  /** 云端清理「预览」结果（dryRun 只统计不删）。没有它就不允许真删 —— 见 cleanCloud 的守卫。 */
  const [gcPreview, setGcPreview] = useState<{ count: number; bytes: number | null } | null>(null);
  /** 预览或真删进行中（与孤儿清理的 orphanBusy 分开：两者互不阻塞）。 */
  const [gcBusy, setGcBusy] = useState(false);
  const [cacheMsg, setCacheMsg] = useState("");
  const [cacheSummary, setCacheSummary] = useState<CacheSummary | null>(null);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  /** 261103 十四批：本地资源占用（note-assets + quick-notes/assets；原生统计，Web 预览为 null）。 */
  const [assetUsage, setAssetUsage] = useState<{ files: number; bytes: number } | null>(null);

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
    void bridge.getAssetUsage().then(setAssetUsage).catch((error) => {
      reportNativeActionError("读取资源占用", error);
      setAssetUsage(null);
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

  /**
   * 云端清理第一步 = 预览（dryRun，只统计不删）。
   * 结果同时给 ResourceCleanupSheet（将删数量/字节）与设置页结果行（失败原因）。
   */
  const previewCloud = useCallback(async () => {
    setGcBusy(true);
    // 预览成功不写结果行（数字由 ResourceCleanupSheet 的预览块展示，避免同一数字在设置页/面板各说一遍）；
    // 失败必须留一句可见原因。
    setGcMsg("");
    try {
      const result = await bridge.gcDeepCleanup({ dryRun: true });
      setGcPreview({ count: result.candidateCount, bytes: result.bytes });
    } catch (error) {
      setGcPreview(null);
      setGcMsg("预览失败：" + getNativeErrorMessage(error));
      reportNativeActionError("云端清理预览", error);
    } finally {
      setGcBusy(false);
    }
  }, []);

  /** 云端清理第二步 = 真删。必须先有预览（防误触一键删云端）；删完清预览并回写结果。 */
  const cleanCloud = useCallback(async () => {
    const preview = gcPreview;
    if (!preview) {
      setGcMsg("请先点「预览」确认要清理的对象");
      return;
    }
    if (preview.count === 0) {
      setGcMsg("没有可清理的云端文件");
      return;
    }
    setGcBusy(true);
    setGcMsg("清理中…");
    try {
      const result = await bridge.gcDeepCleanup({ dryRun: false });
      setGcPreview(null);
      setGcMsg(`已清理 ${result.deletedCount} 个对象` + (result.bytes === null ? "" : `（${formatBytes(result.bytes)}）`));
    } catch (error) {
      setGcMsg("清理失败：" + getNativeErrorMessage(error));
      reportNativeActionError("云端清理", error);
    } finally {
      setGcBusy(false);
    }
  }, [gcPreview]);

  /** 关闭清理面板时丢弃预览（换了云端内容后旧数字会骗人）。 */
  const clearGcPreview = useCallback(() => {
    setGcPreview(null);
  }, []);

  const clearCache = useCallback(async () => {
    setCacheMsg("清理中…");
    try {
      const result = await mobileCachePort.clearDerivedCaches();
      // 261109：更新中心的 staging（应用专属外部目录）与 cache/updates 残留一并清掉
      // （卸载由系统清两处目录；主动清理走这里，避免下载中途取消/失败留下的安装包）。
      void nativeCleanupUpdateFiles();
      // 261105：清缓存的真实内容是「派生搜索缓存（FTS/账本）+ 渲染临时文件」，索引在后台重建。
      const clearedEntries = result.cleared.tempFileBytes ?? 0;
      setCacheMsg(clearedEntries > 0
        ? "已清理派生搜索缓存 " + clearedEntries + " 条与渲染临时文件（索引在后台重建）"
        : "已清理派生缓存与渲染临时文件（索引在后台重建）");
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
    gcPreview,
    gcBusy,
    cleanOrphans,
    deleteOrphan,
    previewCloud,
    cleanCloud,
    clearGcPreview,
    cacheMsg,
    cacheSummary,
    clearCache,
    appInfo,
    diagnostics,
    assetUsage,
  };
}
