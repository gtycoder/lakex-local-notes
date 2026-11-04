/**
 * 文字块的常驻控制条（261104 二十三批续；二十四批改为**固定展示**）：
 * 用户定稿「这是文字框，应该随时能改大小」⇒ 编辑态下每段文字都显示虚线框 + `A-` `A+` + 右下角拖宽手柄，
 * 不必先选中；`×` 删除只在选中时出现（防误删）。
 *
 * 独立成文件的原因同其它桌面控件：跨端样式护栏只扫 SHARED 名单（InkPad），
 * 带类名的浮层放这里就不用为移动端补一份用不到的样式。
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import type { InkPageText } from "../../core/inkDoc.js";
import { inkTextHeight } from "./inkPageTexts.js";

export interface InkTextSelectionControlsProps {
  text: InkPageText;
  page: { width: number; height: number };
  /** 选中态：多显示一个删除按钮（未选中时不显示，防误删）。 */
  selected: boolean;
  onResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onBumpFontSize: (delta: number) => void;
  onRemove: () => void;
}

export function InkTextSelectionControls({ text, page, selected, onResizeStart, onBumpFontSize, onRemove }: InkTextSelectionControlsProps) {
  const height = Math.max(text.fontSize, inkTextHeight(text));
  return (
    <>
      <div
        className={["ink-text-controls", selected ? "is-selected" : ""].join(" ")}
        style={{
          left: (text.x / page.width) * 100 + "%",
          top: (text.y / page.height) * 100 + "%",
        }}
      >
        <button className="ink-text-size" onClick={() => onBumpFontSize(-2)} aria-label="字号变小" title="字号变小">A-</button>
        <button className="ink-text-size" onClick={() => onBumpFontSize(2)} aria-label="字号变大" title="字号变大">A+</button>
        {selected ? <button className="ink-text-remove" onClick={onRemove} aria-label="删除这段文字" title="删除（Delete）">×</button> : null}
      </div>
      <span
        className="ink-text-resize"
        style={{
          left: ((text.x + text.width) / page.width) * 100 + "%",
          top: ((text.y + height) / page.height) * 100 + "%",
        }}
        onPointerDown={onResizeStart}
        aria-hidden="true"
      />
    </>
  );
}

export default InkTextSelectionControls;
