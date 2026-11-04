/**
 * 页内文字块的编辑框（261104 二十三批）。
 *
 * 为什么用 HTML textarea 而不是直接编辑 SVG <text>：中文必须走 IME，只有真实输入框可靠。
 * 位置/字号按页面百分比与当前缩放换算（缩放页面时输入框跟着缩放，所见即所得）。
 *
 * 独立成文件的原因同其它桌面控件：跨端样式护栏只扫 SHARED 名单（InkPad），
 * 把带类名的输入框放这里就不用给移动端补一份用不到的样式。
 */
import type { InkPageText } from "../../core/inkDoc.js";
import { INK_TEXT_LINE_HEIGHT, inkTextHeight } from "./inkPageTexts.js";

export interface InkPageTextEditorProps {
  text: InkPageText;
  /** 页面 → 屏幕的缩放（frame 宽 / 页面逻辑宽）。 */
  scale: number;
  page: { width: number; height: number };
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function InkPageTextEditor({ text, scale, page, value, onChange, onCommit, onCancel }: InkPageTextEditorProps) {
  return (
    <textarea
      className="ink-text-editor"
      value={value}
      autoFocus
      spellCheck={false}
      style={{
        left: `${(text.x / page.width) * 100}%`,
        top: `${(text.y / page.height) * 100}%`,
        width: `${(text.width / page.width) * 100}%`,
        minHeight: `${(inkTextHeight({ ...text, text: value }) / page.height) * 100}%`,
        fontSize: `${Math.max(8, text.fontSize * scale)}px`,
        lineHeight: INK_TEXT_LINE_HEIGHT,
        color: text.color,
        textAlign: text.align ?? "left",
      }}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onCommit();
        }
      }}
    />
  );
}

export default InkPageTextEditor;
