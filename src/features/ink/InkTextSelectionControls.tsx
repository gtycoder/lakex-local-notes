/**
 * 文字块的选中态控制条（261104 二十三批续，二十四批按用户澄清修正）：
 * **选中时固定出现**（A- / A+ / 拖宽手柄 / ×）；取消选中（点到别处）就一起消失。
 * 之前理解成「每段文字常驻」是错的 —— 用户要的是「选中期间一直在」，不是「所有框永远在」。
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
  onResizeStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onBumpFontSize: (delta: number) => void;
  onRemove: () => void;
}

export function InkTextSelectionControls({ text, page, onResizeStart, onBumpFontSize, onRemove }: InkTextSelectionControlsProps) {
  const height = Math.max(text.fontSize, inkTextHeight(text));
  // 按钮按下时阻止默认行为：编辑中（textarea 有焦点）点 A+/A- 不会先把焦点抢走导致编辑器失焦提交。
  const keepFocus = (event: ReactPointerEvent<HTMLElement>) => event.preventDefault();
  return (
    <>
      <div
        className="ink-text-controls is-selected"
        style={{
          left: (text.x / page.width) * 100 + "%",
          top: (text.y / page.height) * 100 + "%",
        }}
      >
        <button className="ink-text-size" onPointerDown={keepFocus} onClick={() => onBumpFontSize(-2)} aria-label="字号变小" title="字号变小">A-</button>
        <button className="ink-text-size" onPointerDown={keepFocus} onClick={() => onBumpFontSize(2)} aria-label="字号变大" title="字号变大">A+</button>
        <button className="ink-text-remove" onPointerDown={keepFocus} onClick={onRemove} aria-label="删除这段文字" title="删除（Delete）">×</button>
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
