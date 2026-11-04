/**
 * 页内贴图「选中态」的两个零件（261104 二十一批）。
 *
 * 分成独立文件的原因（与 InkExportMenu / InkOutlinePanel 同）：跨端样式护栏只检查
 * SHARED 名单里的组件（InkPad 在名单里），它发出的类名必须在桌面与移动两套 CSS 都有规则；
 * 贴图选中态是桌面先行的交互，做成独立组件就不会逼着移动端补一份样式。
 *
 * 两个零件位置不同：虚线框要画在 SVG 里（笔迹层下面），删除按钮是 HTML 浮层（在 SVG 之上）。
 */
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
