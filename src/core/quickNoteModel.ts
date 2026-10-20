import { buildAssetFilename } from "./assetNaming.js";
import { buildLakeImageCardValue, lakeEmptyParagraph, lakeImageCardParagraph, lakeTextParagraph } from "./lakeDocForm.js";
import { sniffImageFormat, type ImageDimensions, type ImageFormat } from "./imageUtils.js";
import { sha256Sync } from "./sha256Sync.js";
import { MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from "./storeLimits.js";
import { normalizeQuickNoteTags, QuickNoteTagError } from "./quickNoteTags.js";
import type { QuickNoteImage } from "./types.js";

/** v2 起小记正文是**内核形态的 Lake 正文**（`body`），`text` 退化为派生镜像（预览/搜索/移动端降级）。 */
export const QUICK_NOTE_VERSION = 2;
export const MAX_QUICK_NOTE_TEXT_LENGTH = 200_000;
/** 正文（Lake HTML，含图片卡片的 JSON 载荷）上限；比纯文本宽，但仍远低于同步侧硬上限。 */
export const MAX_QUICK_NOTE_BODY_LENGTH = 4_000_000;

/** Shared quick-note image gate: size, magic bytes, and MIME are platform-independent. */
export function validateQuickNoteImageBytes(bytes: Uint8Array): ImageFormat {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) {
    throw new QuickNoteModelError("图片为空或超过 25 MiB");
  }
  const format = sniffImageFormat(bytes);
  if (!format) throw new QuickNoteModelError("仅支持 PNG、JPEG、GIF、WebP 和 AVIF 图片");
  return format;
}

export function validateQuickNoteImageDimensions(dimensions: ImageDimensions): void {
  if (
    !Number.isSafeInteger(dimensions.width) || dimensions.width <= 0 ||
    !Number.isSafeInteger(dimensions.height) || dimensions.height <= 0
  ) {
    throw new QuickNoteModelError("图片尺寸无效");
  }
  if (
    dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
  ) {
    throw new QuickNoteModelError(`图片尺寸过大（${dimensions.width}x${dimensions.height}），上限 ${MAX_IMAGE_PIXELS} 像素`);
  }
}

export type StoredQuickNoteImage = Omit<QuickNoteImage, "url">;
export interface StoredQuickNoteContent {
  version: number;
  /** 纯文本镜像：由写作者提供（桌面由内核正文抽取、移动端由输入框内容），供预览/搜索/降级显示。 */
  text: string;
  /** 内核形态正文（Lake HTML）。新建时若调用方没给，按 text 合成（见 quickNoteBodyFromText）。 */
  body: string;
  /**
   * **资源清单**（字段名沿用 v2 的 `images`，语义已放宽为「正文引用的小记资源」）：
   * 图片（`image/*`，带 width/height）与**附件**（其它 MIME，width/height 为 null）混在同一个数组里。
   * staging / promote / 转换搬运 / 孤儿清理都按「文件名清单」处理，与 MIME 无关；
   * 需要"当图片渲染"的地方用 `isQuickNoteImageMime(mimeType)` 过滤（缩略图、图片网格）。
   */
  images: StoredQuickNoteImage[];
  /** 小记标签；旧内容缺失时按空数组读取。顺序 = 最近添加在前。 */
  tags: string[];
}

export class QuickNoteModelError extends Error {
  readonly kind = "InvalidInput" as const;

  constructor(message: string) {
    super(message);
    this.name = "QuickNoteModelError";
  }
}

/** Model-level validation for text/image content; no database, filesystem, or Electron access. */
export function normalizeQuickNoteContent(
  text: string,
  body: string,
  images: StoredQuickNoteImage[],
  tags: unknown = [],
): StoredQuickNoteContent {
  if (typeof text !== "string") throw new QuickNoteModelError("小记正文必须是文本");
  if (text.length > MAX_QUICK_NOTE_TEXT_LENGTH) throw new QuickNoteModelError("小记正文过长");
  if (typeof body !== "string") throw new QuickNoteModelError("小记正文格式无效");
  if (body.length > MAX_QUICK_NOTE_BODY_LENGTH) throw new QuickNoteModelError("小记正文过长");
  if (!text.trim() && images.length === 0) throw new QuickNoteModelError("请至少记录文字、一张图片或一个附件");
  let normalizedTags: string[];
  try { normalizedTags = normalizeQuickNoteTags(tags); }
  catch (error) {
    throw new QuickNoteModelError(error instanceof QuickNoteTagError ? error.message : "小记标签格式无效");
  }
  return { version: QUICK_NOTE_VERSION, text, body, images, tags: normalizedTags };
}

