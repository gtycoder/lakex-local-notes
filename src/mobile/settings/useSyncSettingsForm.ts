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
  const [supersededNotes, setSupersededNotes] = useState<Array<{ id: string; title: string }>>([]);
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
      // v3 把结构化回执放在顶层（notes 为 null）：warningDetails / supersededNotes 都要读。
      setWarnings(result.warnings ?? result.notes?.warnings ?? []);
      setSupersededNotes(result.supersededNotes ?? []);
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
    supersededNotes,
    lastSync,
    lastSyncText: lastSync ? describeSyncStatus(lastSync) : "本机还没有同步记录",
    runSync,
  };
}