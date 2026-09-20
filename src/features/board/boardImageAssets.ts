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
import { parseLocalAssetUrl } from "../../core/assetUrl";
