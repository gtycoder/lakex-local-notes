import { Download } from "lucide-react";
import { Submenu } from "./Overlay";

/** 已实现的文档导出格式（仅 doc 文档可用）。 */
export type DocExportFormat = "markdown" | "html" | "pdf";
/**
 * 导出动作格式全集：doc 用 markdown/html/pdf；
 * bitable 用 csv / zip（已实现）；usheet 的 csv/xlsx、board 的 png/svg 目前是**占位**（disabled，逻辑后续补）。
 */
export type ExportFormat = DocExportFormat | "csv" | "zip" | "xlsx" | "png" | "svg";

export interface ExportSubmenuItemProps {
  /** 文档类型：doc / usheet / bitable / board（未知按 doc 处理）。 */
  kind: string;
  onExportAs: (format: ExportFormat) => void;
  onCopyMarkdown: () => void;
  onCopyPaths: () => void;
  onClose: () => void;
}

/** 占位菜单项：可见但不可点，明确标注「开发中」，不误导为已支持。 */
function Placeholder({ label }: { label: string }) {
  return <button role="menuitem" disabled title="开发中">{label}</button>;
}

/**
 * 「导出」二级菜单行（目录树右键 + 文档右上角 ⋯ 共用同一份动作）。
 *
 * **按文档类型给各自的菜单，不混用**（用户 260930 明确）：
 * - doc：Markdown 资料包 / Markdown 文本（复制）/ HTML / PDF / 资料路径（**已彻底移除「导出为原生 Lake」**）；
 * - usheet：CSV / Excel —— 占位（disabled，待补逻辑）；
 * - bitable：CSV（活动数据表）；
 * - board：PNG / SVG —— 占位（disabled，待补逻辑）。
 * 「导出资料路径（本机 AI）」是与格式无关的本地路径工具，各类型都保留。
 *
 * 视觉/交互/定位全部交给标准原语 `<Submenu>`；本组件只提供行文案与菜单项。
 */
export function ExportSubmenuItem({ kind, onExportAs, onCopyMarkdown, onCopyPaths, onClose }: ExportSubmenuItemProps) {
  const run = (action: () => void) => () => { action(); onClose(); };
  const type = kind === "usheet" ? "sheet" : kind === "bitable" || kind === "board" ? kind : "doc";

  return (
    <Submenu label={<><Download size={15} /><span>导出</span></>}>
      {type === "doc" && (
        <>
          <button role="menuitem" onClick={run(() => onExportAs("markdown"))}>导出为 Markdown 资料包</button>
          <button role="menuitem" onClick={run(onCopyMarkdown)}>导出为 Markdown 文本（复制）</button>
          <button role="menuitem" onClick={run(() => onExportAs("html"))}>导出为 HTML</button>
          <button role="menuitem" disabled title="开发中">导出为 Word（开发中）</button>
          <button role="menuitem" onClick={run(() => onExportAs("pdf"))}>导出为 PDF（图片内嵌）</button>
        </>
      )}
      {type === "sheet" && (
        <>
          <Placeholder label="导出为 CSV（开发中）" />
          <Placeholder label="导出为 Excel（开发中）" />
        </>
      )}
      {type === "bitable" && (
        <>
          <button role="menuitem" onClick={run(() => onExportAs("csv"))}>导出为 CSV</button>
          <button role="menuitem" onClick={run(() => onExportAs("zip"))}>导出为压缩包（含附件）</button>
        </>
      )}
      {type === "board" && (
        <>
          <Placeholder label="导出为 PNG（开发中）" />
          <Placeholder label="导出为 SVG（开发中）" />
        </>
      )}
      <div className="context-menu-sep" />
      <button role="menuitem" onClick={run(onCopyPaths)}>导出资料路径（本机 AI）</button>
    </Submenu>
  );
}
