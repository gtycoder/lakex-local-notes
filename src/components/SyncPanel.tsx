import { Check, Cloud, History, LoaderCircle, X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { native } from "../lib/native";
import type { SyncProgress, SyncStatus, SyncStatusInfo } from "../lib/types";

const PHASE_LABEL: Record<SyncProgress["phase"], string> = {
  connect: "连接 S3",
  download: "下载远端变更",
  upload: "上传本地变更",
  manifest: "写入清单",
  "quick-notes": "同步小记",
  done: "同步完成",
};

function formatTime(iso: string | null): string {
  if (!iso) return "从未";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export interface SyncPanelHandle {
  sync: () => Promise<void>;
}

interface SyncPanelProps {
  open: boolean;
  onClose: () => void;
  onSyncStatusChange?: (status: Pick<SyncStatus, "phase" | "message"> & Partial<Pick<SyncStatus, "lastSyncedAt" | "pendingChanges">>) => void;
  /** 未配置 S3 时由外层展示可操作的设置提示，而不是把 IPC 原始错误抛到界面。 */
  onSyncUnavailable?: () => void;
}

export const SyncPanel = forwardRef<SyncPanelHandle, SyncPanelProps>(function SyncPanel({ open, onClose, onSyncStatusChange, onSyncUnavailable }, ref) {
  const [status, setStatus] = useState<"idle" | "busy" | "ok" | "error">("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [lastSync, setLastSync] = useState<SyncStatusInfo | null>(null);

  useEffect(() => {
    if (!open) return;
    void native.getSyncStatus().then(setLastSync).catch(() => undefined);
  }, [open]);

  const sync = async () => {
    if (status === "busy") return;
    setStatus("busy");
    setProgress({ phase: "connect", message: "准备同步..." });
    onSyncStatusChange?.({ phase: "syncing", message: "准备同步..." });
    const unsubscribe = native.onSyncProgress(setProgress);
    try {
      // 先做本地预检：没有 S3 配置时不再调用 IPC，让用户看到可操作的设置提示。
      const settings = await native.getS3Settings();
      if (!settings) {
        setStatus("idle");
        setMessage("尚未配置云同步");
        onSyncStatusChange?.({ phase: "idle", message: "尚未配置云同步" });
        onSyncUnavailable?.();
        return;
      }
      const result = await native.syncNow();
      setLastSync({ lastSyncedAt: result.completedAt, lastResult: result });
      const lakeMessage = `Lake：上传 ${result.uploaded}，下载 ${result.downloaded}，冲突 ${result.conflicts}`;
      const quickMessage = result.quickNotes?.error
        ? `；小记同步失败（Lake 已完成）`
        : result.quickNotes ? `；小记：上传 ${result.quickNotes.uploaded}，下载 ${result.quickNotes.downloaded}，冲突 ${result.quickNotes.conflicts}` : "";
      const resultMessage = `同步完成：${lakeMessage}${quickMessage}`;
      setMessage(resultMessage);
      if (result.supersededNotes && result.supersededNotes.length > 0) {
        const titles = result.supersededNotes.slice(0, 5).map((n) => `「${n.title}」`).join("、");
        const more = result.supersededNotes.length > 5 ? ` 等 ${result.supersededNotes.length} 篇` : "";
        (window as any).alert(`检测到远端修改已覆盖本地：${titles}${more}。\n本地修改已存入该文档的历史版本，可在"历史版本"中找回。`);
      }
      setStatus(result.quickNotes?.error ? "error" : "ok");
      onSyncStatusChange?.({ phase: "success", message: resultMessage, lastSyncedAt: result.completedAt, pendingChanges: 0 });
    } catch (error) {
      const rawMessage = String(error);
      // 兼容旧版本主进程/配置竞态：即使预检后配置被清空，也走同一套友好提示。
      if (rawMessage.includes("请先保存 S3 配置")) {
        setStatus("idle");
        setMessage("尚未配置云同步");
        onSyncStatusChange?.({ phase: "idle", message: "尚未配置云同步" });
        onSyncUnavailable?.();
      } else {
        const errorMessage = "同步失败，请检查网络或 S3 配置";
        setMessage(errorMessage);
        setStatus("error");
        onSyncStatusChange?.({ phase: "error", message: errorMessage });
      }
    } finally {
      unsubscribe();
      window.setTimeout(() => setProgress(null), 400);
    }
  };

  useImperativeHandle(ref, () => ({ sync }), [sync, status]);

  if (!open) return null;

  const mainCurrent = progress?.current;
  const mainTotal = progress?.total;
  const assetCurrent = progress?.assetCurrent;
  const assetTotal = progress?.assetTotal;
  const mainPercent = mainCurrent != null && mainTotal
    ? Math.min(100, Math.round((mainCurrent / mainTotal) * 100))
    : null;
  const assetPercent = assetCurrent != null && assetTotal
    ? Math.min(100, Math.round((assetCurrent / assetTotal) * 100))
    : null;
  const busy = status === "busy";

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="sync-panel" role="dialog" aria-modal="true">
        <header>
          <div><Cloud size={20} /><div><h2>S3 同步</h2><p>S3 配置在 偏好设置 → 云端与同步</p></div></div>
          <button className="icon-button" onClick={onClose} title="关闭"><X size={19} /></button>
        </header>

        {progress && (
          <div className="sync-progress">
            <div className="sync-progress-row">
              <span className="sync-progress-label">
                {busy ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}
                {PHASE_LABEL[progress.phase]}
                {mainCurrent != null && mainTotal ? `（${mainCurrent}/${mainTotal}）` : ""}
              </span>
              {mainPercent != null && <span className="sync-progress-pct">{mainPercent}%</span>}
            </div>
            <div className="sync-progress-track">
              <div
                className={`sync-progress-bar ${mainPercent == null ? "indeterminate" : ""}`}
                style={mainPercent != null ? { width: `${mainPercent}%` } : undefined}
              />
            </div>
            {assetTotal != null && assetTotal > 0 && (
              <div className="sync-progress-sub">
                <div className="sync-progress-row sync-progress-row--sub">
                  <span className="sync-progress-label">资源（{assetCurrent ?? 0}/{assetTotal}）</span>
                  {assetPercent != null && <span className="sync-progress-pct">{assetPercent}%</span>}
                </div>
                <div className="sync-progress-track">
                  <div className="sync-progress-bar" style={{ width: `${assetPercent ?? 0}%` }} />
                </div>
              </div>
            )}
            <div className="sync-progress-message">{progress.message}</div>
          </div>
        )}

        <div className="sync-last-result">
          <div className="sync-last-row"><History size={13} />本地最后同步：{formatTime(lastSync?.lastSyncedAt ?? null)}</div>
          {lastSync?.lastResult && (
            <div className="sync-last-row sync-last-counts">
              上传 {lastSync.lastResult.uploaded} · 下载 {lastSync.lastResult.downloaded} · 冲突 {lastSync.lastResult.conflicts}
              {lastSync.lastResult.quickNotes && (
                <> · 小记 {lastSync.lastResult.quickNotes.uploaded}↑ {lastSync.lastResult.quickNotes.downloaded}↓</>
              )}
              <span className="sync-last-manifest">#{lastSync.lastResult.manifestId.slice(0, 8)}</span>
            </div>
          )}
        </div>

        {message && <div className={`connection-message ${status}`}>{status === "busy" ? <LoaderCircle className="spin" size={16} /> : status === "ok" ? <Check size={16} /> : null}{message}</div>}
        <footer>
          <button className="primary-button" onClick={sync} disabled={busy}>{busy ? "同步中..." : "立即同步"}</button>
        </footer>
      </section>
    </div>
  );});
