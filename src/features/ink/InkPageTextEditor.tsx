/**
 * 页内文字块的编辑框（261104 二十三批；二十五批改成「与展示态同几何、无框」）。
 *
 * 为什么用 HTML textarea 而不是直接编辑 SVG <text>：中文必须走 IME，只有真实输入框可靠。
 *
 * **它必须是隐形的**：编辑态与展示态看起来必须是同一段字（用户 261104 报「编辑样式和完成样式完全不同，
 * 编辑态和展示态转换过程中也有很大变动」）。所以这里不画边框/底色/内距，只留一个与展示文字像素对齐的
 * 输入区；编辑中那段字的**画**由 InkPad 用同一套 <text> 渲染（见 InkPad 的 editingTextId 分支），
 * 这里只提供光标、选区与 IME 预编辑。
 *
 * 对齐口径（单一来源 = inkPageTexts.ts）：
 *  - 展示态首行基线 = 块顶 + fontSize × INK_TEXT_BASELINE_RATIO；
 *  - textarea 首行基线 = 行盒顶 + fontSize × INK_TEXT_EDITOR_BASELINE_RATIO（CSS 行盒公式）；
 *  ⇒ 输入框顶部要上移 (0.9 − 1.12) × fontSize，第一个字才与展示态重合。
 * 位置/字号全部按 scale 换算成 **px**（百分比会随父容器不同而漂，两端 frame 几何不同）。
 *
 * 独立成文件的原因同其它桌面控件：跨端样式护栏只扫 SHARED 名单（InkPad），把带类名的输入框放这里，
 * 就不用给移动端补一份用不到的样式。
 */
import type { InkPageText } from "../../core/inkDoc.js";
import { INK_TEXT_LINE_HEIGHT, inkTextEditorTopOffset, wrapInkTextLines } from "./inkPageTexts.js";

export interface InkPageTextEditorProps {
  text: InkPageText;
  /** 页面 → 屏幕的缩放（frame 宽 / 页面逻辑宽）。 */
  scale: number;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function InkPageTextEditor({ text, scale, value, onChange, onCommit, onCancel }: InkPageTextEditorProps) {
  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
  // 行数取「估算的那一份」（= 提交后屏幕/导出画的行数），避免浮点除后再乘回去的误差把输入框压矮
  const lines = Math.max(1, wrapInkTextLines(value, text.width, text.fontSize).length);
  return (
    <textarea
      className="ink-text-editor"
      value={value}
      autoFocus
      spellCheck={false}
      aria-label="编辑这段文字"
      style={{
        left: `${round2(text.x * safeScale)}px`,
        top: `${round2((text.y + inkTextEditorTopOffset(text.fontSize)) * safeScale)}px`,
        width: `${round2(text.width * safeScale)}px`,
        height: `${round2(lines * text.fontSize * INK_TEXT_LINE_HEIGHT * safeScale)}px`,
        fontSize: `${round2(text.fontSize * safeScale)}px`,
        lineHeight: INK_TEXT_LINE_HEIGHT,
        color: text.color,
        caretColor: text.color,
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
