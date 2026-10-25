import { sha256Hex } from "./syncUtils.js";
import { assertSafeSegment } from "./s3v3Keys.js";
import { S3V3_HASH_RE } from "./s3v3Types.js";

/** S3 v3 索引/声明的纯逻辑：规范化序列化（稳定 hash）、校验、解析。 */

export const S3V3_INDEX_VERSION = 3 as const;
export const S3V3_MAX_INDEX_BYTES = 64 * 1024 * 1024;
export const S3V3_MAX_LAKE_NOTES = 100_000;
export const S3V3_MAX_FOLDERS = 10_000;
export const S3V3_MAX_QUICK_NOTES = 20_000;

export interface AssetDeclEntry {
  filename: string;
  size: number;
  hash: string;
}
export interface AssetDeclaration {
  assets: AssetDeclEntry[];
}

export interface LakeNoteEntry {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  updatedAt: string;
  contentHash: string;
  kind?: string;
  icon?: string | null;
  isLocked?: boolean;
  lockedAt?: string | null;
  isConflict?: boolean;
  trashedAt?: string | null;
  deletedFromParentId?: string | null;
  /** 资产声明版本 hash；缺省 = 无资产。 */
  assetsHash?: string;
}

export interface LakeFolderEntry {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  nodeType: "notebook" | "group";
  icon: string | null;
  updatedAt: string;
  trashedAt?: string | null;
  deletedFromParentId?: string | null;
}

export interface LakeIndex {
  v: typeof S3V3_INDEX_VERSION;
  space: "lake";
  notes: LakeNoteEntry[];
  folders: LakeFolderEntry[];
}

export interface QuickNoteTagEntry {
  id: string;
  name: string;
  color?: string | null;
  order?: number;
  createdAt: string;
  updatedAt: string;
}

export interface QuickNoteEntry {
  id: string;
  createdAt: string;
  updatedAt: string;
  contentHash: string;
  isConflict?: boolean;
  assetsHash?: string;
  tagIds?: string[];
  tagsUpdatedAt?: string;
}

export interface QuickNotesIndex {
  v: typeof S3V3_INDEX_VERSION;
  space: "quickNotes";
  items: QuickNoteEntry[];
  tags?: QuickNoteTagEntry[];
}

/** 递归 canonical JSON：对象 key 排序、数组保持顺序（调用方先排序）。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((v) => canonicalJson(v)).join(",") + "]";
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

export function sha256Text(text: string): string {
  return sha256Hex(new TextEncoder().encode(text));
}

export function serializeLakeIndex(index: LakeIndex): string {
  const notes = [...index.notes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const folders = [...index.folders].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return canonicalJson({ v: index.v, space: index.space, notes, folders });
}
export function serializeQuickNotesIndex(index: QuickNotesIndex): string {
  const items = [...index.items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const tags = index.tags ? [...index.tags].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) : undefined;
  return canonicalJson({ v: index.v, space: index.space, items, tags });
}
export function indexHashOf(serialized: string): string {
  return sha256Text(serialized);
}

export function serializeDeclaration(decl: AssetDeclaration): string {
  const assets = [...decl.assets].sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
  return canonicalJson({ assets });
}
export function declarationHashOf(decl: AssetDeclaration): string {
  return sha256Text(serializeDeclaration(decl));
}

/** 稳定资产声明版本 hash（供索引 assetsHash 使用）。 */
export function buildAssetDeclaration(assets: AssetDeclEntry[]): { declHash: string; declaration: AssetDeclaration; serialized: string } {
  const declaration: AssetDeclaration = { assets: [...assets] };
  const serialized = serializeDeclaration(declaration);
  return { declHash: sha256Text(serialized), declaration, serialized };
}

function isHash(v: unknown): v is string {
  return typeof v === "string" && S3V3_HASH_RE.test(v);
}
function isSafeId(v: unknown): v is string {
  try { assertSafeSegment(String(v)); return typeof v === "string"; } catch { return false; }
}

export function validateAssetDeclaration(raw: unknown): AssetDeclaration {
  if (!raw || typeof raw !== "object") throw new Error("资产声明非对象");
  const d = raw as Partial<AssetDeclaration>;
  if (!Array.isArray(d.assets)) throw new Error("资产声明 assets 非数组");
  const seen = new Set<string>();
  for (const a of d.assets) {
    if (!a || typeof a !== "object") throw new Error("资产声明条目非对象");
    if (typeof a.filename !== "string" || !isSafeId(a.filename)) throw new Error("资产文件名非法");
    if (!Number.isSafeInteger(a.size) || a.size < 0) throw new Error("资产 size 非法");
    if (!isHash(a.hash)) throw new Error("资产 hash 非法");
    if (seen.has(a.filename)) throw new Error("资产文件名重复: " + a.filename);
    seen.add(a.filename);
  }
  return { assets: d.assets.map((a) => ({ filename: a.filename, size: a.size, hash: a.hash })) };
}

