import { FilePlus2, Save, Undo2 } from "lucide-react";
import { Dialog } from "../ui/Overlay";
import { SAVE_CONFLICT_MESSAGE } from "../../lib/types";

/**
 * 保存版本守卫的冲突确认（Batch4-D）：磁盘正文被外部/他端改过时，保存**没有写盘**，
 * 让用户显式三选一，绝不静默覆盖、也绝不静默丢弃本地编辑。
 *
 * - 另存为副本（默认 / 安全项）：把本地改动写成一篇新文档，原文档载入磁盘版本；
 * - 覆盖磁盘：用本地版本覆盖（用户明确选择，带上冲突时看到的 diskHash 重试一次）；
 * - 放弃本次修改并载入磁盘版：丢弃本地未保存内容（显式选择）。
 *
 * Esc / 点遮罩不关闭（onDismiss = 保持挂起）：冲突未处理前自动保存一直暂停，避免反复弹窗。
 */
export interface SaveConflictDialogProps {
  open: boolean;
  /** 文档标题（标题栏展示用）。 */
  fileName: string;
  /** 处理中：三个按钮一起禁用（防止重复点击派发多次覆盖/副本）。 */
  busy?: boolean;
  onSaveAsCopy(): void;
  onOverwrite(): void;
  onDiscardAndReload(): void;
  onDismiss?(): void;
}

export function SaveConflictDialog({ open, fileName, busy = false, onSaveAsCopy, onOverwrite, onDiscardAndReload, onDismiss }: SaveConflictDialogProps) {
  if (!open) return null;
  return (
    <Dialog open={open} onDismiss={onDismiss ?? (() => { /* 必须显式选择：不处理就等于保持挂起 */ })} label="保存冲突" className="save-conflict-dialog">
      {/* 261112 UI 审计 17 I-9：改用 overlay 的 .ln-dialog 三段式（head/body/actions 单一来源），
          只保留表面类 .save-conflict-dialog（宽度）与文件名行（颜色/断行）两条本处专属样式。 */}
      <div className="ln-dialog__head">
        <span className="ln-dialog__title">这篇文档在别处被改过</span>
      </div>
      <div className="ln-dialog__body">
        <p>{SAVE_CONFLICT_MESSAGE}</p>
        <p className="save-conflict-dialog__file">
          文档：<strong>{fileName || "无标题"}</strong>
        </p>
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn ln-btn--primary" disabled={busy} onClick={onSaveAsCopy} autoFocus>
          <FilePlus2 size={14} aria-hidden="true" />另存为副本（推荐）
        </button>
        <button type="button" className="ln-btn ln-btn--secondary" disabled={busy} onClick={onOverwrite}>
          <Save size={14} aria-hidden="true" />覆盖磁盘
        </button>
        <button type="button" className="ln-btn ln-btn--ghost" disabled={busy} onClick={onDiscardAndReload}>
          <Undo2 size={14} aria-hidden="true" />放弃本次修改并载入磁盘版
        </button>
      </div>
    </Dialog>
  );
}
