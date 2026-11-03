/**
 * 手写板背景图下采样（261103 十二批）：只在「导入超大图」时跑一次。
 *
 * 目标：把「整页背景」的渲染解码内存从 像素数 × 4B 压到 ≤ ~23MB（最长边 2400），
 * 避免一张 48MP 照片当背景时 ≈190MB 的解码峰值（移动端会被 OOM 杀掉）。
 * 实现用浏览器 canvas（桌面 Electron / Android WebView 同一套），不引依赖；
 * 失败返回 null ⇒ 调用方按原图导入（不阻断导入，只保留旧行为）。
 * 输出优先 webp（体积小，两端资产服务都支持），失败退 jpeg；文件名同步换扩展名（mime 由扩展名决定）。
 */
export interface InkDownscaledImage {
  /** 显式绑定 ArrayBuffer：与 upload / InkImageImportDeps 期望的字节类型一致（避免 SharedArrayBuffer 泛型）。 */
  bytes: Uint8Array<ArrayBuffer>;
  filename: string;
}

function baseName(name: string): string {
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const bare = slash >= 0 ? name.slice(slash + 1) : name;
  const dot = bare.lastIndexOf(".");
  return dot > 0 ? bare.slice(0, dot) : bare;
}

function closeBitmap(bitmap: ImageBitmap | HTMLImageElement): void {
  if (typeof ImageBitmap !== "undefined" && bitmap instanceof ImageBitmap) bitmap.close();
}

async function decodeSource(file: File): Promise<ImageBitmap | HTMLImageElement | null> {
  const createBitmap = (globalThis as { createImageBitmap?: typeof createImageBitmap }).createImageBitmap;
  if (typeof createBitmap === "function") {
    try {
      return await createBitmap(file);
    } catch {
      // 落到 <img> 兜底（个别格式 createImageBitmap 不支持）
    }
  }
  if (typeof Image === "undefined" || typeof URL?.createObjectURL !== "function") return null;
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(null); };
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/** 等比缩到 target（调用方已按最长边算出）；失败返回 null。 */
export async function downscaleInkImageFile(
  file: File,
  target: { width: number; height: number },
): Promise<InkDownscaledImage | null> {
  if (typeof document === "undefined") return null;
  const width = Math.max(1, Math.round(target.width));
  const height = Math.max(1, Math.round(target.height));
  let source: ImageBitmap | HTMLImageElement | null = null;
  try {
    source = await decodeSource(file);
    if (!source) return null;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
    closeBitmap(source);
    source = null;
    let blob = await canvasToBlob(canvas, "image/webp", 0.9);
    let ext = ".webp";
    if (!blob || blob.size === 0) {
      blob = await canvasToBlob(canvas, "image/jpeg", 0.92);
      ext = ".jpg";
    }
    if (!blob || blob.size === 0) return null;
    return { bytes: new Uint8Array(await blob.arrayBuffer()), filename: baseName(file.name) + ext };
  } catch {
    return null;
  } finally {
    if (source) closeBitmap(source);
  }
}
