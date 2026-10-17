import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Cloud, CloudOff, HardDrive, History, LoaderCircle, Settings2, TriangleAlert, CloudUpload } from "lucide-react";
import { isCloudActive } from "../core/cloudState.js";
import type { SyncStatus, SyncStatusInfo, SyncWarning } from "../lib/types";
import { buildSyncStatusModel } from "./syncStatusModel";
import { native } from "../lib/native";
import { formatBytesCompact } from "../lib/formatBytes";
import { formatDateTime } from "../core/dateFormat";
import { reportNativeActionError } from "../lib/nativeErrors";
import { chooseVisibleAnchor, clampPopoverPosition } from "../hooks/topMenuPosition";
import { HoverPopover } from "./ui/Overlay";

export interface SyncStatusPopoverProps {
  buttonRef?: RefObject<HTMLButtonElement>;
  visible?: boolean;
  sync: SyncStatus;
  pendingDocuments: number;
  pendingFolders?: number;
  pendingQuickNotes?: number;
  cloudEnabled: boolean;
  cloudConfigured: boolean;
  conflictSnapshots?: Array<{ noteId: string; title: string }>;
  conflictSnapshotText?: string | null;
  /** 点击云按钮：直接开始同步（对齐思源——点击即同步，不弹窗）。 */
  onSync: () => void;
  onOpenSettings: () => void;
  onOpenHistory?: (noteId: string) => void;
  /** 点击同步警告：打开对应文档（远端缺内容的那篇）。 */
  onOpenNote?: (noteId: string) => void;
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
  return Number.isNaN(date.getTime()) ? "暂无记录" : formatDateTime(date);
}

