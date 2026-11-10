/**
 * 「保存到小记」弹窗：**浮动窗（可拖动/8 向缩放，尺寸本地记忆）** + ln-* 原语。
 * 261110 用户定稿：默认 860×620（min 560×420），正文 textarea 吃满窗体高度。
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Dialog } from "../../components/ui/Overlay";
import { DialogResizeHandles } from "../../components/ui/DialogResizeHandles";
import { useFloatingDialog } from "../../components/hooks/useFloatingDialog";

export interface SaveQuickNoteDialogProps {
  open: boolean;
  content: string;
  busy: boolean;
  error: string | null;
  onConfirm: (text: string) => void;
  onClose: () => void;
}

export function SaveQuickNoteDialog({ open, content, busy, error, onConfirm, onClose }: SaveQuickNoteDialogProps) {
  const floating = useFloatingDialog({ id: "aiw-save-quicknote", initialSize: { w: 860, h: 620 }, minSize: { w: 560, h: 420 } });
  /** 首焦点 = 正文（直接可编辑）；不落在右上关闭钮上。 */
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(content);
  useEffect(() => { if (open) setText(content); }, [open, content]);
  const canSave = text.trim().length > 0 && !busy;
  return (
    <Dialog
      open={open}
      onDismiss={onClose}
      label="保存到小记"
      surfaceRef={floating.panelRef}
      surfaceClassName="floating-dialog aiw-quicknote"
      style={floating.panelStyle}
      initialFocus={textareaRef}
    >
      <div className="ln-dialog__head floating-dialog-header" onPointerDown={floating.startDrag}>
        <span className="ln-dialog__title">保存到小记</span>
        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="关闭" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="ln-dialog__body">
        <div className="aiw-quicknote__body">
          <textarea
            ref={textareaRef}
            className="ln-text-field aiw-quicknote__input"
            value={text}
            aria-label="小记正文"
            onChange={(event) => setText(event.target.value)}
          />
          {error && <p className="aiw-quicknote__error" role="alert">{error}</p>}
        </div>
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn ln-btn--ghost" onClick={onClose}>{busy ? "取消保存" : "关闭"}</button>
        <button type="button" className="ln-btn ln-btn--primary" disabled={!canSave} onClick={() => onConfirm(text)}>
          {busy ? "保存中…" : "小记一下"}
        </button>
      </div>
      <DialogResizeHandles onResize={floating.startResize} />
    </Dialog>
  );
}
