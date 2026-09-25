import { Download } from "lucide-react";
import { Submenu } from "./ui/Overlay";

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
 * 视觉/交互/定位全部交给标准原语 `<Submenu>`（悬停展开 + 相邻侧定位 + 视口夹取 + 嵌套浮层保护）；
 * 本组件只提供行文案与菜单项。此前手写的视口上移/左右翻转逻辑已随之收编。
 */
export function ExportSubmenuItem({ onExportAs, onCopyMarkdown, onCopyPaths, onClose }: ExportSubmenuItemProps) {
  const run = (action: () => void) => () => { action(); onClose(); };

  return (
    <Submenu label={<><Download size={15} /><span>导出</span></>}>
      <button role="menuitem" onClick={run(() => onExportAs("markdown"))}>导出为 Markdown 资料包</button>
      <button role="menuitem" onClick={run(onCopyMarkdown)}>导出为 Markdown 文本（复制）</button>
      <button role="menuitem" onClick={run(() => onExportAs("html"))}>导出为 HTML</button>
      <button role="menuitem" disabled title="开发中">导出为 Word（开发中）</button>
      <button role="menuitem" onClick={run(() => onExportAs("pdf"))}>导出为 PDF（图片内嵌）</button>
      <div className="context-menu-sep" />
      <button role="menuitem" onClick={run(() => onExportAs("lake"))}>导出为原生 Lake（图片内嵌）</button>
      <button role="menuitem" onClick={run(onCopyPaths)}>导出资料路径（本机 AI）</button>
    </Submenu>
  );
}
