import { useCallback, useEffect, useState } from "react";
import type { SyncSettings, SyncWarning } from "../../lib/types";
import { bridge } from "../bridge";
import { writeSyncSettings } from "../sync/syncSettingsStore";
import { describeSyncStatus, readSyncStatus, subscribeSyncStatus, type MobileSyncStatus } from "../sync/syncStatusStore";

const DEFAULT_SYNC_SETTINGS: SyncSettings = { enabled: true, autoMode: "manual", autoIntervalMinutes: 15 };

/** 设置页同步状态：配置草稿、上次同步可观测性与手动同步流程。 */
export function useSyncSettingsForm(open: boolean, onRefresh: () => Promise<void>) {
  const [syncSettings, setSyncSettings] = useState<SyncSettings | null>(null);
  const [syncMsg, setSyncMsg] = useState("");
  const [warnings, setWarnings] = useState<SyncWarning[]>([]);
  const [lastSync, setLastSync] = useState<MobileSyncStatus | null>(() => readSyncStatus());

  useEffect(() => {
    if (!open) return;
    setSyncSettings(bridge.getSyncSettings());
  }, [open]);

  useEffect(() => subscribeSyncStatus(() => setLastSync(readSyncStatus())), []);

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
      setWarnings(result.notes?.warnings ?? []);
      await onRefresh();
    } catch (error) {
      setSyncMsg("同步失败: " + (error as Error).message);
    }
  }, [onRefresh]);

  return {
    syncSettings,
    updateSyncSettings,
    syncMsg,
    warnings,
    lastSync,
    lastSyncText: lastSync ? describeSyncStatus(lastSync) : "本机还没有同步记录",
    runSync,
  };
}
