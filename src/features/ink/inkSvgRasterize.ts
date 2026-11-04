/**
 * 自包含 SVG → PNG 字节（261104 十七批：单页导出 PNG）。
 *
 * 为什么在渲染层做：主进程没有 SVG 栅格化能力（不引新依赖），而 Chromium 里有 canvas。
 * SVG 由主进程生成、图片已经转成 **data URI** ⇒ 画进 canvas 不会污染画布（不用 CORS 放行）。
 * 尺寸按 scale 放大（默认 2×：A4 794×1123 → 1588×2246，约 192dpi，分享/打印都够）。
 */
export interface InkSvgRasterizeOptions {
  /** 放大倍数（1–4，默认 2）。 */
  scale?: number;
  /** 底色（默认白；底纹与页图都画在 SVG 里）。 */
  background?: string;
}

export async function rasterizeInkSvgToPng(
  svg: string,
  width: number,
  height: number,
  options: InkSvgRasterizeOptions = {},
): Promise<Uint8Array> {
  if (!svg || width <= 0 || height <= 0) throw new Error("手写板页面尺寸无效，无法导出 PNG");
  const scale = Math.max(1, Math.min(4, options.scale ?? 2));
  // 实测（261104，Electron/Chromium）：`createImageBitmap(new Blob([svg], {type:"image/svg+xml"}))`
  // 对这种带 data URI 图片的 SVG **解码失败**（InvalidStateError），而 `<img src="data:image/svg+xml,…">`
  // 能正常拿到 naturalWidth/Height ⇒ 统一走 Image 路径（用户手势/prod 都稳）。
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error("SVG 解码失败（无法导出 PNG）"));
    element.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("无法创建画布（导出 PNG 失败）");
  context.fillStyle = options.background ?? "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("PNG 编码失败");
  return new Uint8Array(await blob.arrayBuffer());
}