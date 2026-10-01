import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, History, LoaderCircle, Lock, Save, Upload, WifiOff } from "lucide-react";
import type { DocumentStatusModel } from "./documentStatusModel";
import { Popover } from "./ui/Overlay";
import { usePopoverPosition } from "../hooks/usePopoverPosition";

export interface StatusBarNotice {
  text: string;
  action?: { label: string; onClick: () => void };
}

export interface DesktopStatusBarProps {
  showDocumentStats: boolean;
  /** 当前文档类型（v6）：非 doc 时「字数/图片」口径不适用（正文不是 Lake 文本），改为显示类型标签。 */
  docKind?: "doc" | "sheet" | "bitable" | "board";
  wordCount: number;
  imageCount: number;
  notice: StatusBarNotice | null;
  documentStatus: DocumentStatusModel;
  /** 当前文档已锁定（只读）。 */
  locked?: boolean;
  /**
   * 解锁当前文档。传了才把锁标识做成可点胶囊（点开一个小浮层再确认解锁）；
   * 不传 = 退回纯展示的静态标识（原行为）。
   */
  onUnlock?: () => void;
}

function StatusIcon({ status }: { status: DocumentStatusModel }) {
  switch (status.kind) {
    case "saving": return <LoaderCircle className="spin" size={12} />;
    case "dirty": return <Save size={12} />;
    case "save-error": return <AlertTriangle size={12} />;
    case "local-only": return <WifiOff size={12} />;
    case "pending": return <Upload size={12} />;
    case "conflict": return <AlertTriangle size={12} />;
    case "synced-history": return <History size={12} />;
    case "synced": return <CheckCircle2 size={12} />;
  }
}

export function DesktopStatusBar({ showDocumentStats, docKind = "doc", wordCount, imageCount, notice, documentStatus, locked = false, onUnlock }: DesktopStatusBarProps) {
  const lockRef = useRef<HTMLButtonElement | null>(null);
  const [unlockOpen, setUnlockOpen] = useState(false);
  // 锁标识的小浮层：锚在胶囊上，贴底会自动翻到上方（usePopoverPosition 先量真实尺寸）
  const unlockPos = usePopoverPosition({ open: unlockOpen, anchor: lockRef.current, width: 232, align: "start" });
  // 解锁后（或切到未锁定文档）关掉浮层
  useEffect(() => { if (!locked) setUnlockOpen(false); }, [locked]);
  if (!showDocumentStats) return null;
  return (
    <>
      <footer
        className={`statusbar document-statusbar${notice ? " has-message" : ""}`}
        data-doc-kind={docKind}
        aria-label="当前文档状态"
      >
        {/* 只有这一枚胶囊可点（pointer-events:auto）；「表格」「同步状态」保持不可点。 */}
        {locked && (onUnlock ? (
          <button
            type="button"
            ref={lockRef}
            className="document-statusbar-lock"
            title="点击解锁"
            aria-label="解锁当前文档"
            aria-haspopup="dialog"
            aria-expanded={unlockOpen}
            onClick={() => setUnlockOpen((open) => !open)}
          >
            <Lock size={11} aria-hidden="true" />
            <span>已锁定</span>
          </button>
        ) : (
          <span className="document-statusbar-lock" title="文档已锁定（只读）" aria-label="文档已锁定（只读）">
            <Lock size={11} aria-hidden="true" />
            <span>已锁定</span>
          </span>
        ))}
        <div className="document-statusbar-message" aria-live="polite">
          {notice?.text || ""}
        </div>
        <div className="document-statusbar-fixed">
          <div className="document-statusbar-stats" aria-label="文档统计">
            {docKind === "doc" ? (
              <>
                <span>字数 {Math.max(0, wordCount)}</span>
                <span>图片 {Math.max(0, imageCount)}</span>
              </>
            ) : (
              <span>{docKind === "sheet" ? "表格" : docKind === "bitable" ? "多维表" : "画板"}</span>
            )}
          </div>
          <div className={`document-statusbar-state ${documentStatus.kind}`} title={documentStatus.label} aria-label={documentStatus.label}>
            <span className="document-statusbar-status-icon" aria-hidden="true"><StatusIcon status={documentStatus} /></span>
            <span>{documentStatus.label}</span>
          </div>
        </div>
      </footer>
      {locked && onUnlock && unlockOpen && (
        <Popover open onDismiss={() => setUnlockOpen(false)} style={unlockPos.style ?? undefined} surfaceRef={unlockPos.surfaceRef}>
          <div className="document-lock-popover">
            <strong>本文档已锁定（只读）</strong>
            <span>锁定期间编辑与工具栏被禁用。</span>
            <button type="button" className="ln-btn ln-btn--primary" onClick={() => { setUnlockOpen(false); onUnlock(); }}>解锁</button>
          </div>
        </Popover>
      )}
      {notice && (
        <div className="document-notice-toast" role="status" aria-live="polite">
          <span>{notice.text}</span>
          {notice.action && <button type="button" onClick={notice.action.onClick}>{notice.action.label}</button>}
        </div>
      )}
    </>
  );
}
