/**
 * 移动端「同步记录」列表页（261105 P1 第 4 项，消费 task-36 的 bridge）：
 * 入口 = 设置页「上次同步」下方（有未读时显示处数）；列表 = 时间/标题/类型 + 跳转与恢复。
 *
 * 语义（与桌面账本同一份数据，设备本地、不进 S3）：
 *  - remote_wins：他端发布覆盖了本机版本（本机版本已留档历史）⇒ 可在移动端「恢复本地被覆盖版」；
 *  - remote_purged：他端删除了这篇（本机副本进回收站）⇒ 只读记录（恢复去回收站/桌面）；
 *  - save_external_changed：保存被磁盘改动拦下（审计记录，没有可恢复目标）。
 *  - 小记空间的记录仅可查看（移动端没有按 id 打开小记的入口；恢复请在桌面处理）。
 * 版式复用设置页既有骨架类（mb-set-* / mb-btn / mb-empty），**不新增 CSS**。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { SyncConflictKind } from "../../lib/types";
import type { MobileSyncConflictRow } from "../data/syncConflictRepository";
import { formatDateTime } from "../../core/dateFormat";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import { bridge } from "../bridge";
import { MobileSheet } from "../ui/MobileSheet";
import { confirmMobile } from "../ui/ConfirmDialog";
import { showToast } from "../ui/toastBus";

export const SYNC_CONFLICT_KIND_LABEL: Record<SyncConflictKind, string> = {
  remote_wins: "远端覆盖本地",
  remote_purged: "他端删除（本机副本已进回收站）",
  save_external_changed: "保存时磁盘被改（未写盘）",
};

export function conflictKindLabel(kind: string): string {
  return SYNC_CONFLICT_KIND_LABEL[kind as SyncConflictKind] ?? String(kind);
}

export function conflictTitle(row: MobileSyncConflictRow): string {
  const title = (row.title ?? "").trim();
  if (title) return title;
  return row.space === "quickNotes" ? "（无标题小记）" : "（无标题文档）";
}

export function formatConflictAt(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : formatDateTime(date);
}

/** 可恢复 = 他端覆盖了本地（本机版本有历史留档）且尚未处理；其余类型没有可恢复目标。 */
export function canRestoreConflict(row: MobileSyncConflictRow): boolean {
  return row.kind === "remote_wins" && row.space === "lake" && !row.resolvedAt;
}

/** 打开笔记只对文档空间有意义（移动端没有按 id 直达小记的入口）。 */
export function canOpenConflict(row: MobileSyncConflictRow): boolean {
  return row.space === "lake";
}

export interface SyncConflictsEntryProps {
  /** 未读条数（角标数字）；0 ⇒ 不渲染入口。 */
  count: number;
  onOpen: () => void;
}

/** 设置页「上次同步」下方的入口。 */
export function SyncConflictsEntry({ count, onOpen }: SyncConflictsEntryProps) {
  if (count <= 0) return null;
  return (
    <div className="mb-set-block__actions">
      <button type="button" className="mb-btn mb-btn--secondary" onClick={onOpen}>
        最近同步有 {count} 处覆盖/删除 →
      </button>
    </div>
  );
}

export interface SyncConflictsSheetProps {
  open: boolean;
  onClose: () => void;
  /** 打开笔记（文档 space）；父层负责关抽屉/跳转，失败由父层给同源提示。 */
  onOpenNote?: (noteId: string) => void;
  /** 列表/未读数变化后通知父层刷新入口角标。 */
  onChanged?: () => void;
}

