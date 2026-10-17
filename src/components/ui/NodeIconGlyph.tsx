import { CircleHelp } from "lucide-react";
import { parseNodeIcon } from "../../lib/nodeIcons";
import "./nodeIcon.css";

/**
 * 目录节点自定义图标的图形（261014：在「表情符号」之外新增「图标」类目）。
 *
 * 渲染形态 = **浅渐变圆角底块 + 白色线性轮廓**（用户 261015：先加底块，再按飞书预制色减轻底色）。
 * 选择器预览、目录行与标签页都由本组件提供；换色时整张底块一起预览。
 *
 * · **表情符号** ⇒ 字符原样保留，和图标共用居中槽；字号适当放大，图标底块适当缩小，视觉尺寸靠拢。
 * · **图标** ⇒ 选中色着底、线性轮廓留白；颜色是内容标识，三主题共用 themes/base.css 的色表。
 * · **目录里没有的 id** ⇒ 中性问号图形；**绝不把 `i:xxx:0` 这种原始串显示到界面上**（跨端版本差兜底）。
 */
export function NodeIconGlyph({ value }: { value: string | null | undefined }) {
  const parsed = parseNodeIcon(value);
  if (!parsed) return null;
  if (parsed.kind === "emoji") {
    return <span className="node-icon-glyph" aria-hidden="true"><span className="node-icon-glyph__emoji">{parsed.char}</span></span>;
  }
  if (parsed.kind === "unknown") {
    return (
      <span className="node-icon-glyph node-icon-glyph--unknown" aria-hidden="true">
        <CircleHelp />
      </span>
    );
  }
  const Glyph = parsed.icon.Icon;
  return (
    <span className="node-icon-glyph" data-tint={parsed.tint} aria-hidden="true">
      <Glyph />
    </span>
  );
}
