import { sha256Hex } from "../../syncUtils.js";
import { normalizeFolderSpace, type DiaryFolderSpace } from "../../diary.js";
import { assertSafeSegment } from "./s3v3Keys.js";
import { S3V3_HASH_RE } from "./s3v3Types.js";

/** S3 v3 索引/声明的纯逻辑：规范化序列化（稳定 hash）、校验、解析。 */

export const S3V3_INDEX_VERSION = 3 as const;
export const S3V3_MAX_INDEX_BYTES = 64 * 1024 * 1024;
export const S3V3_MAX_LAKE_NOTES = 100_000;
export const S3V3_MAX_FOLDERS = 10_000;
export const S3V3_MAX_QUICK_NOTES = 20_000;
/** 小记 `purged` 墓碑保留窗口（天）：与回收站自动过期同口径（90 天，用户 261026 定稿）。 */
export const S3V3_QUICK_PURGE_RETENTION_DAYS = 90;
/** 标签目录硬上限（261105）：tags[] 不允许无界增长（异常端/旧实现都可能把它撑大）。 */
export const S3V3_MAX_TAGS = 5_000;
/** 每条文档/小记的标签关系上限（与小记 MAX_QUICK_NOTE_TAGS=20 同口径）。 */
export const S3V3_MAX_TAGS_PER_NOTE = 20;

export interface AssetDeclEntry {
  filename: string;
  size: number;
  hash: string;
  /** 小记图片渲染元信息（可选；Lake 附件不需要）。 */
  mimeType?: string;
  width?: number | null;
  height?: number | null;
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
  /**
   * 文档标签关系（261105 P1）：**排序后的集合**（顺序是设备本地视图，不参与同步）。
   * 目录本身沿用 quick-notes 索引的 tags[]（已同步）；这里只带关系集合。
   */
  tagIds?: string[];
  /** 文档标签关系版本（LWW）：正文 hash 不变也必须能传播关系变更。 */
  tagsUpdatedAt?: string;
}

export interface LakeFolderEntry {
  id: string;
  title: string;
  parentId: string | null;
  sortOrder: number;
  nodeType: "notebook" | "group";
  icon: string | null;
  updatedAt: string;
  /**
   * 日记本标记（261109，docs/DIARY.md）。
   * **发布时必须显式写**：非日记写 `null`（不是省略字段）——否则「取消日记标记」在 wire 上不可见、
   * 两端会互刷（同 tagIds 空集合必须写 `[]` 的教训）。
   * 读取容错：未知值/缺字段一律当非日记（`normalizeFolderSpace`）。
   */
  space?: DiaryFolderSpace | null;
  trashedAt?: string | null;
  deletedFromParentId?: string | null;
}

export interface LakeIndex {
  v: typeof S3V3_INDEX_VERSION;
  space: "lake";
  notes: LakeNoteEntry[];
  folders: LakeFolderEntry[];
}

/**
 * 标签目录条目：**只有 active 标签**（删除 = 缺席，261105 定稿）。
 * 旧索引里可能残留 `deletedAt` 墓碑；读取时按「缺席」处理（校验阶段直接丢字段），发布时永不写回。
 */
export interface QuickNoteTagEntry {
  id: string;
  name: string;
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
  /** 已彻底删除的小记 ID（墓碑；跨端传播“不可恢复删除”，与普通 absent 软删区分）。 */
  purged?: string[];
}

/**
 * canonicalJson 的防御性上限（261105 Batch3-C）。
 *
 * 旧实现是**递归**：深嵌套结构（实验 20 万层）会 RangeError 栈溢出 ⇒ 同步/导入路径遇到
 * 损坏或恶意数据时连错误信息都拿不到。现改为**迭代 + 显式栈**，输出与旧实现逐字节一致
 * （既有序列化/索引 hash 回归由对拍用例锁住），并用这两条上限把病态结构变成可读错误：
 * - 量级依据：lake 索引在硬上限 10 万文档下约 1.1M 个节点（每篇 ~11 个字段值），2M 留 ~1.8x 余量；
 * - 真实索引深度只有 4（{v,space,notes[],folders[]}），256 层远超任何真实文档。
 */
export const CANONICAL_JSON_MAX_DEPTH = 256;
export const CANONICAL_JSON_MAX_NODES = 2_000_000;

