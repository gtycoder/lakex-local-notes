import { useCallback, useEffect, useState } from "react";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import type { SyncConflictRow } from "../../lib/types";
import {
  ackAllSyncConflicts,
  loadSyncConflicts,
  restoreFailureText,
  restoreSyncConflictRow,
  syncConflictBridgeAvailable,
} from "./syncConflicts";

/**
 * 「同步记录」控制器（P1 第 4 项）：账本读数 + 角标 + 面板动作（ack / 恢复）。
 *
 * 从 SyncStatusPopover 抽出来的理由：popover 本身有锚点测量/悬浮语义，难以单测；
 * 而这里的状态机（成功/失败文案、busy、恢复后重读）是可以行为测试的。
 *
 * - 只在 `enabled`（可见的那份顶栏）时拉取，避免 4 份 keep-alive 顶栏重复 IPC；
 * - `syncToken`（= lastSyncedAt）变化时重读（同步完成 ⇒ 可能新增记录）；
 * - 通道不可用（老主进程/浏览器端）⇒ 不拉、不显示角标，面板给可读提示。
 */
export interface SyncConflictsController {
  items: SyncConflictRow[];
  unacked: number;
  error: string | null;
  panelOpen: boolean;
  busyId: string | null;
  statusText: string | null;
  openPanel(): void;
  closePanel(): void;
  reload(): Promise<void>;
  ackAll(): Promise<void>;
  restore(row: SyncConflictRow): Promise<void>;
}

export function useSyncConflicts(options: { enabled: boolean; syncToken?: string | null }): SyncConflictsController {
  const [items, setItems] = useState<SyncConflictRow[]>([]);
  const [unacked, setUnacked] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const { snapshot, error: loadError } = await loadSyncConflicts();
    setItems(snapshot.items);
    setUnacked(snapshot.unacked);
    setError(loadError);
  }, []);

  useEffect(() => {
    if (!options.enabled || !syncConflictBridgeAvailable()) return;
    void reload();
  }, [options.enabled, options.syncToken, reload]);

  const openPanel = useCallback(() => {
    setStatusText(null);
    setPanelOpen(true);
  }, []);
  const closePanel = useCallback(() => setPanelOpen(false), []);

  const ackAll = useCallback(async () => {
    try {
      const next = await ackAllSyncConflicts();
      const ackedAt = new Date().toISOString();
      setItems((current) => current.map((row) => (row.ackedAt ? row : { ...row, ackedAt })));
      setUnacked(next);
      await reload();
    } catch (reason) {
      setStatusText(getNativeErrorMessage(reason));
    }
  }, [reload]);

  const restore = useCallback(async (row: SyncConflictRow) => {
    setBusyId(row.id);
    setStatusText(null);
    try {
      const result = await restoreSyncConflictRow(row.id);
      if (result.ok) {
        setStatusText("已恢复本地版本（" + (result.restoredFromHistory ? "历史快照" : "回收站副本") + "），下次同步会按本机版本上传。");
        await reload();
      } else {
        // 失败必须明说（历史缺失/过期等），不静默。
        setStatusText(restoreFailureText(result));
      }
    } catch (reason) {
      setStatusText(getNativeErrorMessage(reason));
    } finally {
      setBusyId(null);
    }
  }, [reload]);

  return { items, unacked, error, panelOpen, busyId, statusText, openPanel, closePanel, reload, ackAll, restore };
}
