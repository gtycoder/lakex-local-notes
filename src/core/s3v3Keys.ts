/**
 * S3 v3 对象布局（key 单一来源，无 node 依赖）。
 * 设计：docs/S3-REDESIGN.md §2。
 */
export type S3v3Space = "lake" | "quickNotes";

export const S3V3_POINTER_KEY = "meta/pointer.json";
export const S3V3_PREFIX = "";

const SAFE_KEY_RE = /^[A-Za-z0-9._/-]+$/;

export function assertSafeS3Key(key: string): void {
  if (!key || key.length > 1024 || key.startsWith("/") || key.includes("//") || !SAFE_KEY_RE.test(key)) {
    throw new Error("非法 S3 key: " + key);
  }
}

export function assertSafeSegment(seg: string): void {
  if (!seg || seg === "." || seg === ".." || seg.includes("/") || !/^[A-Za-z0-9._-]+$/.test(seg)) {
    throw new Error("非法路径段: " + seg);
  }
}

export function indexKey(space: S3v3Space, commit: string): string {
  const key = space === "lake" ? `meta/index/${commit}.json` : `quick-notes/meta/index/${commit}.json`;
  assertSafeS3Key(key);
  return key;
}

export function declarationKey(space: S3v3Space, id: string, declHash: string): string {
  assertSafeSegment(id);
  assertSafeSegment(declHash);
  const key = space === "lake" ? `meta/assets/${id}/${declHash}.json` : `quick-notes/meta/assets/${id}/${declHash}.json`;
  assertSafeS3Key(key);
  return key;
}

export function lakeBodyKey(noteId: string, contentHash: string): string {
  assertSafeSegment(noteId);
  const key = `objects/${noteId}-${contentHash}.lake`;
  assertSafeS3Key(key);
  return key;
}

export function assetKey(noteId: string, filename: string): string {
  assertSafeSegment(noteId);
  assertSafeSegment(filename);
  const key = `assets/${noteId}/${filename}`;
  assertSafeS3Key(key);
  return key;
}

export function quickNoteBodyKey(contentHash: string): string {
  const key = `quick-notes/objects/${contentHash}.qnote`;
  assertSafeS3Key(key);
  return key;
}

export function quickNoteAssetKey(quickNoteId: string, filename: string): string {
  assertSafeSegment(quickNoteId);
  assertSafeSegment(filename);
  const key = `quick-notes/assets/${quickNoteId}/${filename}`;
  assertSafeS3Key(key);
  return key;
}

/** 彻底删除某篇 Lake 文档时需要删除的前缀。 */
export function lakePurgePrefixes(noteId: string): string[] {
  assertSafeSegment(noteId);
  return [`objects/${noteId}-`, `assets/${noteId}/`, `meta/assets/${noteId}/`];
}

/** 彻底删除某条小记时需要删除的前缀（正文对象按 hash 单独删）。 */
export function quickNotePurgePrefixes(quickNoteId: string): string[] {
  assertSafeSegment(quickNoteId);
  return [`quick-notes/assets/${quickNoteId}/`, `quick-notes/meta/assets/${quickNoteId}/`];
}
