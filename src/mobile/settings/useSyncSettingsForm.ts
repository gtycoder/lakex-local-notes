import { useCallback, useEffect, useState } from "react";
import type { SyncSettings, SyncWarning } from "../../lib/types";
import { bridge } from "../bridge";
import { writeSyncSettings } from "../sync/syncSettingsStore";
import { describeSyncBreakdown, describeSyncStatus, readSyncStatus, subscribeSyncStatus, type MobileSyncStatus } from "../sync/syncStatusStore";
import { describeSyncProgress, readSyncProgress, subscribeSyncProgress, type SyncProgressSnapshot } from "../sync/syncProgressStore";
import type { S3v3DiagnosticReport } from "../../core/s3v3Report";

const DEFAULT_SYNC_SETTINGS: SyncSettings = { enabled: true, autoMode: "manual", autoIntervalMinutes: 15 };

/** 设置页同步状态：配置草稿、上次同步可观测性与手动同步流程。 */
export function useSyncSettingsForm(open: boolean, onRefresh: () => Promise<void>) {
  const [syncSettings, setSyncSettings] = useState<SyncSettings | null>(null);
  const [syncMsg, setSyncMsg] = useState("");
  const [warnings, setWarnings] = useState<SyncWarning[]>([]);
  const [supersededNotes, setSupersededNotes] = useState<Array<{ id: string; title: string }>>([]);
  const [lastSync, setLastSync] = useState<MobileSyncStatus | null>(() => readSyncStatus());
  const [syncProgress, setSyncProgress] = useState<SyncProgressSnapshot | null>(() => readSyncProgress());
  // SD-13：最近 3 轮同步诊断（bridge 在每轮同步结束写入 device_state）。
  const [syncReports, setSyncReports] = useState<S3v3DiagnosticReport[]>([]);

  const reloadSyncReports = useCallback(async () => {
    try { setSyncReports(await bridge.getSyncDiagnostics()); } catch { setSyncReports([]); }
  }, []);

  useEffect(() => {
    if (!open) return;
    void reloadSyncReports();
  }, [open, reloadSyncReports]);

  useEffect(() => {
    if (!open) return;
    setSyncSettings(bridge.getSyncSettings());
  }, [open]);

  useEffect(() => subscribeSyncStatus(() => setLastSync(readSyncStatus())), []);
  useEffect(() => subscribeSyncProgress(() => setSyncProgress(readSyncProgress())), []);

  const updateSyncSettings = useCallback((patch: Partial<SyncSettings>) => {
    setSyncSettings((current) => {
      const next = { ...(current ?? DEFAULT_SYNC_SETTINGS), ...patch };
      writeSyncSettings(next);
      return next;
    });
  }, []);

  const runSync = useCallback(async () => {
    setSyncMsg("同步中…");
    try {
      const result = await bridge.syncNow();
      setSyncMsg(result.message);
      // v3 把结构化回执放在顶层（warningDetails / supersededNotes 都要读）；v2 notes 字段已删（D-7）。
      setWarnings(result.warnings ?? []);
      setSupersededNotes(result.supersededNotes ?? []);
      await onRefresh();
    } catch (error) {
      setSyncMsg("同步失败：" + (error as Error).message);
    }
    // 成功/失败都读一次：诊断由 bridge.syncNow 写在本轮结束时。
    await reloadSyncReports();
  }, [onRefresh, reloadSyncReports]);

  return {
    syncSettings,
    updateSyncSettings,
    syncMsg,
    syncProgressText: describeSyncProgress(syncProgress),
    warnings,
    supersededNotes,
    lastSync,
    lastSyncText: lastSync ? describeSyncStatus(lastSync) : "本机还没有同步记录",
    lastSyncBreakdown: lastSync ? describeSyncBreakdown(lastSync) : null,
    syncReports,
    reloadSyncReports,
    runSync,
  };
}