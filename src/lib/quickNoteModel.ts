import type { QuickNoteImage } from "./types";

export const QUICK_NOTE_VERSION = 1;
export const MAX_QUICK_NOTE_TEXT_LENGTH = 200_000;

export type StoredQuickNoteImage = Omit<QuickNoteImage, "url">;
export interface StoredQuickNoteContent {
  version: number;
  text: string;
  images: StoredQuickNoteImage[];
}

export class QuickNoteModelError extends Error {
  readonly kind = "InvalidInput" as const;

  constructor(message: string) {
    super(message);
    this.name = "QuickNoteModelError";
  }
}

/** Model-level validation for text/image content; no database, filesystem, or Electron access. */
export function normalizeQuickNoteContent(text: string, images: StoredQuickNoteImage[]): StoredQuickNoteContent {
  if (typeof text !== "string") throw new QuickNoteModelError("小记正文必须是文本");
  if (text.length > MAX_QUICK_NOTE_TEXT_LENGTH) throw new QuickNoteModelError("小记正文过长");
  if (!text.trim() && images.length === 0) throw new QuickNoteModelError("请至少记录文字或一张图片");
  return { version: QUICK_NOTE_VERSION, text, images };
}

/** Validate persisted or remote JSON, including image metadata and duplicate IDs. */
export function validateQuickNoteContent(raw: unknown): StoredQuickNoteContent {
  if (!raw || typeof raw !== "object") throw new QuickNoteModelError("小记内容格式无效");
  const value = raw as Partial<StoredQuickNoteContent>;
  if (value.version !== QUICK_NOTE_VERSION || typeof value.text !== "string" || !Array.isArray(value.images)) {
    throw new QuickNoteModelError("小记内容版本或字段无效");
  }
  const seen = new Set<string>();
  const images = value.images.map((image) => validateQuickNoteImage(image, seen));
  return normalizeQuickNoteContent(value.text, images);
}

export function parseQuickNoteContent(json: string): unknown {
  return JSON.parse(json) as unknown;
}

/** Stable JSON representation used for local hashes and sync content objects. */
export function serializeQuickNoteContent(content: StoredQuickNoteContent): string {
  return `${JSON.stringify(content, null, 2)}\n`;
}

export function previewQuickNote(text: string, imageCount: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact) return compact.slice(0, 120);
  return imageCount > 0 ? "[图片]" : "";
}

export function isQuickNoteImageMime(value: string): boolean {
  return ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"].includes(value);
}

function validateQuickNoteImage(raw: unknown, seen: Set<string>): StoredQuickNoteImage {
  if (!raw || typeof raw !== "object") throw new QuickNoteModelError("小记图片字段无效");
  const image = raw as Partial<StoredQuickNoteImage>;
  if (
    typeof image.id !== "string" || !isSafeSegment(image.id) || seen.has(image.id) ||
    typeof image.filename !== "string" || !isSafeSegment(image.filename) ||
    typeof image.mimeType !== "string" || !isQuickNoteImageMime(image.mimeType) ||
    typeof image.size !== "number" || !Number.isSafeInteger(image.size) || image.size <= 0 ||
    typeof image.hash !== "string" || !/^[a-f0-9]{64}$/.test(image.hash)
  ) {
    throw new QuickNoteModelError("小记图片元数据无效");
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
