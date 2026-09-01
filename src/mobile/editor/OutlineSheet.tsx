/**
 * 移动端大纲面板（对齐原型 fab-outline）：读 Lake TOC（kernel.getDocExtraContent().toc）
 * → 标题列表（按 depth 缩进）→ 点击跳转（headingUnfold + scrollByNodeId）。
 */
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { lakeBridge, type LakeEditorInstance } from "../../features/editor/lakeRuntime";

interface TocEntry {
  id?: string;
  text?: string;
  level?: number;
  depth?: number;
  type?: string;
  [k: string]: unknown;
}

export interface OutlineSheetProps {
  open: boolean;
  editor: LakeEditorInstance | null;
  onClose: () => void;
}

export function OutlineSheet({ open, editor, onClose }: OutlineSheetProps) {
  const [entries, setEntries] = useState<TocEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    try {
      const toc = lakeBridge(editor ?? undefined).kernel?.getDocExtraContent?.().toc;
      setEntries(Array.isArray(toc) ? (toc as TocEntry[]) : []);
    } catch { setEntries([]); }
  }, [open, editor]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const jump = (id: string) => {
    try {
      const renderer = lakeBridge(editor ?? undefined).renderer;
      renderer?.execCommand?.("headingUnfold" as never, id);
      renderer?.scrollByNodeId?.(id);
    } catch { /* 跳转失败不阻断 */ }
    onClose();
  };

  return (
    <div className="mobile-sheet-mask" onClick={onClose}>
      <div className="mobile-sheet med-outline-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="mobile-sheet-grab" />
        <div className="mobile-sheet-head">
          <span className="mobile-sheet-title">大纲</span>
          <button className="mobile-icon-btn" onClick={onClose} aria-label="关闭"><X size={20} /></button>
        </div>
        <div className="mobile-sheet-body">
          {entries.length === 0 ? (
            <p className="mobile-sheet-empty">暂无标题</p>
          ) : (
            entries.filter((e) => e.id && e.text).map((e) => (
              <button
                key={String(e.id)}
                className={"med-outline-item lv" + (Math.min((e.depth ?? 1), 3))}
                onClick={() => jump(String(e.id))}
              >
                {String(e.text)}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}