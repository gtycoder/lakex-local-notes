import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Cloud, CloudOff, History, LoaderCircle, Settings2, TriangleAlert, UploadCloud } from "lucide-react";
import type { SyncStatus, SyncStatusInfo } from "../lib/types";
import { buildSyncStatusModel } from "./syncStatusModel";
import { native } from "../lib/native";
import { chooseVisibleAnchor, clampPopoverPosition } from "../hooks/topMenuPosition";

export interface SyncStatusPopoverProps {
  buttonRef?: RefObject<HTMLButtonElement>;
  visible?: boolean;
  sync: SyncStatus;
  pendingDocuments: number;
  pendingFolders?: number;
  pendingQuickNotes?: number;
  cloudEnabled: boolean;
  conflictSnapshots?: Array<{ noteId: string; title: string }>;
  conflictSnapshotText?: string | null;
  /** 点击云按钮：直接开始同步（对齐思源——点击即同步，不弹窗）。 */
  onSync: () => void;
  onOpenSettings: () => void;
  onOpenHistory?: (noteId: string) => void;
}

/** 思源式"云+对钩"组合图标：同步完成后展示（默认色，不变绿）。 */
function CloudCheckIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      <path d="m9.5 14.5 2 2 3.5-3.5" />
    </svg>
  );
}

function formatTime(value: string | null): string {
  if (!value) return "暂无记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "暂无记录" : date.toLocaleString("zh-CN", { hour12: false });
}

function formatBytes(value: number | undefined): string {
  if (!value || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
  return `${unit === 0 || size >= 100 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} 秒`;
}

export function SyncStatusPopover({
  buttonRef,
  visible = true,
  sync,
  pendingDocuments,
  pendingFolders = 0,
  pendingQuickNotes = 0,
  cloudEnabled,
  conflictSnapshots = [],
  conflictSnapshotText,
  onSync,
  onOpenSettings,
  onOpenHistory,
}: SyncStatusPopoverProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [lastResult, setLastResult] = useState<SyncStatusInfo["lastResult"]>(null);
  const localButtonRef = useRef<HTMLButtonElement | null>(null);
  const resolvedButtonRef = buttonRef ?? localButtonRef;
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const controlRef = useRef<HTMLDivElement | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const model = buildSyncStatusModel({ sync, pendingDocuments, pendingFolders, pendingQuickNotes, cloudEnabled, conflictSnapshotCount: conflictSnapshots.length });

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  // 卸载清理悬停定时器
  useEffect(() => () => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
  }, []);

  // 面板打开时（以及每次同步完成 lastSyncedAt 变化时）拉取上次同步结果统计
  useEffect(() => {
    if (!open) return;
    void native.getSyncStatus().then((info) => setLastResult(info.lastResult)).catch(() => undefined);
  }, [open, sync.lastSyncedAt]);

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
    setPosition(clampPopoverPosition(rect, { width: window.innerWidth, height: window.innerHeight }, { width, height: 380 }, 7));
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
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); };
  }, [open]);

  // 对齐思源：悬停展示同步详情（带少量延迟防误触），移出即收起；点击按钮直接同步
  const scheduleHover = (action: "open" | "close") => {
    if (hoverTimerRef.current !== null) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      setOpen(action === "open");
    }, action === "open" ? 250 : 200);
  };

  const qn = lastResult?.quickNotes;
  const stats = lastResult;

  const icon = model.statusClass === "syncing" ? <LoaderCircle className="spin" size={14} /> : model.statusClass === "error" ? <TriangleAlert size={14} /> : model.statusClass === "disabled" ? <CloudOff size={14} /> : model.statusClass === "synced" ? <CloudCheckIcon size={14} /> : model.statusClass === "pending" ? <UploadCloud size={14} /> : <Cloud size={14} />;

  return (
    <div className="sync-status-control" ref={controlRef} onMouseEnter={() => scheduleHover("open")} onMouseLeave={() => scheduleHover("close")}>
      <button
        ref={resolvedButtonRef}
        data-sync-status-button="true"
        className={`toolbar__item toolbar__sync sync-status-button ${model.statusClass}`}
        onClick={() => {
          if (model.statusClass === "syncing") return;
          if (!cloudEnabled) { setOpen(false); onOpenSettings(); return; }
          onSync();
        }}
        aria-label={model.accessibleLabel}
        aria-expanded={open}
      >
        <span className="sync-status-icon" aria-hidden="true">{icon}</span>
        <span className="sync-status-visually-hidden">{model.statusLabel}</span>
      </button>
      {open && (
        <div ref={popoverRef} className="sync-status-popover" role="dialog" aria-label="云端同步状态" style={position ?? undefined}>
          <header className="sync-status-popover-header">
            <div><strong>云端同步</strong><span>{model.statusLabel}</span></div>
            <span className={`sync-status-dot ${model.statusClass}`} aria-hidden="true" />
          </header>
          <section className="sync-status-section">
            <dl>
              <div><dt>上次同步</dt><dd>{formatTime(sync.lastSyncedAt)}{stats?.durationMs ? ` · ${formatDuration(stats.durationMs)}` : ""}</dd></div>
              {stats && (
                <>
                  <div>
                    <dt>上传</dt>
                    <dd>{stats.uploaded} 文档 · {stats.foldersUploaded ?? 0} 目录 · {qn?.uploaded ?? 0} 小记 · {formatBytes(stats.uploadedBytes)}</dd>
                  </div>
                  <div>
                    <dt>下载</dt>
                    <dd>{stats.downloaded} 文档 · {stats.foldersDownloaded ?? 0} 目录 · {qn?.downloaded ?? 0} 小记 · {formatBytes(stats.downloadedBytes)}</dd>
                  </div>
                  {(stats.trashed ?? 0) > 0 && (
                    <div>
                      <dt>移入回收站</dt>
                      <dd>{stats.trashed} 文档</dd>
                    </div>
                  )}
                </>
              )}
              <div>
                <dt>待同步</dt>
                <dd>{model.pendingTotal === 0 ? "全部已同步" : `${model.pendingTotal} 项（文档 ${pendingDocuments} · 目录 ${pendingFolders} · 小记 ${pendingQuickNotes}）`}</dd>
              </div>
            </dl>
          </section>
          {conflictSnapshots.length > 0 && (
            <section className="sync-status-history-note" role="status">
              <History size={14} aria-hidden="true" />
              <div>
                <strong>已保留历史快照 · {conflictSnapshots.length}</strong>
                <span>{conflictSnapshotText ?? "检测到远端版本差异，已保留历史快照"}</span>
                <div className="sync-status-history-list">
                  {conflictSnapshots.map((item) => (
                    <button key={item.noteId} type="button" onClick={() => onOpenHistory?.(item.noteId)}>{item.title || "无标题"} · 查看历史</button>
                  ))}
                </div>
              </div>
            </section>
          )}
          <footer className="sync-status-actions">
            <button type="button" className="sync-status-settings" onClick={() => { setOpen(false); onOpenSettings(); }}><Settings2 size={14} />同步设置</button>
          </footer>
        </div>
      )}
    </div>
  );
}
