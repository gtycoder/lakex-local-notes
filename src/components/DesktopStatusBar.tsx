import { Cloud, LoaderCircle, Lock, Save, WifiOff } from "lucide-react";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export interface StatusBarNotice {
  text: string;
  action?: { label: string; onClick: () => void };
}

export interface DesktopStatusBarProps {
  repositoryLabel: string;
  showDocumentStats: boolean;
  locked: boolean;
  wordCountLabel: string;
  imageCountLabel: string;
  notice: StatusBarNotice | null;
  saveState: SaveState;
  saveLabel: string;
  sync: { cls: string; label: string; title: string };
}

export function DesktopStatusBar({
  repositoryLabel,
  showDocumentStats,
  locked,
  wordCountLabel,
  imageCountLabel,
  notice,
  saveState,
  saveLabel,
  sync,
}: DesktopStatusBarProps) {
  return (
    <footer className="statusbar">
      <span className="statusbar-repo">{repositoryLabel}</span>
      {showDocumentStats && (
        <>
          <span className="statusbar-divider" />
          {locked && (
            <span className="statusbar-lock" title="当前文档已锁定（只读）"><Lock size={11} />已锁定</span>
          )}
          <span className="statusbar-wordcount" title="当前文档字数">{wordCountLabel}</span>
          {imageCountLabel && <span className="statusbar-imagecount" title="当前文档图片数">{imageCountLabel}</span>}
          {notice && (notice.action ? (
            <button
              type="button"
              className="statusbar-notice statusbar-notice-action"
              title={notice.text}
              onClick={notice.action.onClick}
            >
              <span>{notice.text}</span>
              <span className="notice-action-label">{notice.action.label}</span>
            </button>
          ) : (
            <span className="statusbar-notice" title={notice.text}>{notice.text}</span>
          ))}
          <span className={`save-label ${saveState}`} title="保存状态">
            {saveState === "saving" ? <LoaderCircle className="spin" size={11} /> : saveState === "dirty" ? <WifiOff size={11} /> : <Save size={11} />}
            {saveLabel}
          </span>
          <span className={`statusbar-sync ${sync.cls}`} title={sync.title}><Cloud size={11} />{sync.label}</span>
        </>
      )}
    </footer>
  );
}
