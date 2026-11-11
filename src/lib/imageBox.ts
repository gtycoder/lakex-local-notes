/**
 * <img> 的**比例盒**属性（宽高都必须是正整数才写；老数据/附件的 null 不写，避免 0×0 把布局钉死）。
 *
 * 单一来源：移动端卡片（`src/mobile/home/quickNoteImage.ts`）与两端共享的小记只读预览
 * （`src/features/quickNotes/QuickNotePreview.tsx`）都用这一份判据。
 * 用 width/height 属性而不是内联 style：CSS 的 max-width/max-height 仍生效，加载前浏览器先按比例占位。
 */
export function imageBoxAttrs(
  image: { width?: number | null; height?: number | null } | null | undefined,
): { width: number; height: number } | null {
  const width = image?.width;
  const height = image?.height;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width: Math.round(width), height: Math.round(height) };
}
