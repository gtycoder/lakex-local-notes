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

/**
 * 受支持的图片扩展名（嗅探/格式校验/附件→图片卡分发用）。
 * 参考思源 SIYUAN_ASSETS_IMAGE（app/src/constants.ts）补齐常用格式；
 * heic/heif 未列入（浏览器兼容差，保持附件卡由系统应用打开更合适）。
 */
export const ASSET_IMAGE_EXTS = [
  "png", "jpg", "jpeg", "gif", "webp", "avif",
  "apng", "bmp", "svg", "ico", "cur", "jfif", "pjp", "pjpeg", "jpe", "tiff", "tif",
] as const;

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

/**
 * 音频附件扩展名（附件→音频卡分发用）。桌面/移动端共用。
 * ⚠️ 该清单 = Lake fileReader 实测可插入音频卡的格式（CDP 逐格式验证，2026-08-27）：
 * aac/ogg/oga/wma/mid/opus/weba/amr/aiff 等 Lake 的 audio reader 不认，任何路径都建不出卡，
 * 不列入——列入会导致附件插入失败（比保持附件卡更糟）。
 */
export const AUDIO_EXTENSIONS = ["mp3", "wav", "m4a", "flac"] as const;

/**
 * 视频附件扩展名（附件→视频卡分发用）。桌面/移动端共用。
 * ⚠️ 该清单 = Lake fileReader 实测可插入视频卡的格式（CDP 逐格式验证，2026-08-27）：
 * ogv/3g2/m2ts 等 Lake 的 video reader 不认，不列入。
 */
export const VIDEO_EXTENSIONS = [
  "mp4", "mov", "mkv", "avi", "webm", "m4v", "wmv", "flv",
  "mpeg", "mpg", "3gp", "ts",
] as const;

/**
 * Lake fileReader 实测可插入图片卡的格式（CDP 逐格式验证，2026-08-27）。
 * avif/apng/ico/cur/jfif/pjp/pjpeg/jpe 等 Lake 的 image reader 不认，任何路径都建不出卡，
 * 不参与分发（ASSET_IMAGE_EXTS 仍是完整图片资产清单，两者职责不同）。
 */
const LAKE_IMAGE_INSERT_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "tiff", "tif"]);

/** 媒体附件扩展名（音频/视频——应用内嵌播放；非媒体走系统打开）。桌面/移动端共用。 */
const MEDIA_EXT_SET = new Set<string>([...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS]);

/** 附件/插入路径的三类原生卡类型：音频卡 / 视频卡 / 图片卡。 */
export type MediaKind = "audio" | "video" | "image";

/** 文件名是否为媒体附件（音频/视频；图片不算"媒体附件"——图片本就内嵌显示）。 */
export function isMediaFilename(filename: string): boolean {
  const kind = mediaKindOfFilename(filename);
  return kind === "audio" || kind === "video";
}

/**
 * 文件名 → 卡片类型（"audio" | "video" | "image" | null）。
 * 附件路径（insertFiles/dropFile）按此分发：音频/视频/图片自动转对应原生卡，其余保持附件卡。
 */
export function mediaKindOfFilename(filename: string): MediaKind | null {
  const ext = extOf(filename).toLowerCase();
  if ((AUDIO_EXTENSIONS as readonly string[]).includes(ext)) return "audio";
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return "video";
  if (LAKE_IMAGE_INSERT_EXTS.has(ext)) return "image";
  return null;
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

/** 扩展名 → MIME（桌面/移动端/资产服务共用单一事实源；未知回退 octet-stream）。 */
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif",
  svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp", tiff: "image/tiff", tif: "image/tiff",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", rtf: "application/rtf",
  zip: "application/zip", rar: "application/vnd.rar", "7z": "application/x-7z-compressed",
  tar: "application/x-tar", gz: "application/gzip", bz2: "application/x-bzip2", xz: "application/x-xz",
  mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac", ogg: "audio/ogg", wma: "audio/x-ms-wma",
  mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska", avi: "video/x-msvideo",
  webm: "video/webm", m4v: "video/mp4", wmv: "video/x-ms-wmv", flv: "video/x-flv",
  epub: "application/epub+zip", json: "application/json", apk: "application/vnd.android.package-archive",
};

/** 按文件名返回 MIME（未知扩展名 → application/octet-stream）。 */
export function mimeTypeForFilename(filename: string): string {
  return MIME_BY_EXT[extOf(filename).toLowerCase()] ?? "application/octet-stream";
}
