/**
 * 画板图片 → 资产管线（纯逻辑，便于单测）。
 *
 * 背景：画板引擎插入图片（文件选择 / 粘贴 / 拖放）走的是 Drawnix 的 `insertImage`，
 * 它把图片**内联成 data URL** 写进场景元素（`@plait/*` 的 image 元素 `url` 字段）。若原样落盘：
 * - 一张 1MB 照片 ≈ 1.37MB base64 常驻正文 —— 画板天生「一堆图」，正文迅速膨胀；
 * - 每次编辑正文 hash 都变 ⇒ 每次保存都上传一个整对象、云端多留一份待回收；
 * - 图片不进 `manifest.assets`，跨端只能靠正文搬运。
 *
 * 因此宿主侧做一次**提升**（promote）：把 data URL 交给既有资产通道写成
 * `note-assets/{noteId}/{13位时间戳}_{8位hash}.{ext}`，元素里换成 canonical URL。
 * 之后声明（`extractAssetRefs` 是全文本正则，能命中 JSON 里的文件名）、云端差集同步、
 * GC 保护、孤儿清理、他端按需下载、移动端 AssetServer 渲染**全部复用现成能力**，无需按 kind 分支。
 */
import { localAssetHttpUrl, parseLocalAssetUrl } from "../../core/assetUrl";

/** 引擎产出的内联图片形态（`FileReader.readAsDataURL` → `data:image/png;base64,…`）。 */
const INLINE_IMAGE_DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

export function isInlineImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && INLINE_IMAGE_DATA_URL_RE.test(value);
}

/** 深度收集场景里所有内联图片（图片元素的 `url`、思维导图节点上的图、素材库贴进来的图都覆盖）。 */
export function collectInlineImageUrls(node: unknown, out: Set<string> = new Set()): Set<string> {
  if (typeof node === "string") {
    if (isInlineImageDataUrl(node)) out.add(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectInlineImageUrls(item, out);
    return out;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node as Record<string, unknown>)) collectInlineImageUrls(value, out);
  }
  return out;
}

/**
 * 深拷贝并把内联图片替换成 mapping 里的新 URL（只动字符串叶子，结构/其它字段逐字节保留）。
 * mapping 里没有的 data URL 原样保留 ⇒ 上传失败时不会丢图，也不会把场景改坏。
 */
export function replaceInlineImageUrls<T>(node: T, mapping: Map<string, string>): T {
  if (mapping.size === 0) return node;
  if (typeof node === "string") {
    return (mapping.get(node) ?? node) as unknown as T;
  }
  if (Array.isArray(node)) {
    let changed = false;
    const next = node.map((item) => {
      const replaced = replaceInlineImageUrls(item, mapping);
      if (replaced !== item) changed = true;
      return replaced;
    });
    return (changed ? next : node) as unknown as T;
  }
  if (node && typeof node === "object") {
    let changed = false;
    const source = node as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      const replaced = replaceInlineImageUrls(value, mapping);
      if (replaced !== value) changed = true;
      next[key] = replaced;
    }
    return (changed ? next : node) as unknown as T;
  }
  return node;
}

/** 场景里是否还有未提升的内联图片（用于「提升期间先别保存」的判定）。 */
export function hasInlineImages(node: unknown): boolean {
  return collectInlineImageUrls(node).size > 0;
}

/**
 * 深度收集场景里指向**本笔记资产目录**的 URL（`http://127.0.0.1:{port}/{noteId}/{file}`）。
 *
 * 用途：打开画板时把这些 URL 换回 data URL（见 BoardEditor 的「内存 data URL / 磁盘资产 URL」口径）——
 * 引擎的导出/预览会把 `<img>` 转 base64，跨源 `fetch(资产 URL)` 会被资产服务的 CORS 规则拦掉，
 * 而 data URL 不涉及跨源；磁盘上仍是资产 URL（声明/GC/S3/移动端都按资产管线走）。
 */
