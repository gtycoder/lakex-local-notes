import type { CSSProperties } from "react";
import { Check, Cloud, CloudOff, LoaderCircle, TriangleAlert, X } from "lucide-react";
import type { SyncProgress } from "../lib/types";

/** 同步状态小悬浮窗（思源观感：小卡片 + 主色进度条 + 自动消失）。
 * 不再使用带按钮的大弹窗：点击顶栏云按钮后直接开始同步，这里只展示状态。 */
export interface SyncToastData {
  kind: "busy" | "ok" | "error" | "unavailable";
  title: string;
  message: string;
  /** busy 时的进度数据（主色进度条，绝不用红色） */
  progress?: SyncProgress | null;
  /** 完成/错误时的补充说明（如：远端覆盖本地、已存入历史版本） */
  detail?: string;
  onConfigure?: () => void;
}

const PHASE_LABEL: Record<SyncProgress["phase"], string> = {
  connect: "连接 S3",
  download: "下载远端变更",
  upload: "上传本地变更",
  manifest: "写入清单",
  "quick-notes": "同步小记",
  done: "同步完成",
};

function formatPercent(current?: number, total?: number): number | null {
  if (current == null || !total) return null;
  return Math.min(100, Math.round((current / total) * 100));
}

export function SyncToast({ data, onClose, anchorRect }: { data: SyncToastData; onClose: () => void; anchorRect?: DOMRect | null }) {
  const progress = data.progress;
  const mainPct = progress ? formatPercent(progress.current, progress.total) : null;
  const assetPct = progress ? formatPercent(progress.assetCurrent, progress.assetTotal) : null;

  // 有锚点时：在触发按钮（云同步）正下方弹出（思源式原位反馈）
  const anchorStyle: CSSProperties = anchorRect
    ? { position: "fixed", top: Math.round(anchorRect.bottom + 6), left: Math.max(8, Math.min(Math.round(anchorRect.left), window.innerWidth - 380)), right: "auto", bottom: "auto" }
    : {};

  return (
    <div className="sync-toast" role="status" aria-live="polite" style={anchorStyle}>
      <div className={`sync-toast-icon sync-toast-icon--${data.kind}`}>
        {data.kind === "busy" ? <LoaderCircle className="spin" size={17} /> : data.kind === "ok" ? <Check size={17} /> : data.kind === "error" ? <TriangleAlert size={17} /> : <CloudOff size={17} />}
      </div>
      <div className="sync-toast-body">
        <div className="sync-toast-title">{data.title}</div>
        <div className="sync-toast-msg">{data.message}</div>
        {data.kind === "busy" && progress && (
          <div className="sync-toast-progress">
            <div className="sync-toast-progress-row">
              <span>{progress.phase !== "done" ? PHASE_LABEL[progress.phase] : "同步完成"}</span>
              {mainPct != null && <span>{mainPct}%</span>}
            </div>
            <div className="sync-toast-track">
              <div className={`sync-toast-bar ${mainPct == null ? "indeterminate" : ""}`} style={mainPct != null ? { width: `${mainPct}%` } : undefined} />
            </div>
            {assetPct != null && assetPct > 0 && (
              <div className="sync-toast-sub">资源 {progress.assetCurrent ?? 0}/{progress.assetTotal}</div>
            )}
          </div>
        )}
        {data.detail && <div className="sync-toast-detail">{data.detail}</div>}
        {data.kind === "unavailable" && data.onConfigure && (
          <button className="b3-button sync-toast-action" onClick={data.onConfigure}>去配置</button>
        )}
      </div>
      <button className="sync-toast-close" onClick={onClose} aria-label="关闭"><X size={14} /></button>
    </div>
  );
}
