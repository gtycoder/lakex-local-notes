/**
 * 资产命名与引用提取（图片 + 附件共享的单一事实源，桌面/移动端共用）。
 *
 * 命名约定：{13位时间戳}_{8位小写hex}.{ext}（与既有图片一致，跨端互认：
 * 移动端上传的文件桌面能解析、反之亦然，extractAssetRefs/孤儿检测/GC 保护全链路一致）。
 *
 * 引用提取：正文/卡片 value 里出现的资产文件名（canonical URL 的末段），
 * 覆盖任意 <=10 位小写字母数字扩展名 —— 附件（pdf/docx/zip/mp4/...）与图片同规。
 */

/** 13位时间戳 + 下划线 + 8位小写hex + 点 + 1~10位小写字母数字扩展名（单扩展名；上传时归一化到小写）。 */
export const ASSET_NAME_RE = /\d{13}_[0-9a-f]{8}\.[a-z0-9]{1,10}/g;

/** 非全局形态（test()/exec() 无 lastIndex 状态；matchAll 用上面的全局形态）。 */
const ASSET_NAME_RE_SINGLE = /\d{13}_[0-9a-f]{8}\.[a-z0-9]{1,10}/;

/** 受支持的图片扩展名（嗅探/格式校验用）。 */
export const ASSET_IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "avif"] as const;

/** 常见附件扩展名（文件类型图标/内联预览分流用；引用提取不受此清单限制）。 */
export const ASSET_ATTACHMENT_EXTS = [
  // 文档
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv", "rtf", "epub", "key", "pages", "numbers",
  // 压缩包
  "zip", "rar", "7z", "tar", "gz", "bz2", "xz",
  // 音频
  "mp3", "wav", "m4a", "aac", "flac", "ogg", "wma",
  // 视频
  "mp4", "mov", "mkv", "avi", "webm", "m4v", "wmv", "flv",
  // 其他
  "json", "apk", "bin",
] as const;

export const ALL_ASSET_EXTS = [...ASSET_IMAGE_EXTS, ...ASSET_ATTACHMENT_EXTS] as const;

/** 扩展名是否为图片（含不带点）。 */
export function isImageExtension(ext: string): boolean {
  const e = ext.replace(/^\./, "").toLowerCase();
  return (ASSET_IMAGE_EXTS as readonly string[]).includes(e);
}

/** 扩展名是否在受支持资产清单内。 */
export function isAssetExtension(ext: string): boolean {
  const e = ext.replace(/^\./, "").toLowerCase();
  return (ALL_ASSET_EXTS as readonly string[]).includes(e);
}

/** 文件名是否符合 Lake 资产命名约定（{13ts}_{8hex}.{ext}）。 */
export function isAssetFilename(name: string): boolean {
  return ASSET_NAME_RE_SINGLE.test(name);
}

/** 提取正文中引用的资产文件名（去重）。 */
export function extractAssetRefs(content: string): Set<string> {
  return new Set([...content.matchAll(ASSET_NAME_RE)].map((match) => match[0]));
}

/** 提取文件名扩展名（最后一个点之后；无点返回空串）。 */
export function extOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1) : "";
}

/** 8 位小写 hex（平台无关：优先 crypto.getRandomValues，兜底 Math.random）。 */
export function randomHex4(): string {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    const b = new Uint8Array(4);
    c.getRandomValues(b);
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  }
  return Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
}

/**
 * 生成资产文件名：{13位时间戳}_{8hex}.{ext}。
 * 扩展名取原文件名的最后一段，归一化小写并校验（非法/超长回退 "bin"）。
 */
export function buildAssetFilename(originalName: string, now = Date.now()): string {
  const rawExt = extOf(originalName);
  const ext = /^[a-z0-9]{1,10}$/i.test(rawExt) ? rawExt.toLowerCase() : "bin";
  return String(now) + "_" + randomHex4() + "." + ext;
}