/** canonical JSON：对象 key 排序、数组保持顺序（调用方先排序）。
 *  迭代实现（显式栈），因此不受 JS 调用栈深度限制；超限抛可读错误而不是 RangeError。 */
export function canonicalJson(value: unknown): string {
  // 根是原始值：与旧实现完全一致（JSON.stringify 的返回值原样返回，undefined/function 同理）。
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  const out: string[] = [];
  type ArrayFrame = { kind: "array"; value: unknown[]; index: number; depth: number };
  type ObjectFrame = { kind: "object"; value: Record<string, unknown>; keys: string[]; index: number; depth: number };
  const stack: Array<ArrayFrame | ObjectFrame> = [];
  let nodes = 0;
  let pending: { value: unknown; depth: number } | null = { value, depth: 0 };
  while (true) {
    if (pending) {
      const current = pending;
      pending = null;
      nodes += 1;
      if (nodes > CANONICAL_JSON_MAX_NODES) {
        throw new Error(`canonicalJson：节点数超过上限 ${CANONICAL_JSON_MAX_NODES}（结构过大，疑似损坏数据）`);
      }
      const v = current.value;
      if (v === null || typeof v !== "object") {
        const primitive = JSON.stringify(v);
        // 与旧实现一致：undefined / function / symbol 在数组里退化成空串（join 的既有行为）。
        out.push(primitive === undefined ? "" : primitive);
      } else {
        if (current.depth >= CANONICAL_JSON_MAX_DEPTH) {
          throw new Error(`canonicalJson：嵌套超过 ${CANONICAL_JSON_MAX_DEPTH} 层（疑似损坏数据）`);
        }
        if (Array.isArray(v)) {
          out.push("[");
          stack.push({ kind: "array", value: v, index: 0, depth: current.depth });
        } else {
          const obj = v as Record<string, unknown>;
          const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
          out.push("{");
          stack.push({ kind: "object", value: obj, keys, index: 0, depth: current.depth });
        }
      }
      if (stack.length === 0) break;
      continue;
    }
    if (stack.length === 0) break;
    const top = stack[stack.length - 1];
    if (top.kind === "array") {
      if (top.index >= top.value.length) {
        out.push("]");
        stack.pop();
        continue;
      }
      if (top.index > 0) out.push(",");
      pending = { value: top.value[top.index], depth: top.depth + 1 };
      top.index += 1;
    } else {
      if (top.index >= top.keys.length) {
        out.push("}");
        stack.pop();
        continue;
      }
      if (top.index > 0) out.push(",");
      out.push(JSON.stringify(top.keys[top.index]) + ":");
      pending = { value: top.value[top.keys[top.index]], depth: top.depth + 1 };
      top.index += 1;
    }
  }
  return out.join("");
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
  const purged = index.purged ? [...index.purged].sort() : undefined;
  return canonicalJson({ v: index.v, space: index.space, items, tags, purged });
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

/**
 * 裁剪小记 `purged` 墓碑（SD-09）：该数组此前只增不减 ⇒ 索引体积随 purge 历史单调膨胀。
 * 窗口只决定「跨端传播不可恢复删除」记多久，**删除=缺席语义不变**（新设备本来就没有这些内容）。
 * 缺失/非法时间的条目**保守保留**（判不出年龄就不删）；`retentionDays<=0` 关闭裁剪。
 * 与回收站自动过期同口径（90 天）：过了窗口的 id 既不可恢复、也无传播价值。
 */
export function pruneQuickPurgedIds(
  ids: readonly string[],
  purgedAt: Readonly<Record<string, string>> | undefined,
  now: Date,
  retentionDays: number = S3V3_QUICK_PURGE_RETENTION_DAYS,
): string[] {
  const unique = [...new Set(ids)].sort();
  if (retentionDays <= 0) return unique;
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  return unique.filter((id) => {
    const at = purgedAt?.[id];
    if (!at) return true; // 缺时间 = 无法判龄 ⇒ 保守保留
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) return true;
    return ms >= cutoff;
  });
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
    if (a.mimeType !== undefined && typeof a.mimeType !== "string") throw new Error("资产 mimeType 非法");
    if (a.width !== undefined && a.width !== null && !Number.isSafeInteger(a.width)) throw new Error("资产 width 非法");
    if (a.height !== undefined && a.height !== null && !Number.isSafeInteger(a.height)) throw new Error("资产 height 非法");
  }
  return { assets: d.assets.map((a) => ({ filename: a.filename, size: a.size, hash: a.hash, ...(a.mimeType !== undefined ? { mimeType: a.mimeType } : {}), ...(a.width !== undefined ? { width: a.width } : {}), ...(a.height !== undefined ? { height: a.height } : {}) })) };
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
    // 文档标签关系（261105 P1）：只接受字符串数组；旧索引没有该字段 = 未知（不清空本地关系）。
    if (n.tagIds !== undefined) {
      if (!Array.isArray(n.tagIds) || n.tagIds.some((t) => typeof t !== "string")) {
        throw new Error("索引条目 tagIds 非法: " + n.id);
      }
      // Review-A P2-3：去重 + 每篇上限（与小记同一口径），防坏条目撑大索引/破坏集合比较。
      if (new Set(n.tagIds).size !== n.tagIds.length) throw new Error("索引条目 tagIds 重复: " + n.id);
      if (n.tagIds.length > S3V3_MAX_TAGS_PER_NOTE) throw new Error("索引条目 tagIds 过多: " + n.id);
    }
    if (n.tagsUpdatedAt !== undefined) {
      // 坏时间串会按字典序永久压制 LWW ⇒ 必须可解析（空串 = 无版本，允许）。
      if (typeof n.tagsUpdatedAt !== "string") throw new Error("索引条目 tagsUpdatedAt 非法: " + n.id);
      if (n.tagsUpdatedAt !== "" && !Number.isFinite(Date.parse(n.tagsUpdatedAt))) {
        throw new Error("索引条目 tagsUpdatedAt 非时间: " + n.id);
      }
    }
  }
  for (const f of idx.folders) {
    if (!isSafeId(f.id) || ids.has(f.id)) throw new Error("目录 id 非法/重复: " + String(f.id));
    if (typeof f.title !== "string" || typeof f.updatedAt !== "string") throw new Error("目录 title/updatedAt 非法");
    if (f.nodeType !== "notebook" && f.nodeType !== "group") throw new Error("目录 nodeType 非法");
  }
  // 日记标记读取容错（DIARY.md）：未知值/缺字段一律当非日记，**不抛错、也不自动修复**
  // （多个 space="diary" 的冲突由判据层取首个并告警，不在这里静默改数据）。
  // 互校：space 只对 notebook 有意义（坏端写出 group(space="diary") 时就地归一为 null，
  // 与判据层「只认 notebook」同口径；不抛错 —— 别让一条脏字段毁掉整份索引）。
  const folders: LakeFolderEntry[] = (idx.folders as LakeFolderEntry[]).map((f) => ({
    ...f,
    space: f.nodeType === "notebook" ? normalizeFolderSpace(f.space) : null,
  }));
  return { v: S3V3_INDEX_VERSION, space: "lake", notes: idx.notes as LakeNoteEntry[], folders };
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
  const purged = idx.purged as string[] | undefined;
  if (purged !== undefined && (!Array.isArray(purged) || purged.some((id) => typeof id !== "string"))) throw new Error("小记 purged 列表非法");
  // 标签目录：只接受 active 条目（字段白名单 ⇒ 旧索引残留的 deletedAt 墓碑在此被丢弃 = 缺席）。
  let tags: QuickNoteTagEntry[] | undefined;
  if (idx.tags !== undefined) {
    if (!Array.isArray(idx.tags)) throw new Error("小记标签目录非数组");
    if (idx.tags.length > S3V3_MAX_TAGS) throw new Error("标签条目过多: " + idx.tags.length);
    const tagIds = new Set<string>();
    tags = idx.tags.map((t) => {
      if (!t || typeof t.id !== "string" || tagIds.has(t.id)) throw new Error("标签条目 id 非法/重复: " + String(t?.id));
      tagIds.add(t.id);
      if (typeof t.name !== "string" || typeof t.createdAt !== "string" || typeof t.updatedAt !== "string") throw new Error("标签条目字段非法: " + t.id);
      return { id: t.id, name: t.name, createdAt: t.createdAt, updatedAt: t.updatedAt };
    });
  }
  return { v: S3V3_INDEX_VERSION, space: "quickNotes", items: idx.items as QuickNoteEntry[], ...(tags ? { tags } : {}), ...(purged ? { purged } : {}) };
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