/**
 * 由纯文本合成一份内核形态正文（每个物理换行 = 一个段落，空行 = 空段落）。
 * 用途：没有富文本编辑能力的一端（移动端输入框）与「调用方只给了 text」的兼容入口。
 * 注意：媒体必须走卡片，这里**不产出**任何 `<img>`（见 docs/LAKE-CONTENT-WRITING.md）。
 */
export interface QuickNoteBodyImage {
  filename: string;
  size: number;
  width: number | null;
  height: number | null;
  /** 资源 MIME；缺省按图片处理（移动端合成路径不传）。非 `image/*` 的条目不会变成图片卡。 */
  mimeType?: string;
}

export function quickNoteBodyFromTextAndImages(
  text: string,
  images: readonly QuickNoteBodyImage[],
  imageUrl: (filename: string) => string,
  makeId: () => string,
): string {
  const blocks: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const paragraphId = makeId();
    // 写入形态复用单一来源（src/core/lakeDocForm.ts），避免各处手拼漂移。
    blocks.push(line ? lakeTextParagraph(paragraphId, makeId(), line) : lakeEmptyParagraph(paragraphId));
  }
  for (const image of images) {
    // 附件（非图片）没有图片卡形态，合成路径只处理图片；桌面端正文由内核产出，不走这里。
    if (image.mimeType && !isQuickNoteImageMime(image.mimeType)) continue;
    const cardId = makeId();
    blocks.push(
      lakeImageCardParagraph(
        makeId(),
        buildLakeImageCardValue({
          src: imageUrl(image.filename),
          cardId,
          taskId: makeId(),
          clientId: cardId,
          name: image.filename,
          size: image.size,
          from: "quick-note",
          originWidth: image.width ?? undefined,
          originHeight: image.height ?? undefined,
        }),
      ),
    );
  }
  return blocks.join("");
}

/**
 * 正文里的资源作用域改写：`/quick-notes/staging/<draftId>/` → `/quick-notes/<noteId>/`（保存时），
 * 或 `/quick-notes/<quickNoteId>/` → `/<noteId>/`（转换为正式文档时，见 convertQuickNoteScope）。
 * 同时处理卡片值里 URL-encoded 的形态（内核把卡片 value 编码进 `data:` 载荷）。
 */
export function rewriteQuickNoteAssetScope(body: string, fromScope: string, toScope: string): string {
  const encodedFrom = encodeURIComponent(fromScope);
  const encodedTo = encodeURIComponent(toScope);
  // 卡片 value 是 `data:` + encodeURIComponent(JSON) ⇒ 正文里两种形态都可能出现，两种都要换。
  return body.split(fromScope).join(toScope).split(encodedFrom).join(encodedTo);
}

