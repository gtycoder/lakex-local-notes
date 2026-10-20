import { CircleHelp } from "lucide-react";
import { parseNodeIcon } from "../../lib/nodeIcons";
import "./nodeIcon.css";

/**
 * 目录节点自定义图标的图形（261020 精简：只剩表情与语雀彩色插画两套）。
 *
 * · **表情符号** ⇒ 字符原样保留，与图标共用居中槽。
 * · **笔记本/分组的插画** ⇒ 原样渲染 20×20 SVG（图形自带配色，没有底块、没有色号）。
 * · **画不出来的值**（旧 `i:` 方言 / 跨端版本差）⇒ 中性问号；**绝不把原始串显示到界面上**。
 */
export function NodeIconGlyph({ value }: { value: string | null | undefined }) {
  const parsed = parseNodeIcon(value);
  if (!parsed) return null;
  if (parsed.kind === "emoji") {
    return <span className="node-icon-glyph" aria-hidden="true"><span className="node-icon-glyph__emoji">{parsed.char}</span></span>;
  }
  if (parsed.kind === "notebook") {
    const NbSvg = parsed.icon.Svg;
    return (
      <span className="node-icon-glyph node-icon-glyph--notebook" aria-hidden="true">
        <NbSvg />
      </span>
    );
  }
  return (
    <span className="node-icon-glyph node-icon-glyph--unknown" aria-hidden="true">
      <CircleHelp />
    </span>
  );
}
