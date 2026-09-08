/**
 * 知识库列表（思源口径：.b3-list--mobile 行 = 图标 18 + 名称 + .counter 文档数 + 右箭头；不再是 3:4 卡片宫格）。
 * 排序：长按进排序模式（拖动调整顺序，松手持久化 bridge.moveTreeNodeOrdered）。
 */
import { useRef, useState } from "react";
import { BookOpen, Check, GripVertical, X, ChevronRight } from "lucide-react";
import type { TreeNode } from "../../lib/types";

export interface NotebookGridProps {
  notebooks: TreeNode[];
  /** 每个笔记本下的文档数（.counter 展示） */
  docCounts: Record<string, number>;
  onOpenNotebook: (id: string) => void;
  /** 持久化排序：传入新的排序 id 列表。 */
  onReorder: (orderedIds: string[]) => Promise<void>;
}

export function NotebookGrid(props: NotebookGridProps) {
  const { notebooks, docCounts, onOpenNotebook, onReorder } = props;
  const [sorting, setSorting] = useState(false);
  const [items, setItems] = useState<TreeNode[]>(notebooks);
  const dragIdRef = useRef<string | null>(null);
  const dragOverIdRef = useRef<string | null>(null);
  const longPressRef = useRef<number | null>(null);

  const startSort = () => { setItems(notebooks); setSorting(true); };
  const cancelSort = () => { setSorting(false); };
  const finishSort = async () => {
    setSorting(false);
    try { await onReorder(items.map((n) => n.id)); } catch { /* 持久化失败由调用方提示 */ }
  };
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
  const clearLongPress = () => { if (longPressRef.current !== null) { window.clearTimeout(longPressRef.current); longPressRef.current = null; } };

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
      <div className="b3-list b3-list--mobile mobile-nb-list">
        {(sorting ? items : notebooks).map((nb) => (
          <div
            key={nb.id}
            className="b3-list-item mobile-nb-row"
            role="button"
            tabIndex={0}
            draggable={sorting}
            onClick={() => !sorting && onOpenNotebook(nb.id)}
            onDragStart={() => handleDragStart(nb.id)}
            onDragOver={(e) => { e.preventDefault(); handleDragOver(nb.id); }}
            onDragEnd={handleDragEnd}
            onDragLeave={() => { if (dragOverIdRef.current === nb.id) dragOverIdRef.current = null; }}
            onContextMenu={(e) => { e.preventDefault(); if (!sorting) startSort(); }}
            onTouchStart={(e) => {
              if (sorting) return;
              longPressRef.current = window.setTimeout(() => { longPressRef.current = null; startSort(); }, 600);
              void e;
            }}
            onTouchEnd={clearLongPress}
            onTouchMove={clearLongPress}
            onTouchCancel={clearLongPress}
          >
            <span className="b3-list-item__graphic">
              {sorting ? <GripVertical size={18} /> : nb.icon ? <span className="ln-node-emoji">{nb.icon}</span> : <BookOpen size={18} />}
            </span>
            <span className="b3-list-item__text">{nb.title}</span>
            <span className="counter">{docCounts[nb.id] ?? 0}</span>
            {!sorting && <span className="b3-list-item__arrow"><ChevronRight size={16} /></span>}
          </div>
        ))}
      </div>
    </>
  );
}
