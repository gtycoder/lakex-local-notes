/** 笔记本宫格（支持自定义排序）：长按进入排序模式，拖动调整顺序，松手持久化（bridge.moveTreeNodeOrdered）。 */
import { useRef, useState } from "react";
import { BookOpen, Check, GripVertical, X } from "lucide-react";
import type { TreeNode } from "../../lib/types";

export interface NotebookGridProps {
  notebooks: TreeNode[];
  onOpenNotebook: (id: string) => void;
  /** 持久化排序：传入新的排序 id 列表（调用方调 bridge.moveTreeNodeOrdered）。 */
  onReorder: (orderedIds: string[]) => Promise<void>;
}

export function NotebookGrid(props: NotebookGridProps) {
  const { notebooks, onOpenNotebook, onReorder } = props;
  const [sorting, setSorting] = useState(false);
  const [items, setItems] = useState<TreeNode[]>(notebooks);
  // 拖拽中的卡片 id + 指针位置
  const dragIdRef = useRef<string | null>(null);
  const dragOverIdRef = useRef<string | null>(null);

  const startSort = () => { setItems(notebooks); setSorting(true); };
  const cancelSort = () => { setSorting(false); };

  const finishSort = async () => {
    setSorting(false);
    const orderedIds = items.map((n) => n.id);
    try { await onReorder(orderedIds); }
    catch { /* 持久化失败由调用方提示 */ }
  };

  // 拖拽调整：把 dragId 移到 dragOverId 前
  const handleDragStart = (id: string) => { dragIdRef.current = id; };
  const handleDragOver = (id: string) => {
    if (!dragIdRef.current || dragIdRef.current === id || dragOverIdRef.current === id) return;
    dragOverIdRef.current = id;
    setItems((prev) => {
      const from = prev.findIndex((n) => n.id === dragIdRef.current);
      const to = prev.findIndex((n) => n.id === id);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };
  const handleDragEnd = () => { dragIdRef.current = null; dragOverIdRef.current = null; };

  if (notebooks.length === 0) return <div className="mobile-empty">暂无知识库</div>;

  return (
    <>
      {sorting && (
        <div className="mobile-sortbar">
          <span>拖动调整顺序</span>
          <button onClick={() => void finishSort()} aria-label="完成"><Check size={18} /></button>
          <button onClick={cancelSort} aria-label="取消"><X size={18} /></button>
        </div>
      )}
      <div className="mobile-nb-grid">
        {(sorting ? items : notebooks).map((nb) => (
          <div
            key={nb.id}
            className="mobile-nb-card"
            draggable={sorting}
            onClick={() => !sorting && onOpenNotebook(nb.id)}
            onDragStart={() => handleDragStart(nb.id)}
            onDragOver={(e) => { e.preventDefault(); handleDragOver(nb.id); }}
            onDragEnd={handleDragEnd}
            onDragLeave={() => { if (dragOverIdRef.current === nb.id) dragOverIdRef.current = null; }}
            onContextMenu={(e) => { e.preventDefault(); if (!sorting) startSort(); }}
            onTouchStart={(e) => {
              // 长按 600ms 进入排序（touch 无 drag 事件，用长按+手柄拖拽的简化：长按进排序模式）
              const t = window.setTimeout(() => { if (!sorting) startSort(); }, 600);
              (e.currentTarget as HTMLElement).dataset.longPress = String(t);
            }}
            onTouchEnd={(e) => {
              const t = (e.currentTarget as HTMLElement).dataset.longPress;
              if (t) window.clearTimeout(Number(t));
            }}
          >
            <div className="mobile-nb-cover">
              {sorting ? <GripVertical size={18} /> : <BookOpen size={28} />}
            </div>
            <div className="mobile-nb-name">{nb.title}</div>
          </div>
        ))}
      </div>
    </>
  );
}
