/**
 * 移动端快捷切换目录（对齐原型 ed-list / doc-list）：当前笔记本文档列表 → 点击切换。
 */
import { useEffect } from "react";
import { MobileSheet } from "../ui/MobileSheet";

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

  // MOB-11：scrim / 右滑关闭 / 返回栈 / 焦点与滚动锁统一由 MobileSheet 负责
  //（此前打开后按返回键会落到父层）；类名与 DOM 结构沿用原手写版（.mb-scrim + .mb-sheet，视觉不变）。
  return (
    <MobileSheet open={open} title="文档列表" onClose={onClose}>
      {documents.length === 0 ? (
        <p className="mb-empty mb-empty--inset">暂无文档</p>
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
    </MobileSheet>
  );
}
