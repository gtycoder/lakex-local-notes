import { Download } from "lucide-react";
import { Submenu } from "./Overlay";
import { hostCapabilities } from "../../lib/hostCapabilities";

/** 已实现的文档导出格式（仅 doc 文档可用）。 */
export type DocExportFormat = "markdown" | "html" | "pdf" | "docx";
/**
 * 导出动作格式全集：doc 用 markdown/html/pdf/docx；
 * bitable 用 csv / zip；usheet 用 csv / xlsx；board 用 png / svg（已实现）；ink 的导出尚未实现。
 */
export type ExportFormat = DocExportFormat | "csv" | "zip" | "xlsx" | "png" | "svg";

export interface ExportSubmenuItemProps {
  /** 文档类型：doc / usheet / bitable / board / ink（未知按 doc 处理）。 */
  kind: string;
  onExportAs: (format: ExportFormat) => void;
  onCopyMarkdown: () => void;
  onCopyPaths: () => void;
  onClose: () => void;
}

/**
 * 「导出」二级菜单行（目录树右键 + 文档右上角 ⋯ 共用同一份动作）。
 *
 * **按文档类型给各自的菜单，不混用**（用户 260930 明确）：
 * - doc：Markdown 资料包 / Markdown 文本（复制）/ HTML / Word / PDF / 资料路径（**已彻底移除「导出为原生 Lake」**）；
 * - usheet：CSV（活动工作表）/ Excel（全部工作表）；
 * - bitable：CSV（活动数据表）；
 * - board：PNG / SVG（已接线：复用画板内 Drawnix 导出；画板需已打开）。
 * - ink：正式 v1 不提供导出（子菜单只有下面的资料路径工具）。
 * 「导出资料路径（本机 AI）」是与格式无关的本地路径工具，各类型都保留。
 *
 * 视觉/交互/定位全部交给标准原语 `<Submenu>`；本组件只提供行文案与菜单项。
 */
export function ExportSubmenuItem({ kind, onExportAs, onCopyMarkdown, onCopyPaths, onClose }: ExportSubmenuItemProps) {
  // 宿主能力门禁：没有文件导入导出的宿主不显示导出入口（桌面 / 浏览器 Web 端都支持导出）。
  if (!hostCapabilities().importExport) return null;
  const run = (action: () => void) => () => { action(); onClose(); };
  const type = kind === "usheet" ? "sheet" : kind === "bitable" || kind === "board" || kind === "ink" ? kind : "doc";

  return (
    <Submenu label={<><Download size={15} /><span>导出</span></>}>
      {type === "doc" && (
        <>
          <button role="menuitem" onClick={run(() => onExportAs("markdown"))}>导出为 Markdown 资料包</button>
          <button role="menuitem" onClick={run(onCopyMarkdown)}>导出为 Markdown 文本（复制）</button>
          <button role="menuitem" onClick={run(() => onExportAs("html"))}>导出为 HTML</button>
          <button role="menuitem" onClick={run(() => onExportAs("docx"))}>导出为 Word</button>
          <button role="menuitem" onClick={run(() => onExportAs("pdf"))}>导出为 PDF（图片内嵌）</button>
        </>
      )}
      {type === "sheet" && (
        <>
          <button role="menuitem" onClick={run(() => onExportAs("csv"))}>导出为 CSV</button>
          <button role="menuitem" onClick={run(() => onExportAs("xlsx"))}>导出为 Excel</button>
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
          <button role="menuitem" onClick={run(() => onExportAs("png"))}>导出为 PNG</button>
          <button role="menuitem" onClick={run(() => onExportAs("svg"))}>导出为 SVG</button>
        </>
      )}
      {type !== "ink" && <div className="context-menu-sep" />}
      <button role="menuitem" onClick={run(onCopyPaths)}>导出资料路径（本机 AI）</button>
    </Submenu>
  );
}