export function validateLakeIndex(raw: unknown): LakeIndex {
  if (!raw || typeof raw !== "object") throw new Error("索引非对象");
  const idx = raw as Partial<LakeIndex>;
  if (idx.v !== S3V3_INDEX_VERSION || idx.space !== "lake") throw new Error("索引版本/空间非法");
  if (!Array.isArray(idx.notes) || !Array.isArray(idx.folders)) throw new Error("索引 notes/folders 非数组");
  if (idx.notes.length > S3V3_MAX_LAKE_NOTES) throw new Error("索引条目过多: " + idx.notes.length);
  if (idx.folders.length > S3V3_MAX_FOLDERS) throw new Error("目录条目过多: " + idx.folders.length);
  const ids = new Set<string>();
  for (const n of idx.notes) {
    if (!isSafeId(n.id) || ids.has(n.id)) throw new Error("索引条目 id 非法/重复: " + String(n.id));
    ids.add(n.id);
    if (typeof n.title !== "string" || typeof n.updatedAt !== "string") throw new Error("索引条目 title/updatedAt 非法");
    if (!isHash(n.contentHash)) throw new Error("索引条目 contentHash 非法: " + n.id);
    if (n.parentId !== null && typeof n.parentId !== "string") throw new Error("索引条目 parentId 非法");
    if (typeof n.sortOrder !== "number") throw new Error("索引条目 sortOrder 非法");
    if (n.assetsHash !== undefined && !isHash(n.assetsHash)) throw new Error("索引条目 assetsHash 非法: " + n.id);
  }
  for (const f of idx.folders) {
    if (!isSafeId(f.id) || ids.has(f.id)) throw new Error("目录 id 非法/重复: " + String(f.id));
    if (typeof f.title !== "string" || typeof f.updatedAt !== "string") throw new Error("目录 title/updatedAt 非法");
    if (f.nodeType !== "notebook" && f.nodeType !== "group") throw new Error("目录 nodeType 非法");
  }
  return { v: S3V3_INDEX_VERSION, space: "lake", notes: idx.notes as LakeNoteEntry[], folders: idx.folders as LakeFolderEntry[] };
}

export function validateQuickNotesIndex(raw: unknown): QuickNotesIndex {
  if (!raw || typeof raw !== "object") throw new Error("小记索引非对象");
  const idx = raw as Partial<QuickNotesIndex>;
  if (idx.v !== S3V3_INDEX_VERSION || idx.space !== "quickNotes") throw new Error("小记索引版本/空间非法");
  if (!Array.isArray(idx.items)) throw new Error("小记索引 items 非数组");
  if (idx.items.length > S3V3_MAX_QUICK_NOTES) throw new Error("小记条目过多: " + idx.items.length);
  const ids = new Set<string>();
  for (const it of idx.items) {
    if (!isSafeId(it.id) || ids.has(it.id)) throw new Error("小记条目 id 非法/重复: " + String(it.id));
    ids.add(it.id);
    if (!isHash(it.contentHash) || typeof it.createdAt !== "string" || typeof it.updatedAt !== "string") throw new Error("小记条目字段非法: " + it.id);
    if (it.assetsHash !== undefined && !isHash(it.assetsHash)) throw new Error("小记 assetsHash 非法: " + it.id);
    if (it.tagIds !== undefined && (!Array.isArray(it.tagIds) || it.tagIds.some((t) => typeof t !== "string"))) throw new Error("小记 tagIds 非法");
  }
  return { v: S3V3_INDEX_VERSION, space: "quickNotes", items: idx.items as QuickNoteEntry[], tags: idx.tags as QuickNoteTagEntry[] | undefined };
}

export function parseLakeIndexBytes(bytes: Uint8Array): { index: LakeIndex; commit: string; serialized: string } {
  if (bytes.length > S3V3_MAX_INDEX_BYTES) throw new Error("索引过大: " + bytes.length);
  const text = new TextDecoder().decode(bytes);
  const index = validateLakeIndex(JSON.parse(text));
  // 规范形式必须与落盘一致（防篡改/非规范写入）；不一致时以重新序列化为准。
  const serialized = serializeLakeIndex(index);
  return { index, commit: sha256Text(serialized), serialized };
}

export function parseQuickNotesIndexBytes(bytes: Uint8Array): { index: QuickNotesIndex; commit: string; serialized: string } {
  if (bytes.length > S3V3_MAX_INDEX_BYTES) throw new Error("小记索引过大: " + bytes.length);
  const text = new TextDecoder().decode(bytes);
  const index = validateQuickNotesIndex(JSON.parse(text));
  const serialized = serializeQuickNotesIndex(index);
  return { index, commit: sha256Text(serialized), serialized };
}
