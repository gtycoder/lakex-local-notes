import { useLayoutEffect, useRef, useState } from "react";
import { ChevronRight, Download } from "lucide-react";

export type ExportFormat = "markdown" | "html" | "lake" | "pdf";

export interface ExportSubmenuItemProps {
  onExportAs: (format: ExportFormat) => void;
  onCopyMarkdown: () => void;
  onCopyPaths: () => void;
  onClose: () => void;
}

/**
 * 「导出」二级菜单行（目录树右键 + 文档右上角 ⋯ 共用同一份动作）。
 *
 * 定位：子菜单默认与行顶对齐（CSS `top:-4px`），但一级菜单靠下时导出的后几项会被窗口底边裁掉
 * （260916 用户截图：Word/PDF/Lake/资料路径 全看不到）。这里展开时按**视口**把整块子菜单上移，
 * 底部贴边即止；比视口还高时贴顶显示并允许子菜单内部滚动（对应 dialogs.css 的 max-height）。
 * 左右方向沿用原口径：右侧放不下就翻到一级菜单左侧。
 */
export function ExportSubmenuItem({ onExportAs, onCopyMarkdown, onCopyPaths, onClose }: ExportSubmenuItemProps) {
  const [open, setOpen] = useState(false);
  const [openLeft, setOpenLeft] = useState(false);
  const [top, setTop] = useState(-4);
  const rowRef = useRef<HTMLDivElement>(null);
  const submenuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const row = rowRef.current;
    const submenu = submenuRef.current;
    if (!row || !submenu) return;
    const margin = 8;
    const rowRect = row.getBoundingClientRect();
    const height = submenu.offsetHeight;
    const minTop = margin - rowRect.top;                                  // 子菜单顶贴窗口顶
    const maxTop = window.innerHeight - margin - height - rowRect.top;    // 子菜单底贴窗口底
    setTop(Math.round(Math.min(Math.max(-4, minTop), Math.max(minTop, maxTop))));
    setOpenLeft(rowRect.right + 2 + submenu.offsetWidth + margin > window.innerWidth);
  }, [open]);

  const run = (action: () => void) => () => { action(); onClose(); };

  return (
    <div
      ref={rowRef}
      className="context-menu-item has-submenu"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="context-menu-item-label"><Download size={15} /><span>导出</span></span>
      <ChevronRight size={14} />
      {open && (
        <div
          ref={submenuRef}
          className={`context-menu-submenu${openLeft ? " open-left" : ""}`}
          style={{ top }}
          role="menu"
        >
          <button role="menuitem" onClick={run(() => onExportAs("markdown"))}>导出为 Markdown 资料包</button>
          <button role="menuitem" onClick={run(onCopyMarkdown)}>导出为 Markdown 文本（复制）</button>
          <button role="menuitem" onClick={run(() => onExportAs("html"))}>导出为 HTML</button>
          <button role="menuitem" disabled title="开发中">导出为 Word（开发中）</button>
          <button role="menuitem" onClick={run(() => onExportAs("pdf"))}>导出为 PDF（图片内嵌）</button>
          <div className="context-menu-sep" />
          <button role="menuitem" onClick={run(() => onExportAs("lake"))}>导出为原生 Lake（图片内嵌）</button>
          <button role="menuitem" onClick={run(onCopyPaths)}>导出资料路径（本机 AI）</button>
        </div>
      )}
    </div>
  );
}
