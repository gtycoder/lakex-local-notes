import { useMemo } from "react";
import { CheckCheck, Clock, ExternalLink, History, RotateCcw, TriangleAlert, X } from "lucide-react";
import { Dialog } from "../ui/Overlay";
import { useConfirm } from "../../hooks/useConfirm";
import { formatDateTime } from "../../core/dateFormat";
import type { SyncConflictRow } from "../../lib/types";
import {
  SYNC_CONFLICT_KIND_LABEL,
  canRestoreSyncConflict,
  syncConflictKindHint,
  syncConflictTitle,
} from "./syncConflicts";
import "./syncConflictsPanel.css";

/**
 * 「同步记录」页（P1 第 4 项）：本机同步账本的只读列表 + 可挽回动作。
 *
 * 定稿：**独立浮层**（从 SyncStatusPopover 的「最近同步有 N 处覆盖/删除 → 查看」打开），
 * 不做设置页嵌入、不做打断式弹窗 —— 同步完成绝不主动弹这个面板。
 *
 * 每行：时间 / 标题 / 类型（远端覆盖本地 / 他端删除 / 保存时磁盘被改）+ 动作：
 * - 打开笔记、查看历史；
 * - 「恢复本地被覆盖版」只对 remote_wins / remote_purged 且未处理的行提供（二次确认：会覆盖云端远端版本、恢复后按本机版本重传）；
 * - save_external_changed 是审计事件，没有可恢复版本 ⇒ 只给「打开文档处理」出口。
 * 空态：「最近没有同步记录」。顶部「全部标记已读」只清角标，不删数据。
 */
export interface SyncConflictsPanelProps {
  open: boolean;
  items: readonly SyncConflictRow[];
  /** 读取失败的可读提示（通道不可用/主进程报错）。 */
  error?: string | null;
  /** 正在恢复的行 id（按钮禁用 + 文案）。 */
  busyId?: string | null;
  /** 行状态提示（恢复成功/失败文案）。 */
  statusText?: string | null;
  onClose(): void;
  /** 全部标记已读（清角标，不删数据）。 */
  onAckAll(): void | Promise<void>;
  /** 恢复本地被覆盖版（调用方负责二次确认后的真实动作）。 */
  onRestore(row: SyncConflictRow): void | Promise<void>;
  onOpenNote(row: SyncConflictRow): void;
  onViewHistory(row: SyncConflictRow): void;
}

function timeText(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : formatDateTime(date);
}

export function SyncConflictsPanel({
  open, items, error = null, busyId = null, statusText = null, onClose, onAckAll, onRestore, onOpenNote, onViewHistory,
}: SyncConflictsPanelProps) {
  const { confirm, confirmElement } = useConfirm();
  const rows = useMemo(() => items, [items]);
  const unacked = rows.filter((row) => !row.ackedAt).length;

  const requestRestore = async (row: SyncConflictRow) => {
    const ok = await confirm({
      title: "恢复本地被覆盖版？",
      body: "会用历史版本覆盖当前文档，并按本机版本重新上传（云端远端版本将被覆盖）。恢复后这条记录标记为已处理；历史快照缺失/过期时会明确报错。",
      confirmText: "恢复本地版",
      danger: true,
    });
    if (!ok) return;
    await onRestore(row);
  };

  return (
    <Dialog open={open} onDismiss={onClose} label="同步记录" className="sync-conflicts-dialog">
      <div className="ln-dialog__body">
        <header className="sync-conflicts__head">
          <h3><Clock size={15} aria-hidden="true" />同步记录</h3>
          <span className="sync-conflicts__count">{rows.length} 条{unacked > 0 ? "（" + unacked + " 条未读）" : ""}</span>
          <button type="button" className="ln-btn ln-btn--secondary sync-conflicts__ack" disabled={unacked === 0}
            onClick={() => void onAckAll()}><CheckCheck size={14} aria-hidden="true" />全部标记已读</button>
          <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="关闭同步记录" onClick={onClose}><X size={14} /></button>
        </header>
        {error && <p className="sync-conflicts__error" role="status">{error}</p>}
        {statusText && <p className="sync-conflicts__status" role="status">{statusText}</p>}
        {rows.length === 0 ? (
          <p className="sync-conflicts__empty" role="status">最近没有同步记录。</p>
        ) : (
          <ul className="sync-conflicts__list">
            {rows.map((row) => {
              // Lake 文档：打开/历史/恢复；小记：只能「恢复回收站副本」（无历史快照、导航在另一套空间）。
              const isLake = row.space === "lake";
              const restorable = canRestoreSyncConflict(row);
              const resolved = !!row.resolvedAt;
              return (
                <li key={row.id} className={"sync-conflicts__row" + (row.ackedAt ? "" : " is-unread") + (resolved ? " is-resolved" : "")}
                  data-conflict-kind={row.kind}>
                  <div className="sync-conflicts__row-main">
                    <span className="sync-conflicts__kind" data-kind={row.kind}>{SYNC_CONFLICT_KIND_LABEL[row.kind] ?? row.kind}</span>
                    <time className="sync-conflicts__time" dateTime={row.at}>{timeText(row.at)}</time>
                    {!row.ackedAt && <span className="sync-conflicts__unread" aria-label="未读" />}
                    {resolved && <span className="sync-conflicts__resolved"><TriangleAlert size={11} aria-hidden="true" />已处理</span>}
                  </div>
                  <div className="sync-conflicts__title ln-ellipsis">{syncConflictTitle(row)}</div>
                  <div className="sync-conflicts__hint">{syncConflictKindHint(row.kind)}</div>
                  {isLake ? (
                  <div className="sync-conflicts__actions">
                    <button type="button" className="ln-btn ln-btn--ghost" aria-label={"打开笔记 " + syncConflictTitle(row)}
                      onClick={() => onOpenNote(row)}><ExternalLink size={13} aria-hidden="true" />打开笔记</button>
                    <button type="button" className="ln-btn ln-btn--ghost" aria-label={"查看历史 " + syncConflictTitle(row)}
                      onClick={() => onViewHistory(row)}><History size={13} aria-hidden="true" />查看历史</button>
                    {restorable && (
                      <button type="button" className="ln-btn ln-btn--secondary" disabled={busyId === row.id}
                        aria-label={"恢复本地被覆盖版 " + syncConflictTitle(row)}
                        onClick={() => void requestRestore(row)}>
                        <RotateCcw size={13} aria-hidden="true" />{busyId === row.id ? "恢复中…" : "恢复本地被覆盖版"}
                      </button>
                    )}
                  </div>
                  ) : (
                    <>
                      <div className="sync-conflicts__hint" data-quick-notes-row>小记空间：到「小记」里查看该条记录。</div>
                      {restorable && (
                        <div className="sync-conflicts__actions">
                          <button type="button" className="ln-btn ln-btn--secondary" disabled={busyId === row.id}
                            aria-label={"恢复本地被覆盖版 " + syncConflictTitle(row)}
                            onClick={() => void requestRestore(row)}>
                            <RotateCcw size={13} aria-hidden="true" />{busyId === row.id ? "恢复中…" : "恢复本地被覆盖版"}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {confirmElement}
    </Dialog>
  );
}
