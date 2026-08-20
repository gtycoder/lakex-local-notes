import { AlertTriangle, CheckCircle2, History, Lock, LoaderCircle, Save, Upload, WifiOff } from "lucide-react";
import type { DocumentStatusModel, LocalSaveState } from "./documentStatusModel";

export interface StatusBarNotice {
  text: string;
  action?: { label: string; onClick: () => void };
}

export interface DesktopStatusBarProps {
  showDocumentStats: boolean;
  locked: boolean;
  wordCountLabel: string;
  imageCountLabel: string;
  notice: StatusBarNotice | null;
  saveState: LocalSaveState;
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

export function DesktopStatusBar({ showDocumentStats, locked, wordCountLabel, imageCountLabel, notice, documentStatus }: DesktopStatusBarProps) {
  if (!showDocumentStats) return null;
  return (
    <footer className="statusbar document-statusbar" aria-label="当前文档状态">
      <div className="document-statusbar-stats" aria-label="文档统计">
        <span>字数 {wordCountLabel.replace(/\s*字$/, "") || "0"}</span>
        <span>图片 {imageCountLabel.replace(/^图片\s*/, "") || "0"}</span>
      </div>
      <div className="document-statusbar-notice" aria-live="polite">
        {notice && <span title={notice.text}>{notice.text}</span>}
      </div>
      <div className={`document-statusbar-state ${documentStatus.kind}`} title={documentStatus.label}>
        {locked && <span className="document-statusbar-locked"><Lock size={12} />只读</span>}
        <span className="document-statusbar-status-icon" aria-hidden="true"><StatusIcon status={documentStatus} /></span>
        <span>{documentStatus.label}</span>
      </div>
    </footer>
  );
}