function formatDuration(ms: number | undefined): string {
  if (!ms || ms <= 0) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} 秒`;
}

/** 同步警告的一行展示：主文本取文档标题（缺则 id），副文本标注缺失类型/文件名。 */
function warningPrimary(w: SyncWarning): string {
  return w.title || w.noteId || "未命名文档";
}
function warningMeta(w: SyncWarning): string {
  return w.kind === "asset_missing" ? (w.filename ?? "资源缺失") : "正文缺失";
}


export function SyncStatusPopover({
  buttonRef,
  visible = true,
  sync,
  pendingDocuments,
  pendingFolders = 0,
  pendingQuickNotes = 0,
  cloudEnabled,
  cloudConfigured,
  conflictSnapshots = [],
  conflictSnapshotText,
  onSync,
  onOpenSettings,
  onOpenHistory,
  onOpenNote,
}: SyncStatusPopoverProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [lastResult, setLastResult] = useState<SyncStatusInfo["lastResult"]>(null);
  const localButtonRef = useRef<HTMLButtonElement | null>(null);
  const resolvedButtonRef = buttonRef ?? localButtonRef;
  const controlRef = useRef<HTMLDivElement | null>(null);
  const model = buildSyncStatusModel({ sync, pendingDocuments, pendingFolders, pendingQuickNotes, cloudEnabled, conflictSnapshotCount: conflictSnapshots.length });
  // 云同步未启用 / 未配置 = 本地空间：同一个浮层，换成「仅本地」内容 + 去设置入口。
  // 顶栏图标 = 云同步状态灯：关了开关 或 没配置 S3 ⇒ 磁盘（判据与后端同源，见 core/cloudState）。
  const localOnly = !isCloudActive(cloudConfigured, cloudEnabled);

  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

  // 面板打开时（以及每次同步完成 lastSyncedAt 变化时）拉取上次同步结果统计
  useEffect(() => {
    if (!open) return;
    void native.getSyncStatus().then((info) => setLastResult(info.lastResult)).catch((error) => reportNativeActionError("读取同步结果", error));
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

  const qn = lastResult?.quickNotes;
  const stats = lastResult;

  const icon = localOnly ? <HardDrive size={14} /> : model.statusClass === "syncing" ? <LoaderCircle className="spin" size={14} /> : model.statusClass === "error" ? <TriangleAlert size={14} /> : model.statusClass === "disabled" ? <CloudOff size={14} /> : model.statusClass === "synced" ? <CloudCheckIcon size={14} /> : model.statusClass === "pending" ? <CloudUpload size={14} /> : <Cloud size={14} />;

  return (
    <div className="sync-status-control" ref={controlRef}>
      <button
        ref={resolvedButtonRef}
        data-sync-status-button="true"
        className={`toolbar__item toolbar__sync sync-status-button ${localOnly ? "workspace-local" : model.statusClass}`}
        onClick={() => {
          if (localOnly) { setOpen((value) => !value); return; }
          if (model.statusClass === "syncing") return;
          // 点击即同步（对齐思源）。只有 S3 未配置时才在下方走配置提示，绝不在此跳设置。
          onSync();
        }}
        aria-label={localOnly ? "本地空间，未开启云同步" : model.accessibleLabel}
        aria-expanded={open}
      >
        <span className="sync-status-icon" aria-hidden="true">{icon}</span>
        <span className="sync-status-visually-hidden">{localOnly ? "当前仅本地" : model.statusLabel}</span>
      </button>
      <HoverPopover
        open={open}
        onOpenChange={setOpen}
        anchorRef={resolvedButtonRef}
        onDismiss={() => setOpen(false)}
        ignoreOutside={(target) => controlRef.current?.contains(target) ?? false}
        className="sync-status-popover"
        style={position ?? undefined}
        label={localOnly ? "本地空间" : "云端同步状态"}
      >
          {localOnly ? (
            <>
              <header className="sync-status-popover-header">
                <div><strong>本地空间</strong><span>当前仅本地</span></div>
                <span className="sync-status-dot" aria-hidden="true" />
              </header>
              <section className="sync-status-section">
                <p className="sync-status-local-note">尚未开启云同步，数据仅保存在本机。开启后可多端同步与备份。</p>
              </section>
              <footer className="sync-status-actions">
                <span className="sync-status-footer-state">数据仅在本机</span>
                <button type="button" className="b3-button b3-button--outline" onClick={() => { setOpen(false); onOpenSettings(); }}><Settings2 size={14} />去设置云同步</button>
              </footer>
            </>
          ) : (
            <>
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
                    <dd>{stats.uploaded} 文档 · {stats.foldersUploaded ?? 0} 目录 · {qn?.uploaded ?? 0} 小记 · {formatBytesCompact(stats.uploadedBytes)}</dd>
                  </div>
                  <div>
                    <dt>下载</dt>
                    <dd>{stats.downloaded} 文档 · {stats.foldersDownloaded ?? 0} 目录 · {qn?.downloaded ?? 0} 小记 · {formatBytesCompact(stats.downloadedBytes)}</dd>
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
                <div className="sync-status-history-list b3-list b3-list--background" role="list">
                  {conflictSnapshots.map((item) => (
                    <button key={item.noteId} type="button" className="b3-list-item" onClick={() => onOpenHistory?.(item.noteId)}>
                      <span className="b3-list-item__text ln-ellipsis">{item.title || "无标题"}</span>
                      <span className="b3-list-item__meta">查看历史</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}
          {stats?.warnings && stats.warnings.length > 0 && (
            <section className="sync-status-history-note" role="status">
              <TriangleAlert size={14} aria-hidden="true" />
              <div>
                <strong>同步有 {stats.warnings.length} 项被跳过</strong>
                <span>远端缺少对象/资源，已跳过受影响条目；本地内容未改动，下次同步会重试。</span>
                <div className="sync-status-history-list b3-list b3-list--background" role="list">
                  {stats.warnings.map((w, i) => (
                    <button
                      key={`${w.kind}-${w.noteId ?? i}-${w.filename ?? ""}`}
                      type="button"
                      className="b3-list-item"
                      disabled={!w.noteId || !onOpenNote}
                      onClick={() => { if (w.noteId) onOpenNote?.(w.noteId); }}
                    >
                      <span className="b3-list-item__text ln-ellipsis">{warningPrimary(w)}</span>
                      <span className="b3-list-item__meta">{warningMeta(w)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
          )}
          <footer className="sync-status-actions">
            <span className="sync-status-footer-state" aria-live="polite">
              上次同步 {formatTime(sync.lastSyncedAt)}
              {model.pendingTotal > 0 && ` · 未同步 ${model.pendingTotal} 项`}
            </span>
            <button type="button" className="b3-button b3-button--outline" onClick={() => { setOpen(false); onOpenSettings(); }}><Settings2 size={14} />同步设置</button>
          </footer>
            </>
          )}
      </HoverPopover>
    </div>
  );
}
