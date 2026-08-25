/** 笔记本页：完整子树递归展示（P1-3/P2-3/P2-4：顶级只含直接子节点，group 可递归展开，sort_order 排序）。 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronRight, FileText, FolderOpen, MoreHorizontal } from "lucide-react";
import { bridge } from "../bridge";

export interface NotebookTreeItem {
  id: string;
  title: string;
  kind: "group" | "note";
  parentId: string | null;
  sortOrder: number;
}

export interface NotebookPageProps {
  notebookId: string;
  onBack: () => void;
  onOpenNote: (id: string) => void;
  onCreateNote: () => void;
}

export function NotebookPage(props: NotebookPageProps) {
  const { notebookId, onBack, onOpenNote, onCreateNote } = props;
  const [items, setItems] = useState<NotebookTreeItem[]>([]);
  const [title, setTitle] = useState("知识库");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([notebookId]));

  const load = useCallback(async () => {
    const [tree, nodes] = await Promise.all([bridge.listNotebookTree(notebookId), bridge.listTreeNodes()]);
    setItems(tree);
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

  // 递归渲染：items 已按父级分组 + sort_order 排序；只显示"父级已展开"的节点
  const childrenOf = (parentId: string) => items.filter((it) => it.parentId === parentId);

  const renderBranch = (parentId: string, depth: number): ReactNode => {
    const children = childrenOf(parentId);
    return children.map((it) => (
      <div key={it.kind + "-" + it.id}>
        {it.kind === "group" ? (
          <>
            <div className={`mobile-doc-row mobile-group-row`} style={{ paddingLeft: 16 + depth * 18 }} onClick={() => toggleGroup(it.id)}>
              <FolderOpen size={18} />
              <span className="mobile-group-title">{it.title}</span>
              <ChevronRight size={15} className={expanded.has(it.id) ? "mobile-chevron open" : "mobile-chevron"} />
            </div>
            {expanded.has(it.id) && renderBranch(it.id, depth + 1)}
          </>
        ) : (
          <div className="mobile-doc-row" style={{ paddingLeft: 16 + depth * 18 }} onClick={() => onOpenNote(it.id)}>
            <FileText size={18} />
            <span>{it.title}</span>
          </div>
        )}
      </div>
    ));
  };

  const topLevel = childrenOf(notebookId);

  return (
    <div className="mobile-notebook">
      <header className="mobile-topbar">
        <button className="mobile-icon-btn" onClick={onBack} aria-label="返回"><ArrowLeft size={22} /></button>
        <div className="mobile-topbar-title">{title}</div>
        <button className="mobile-icon-btn" onClick={onCreateNote} aria-label="新建文档"><MoreHorizontal size={20} /></button>
      </header>
      <div className="mobile-scroll">
        {topLevel.length === 0 && <div className="mobile-empty">暂无文档，点右上新建</div>}
        {renderBranch(notebookId, 0)}
      </div>
      <div className="mobile-fab-col">
        <button className="mobile-fab" onClick={onCreateNote} aria-label="新建文档"><FileText size={20} /></button>
      </div>
    </div>
  );
}
