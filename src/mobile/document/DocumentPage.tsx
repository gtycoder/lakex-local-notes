/** 文档页（单文档视图）：顶栏 + 复用的编辑器主体 DocumentEditor。
 * 由首页/搜索直接打开单个文档时使用；第二层工作区(NotebookWorkspace)另用 DocumentEditor 包 tab + 左右抽屉。 */
import { useState } from "react";
import { ArrowLeft, Pencil, Trash2, ListTree, Files } from "lucide-react";
import { DocumentEditor } from "../editor/DocumentEditor";
import type { DocListItem } from "../editor/DocListSheet";
import type { POCNote } from "../bridge";

export interface DocumentPageProps {
  note: POCNote;
  content: string;
  title: string;
  editing: boolean;
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
  onToggleEdit: () => void;
  onBack: () => void;
  onDelete: () => void;
  /** 当前笔记本文档列表（快捷切换目录用） */
  documents?: DocListItem[];
  /** 切换打开另一个文档 */
  onOpenDocument?: (id: string) => void;
}

export function DocumentPage(props: DocumentPageProps) {
  const { note, content, title, editing, onTitleChange, onContentChange, onToggleEdit, onBack, onDelete, documents, onOpenDocument } = props;
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [docListOpen, setDocListOpen] = useState(false);

  return (
    <div className="mobile-document">
      <header className="mobile-topbar">
        <button className="mobile-icon-btn" onClick={onBack} aria-label="返回"><ArrowLeft size={22} /></button>
        <input className="mobile-title-input" value={title} onChange={(e) => onTitleChange(e.target.value)} readOnly={!editing} />
        <div className="mobile-topbar-actions">
          {!editing ? (
            <>
              <button className="mobile-icon-btn" onClick={() => setOutlineOpen(true)} aria-label="大纲"><ListTree size={20} /></button>
              <button className="mobile-icon-btn" onClick={() => setDocListOpen(true)} aria-label="目录"><Files size={20} /></button>
              <button className="mobile-icon-btn" onClick={onToggleEdit} aria-label="编辑"><Pencil size={20} /></button>
              <button className="mobile-icon-btn" onClick={onDelete} aria-label="删除"><Trash2 size={19} /></button>
            </>
          ) : (
            <>
              <button className="mobile-icon-btn" onClick={() => setDocListOpen(true)} aria-label="目录"><Files size={20} /></button>
              <button className="mobile-done-btn" onClick={onToggleEdit}>完成</button>
            </>
          )}
        </div>
      </header>
      <DocumentEditor
        note={note}
        content={content}
        title={title}
        editing={editing}
        onContentChange={onContentChange}
        onToggleEdit={onToggleEdit}
        documents={documents}
        onOpenDocument={onOpenDocument}
        outlineOpen={outlineOpen}
        onToggleOutline={() => setOutlineOpen((v) => !v)}
        docListOpen={docListOpen}
        onToggleDocList={() => setDocListOpen((v) => !v)}
      />
    </div>
  );
}
