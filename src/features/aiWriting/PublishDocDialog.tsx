/**
 * 「生成文档」弹窗（v1 简化，用户 261109 定稿）：**只选到知识库（= 我们的笔记本）**，
 * 不再选目录、不做同级/子级；确认后把 Markdown 转成 Lake 正文写进该笔记本。
 */
import { useEffect, useState } from "react";
import { Dialog } from "../../components/ui/Overlay";
import { Select } from "../../components/ui/Select";
import type { TreeNode } from "../../lib/types";
import { selectableNotebooks } from "./aiWritingDocs";

export interface PublishDocDialogProps {
  open: boolean;
  title: string;
  notebooks: readonly TreeNode[];
  busy: boolean;
  error: string | null;
  onConfirm: (notebookId: string) => void;
  onClose: () => void;
}

export function PublishDocDialog({ open, title, notebooks, busy, error, onConfirm, onClose }: PublishDocDialogProps) {
  const options = selectableNotebooks(notebooks).map((node) => ({ value: node.id, label: node.title }));
  const [notebookId, setNotebookId] = useState(options[0]?.value ?? "");
  useEffect(() => { if (open) setNotebookId(options[0]?.value ?? ""); }, [open, options[0]?.value]);
  const canConfirm = Boolean(notebookId) && !busy;
  return (
    <Dialog open={open} onDismiss={onClose} label="生成文档" className="aiw-publish">
      <div className="ln-dialog__head"><span className="ln-dialog__title">生成文档</span></div>
      <div className="ln-dialog__body">
        <p className="aiw-publish__desc">把这条回答保存为一篇文档，选择要放进哪个知识库。</p>
        {options.length === 0 ? (
          <p className="aiw-publish__empty">还没有可用的知识库，先到左侧目录新建一个笔记本。</p>
        ) : (
          <div className="aiw-publish__row">
            <span className="aiw-publish__label">知识库</span>
            <Select value={notebookId} options={options} onChange={setNotebookId} label="选择知识库" className="aiw-publish__select" />
          </div>
        )}
        <p className="aiw-publish__hint">标题：{title || "AI 生成文档"}</p>
        {error && <p className="aiw-publish__error" role="alert">{error}</p>}
      </div>
      <div className="ln-dialog__actions">
        {/* 转换可能一二十秒：取消必须随时可用（真取消，不是关掉弹窗让转换在后台跑）。 */}
        <button type="button" className="ln-btn ln-btn--ghost" onClick={onClose}>{busy ? "取消生成" : "取消"}</button>
        <button type="button" className="ln-btn ln-btn--primary" disabled={!canConfirm} onClick={() => onConfirm(notebookId)}>
          {busy ? "生成中…" : "确认"}
        </button>
      </div>
    </Dialog>
  );
}
