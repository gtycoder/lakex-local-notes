import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { Check, Cloud, CloudOff, History, LoaderCircle, Settings2, TriangleAlert, UploadCloud } from "lucide-react";
import type { SyncStatus } from "../lib/types";
import { buildSyncStatusModel, type SyncStatusModelInput } from "./syncStatusModel";

type SaveState = SyncStatusModelInput["saveState"];

export interface SyncStatusPopoverProps {
  buttonRef: MutableRefObject<HTMLButtonElement | null>;
  sync: SyncStatus;
  saveState: SaveState;
  saveLabel: string;
  pendingDocuments: number;
  pendingResources: number;
  pendingQuickNotes?: number;
  dirtyTabCount: number;
  lastSavedAt: string | null;
  cloudEnabled: boolean;
  conflictSnapshotCount?: number;
  conflictSnapshotText?: string | null;
  onSync: () => void;
  onOpenSettings: () => void;
  onOpenHistory?: () => void;
}

function formatTime(value: string | null): string {
  if (!value) return "暂无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "暂无记录" : date.toLocaleString("zh-CN", { hour12: false });
}

export function SyncStatusPopover({
  buttonRef,
  sync,
  saveState,
  saveLabel,
  pendingDocuments,
  pendingResources,
  pendingQuickNotes = 0,
  dirtyTabCount,
  lastSavedAt,
  cloudEnabled,
  conflictSnapshotCount = 0,
  conflictSnapshotText,
  onSync,
  onOpenSettings,
  onOpenHistory,
}: SyncStatusPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const model = buildSyncStatusModel({ sync, saveState, saveLabel, pendingDocuments, pendingResources, pendingQuickNotes, dirtyTabCount, lastSavedAt, cloudEnabled, conflictSnapshotCount });

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("keydown", keydown); };
  }, [buttonRef, open]);

  const anchor = buttonRef.current?.getBoundingClientRect();
  const style = anchor ? { top: Math.round(anchor.bottom + 7), left: Math.max(8, Math.min(Math.round(anchor.left), window.innerWidth - 330)) } : undefined;
  const icon = model.statusClass === "syncing" ? <LoaderCircle className="spin" size={14} /> : model.statusClass === "error" ? <TriangleAlert size={14} /> : model.statusClass === "disabled" ? <CloudOff size={14} /> : model.statusClass === "synced" ? <Check size={14} /> : model.statusClass === "pending" ? <UploadCloud size={14} /> : <Cloud size={14} />;

  return (
    <div className="sync-status-control">
      <button
        ref={buttonRef}
        className={`toolbar__item toolbar__sync sync-status-button ${model.statusClass}`}
        onClick={() => setOpen((value) => !value)}
        title={model.accessibleLabel}
        aria-label={model.accessibleLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="sync-status-icon" aria-hidden="true">{icon}</span>
        {model.pendingTotal > 0 && <span className="sync-status-count" aria-hidden="true">{model.pendingTotal > 99 ? "99+" : model.pendingTotal}</span>}
        <span className="sync-status-visually-hidden">{model.localLabel}，{model.statusLabel}</span>
      </button>
      {open && (
        <div ref={popoverRef} className="sync-status-popover" role="dialog" aria-label="本地与云端同步状态" style={style}>
          <header className="sync-status-popover-header">
            <div><strong>同步状态</strong><span>{model.statusLabel}</span></div>
            <span className={`sync-status-dot ${model.statusClass}`} aria-hidden="true" />
          </header>
          <section className="sync-status-section">
            <h3>本地状态</h3>
            <dl>
              <div><dt>保存状态</dt><dd>{model.localLabel}</dd></div>
              <div><dt>最近保存</dt><dd>{formatTime(lastSavedAt)}</dd></div>
              <div><dt>未保存标签</dt><dd>{dirtyTabCount}</dd></div>
            </dl>
          </section>
          <section className="sync-status-section">
            <h3>云端状态</h3>
            <dl>
              <div><dt>上次同步</dt><dd>{formatTime(sync.lastSyncedAt)}</dd></div>
              <div><dt>待上传文档</dt><dd>{pendingDocuments}</dd></div>
              <div><dt>待上传资源</dt><dd>{pendingResources}</dd></div>
              <div><dt>待上传小记</dt><dd>{pendingQuickNotes}</dd></div>
            </dl>
          </section>
          {conflictSnapshotText && (
            <section className="sync-status-history-note" role="status">
              <History size={14} aria-hidden="true" />
              <div><strong>已保留历史快照</strong><span>{conflictSnapshotText}</span></div>
              {onOpenHistory && <button type="button" onClick={onOpenHistory}>查看历史</button>}
            </section>
          )}
          <footer className="sync-status-actions">
            <button type="button" className="b3-button b3-button--primary" onClick={() => { setOpen(false); onSync(); }} disabled={!cloudEnabled || model.statusClass === "syncing"}><Cloud size={14} />立即同步</button>
            <button type="button" className="sync-status-settings" onClick={() => { setOpen(false); onOpenSettings(); }}><Settings2 size={14} />同步设置</button>
          </footer>
        </div>
      )}
    </div>
  );
}
