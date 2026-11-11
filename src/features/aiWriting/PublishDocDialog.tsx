/**
 * 「生成文档」弹窗：**浮动窗（可拖动/8 向缩放，尺寸本地记忆）** + ln-* 原语。
 * 261110 用户定稿：原弹窗太窄 ⇒ 默认 780×460（min 560×340），内容走 ln-form 行 + 原语按钮。
 */
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { Dialog } from "../../components/ui/Overlay";
import { DialogResizeHandles } from "../../components/ui/DialogResizeHandles";
import { useFloatingDialog } from "../../components/hooks/useFloatingDialog";
import { Select } from "../../components/ui/Select";
import type { TreeNode } from "../../lib/types";
import { selectableNotebooks } from "./aiWritingDocs";

export interface PublishDocDialogProps {
  open: boolean;
  title: string;
  notebooks: readonly TreeNode[];
  busy: boolean;
  error: string | null;
  /** 确认：目标知识库 + **用户改过的标题**（空标题不允许确认）。 */
  onConfirm: (notebookId: string, title: string) => void;
  onClose: () => void;
}

export function PublishDocDialog({ open, title, notebooks, busy, error, onConfirm, onClose }: PublishDocDialogProps) {
  const floating = useFloatingDialog({ id: "aiw-publish-doc", initialSize: { w: 780, h: 460 }, minSize: { w: 560, h: 340 } });
  /** 首焦点 = 标题输入（用户 261110：标题必须可改，进来就能直接改）。 */
  const titleRef = useRef<HTMLInputElement>(null);
  const options = selectableNotebooks(notebooks).map((node) => ({ value: node.id, label: node.title }));
  const [notebookId, setNotebookId] = useState(options[0]?.value ?? "");
  /** 文档标题：默认取回答首行摘要，**可编辑**（用户 261110 点单）。 */
  const [docTitle, setDocTitle] = useState(title);
  useEffect(() => { if (open) { setNotebookId(options[0]?.value ?? ""); setDocTitle(title); } }, [open, title, options[0]?.value]);
  const canConfirm = Boolean(notebookId) && docTitle.trim().length > 0 && !busy;
  return (
    <Dialog
      open={open}
      onDismiss={onClose}
      label="生成文档"
      surfaceRef={floating.panelRef}
      surfaceClassName="floating-dialog aiw-publish"
      style={floating.panelStyle}
      initialFocus={titleRef}
    >
      <div className="ln-dialog__head floating-dialog-header" onPointerDown={floating.startDrag}>
        <span className="ln-dialog__title">生成文档</span>
        <button type="button" className="ln-iconbtn ln-iconbtn--compact" aria-label="关闭" onClick={onClose}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>
      <div className="ln-dialog__body">
        <div className="aiw-publish__body">
          <p className="aiw-publish__desc">把这条回答保存为一篇文档，选择要放进哪个知识库。</p>
          {options.length === 0 ? (
            <p className="aiw-publish__empty">还没有可用的知识库，先到左侧目录新建一个笔记本。</p>
          ) : (
            <div className="ln-form__row aiw-publish__row">
              <span className="ln-form__label aiw-publish__label">知识库</span>
              <Select value={notebookId} options={options} onChange={setNotebookId} label="选择知识库" className="aiw-publish__select" />
            </div>
          )}
          <div className="ln-form__row aiw-publish__row">
            <span className="ln-form__label aiw-publish__label">标题</span>
            <input
              ref={titleRef}
              className="ln-text-field aiw-publish__title"
              value={docTitle}
              aria-label="文档标题"
              placeholder="AI 生成文档"
              onChange={(event) => setDocTitle(event.target.value)}
            />
          </div>
          {error && <p className="aiw-publish__error" role="alert">{error}</p>}
        </div>
      </div>
      <div className="ln-dialog__actions">
        <button type="button" className="ln-btn ln-btn--ghost" onClick={onClose}>{busy ? "取消生成" : "取消"}</button>
        <button type="button" className="ln-btn ln-btn--primary" disabled={!canConfirm} onClick={() => onConfirm(notebookId, docTitle.trim())}>
          {busy ? "生成中…" : "确认"}
        </button>
      </div>
      <DialogResizeHandles onResize={floating.startResize} />
    </Dialog>
  );
}
