/**
 * S3 v3 对象布局（key 单一来源，无 node 依赖）。
 * 设计：docs/SYNC-PROTOCOL.md §3.1（历史 S3-REDESIGN §2 已删，git 可查）。
 */
import { isSafePathSegment } from "../../storeUtils.js";

export type S3v3Space = "lake" | "quickNotes";

export const S3V3_POINTER_KEY = "meta/pointer.json";
export const S3V3_PREFIX = "";

const SAFE_KEY_RE = /^[A-Za-z0-9._/-]+$/;
/** v3 key 段允许的字符集（协议面收紧：不含空格/Unicode；分隔符与遍历已由基线判据拒绝）。 */
const SAFE_SEGMENT_CHARS_RE = /^[A-Za-z0-9._-]+$/;

/**
 * gzip 只用于 v3 的**元数据对象**（索引 / 资产声明）；正文与附件一律不压缩。
 * P0（261026）：端口曾按「字节以 1f8b 开头」判定 gzip，会把恰好以这两个字节开头的
 * 二进制附件当 gzip 解压 ⇒ Z_DATA_ERROR / 附件下载失败。判定必须按 key 而非魔数。
 */
export function isGzipMetadataKey(rel: string): boolean {
  return rel.startsWith("meta/") || rel.startsWith("quick-notes/meta/");
}

export function assertSafeS3Key(key: string): void {
  if (!key || key.length > 1024 || key.startsWith("/") || key.includes("//") || !SAFE_KEY_RE.test(key)) {
    throw new Error("非法 S3 key: " + key);
  }
}

/**
 * S3 key 段校验（**抛错形态**的薄包装，CORE-09）：基线判据 = core/storeUtils.isSafePathSegment
 * （与 quickNoteModel 远端内容校验同源），这里只叠加 v3 key 自己的字符集白名单。
 */
export function assertSafeSegment(seg: string): void {
  if (!isSafePathSegment(seg) || !SAFE_SEGMENT_CHARS_RE.test(seg)) {
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

/** 小记对象布局的**唯一来源**在此；曾有一份 `core/quickNoteKeys.ts` 是 v2 残留（自称唯一来源却零引用），已删（CORE-03）。 */
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
