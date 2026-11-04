/**
 * 单页导出入口（桌面专用）：**一个**按钮 + 点开后的格式菜单。
 *
 * 独立成文件（不进 InkPad 主文件）有两个原因：
 *  ① 用户定稿「只新增一个按钮，点开选格式」，把菜单控件收在一处，InkPad 只负责状态与回调；
 *  ② 跨端样式护栏（crossEndClassCoverage）要求「共享组件发出的类名两端都要有样式」——
 *     这个菜单只在桌面渲染（移动端不注入 onExportPage），放在桌面宿主侧才不会逼着移动端写死样式。
 */
import { Download } from "lucide-react";

/** 单页导出的三种格式。 */
export const EXPORT_FORMATS = [
  { value: "pdf", label: "当前页 PDF" },
  { value: "png", label: "当前页 PNG" },
  { value: "svg", label: "当前页 SVG" },
] as const;
export type InkPageExportFormat = (typeof EXPORT_FORMATS)[number]["value"];

export interface InkExportMenuProps {
  open: boolean;
  onToggle: () => void;
  onPick: (format: InkPageExportFormat) => void;
}

export function InkExportMenu({ open, onToggle, onPick }: InkExportMenuProps) {
  return (
    <div className="ink-export" data-ink-export>
      <button
        className={["ink-tool", open ? "is-active" : ""].join(" ")}
        onClick={onToggle}
        aria-label="导出"
        title="导出当前页"
        aria-expanded={open}
      ><Download size={16} /></button>
      {open && (
        <div className="ink-export__menu" role="menu" aria-label="导出当前页" data-ink-export-menu>
          {EXPORT_FORMATS.map((item) => (
            <button key={item.value} role="menuitem" onClick={() => onPick(item.value)}>{item.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}

export default InkExportMenu;
