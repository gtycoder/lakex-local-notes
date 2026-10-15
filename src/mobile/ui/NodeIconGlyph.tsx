import { CircleHelp } from "lucide-react";
import { parseNodeIcon } from "../../lib/nodeIcons";
import "./nodeIcon.css";

/** 与桌面共享图标值与资源，移动端独立渲染、独立样式。 */
export function MobileNodeIconGlyph({ value }: { value: string | null | undefined }) {
  const parsed = parseNodeIcon(value);
  if (!parsed) return null;
  if (parsed.kind === "emoji") {
    return <span className="mb-node-glyph" aria-hidden="true"><span className="mb-node-glyph__emoji">{parsed.char}</span></span>;
  }
  if (parsed.kind === "unknown") {
    return <span className="mb-node-glyph mb-node-glyph--unknown" aria-hidden="true"><CircleHelp /></span>;
  }
  const Glyph = parsed.icon.Icon;
  return <span className="mb-node-glyph" data-tint={parsed.tint} aria-hidden="true"><Glyph /></span>;
}
