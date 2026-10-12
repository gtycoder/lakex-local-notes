/**
 * 移动端快捷切换目录（对齐原型 ed-list / doc-list）：当前笔记本文档列表 → 点击切换。
 */
import { useEffect } from "react";
import { X } from "lucide-react";

export interface DocListItem {
  id: string;
  title: string;
}

export interface DocListSheetProps {
  open: boolean;
  documents: DocListItem[];
  activeId: string | null;
  onPick: (id: string) => void;
  onClose: () => void;
}

export function DocListSheet({ open, documents, activeId, onPick, onClose }: DocListSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="mobile-sheet-mask" onClick={onClose}>
      <div className="mobile-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mobile-sheet-grab" />
        <div className="mobile-sheet-head">
          <span className="mobile-sheet-title">文档列表</span>
          <button className="mobile-icon-btn" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </div>
        <div className="mobile-sheet-body">
          {documents.length === 0 ? (
            <p className="mobile-sheet-empty">暂无文档</p>
          ) : (
            documents.map((d) => (
              <button
                key={d.id}
                className={"med-doc-item" + (d.id === activeId ? " med-active" : "")}
                onClick={() => { onPick(d.id); onClose(); }}
              >
                <span className="med-doc-item-title mb-ellipsis">{d.title || "无标题"}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}