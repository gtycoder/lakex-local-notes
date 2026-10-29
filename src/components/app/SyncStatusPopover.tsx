import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { Cloud, CloudOff, HardDrive, History, LoaderCircle, Settings2, TriangleAlert, CloudUpload } from "lucide-react";
import { isCloudActive } from "../../core/cloudState";
import type { SyncStatus, SyncStatusInfo } from "../../lib/types";
import { buildSyncStatusModel } from "./syncStatusModel";
import { native } from "../../lib/native";
import { formatBytesCompact } from "../../lib/formatBytes";
import { formatDateTime } from "../../core/dateFormat";
import { reportNativeActionError } from "../../lib/nativeErrors";
import { chooseVisibleAnchor } from "../../hooks/topMenuPosition";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import { HoverPopover } from "../ui/Overlay";

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
}: SyncStatusPopoverProps) {
  const [open, setOpen] = useState(false);
  /** 当前可见的顶栏同步按钮（keep-alive 下同一个 ref 可能指向隐藏副本）。 */
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
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

  /** 顶栏在 keep-alive 下可能同时存在多份按钮：按可见性挑真正的那一个（与旧定位同口径）。 */
  const resolveAnchor = useCallback((): HTMLButtonElement | null => {
    if (typeof document === "undefined") return null;
    const candidates = [...document.querySelectorAll<HTMLButtonElement>("[data-sync-status-button]")];
    return chooseVisibleAnchor(resolvedButtonRef.current, candidates);
  }, [resolvedButtonRef]);

  useLayoutEffect(() => {
    if (!open) {
      setAnchorEl(null);
      return;
    }
    setAnchorEl(resolveAnchor());
    const onViewportChange = () => setAnchorEl(resolveAnchor());
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
    };
  }, [open, resolveAnchor]);

  // 面板定位走**测量式**（DT-03）：真实宽高由表面量出（内容随同步结果变化还会 ResizeObserver 重排），
  // 不再用「宽 min(320, vw-16) + 高 380」的估算去夹视口。gap/margin 保持原 7。
  const popoverPos = usePopoverPosition({ open, anchor: anchorEl, gap: 7, margin: 7 });

  const qn = lastResult?.quickNotes;
  const stats = lastResult;
  // 261028：浮窗只保留「上传/下载细分 + 状态/时间/待同步 + 异常计数」；明细进设置→同步诊断。
  const upDocs = stats?.uploadedDocuments ?? stats?.uploaded ?? 0;
  const downDocs = stats?.downloadedDocuments ?? stats?.downloaded ?? 0;
  const upQuick = stats?.uploadedQuickNotes ?? qn?.uploaded ?? 0;
  const downQuick = stats?.downloadedQuickNotes ?? qn?.downloaded ?? 0;
  const upFolders = stats?.foldersUploaded ?? 0;
  const downFolders = stats?.foldersDownloaded ?? 0;
  const upBytes = stats?.uploadedBytes ?? 0;
  const downBytes = stats?.downloadedBytes ?? 0;

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
        panelRef={popoverPos.surfaceRef}
        style={popoverPos.style ?? undefined}
        label={localOnly ? "本地空间" : "云端同步状态"}
      >
          {localOnly ? (
            <>
              <header className="sync-status-popover-header">
                <div><strong>本地空间</strong><span>当前仅本地</span></div>
                <span className="sync-status-dot" aria-hidden="true" />
              </header>
              <section className="sync-status-section">
                <p className="sync-status-local-note">数据仅保存在本机；开启云同步后可多端同步与备份。</p>
              </section>
              <footer className="sync-status-actions">
                <button type="button" className="ln-btn ln-btn--secondary" onClick={() => { setOpen(false); onOpenSettings(); }}><Settings2 size={14} />去设置云同步</button>
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
              {/* 上传/下载细分：用户要求始终展示（0 也显示）；字节仅统计正文+资源。 */}
              <div>
                <dt>上传</dt>
                <dd>{upDocs} 文档 · {upFolders} 目录 · {upQuick} 小记 · {formatBytesCompact(upBytes)}</dd>
              </div>
              <div>
                <dt>下载</dt>
                <dd>{downDocs} 文档 · {downFolders} 目录 · {downQuick} 小记 · {formatBytesCompact(downBytes)}</dd>
              </div>
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
                <button
                  type="button"
                  className="ln-btn ln-btn--secondary sync-status-inline-action"
                  onClick={() => { setOpen(false); onOpenHistory?.(conflictSnapshots[0]!.noteId); }}
                >查看历史</button>
              </div>
            </section>
          )}
          {stats?.warnings && stats.warnings.length > 0 && (
            <section className="sync-status-history-note" role="status">
              <TriangleAlert size={14} aria-hidden="true" />
              <div>
                <strong>同步有 {stats.warnings.length} 项被跳过</strong>
                <span>本地内容未改动，下次同步会重试；逐项原因见「设置 → 同步诊断」。</span>
              </div>
            </section>
          )}
          <footer className="sync-status-actions">
            {/* 「上次同步」已在上方明细行里（含耗时）；页脚不再重复，只留入口。 */}
            <button type="button" className="ln-btn ln-btn--secondary" onClick={() => { setOpen(false); onOpenSettings(); }}><Settings2 size={14} />同步设置</button>
          </footer>
            </>
          )}
      </HoverPopover>
    </div>
  );
}