/** 兼容 Web/Node 的 UUID（小记图片 id）。 */
function randomUUID(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * 从上传图片文件构造小记图片条目 + 落盘文件对。
 * ⚠️ 唯一名（buildAssetFilename）只生成一次：content JSON 引用的 filename 与落盘文件名必须一致——
 * 若两处各调 buildAssetFilename 会生成不同随机名，同步 readAsset 将找不到文件（真机踩过，勿拆回）。
 */
export function buildQuickNoteImageFiles(
  imageFiles: Array<{ filename: string; mimeType: string; width: number | null; height: number | null; bytes: Uint8Array }>
): { images: StoredQuickNoteImage[]; files: Array<{ filename: string; bytes: Uint8Array }> } {
  const images: StoredQuickNoteImage[] = [];
  const files: Array<{ filename: string; bytes: Uint8Array }> = [];
  for (const f of imageFiles) {
    const name = buildAssetFilename(f.filename);
    images.push({
      id: randomUUID(),
      filename: name,
      mimeType: f.mimeType,
      width: f.width,
      height: f.height,
      size: f.bytes.length,
      hash: sha256Sync(f.bytes),
    });
    files.push({ filename: name, bytes: f.bytes });
  }
  return { images, files };
}

/** Validate persisted or remote JSON, including image metadata and duplicate IDs. */
export function validateQuickNoteContent(raw: unknown): StoredQuickNoteContent {
  if (!raw || typeof raw !== "object") throw new QuickNoteModelError("小记内容格式无效");
  const value = raw as Partial<StoredQuickNoteContent>;
  if (value.version !== QUICK_NOTE_VERSION || typeof value.text !== "string" || typeof value.body !== "string" || !Array.isArray(value.images)) {
    throw new QuickNoteModelError("小记内容版本或字段无效");
  }
  const seen = new Set<string>();
  const images = value.images.map((image) => validateQuickNoteImage(image, seen));
  return normalizeQuickNoteContent(value.text, value.body, images, value.tags);
}

export function parseQuickNoteContent(json: string): unknown {
  return JSON.parse(json) as unknown;
}

/** Stable JSON representation used for local hashes and sync content objects. */
export function serializeQuickNoteContent(content: StoredQuickNoteContent): string {
  return `${JSON.stringify(content, null, 2)}\n`;
}

/** 仅比较正文/资源；标签单独变化时不刷新小记时间。 */
export function sameQuickNoteExceptTags(
  a: Pick<StoredQuickNoteContent, "text" | "body" | "images">,
  b: Pick<StoredQuickNoteContent, "text" | "body" | "images">,
): boolean {
  return a.text === b.text && a.body === b.body && JSON.stringify(a.images) === JSON.stringify(b.images);
}

export function previewQuickNote(text: string, imageCount: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact) return compact.slice(0, 120);
  return imageCount > 0 ? "[图片]" : "";
}

export function isQuickNoteImageMime(value: string): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(value);
}

/** 小记资源（图片或附件）允许的 MIME 形态：`type/subtype`、长度受限，避免任意串进库。 */
export function isSafeAssetMime(value: string): boolean {
  return value.length > 0 && value.length <= 120 && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value);
}

function validateQuickNoteImage(raw: unknown, seen: Set<string>): StoredQuickNoteImage {
  if (!raw || typeof raw !== "object") throw new QuickNoteModelError("小记资源字段无效");
  const image = raw as Partial<StoredQuickNoteImage>;
  if (
    typeof image.id !== "string" || !isSafeSegment(image.id) || seen.has(image.id) ||
    typeof image.filename !== "string" || !isSafeSegment(image.filename) ||
    // 资源 MIME：图片走白名单；**附件**（内核 file 卡：pdf/zip/docx…）允许任意合法 MIME，
    // 但它们没有像素尺寸 ⇒ 强制 width/height 为 null（图片仍可有值）。
    typeof image.mimeType !== "string" || !isSafeAssetMime(image.mimeType) ||
    (!isQuickNoteImageMime(image.mimeType) && (image.width ?? null) !== null) ||
    (!isQuickNoteImageMime(image.mimeType) && (image.height ?? null) !== null) ||
    typeof image.size !== "number" || !Number.isSafeInteger(image.size) || image.size <= 0 ||
    typeof image.hash !== "string" || !/^[a-f0-9]{64}$/.test(image.hash)
  ) {
    throw new QuickNoteModelError("小记资源元数据无效");
  }
  if (image.width !== null && image.width !== undefined && (!Number.isInteger(image.width) || image.width <= 0)) {
    throw new QuickNoteModelError("图片宽度无效");
  }
  if (image.height !== null && image.height !== undefined && (!Number.isInteger(image.height) || image.height <= 0)) {
    throw new QuickNoteModelError("图片高度无效");
  }
  seen.add(image.id);
  return {
    id: image.id,
    filename: image.filename,
    mimeType: image.mimeType,
    width: image.width ?? null,
    height: image.height ?? null,
    size: image.size,
    hash: image.hash,
  };
}

function isSafeSegment(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && !value.includes("/") && !value.includes("\\");
}
