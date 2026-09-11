/**
 * 移动端大纲面板（对齐原型 fab-outline）：读 Lake TOC（kernel.getDocExtraContent().toc）
 * → 标题列表（按 depth 缩进）→ 点击跳转（headingUnfold + scrollByNodeId）。
 */
import { useEffect, useMemo, useState } from "react";
import { X, ChevronLeft } from "lucide-react";
import { lakeBridge, resolveScrollNode, type LakeEditorInstance } from "../../features/editor/lakeRuntime";

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
  /** 渲染为右侧抽屉(.side-panel--right)而非底部 sheet。缺省为底部 sheet。 */
  side?: boolean;
}

export function OutlineSheet({ open, editor, onClose, side }: OutlineSheetProps) {
  const [entries, setEntries] = useState<TocEntry[]>([]);

  useEffect(() => {
    if (!open) return;
    let attempts = 0;
    let timer: number | undefined;
    // 内核 toc 就绪可能晚于面板打开：空则短轮询重试（≤ 20 次 × 200ms ≈ 4s），避免只读一次得到“暂无标题”。
    const read = (): void => {
      try {
        const toc = lakeBridge(editor ?? undefined).kernel?.getDocExtraContent?.().toc;
        const next = Array.isArray(toc) ? (toc as TocEntry[]) : [];
        setEntries(next);
        if (next.length === 0 && attempts < 20) { attempts += 1; timer = window.setTimeout(read, 200); }
      } catch { setEntries([]); }
    };
    read();
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, [open, editor]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // side 变体始终渲染（靠 .on 滑入/滑出，动画可达）；底部 sheet 仍按 open 条件渲染
  if (!open && !side) return null;

  const jump = (id: string) => {
    try {
      const renderer = lakeBridge(editor ?? undefined).renderer;
      renderer?.execCommand?.("headingUnfold" as never, id);
      renderer?.scrollByNodeId?.(id);
    } catch { /* 跳转失败不阻断 */ }
    // DOM 校正（对齐桌面 handleOutlineNavigate）：viewer/懒卡片下 scrollByNodeId 可能不精确，按节点位置兜底滚动
    try {
      const host = document.querySelector(".doc-pane.active .mobile-doc-body") ?? document.querySelector(".mobile-doc-body");
      if (host instanceof HTMLElement) {
        const scroller = resolveScrollNode(host);
        const el = document.getElementById(id);
        const correct = () => {
          if (!el || !scroller) return;
          const delta = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
          if (Math.abs(delta) > 2) scroller.scrollTop += delta;
        };
        window.setTimeout(correct, 50);
        window.setTimeout(correct, 200);
      }
    } catch { /* 校正失败不阻断 */ }
    onClose();
  };

  return (
    <div className={side ? ("side-mask" + (open ? " on" : "")) : "mobile-sheet-mask"} data-panel-mask={side ? "right" : undefined} onClick={onClose}>
      <div className={side ? ("side-panel side-panel--right" + (open ? " on" : "")) : "mobile-sheet med-outline-sheet"} onClick={(e) => e.stopPropagation()}>
        {!side && <div className="mobile-sheet-grab" />}
        {side ? (
          /* 侧栏头 = 思源 #sidebarRight .toolbar 口径：标题 + 箭头关闭（左栏收右箭头、右栏收左箭头） */
          <div className="toolbar toolbar--border toolbar--dark" data-prevent-swipe>
            <div className="toolbar__scroll"><span className="toolbar__text">大纲</span></div>
            <span className="toolbar__icon" role="button" tabIndex={0} onClick={onClose} aria-label="收起"><ChevronLeft /></span>
          </div>
        ) : (
          <div className="mobile-sheet-head">
            <span className="mobile-sheet-title">大纲</span>
            <button className="mobile-icon-btn" onClick={onClose} aria-label="关闭"><X size={20} /></button>
          </div>
        )}
        <div className={"mobile-sheet-body" + (side ? " side-panel-body b3-list--mobile" : "")}>
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