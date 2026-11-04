/**
 * 页内贴图「选中态」的三个零件（261104 二十一批、二十一批续：缩放手柄）。
 *
 * 分成独立文件的原因（与 InkExportMenu / InkOutlinePanel 同）：跨端样式护栏只检查
 * SHARED 名单里的组件（InkPad 在名单里），它发出的类名必须在桌面与移动两套 CSS 都有规则；
 * 贴图选中态是桌面先行的交互，做成独立组件就不会逼着移动端补一份样式。
 *
 * 位置不同：虚线框画在 SVG 里（笔迹层下面）；删除按钮与缩放手柄是 HTML 浮层（在 SVG 之上）。
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import type { InkPageImage } from "../../core/inkDoc.js";

/** 选中贴图的虚线框（SVG 元素，pointer-events:none）。 */
export function InkImageSelectionRect({ image }: { image: InkPageImage }) {
  return (
    <rect
      className="ink-image-select"
      x={image.x}
      y={image.y}
      width={image.width}
      height={image.height}
      fill="none"
      stroke="var(--lake-accent)"
      strokeWidth={2}
      strokeDasharray="6 4"
      pointerEvents="none"
    />
  );
}

/** 选中贴图右下角的缩放手柄（HTML 浮层；拖动逻辑在 InkPad，按「保持宽高比、锚点左上角」缩放）。 */
export function InkImageResizeHandle({ image, page, onStart }: { image: InkPageImage; page: { width: number; height: number }; onStart: (event: ReactPointerEvent<HTMLElement>) => void }) {
  return (
    <span
      className="ink-image-resize"
      style={{
        left: `${((image.x + image.width) / page.width) * 100}%`,
        top: `${((image.y + image.height) / page.height) * 100}%`,
      }}
      onPointerDown={onStart}
      aria-hidden="true"
    />
  );
}

/** 选中贴图右上角的删除按钮（HTML 浮层，只有按钮接事件）。 */
export function InkImageRemoveButton({ image, page, onRemove }: { image: InkPageImage; page: { width: number; height: number }; onRemove: () => void }) {
  return (
    <button
      className="ink-image-remove"
      style={{
        left: `${((image.x + image.width) / page.width) * 100}%`,
        top: `${(image.y / page.height) * 100}%`,
      }}
      onClick={onRemove}
      aria-label="删除这张图"
      title="删除这张图（Delete）"
    >×</button>
  );
}