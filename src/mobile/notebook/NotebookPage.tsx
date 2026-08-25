/** 笔记本页：标题 + 目录（children 列表）。Phase 1 基础版。 */
import { ArrowLeft, FileText, FolderOpen, MoreHorizontal } from "lucide-react";
import type { TreeNode } from "../../lib/types";

export interface NotebookPageProps {
  notebook: TreeNode | undefined;
  children: TreeNode[];
  onBack: () => void;
  onOpenNote: (id: string) => void;
  onCreateNote: () => void;
}

export function NotebookPage(props: NotebookPageProps) {
  const { notebook, children, onBack, onOpenNote, onCreateNote } = props;
  const title = notebook?.title ?? "知识库";
  const items = children.filter((n) => n.nodeType !== "notebook");
  return (
    <div className="mobile-notebook">
      <header className="mobile-topbar">
        <button className="mobile-icon-btn" onClick={onBack} aria-label="返回"><ArrowLeft size={22} /></button>
        <div className="mobile-topbar-title">{title}</div>
        <button className="mobile-icon-btn" onClick={onCreateNote} aria-label="新建文档"><MoreHorizontal size={20} /></button>
      </header>
      <div className="mobile-scroll">
        {items.length === 0 && <div className="mobile-empty">暂无文档</div>}
        {items.map((n) => (
          <div key={n.id} className="mobile-doc-row" onClick={() => n.noteFileId && onOpenNote(n.noteFileId)}>
            {n.nodeType === "group" ? <FolderOpen size={18} /> : <FileText size={18} />}
            <span>{n.title}</span>
          </div>
        ))}
      </div>
      <div className="mobile-fab-col">
        <button className="mobile-fab" onClick={onCreateNote} aria-label="新建文档"><FileText size={20} /></button>
      </div>
    </div>
  );
}
