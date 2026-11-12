import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CloudOff, History, LoaderCircle, Lock, Save, Upload, WifiOff } from "lucide-react";
import type { DocumentStatusModel } from "../model/documentStatusModel";
import { Popover } from "../ui/Overlay";
import { NoticeToast, type StatusBarNotice } from "./NoticeToast";
import { usePopoverPosition } from "../../hooks/usePopoverPosition";
import type { NoteKind } from "../../core/noteKind";

export type { StatusBarNotice } from "./NoticeToast";

export interface DesktopStatusBarProps {
  showDocumentStats: boolean;
  /** 当前文档类型：非 doc 时「字数/图片」口径不适用（正文不是 Lake 文本），改为显示类型标签。 */
  docKind?: NoteKind;
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
    // v3：云端已彻底删除、本机仅保留回收站副本（恢复并重新上传成功后自动消失）
    case "cloud-deleted": return <CloudOff size={12} />;
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
  // 非知识库空间（日记 / 小记 / AI 写作 / 标签 / 回收站 / 资源）没有状态栏，但操作提示要在
  // （261112 task-93）：只渲染共享的 NoticeToast，不渲染底栏空壳；无提示时返回 null（DOM 与以前完全一致）。
  if (!showDocumentStats) return <NoticeToast notice={notice} />;
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
            className="ln-btn ln-btn--ghost ln-btn--compact document-statusbar-lock"
            title="点击解锁"
            aria-label="解锁当前文档"
            aria-haspopup="dialog"
            aria-expanded={unlockOpen}
            onClick={() => setUnlockOpen((open) => !open)}
          >
            <Lock size={12} aria-hidden="true" />
            <span>已锁定</span>
          </button>
        ) : (
          <span className="document-statusbar-lock" title="文档已锁定（只读）" aria-label="文档已锁定（只读）">
            <Lock size={12} aria-hidden="true" />
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
              <span>{docKind === "usheet" ? "表格" : docKind === "bitable" ? "多维表" : docKind === "board" ? "画板" : "手写板"}</span>
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
      {/* 提示 toast 与其它空间共用同一实现（此处是知识库空间的挂载点；位置/视觉不变）。 */}
      <NoticeToast notice={notice} />
    </>
  );
}
