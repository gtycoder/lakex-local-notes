/**
 * 「保存到小记」弹窗（v1）：正文可直接编辑，确认 = 建一条小记（走既有 createQuickNote）。
 * 标签入口留待 v1.1（语雀同款位置），避免本版把标签体系再拉进来。
 */
import { useEffect, useState } from "react";
import { Dialog } from "../../components/ui/Overlay";

export interface SaveQuickNoteDialogProps {
  open: boolean;
  content: string;
  busy: boolean;
  error: string | null;
  onConfirm: (text: string) => void;
  onClose: () => void;
}

export function SaveQuickNoteDialog({ open, content, busy, error, onConfirm, onClose }: SaveQuickNoteDialogProps) {
  const [text, setText] = useState(content);
  useEffect(() => { if (open) setText(content); }, [open, content]);
  const canSave = text.trim().length > 0 && !busy;
  return (
    <Dialog open={open} onDismiss={onClose} label="保存到小记" className="aiw-quicknote">
      <div className="ln-dialog__head"><span className="ln-dialog__title">保存到小记</span></div>
      <div className="ln-dialog__body">
        <textarea
          className="ln-input__field aiw-quicknote__input"
          value={text}
          rows={10}
          aria-label="小记正文"
          onChange={(event) => setText(event.target.value)}
        />
        {error && <p className="aiw-quicknote__error" role="alert">{error}</p>}
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn ln-btn--ghost" onClick={onClose}>{busy ? "取消保存" : "关闭"}</button>
        <button type="button" className="ln-btn ln-btn--primary" disabled={!canSave} onClick={() => onConfirm(text)}>
          {busy ? "保存中…" : "小记一下"}
        </button>
      </div>
    </Dialog>
  );
}
