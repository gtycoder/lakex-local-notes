import { AlertTriangle, CheckCircle2, History, LoaderCircle, Save, Upload, WifiOff } from "lucide-react";
import type { DocumentStatusModel } from "./documentStatusModel";

export interface StatusBarNotice {
  text: string;
  action?: { label: string; onClick: () => void };
}

export interface DesktopStatusBarProps {
  showDocumentStats: boolean;
  wordCount: number;
  imageCount: number;
  notice: StatusBarNotice | null;
  documentStatus: DocumentStatusModel;
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

export function DesktopStatusBar({ showDocumentStats, wordCount, imageCount, notice, documentStatus }: DesktopStatusBarProps) {
  if (!showDocumentStats) return null;
  return (
    <>
      <footer className={`statusbar document-statusbar${notice ? " has-message" : ""}`} aria-label="当前文档状态">
        <div className="document-statusbar-message" aria-live="polite">
          {notice?.text || ""}
        </div>
        <div className="document-statusbar-fixed">
          <div className="document-statusbar-stats" aria-label="文档统计">
            <span>字数 {Math.max(0, wordCount)}</span>
            <span>图片 {Math.max(0, imageCount)}</span>
          </div>
          <div className={`document-statusbar-state ${documentStatus.kind}`} title={documentStatus.label} aria-label={documentStatus.label}>
            <span className="document-statusbar-status-icon" aria-hidden="true"><StatusIcon status={documentStatus} /></span>
            <span>{documentStatus.label}</span>
          </div>
        </div>
      </footer>
      {notice && (
        <div className="document-notice-toast" role="status" aria-live="polite">
          <span>{notice.text}</span>
          {notice.action && <button type="button" onClick={notice.action.onClick}>{notice.action.label}</button>}
        </div>
      )}
    </>
  );
}