export function collectBoardAssetUrls(node: unknown, noteId: string, out: Set<string> = new Set()): Set<string> {
  if (typeof node === "string") {
    const ref = parseLocalAssetUrl(node);
    if (ref && ref.space === "note" && !ref.staging && ref.noteId === noteId) out.add(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectBoardAssetUrls(item, noteId, out);
    return out;
  }
  if (node && typeof node === "object") {
    for (const value of Object.values(node as Record<string, unknown>)) collectBoardAssetUrls(value, noteId, out);
  }
  return out;
}
/** 移动端 / 桌面读回资产字节的最小接口（`native.readAssetPreview` 同形）。 */
export interface BoardAssetPreviewLike {
  supported: boolean;
  dataUrl?: string;
}

/** 图片 MIME → 落盘扩展名（`buildAssetFilename` 只认原文扩展名）。 */
const IMAGE_MIME_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/tiff": "tiff",
};

export interface InlineImageBytes {
  mime: string;
  bytes: Uint8Array;
  /** 目标落盘扩展名（未知类型按 png 兜底，不阻断上传） */
  extension: string;
}

/** 把内联图片 data URL 解成字节（提升上传用）；非图片/非 base64/解码失败 → null（保持内联，绝不清空）。 */
export function decodeInlineImageDataUrl(value: unknown): InlineImageBytes | null {
  if (typeof value !== "string") return null;
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(value.trim());
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const rawExt = mime.slice("image/".length).split("+")[0].replace(/[^a-z0-9]/g, "");
  const extension = IMAGE_MIME_EXTENSION[mime] ?? (rawExt || "png");
  try {
    const binary = atob(match[2]);
    if (!binary) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return { mime, bytes, extension };
  } catch {
    return null;
  }
}

/**
 * 画板图片管线的**两端映射**（纯逻辑，读写能力由调用方注入；桌面/移动共用同一口径）。
 *
 * - `boardAssetHydrationMapping`：打开时把**本笔记的资产 URL**换回 data URL（内存口径），
 *   并把 dataURL → 资产URL 反向登记，保证下次保存写回同一个资产 URL（不重复上传、不改 hash）。
 *   读不到就跳过（保持资产 URL 渲染）。
 * - `boardInlinePromotionMapping`：保存前把**内联 data URL**提升为资产文件（`note-assets/{noteId}/`），
 *   单张失败跳过（保持内联形态，不丢图）。
 */
export async function boardAssetHydrationMapping(
  elements: unknown[],
  noteId: string,
  read: (noteId: string, filename: string) => Promise<BoardAssetPreviewLike>,
): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  const assetUrls = collectBoardAssetUrls(elements, noteId);
  for (const assetUrl of assetUrls) {
    const ref = parseLocalAssetUrl(assetUrl);
    if (!ref || ref.space !== "note" || ref.staging) continue;
    try {
      const preview = await read(ref.noteId, ref.filename);
      if (preview.supported && preview.dataUrl) mapping.set(assetUrl, preview.dataUrl);
    } catch {
      // 读回失败：保持资产 URL 渲染即可，不影响打开
    }
  }
  return mapping;
}

/**
 * 上传回执的最小形状：**优先用 `url`**（两端上传通道都回 canonical URL，磁盘名在 URL 末段）；
 * 只有 `filename` 时按 `noteId` 拼 canonical URL（`filename` 必须是**磁盘名**，不是展示名）。
 */
export interface BoardImageUploadLike {
  url?: string;
  filename?: string;
}

export async function boardInlinePromotionMapping(
  elements: unknown[],
  noteId: string,
  upload: (input: { bytes: Uint8Array; filename: string }) => Promise<BoardImageUploadLike>,
  /** 已在内存里有映射（hydrate 反向登记）的 data URL 不再重复上传。 */
  known: ReadonlyMap<string, string> = new Map(),
): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  for (const dataUrl of collectInlineImageUrls(elements)) {
    if (known.has(dataUrl)) continue;
    const decoded = decodeInlineImageDataUrl(dataUrl);
    if (!decoded) continue;
    try {
      const uploaded = await upload({ bytes: decoded.bytes, filename: "board-image." + decoded.extension });
      // ⚠️ 移动端 bridge.uploadResource 的 `filename` 是**展示名**（用户原始名），磁盘名只在 `url` 末段；
      // 只认 url，避免把展示名当路径写进正文（否则图片 404）。
      const assetUrl = uploaded?.url ?? (uploaded?.filename ? localAssetHttpUrl(noteId, uploaded.filename) : null);
      if (assetUrl) mapping.set(dataUrl, assetUrl);
    } catch {
      // 单张失败：保持内联形态，下次变更再试
    }
  }
  return mapping;
}
