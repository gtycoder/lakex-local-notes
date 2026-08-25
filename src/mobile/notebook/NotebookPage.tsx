/** 笔记本页：folders 子节点（group）+ notes 文档（移动端两表合并，见 bridge.listNotebookChildren）。 */
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, FileText, FolderOpen, MoreHorizontal } from "lucide-react";
import { bridge } from "../bridge";

export interface NotebookChild {
  id: string;
  title: string;
  kind: "group" | "note";
  parentId: string | null;
}

export interface NotebookPageProps {
  notebookId: string;
  onBack: () => void;
  onOpenNote: (id: string) => void;
  onCreateNote: () => void;
}

export function NotebookPage(props: NotebookPageProps) {
  const { notebookId, onBack, onOpenNote, onCreateNote } = props;
  const [items, setItems] = useState<NotebookChild[]>([]);
  const [title, setTitle] = useState("知识库");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    const [children, nodes] = await Promise.all([bridge.listNotebookChildren(notebookId), bridge.listTreeNodes()]);
    setItems(children);
    const nb = nodes.find((n) => n.id === notebookId);
    if (nb) setTitle(nb.title);
  }, [notebookId]);

  useEffect(() => { void load(); }, [load]);

  const toggleGroup = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // 顶级项（根）+ 展开 group 的子项
  const topLevel = items.filter((it) => it.parentId === notebookId || it.kind === "note");
  const groupChildren = (groupId: string) => items.filter((it) => it.parentId === groupId);

  return (
    <div className="mobile-notebook">
      <header className="mobile-topbar">
        <button className="mobile-icon-btn" onClick={onBack} aria-label="返回"><ArrowLeft size={22} /></button>
        <div className="mobile-topbar-title">{title}</div>
        <button className="mobile-icon-btn" onClick={onCreateNote} aria-label="新建文档"><MoreHorizontal size={20} /></button>
      </header>
      <div className="mobile-scroll">
        {topLevel.length === 0 && <div className="mobile-empty">暂无文档，点右上新建</div>}
        {topLevel.map((it) => (
          <div key={it.kind + "-" + it.id}>
            {it.kind === "group" ? (
              <>
                <div className="mobile-doc-row mobile-group-row" onClick={() => toggleGroup(it.id)}>
                  <FolderOpen size={18} />
                  <span className="mobile-group-title">{it.title}</span>
                  <ChevronRight size={15} className={expanded.has(it.id) ? "mobile-chevron open" : "mobile-chevron"} />
                </div>
                {expanded.has(it.id) && groupChildren(it.id).map((c) => (
                  <div key={c.kind + "-" + c.id} className="mobile-doc-row mobile-group-child" onClick={() => c.kind === "note" && onOpenNote(c.id)}>
                    {c.kind === "group" ? <FolderOpen size={16} /> : <FileText size={16} />}
                    <span>{c.title}</span>
                  </div>
                ))}
              </>
            ) : (
              <div className="mobile-doc-row" onClick={() => onOpenNote(it.id)}>
                <FileText size={18} />
                <span>{it.title}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mobile-fab-col">
        <button className="mobile-fab" onClick={onCreateNote} aria-label="新建文档"><FileText size={20} /></button>
      </div>
    </div>
  );
}
