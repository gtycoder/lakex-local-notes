import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Check, Cloud, CloudOff, History, LoaderCircle, Settings2, TriangleAlert, UploadCloud } from "lucide-react";
import type { SyncStatus } from "../lib/types";
import { buildSyncStatusModel, type SyncStatusModelInput } from "./syncStatusModel";
import { chooseVisibleAnchor, clampPopoverPosition } from "../hooks/topMenuPosition";

type SaveState = SyncStatusModelInput["saveState"];

export interface SyncStatusPopoverProps {
  buttonRef?: RefObject<HTMLButtonElement>;
  visible?: boolean;
  sync: SyncStatus;
  saveState: SaveState;
  saveLabel: string;
  pendingDocuments: number;
  pendingFolders?: number;
  pendingResources: number;
  pendingQuickNotes?: number;
  dirtyTabCount: number;
  lastSavedAt: string | null;
  cloudEnabled: boolean;
  conflictSnapshots?: Array<{ noteId: string; title: string }>;
  conflictSnapshotText?: string | null;
  onSync: () => void;
  onOpenSettings: () => void;
  onOpenHistory?: (noteId: string) => void;
}

function formatTime(value: string | null): string {
  if (!value) return "暂无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "暂无记录" : date.toLocaleString("zh-CN", { hour12: false });
}

export function SyncStatusPopover({
  buttonRef,
  visible = true,
  sync,
  saveState,
  saveLabel,
  pendingDocuments,
  pendingFolders = 0,
  pendingResources,
  pendingQuickNotes = 0,
  dirtyTabCount,
  lastSavedAt,
  cloudEnabled,
  conflictSnapshots = [],
  conflictSnapshotText,
  onSync,
  onOpenSettings,
  onOpenHistory,
}: SyncStatusPopoverProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const localButtonRef = useRef<HTMLButtonElement | null>(null);
  const resolvedButtonRef = buttonRef ?? localButtonRef;
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const model = buildSyncStatusModel({ sync, saveState, saveLabel, pendingDocuments, pendingFolders, pendingResources, pendingQuickNotes, dirtyTabCount, lastSavedAt, cloudEnabled, conflictSnapshotCount: conflictSnapshots.length });

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  const updatePosition = useCallback(() => {
    if (typeof window === "undefined") return;
    const candidates = [...document.querySelectorAll<HTMLButtonElement>("[data-sync-status-button]")];
    const anchor = chooseVisibleAnchor(resolvedButtonRef.current, candidates);
    if (!anchor) {
      setPosition(null);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(320, Math.max(0, window.innerWidth - 16));
    setPosition(clampPopoverPosition(rect, { width: window.innerWidth, height: window.innerHeight }, { width, height: 420 }, 7));
  }, [resolvedButtonRef]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    updatePosition();
    const onViewportChange = () => updatePosition();
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popoverRef.current?.contains(target) && !resolvedButtonRef.current?.contains(target)) setOpen(false);
    };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("pointerdown", close, true); document.removeEventListener("keydown", keydown); };
  }, [open, resolvedButtonRef]);

  const icon = model.statusClass === "syncing" ? <LoaderCircle className="spin" size={14} /> : model.statusClass === "error" ? <TriangleAlert size={14} /> : model.statusClass === "disabled" ? <CloudOff size={14} /> : model.statusClass === "synced" ? <Check size={14} /> : model.statusClass === "pending" ? <UploadCloud size={14} /> : <Cloud size={14} />;

  return (
    <div className="sync-status-control">
      <button
        ref={resolvedButtonRef}
        data-sync-status-button="true"
        className={`toolbar__item toolbar__sync sync-status-button ${model.statusClass}`}
        onClick={() => setOpen((value) => !value)}
        title={model.accessibleLabel}
        aria-label={model.accessibleLabel}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <span className="sync-status-icon" aria-hidden="true">{icon}</span>
        <span className="sync-status-visually-hidden">{model.localLabel}，{model.statusLabel}</span>
      </button>
      {open && (
          <div ref={popoverRef} className="sync-status-popover" role="dialog" aria-label="本地与云端同步状态" style={position ?? undefined}>
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
              <div><dt>待同步文档</dt><dd>{pendingDocuments}</dd></div>
              <div><dt>待同步目录</dt><dd>{pendingFolders}</dd></div>
              <div><dt>待同步小记</dt><dd>{pendingQuickNotes}</dd></div>
            </dl>
          </section>
          {conflictSnapshots.length > 0 && (
            <section className="sync-status-history-note" role="status">
              <History size={14} aria-hidden="true" />
              <div>
                <strong>已保留历史快照 · {conflictSnapshots.length}</strong>
                <span>{conflictSnapshotText ?? "检测到远端版本差异，已保留历史快照"}</span>
                <div className="sync-status-history-list">
                  {conflictSnapshots.slice(0, 3).map((item) => (
                    <button key={item.noteId} type="button" onClick={() => onOpenHistory?.(item.noteId)}>{item.title || "无标题"} · 查看历史</button>
                  ))}
                </div>
              </div>
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