export function SyncConflictsSheet({ open, onClose, onOpenNote, onChanged }: SyncConflictsSheetProps) {
  const [items, setItems] = useState<MobileSyncConflictRow[] | null>(null);
  const [unacked, setUnacked] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** 正在执行的记录 id / "all"（防连点；同一时刻只允许一个动作）。 */
  const [busyKey, setBusyKey] = useState<string | null>(null);
  /** P2-D alive guard：面板关闭/卸载后不再 setState（等待中的读/写可能晚到）。 */
  const aliveRef = useRef(false);
  useEffect(() => () => { aliveRef.current = false; }, []);

  /**
   * 读列表（带 alive 守卫）：关闭/卸载后晚到的结果直接丢弃，不 setState。
   * 返回是否已应用（供调用方决定要不要继续刷新父层角标）。
   */
  const load = useCallback(async (): Promise<boolean> => {
    try {
      const snapshot = await bridge.listSyncConflicts();
      if (!aliveRef.current) return false;
      setItems(snapshot.items);
      setUnacked(snapshot.unacked);
      setError(null);
      return true;
    } catch (reason) {
      if (!aliveRef.current) return false;
      // 小记库/主库不可用时如实提示（不白屏、不假装空列表）。
      setItems(null);
      setUnacked(0);
      setError(getNativeErrorMessage(reason));
      return false;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    aliveRef.current = true;
    setItems(null);
    setError(null);
    void load();
    return () => { aliveRef.current = false; };
  }, [open, load]);

  const afterChange = useCallback(async (): Promise<void> => {
    const applied = await load();
    if (applied) onChanged?.();
  }, [load, onChanged]);

  const ack = useCallback(async (ids?: string[]): Promise<void> => {
    if (!aliveRef.current) return;
    setBusyKey(ids?.[0] ?? "all");
    try {
      await bridge.ackSyncConflicts(ids);
      await afterChange();
    } catch (reason) {
      if (aliveRef.current) showToast("标记已读失败：" + getNativeErrorMessage(reason), { type: "error" });
    } finally {
      if (aliveRef.current) setBusyKey(null);
    }
  }, [afterChange]);

  const restore = useCallback(async (row: MobileSyncConflictRow): Promise<void> => {
    const ok = await confirmMobile({
      title: "恢复本地被覆盖版？",
      body: "会用本机历史快照写回这篇正文。恢复后本机版本会覆盖云端的远端版本，并按本地版本重新上传。",
      confirmText: "恢复本地版",
    });
    if (!ok) return;
    if (!aliveRef.current) return;
    setBusyKey(row.id);
    try {
      const result = await bridge.restoreSyncConflict(row.id);
      if (!result.ok) {
        // P2-D：already-resolved 不是失败（记录已被处理过）⇒ 中性提示 + 刷新列表，不误导成"恢复失败"。
        if (result.reason === "already-resolved") {
          if (aliveRef.current) showToast(result.message || "这条同步记录已经处理过，无需重复恢复");
          await afterChange();
          return;
        }
        // 其余失败必须明确（历史缺失/已过期/不支持），不能静默。
        if (aliveRef.current) showToast(result.message || "恢复失败：该记录没有可用的历史快照", { type: "error" });
        return;
      }
      if (aliveRef.current) showToast("已恢复本地版本；下次同步会覆盖云端");
      await afterChange();
    } catch (reason) {
      if (aliveRef.current) showToast("恢复失败：" + getNativeErrorMessage(reason), { type: "error" });
    } finally {
      if (aliveRef.current) setBusyKey(null);
    }
  }, [afterChange]);

  return (
    <MobileSheet open={open} title="同步记录" onClose={onClose}>
      {error && <p className="mb-empty mb-empty--inset" role="alert">同步记录暂不可用：{error}</p>}
      {!error && items === null && <p className="mb-empty mb-empty--inset">读取中…</p>}
      {!error && items !== null && items.length === 0 && (
        <div className="mb-empty mb-empty--inset">还没有同步记录</div>
      )}
      {!error && items !== null && items.length > 0 && (
        <div className="mb-set-items">
          {items.map((row) => (
            <div key={row.id} className="mb-set-block">
              <div className="mb-set-block__name mb-ellipsis">{conflictTitle(row)}</div>
              <div className="mb-set-item__desc">
                {conflictKindLabel(row.kind)}
                {formatConflictAt(row.at) ? "，" + formatConflictAt(row.at) : ""}
                {row.resolvedAt ? "（已恢复）" : row.ackedAt ? "" : "（未读）"}
              </div>
              {row.space === "quickNotes" && (
                <div className="mb-set-item__desc">小记的同步记录仅可查看（恢复请在桌面版处理）。</div>
              )}
              <div className="mb-set-block__actions">
                {onOpenNote && canOpenConflict(row) && (
                  <button type="button" className="mb-btn mb-btn--secondary" disabled={busyKey !== null} onClick={() => { onOpenNote(row.noteId); onClose(); }}>打开笔记</button>
                )}
                {canRestoreConflict(row) && (
                  <button type="button" className="mb-btn mb-btn--secondary" disabled={busyKey !== null} onClick={() => void restore(row)}>恢复本地被覆盖版</button>
                )}
                {!row.ackedAt && (
                  <button type="button" className="mb-btn mb-btn--ghost" disabled={busyKey !== null} onClick={() => void ack([row.id])}>标记已读</button>
                )}
              </div>
            </div>
          ))}
          {unacked > 0 && (
            <div className="mb-set-block__actions">
              <button type="button" className="mb-btn mb-btn--primary" disabled={busyKey !== null} onClick={() => void ack()}>全部已读（{unacked}）</button>
            </div>
          )}
        </div>
      )}
    </MobileSheet>
  );
}
