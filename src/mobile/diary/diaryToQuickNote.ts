/**
 * 日记条目 → 小记 = **移动**（261113 用户裁决，覆盖 261113 task-106 的「复制 + 原文进回收站」）。
 * 移动端对齐桌面 `electron/diaryQuickNoteConversion.ts`。
 *
 * 语义：
 *  · **同一篇内容**换空间：正文原样（同一内核 Lake 标记），**不剥任何卡片**；
 *  · 资产目录 note-assets/{noteId}/ → quick-notes/assets/{id}/ **整目录移动**（源不保留副本）；
 *  · id 新建（不沿用 note id）：删除意图/「云端已删除」标记按 id 跨空间共享，同 id 会让其他端复活、
 *    并把以后普通软删小记判成不可恢复 purge ⇒ 换新 id + 零复制改名移动（仍是移动，不是复制）；
 *  · 正文只改写资产 URL 作用域 `/{noteId}/` → `/quick-notes/{id}/`（原样/单编码/双编码三层，core 单一来源）；
 *  · 随后 Lake 侧原稿**物理移除**（notes 行 + 正文 + 资产目录 + 历史快照），**不进回收站**。
 *
 * ⚠️ 后果（如实记录）：**没有可恢复副本**（旧「复制 + 回收站可恢复」作废）；小记没有历史快照 ⇒
 * 原文档 history 快照**删除**（不迁移：迁移后没有任何入口能读）。
 * 同步侧仍由 `purgeTreeItem` 写 `deleted_notes` 删除意图 —— 那是「本地删除」的传播判据（否则 v3 会把
 * 本地缺失当云端恢复把文档拉回来），**不是可恢复副本**。
 *
 * 失败回滚：小记没建好/资产没搬完 ⇒ 原文原样保留；Lake 侧移除失败 ⇒ 资产移回 + 删小记行/正文，
 * 不留半成品。顺序 = 写小记正文+行 → 搬资产 → 删原文（跨两个库 + 文件系统，无全局事务）。
 */
import { mimeTypeForFilename } from "../../core/assetNaming.js";
import { readImageDimensions } from "../../core/imageUtils.js";
import { lakeBodyToPlainText } from "../../core/lakeDocForm.js";
import {
  normalizeQuickNoteContent,
  rewriteQuickNoteAssetScope,
  type StoredQuickNoteImage,
} from "../../core/quickNoteModel.js";
import { sha256Sync } from "../../core/sha256Sync.js";
import type { MobileDb } from "../data/sqliteDb.js";
import { readNote } from "../data/noteRepository.js";
import { removeUnsyncedQuickNote, saveQuickNoteContent } from "../data/quickNotesRepository.js";
import * as trashRepository from "../data/trashRepository.js";

/** 资产读写/移动依赖（生产 = native/assetFs 四件套；测试注入内存实现）。 */
export interface DiaryToQuickNoteAssetDeps {
  /** 该文档作用域下的资产键（形如 `<noteId>/<filename>`）。 */
  listNoteAssetKeys: (noteId: string) => Promise<string[]>;
  /** 读资产字节；文件缺失返回 null（用于算 hash/尺寸，不用于复制）。 */
  loadAssetBytes: (key: string) => Promise<Uint8Array | null>;
  /** 把 note-assets/{noteId}/ **移动**到 quick-notes/assets/{quickNoteId}/，返回移动文件数。 */
  moveNoteAssetsToQuickNote: (noteId: string, quickNoteId: string) => Promise<number>;
  /** 回滚：把 quick-notes/assets/{quickNoteId}/ **移回** note-assets/{noteId}/（不删字节）。 */
  moveQuickNoteAssetsBackToNote: (quickNoteId: string, noteId: string) => Promise<void>;
}

export interface ConvertDiaryToQuickNoteDeps extends DiaryToQuickNoteAssetDeps {
  /** Lake 侧移除（缺省 = purgeTreeItem：写删除意图 + 物理删行/正文/历史；不进回收站）。测试可注入失败验回滚。 */
  removeSourceNote?: (d: MobileDb, noteId: string) => Promise<void>;
  /** 移除后刷新 FTS（与 bridge.trashTreeItem 同口径；不传则跳过）。 */
  reconcileIndex?: (d: MobileDb) => Promise<void>;
}

export interface ConvertDiaryToQuickNoteResult {
  /** 新小记 id（不是原 note id；原因见文件头）。 */
  quickNoteId: string;
  /** 随正文移动到小记作用域的媒体数（图片 + 附件；0 = 本篇没有媒体）。 */
  movedMediaCount: number;
  /** 被删除的原文档历史快照数（小记没有历史快照 ⇒ 不迁移）。 */
  removedHistoryCount: number;
}

function encodeDepth(value: string, depth: number): string {
  let out = value;
  for (let i = 0; i < depth; i += 1) out = encodeURIComponent(out);
  return out;
}

function decodeChain(value: string): string[] {
  const out: string[] = [];
  let current = value;
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
      out.push(next);
    } catch { break; }
  }
  return out;
}

/** 资产文件名的多形态（原样 / 单编码 / 双编码，含先解码的历史名）。 */
function assetReferenceForms(filename: string): string[] {
  const bases = [filename, ...decodeChain(filename)];
  const forms = new Set<string>();
  for (const base of bases) for (let depth = 0; depth <= 2; depth += 1) forms.add(encodeDepth(base, depth));
  return [...forms];
}

function bodyReferencesAsset(body: string, filename: string): boolean {
  return assetReferenceForms(filename).some((form) => body.includes(form));
}

/** 改写后是否仍残留源作用域：先剔除目标作用域（可能包含源串），再按三层形态查找。 */
function hasResidualScope(body: string, sourceId: string, targetId: string): boolean {
  let rest = body;
  for (let depth = 0; depth <= 2; depth += 1) {
    rest = rest.split(encodeDepth(`/quick-notes/${targetId}/`, depth)).join("");
  }
  return [0, 1, 2].some((depth) => rest.includes(encodeDepth(`/${sourceId}/`, depth)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 正文里引用到本笔记作用域下的资产文件名（原样 + URL-encoded 两种写法）。 */
function referencedAssetNames(body: string, noteId: string): string[] {
  const names = new Set<string>();
  const scopes = [`/${noteId}/`, encodeURIComponent(`/${noteId}/`)];
  for (const scope of scopes) {
    const pattern = new RegExp(`${escapeRegExp(scope)}([^"<>\\s)#&]+)`, "g");
    for (const match of body.matchAll(pattern)) {
      const raw = match[1].split("%22")[0].split("%2522")[0].replace(/[.,;:!?]+$/, "");
      if (!raw) continue;
      const decoded = decodeChain(raw);
      names.add(decoded.length ? decoded[decoded.length - 1] : raw);
    }
  }
  return [...names];
}

/**
 * 日记条目 → 小记（移动语义）。抛错即代表**没有产生半成品**：小记未建/已回滚，原文未被移除。
 */
export async function convertDiaryToQuickNote(
  d: MobileDb,
  noteId: string,
  deps: ConvertDiaryToQuickNoteDeps,
): Promise<ConvertDiaryToQuickNoteResult> {
  const note = await readNote(d, noteId);
  if (!note) throw new Error(`笔记不存在或已彻底删除: ${noteId}`);
  if (note.kind !== "doc") {
    throw new Error(`该日记是 ${note.kind} 文档（表格/多维表/画板/手写板），正文不是 Lake 文本，不能转为小记；请先转为文档`);
  }
  const sourceBody = note.content;
  const title = note.title;
  // id 新建（不沿用 note id）：v3 删除意图 /「云端已删除」标记按 id **跨空间共享**（桌面 engineBridge.planWorldOf
  // 同时过滤 lake/quickNotes；planStateOf 把 lake purgeIntents 也交给小记合并）⇒ 同 id 会让其他端的回收站副本
  // 被重新上传复活，也会让本端以后**普通软删**小记被判成不可恢复 purge。
  // 任务书 §6 允许的最小替代 = 换新 id + 正文/资产零复制改名移动（仍是移动，不是复制），协议不动。
  const quickNoteId = crypto.randomUUID();
  // 新 id 理论上不会撞；仍显式拒绝活动行/墓碑，避免覆盖或复活一条已删小记。
  if (await d.prepare("SELECT 1 FROM quick_notes WHERE id=?").get(quickNoteId)) throw new Error(`小记已存在: ${quickNoteId}`);
  if (await d.prepare("SELECT 1 FROM quick_note_deleted WHERE id=?").get(quickNoteId)) throw new Error(`该 id 有已删除小记记录，不能复用: ${quickNoteId}`);

  // 该文档作用域下的实际资产文件名（键 = `<noteId>/<filename>`）。
  const existingFilenames = new Set(
    (await deps.listNoteAssetKeys(noteId))
      .map((key) => key.slice(noteId.length + 1))
      .filter((name) => name.length > 0 && !name.includes("/")),
  );
  // 正文引用了、但本地文件不在 ⇒ 明确失败（不产生「卡片指向不存在文件」的半成品）。
  const missing = referencedAssetNames(sourceBody, noteId).filter((filename) => !existingFilenames.has(filename));
  if (missing.length > 0) {
    throw new Error(`资源文件缺失，无法转换：${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " 等 " + missing.length + " 个" : ""}`);
  }

  // 作用域改写（原样/单编码/双编码三层，core 单一来源）；残留旧作用域 = 安全失败。
  const rewriteBody = rewriteQuickNoteAssetScope(sourceBody, `/${noteId}/`, `/quick-notes/${quickNoteId}/`);
  // 目标作用域字符串可能包含源作用域：先剔除目标串，再按三层形态查残留（否则可能误报）。
  const residual = hasResidualScope(rewriteBody, noteId, quickNoteId);
  if (residual) throw new Error("正文仍引用未搬运的日记资源作用域，转换已中止（未产生小记）");

  // 资源清单 = 正文真正引用的资产（目录整体移动；未引用残留文件一起走但不进同步清单）。
  const carriedFilenames = [...existingFilenames].filter((filename) => bodyReferencesAsset(rewriteBody, filename));
  const images: StoredQuickNoteImage[] = [];
  for (const filename of carriedFilenames) {
    const bytes = await deps.loadAssetBytes(`${noteId}/${filename}`);
    if (!bytes) throw new Error(`资产文件缺失，无法转换：${filename}`);
    const mimeType = mimeTypeForFilename(filename);
    const isImage = mimeType.startsWith("image/");
    const dimensions = isImage ? readImageDimensions(bytes) : null;
    images.push({
      id: crypto.randomUUID(),
      filename,
      mimeType,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      size: bytes.length,
      hash: sha256Sync(bytes),
    });
  }

  // 纯文本镜像（预览/搜索/降级显示）：标题 + 原正文纯文本。
  const plain = lakeBodyToPlainText(sourceBody);
  const text = [title.trim(), plain].map((part) => part.trim()).filter(Boolean).join("\n");
  // 正文/标题/时间/大小限制照旧校验（4MB 正文上限在 normalizeQuickNoteContent 内）。
  const content = normalizeQuickNoteContent(text, rewriteBody.trim() ? rewriteBody : "", images);
  const times = await d.prepare("SELECT updated_at, created_at FROM notes WHERE id=?").get(noteId) as
    { updated_at: string; created_at?: string | null } | undefined;
  const removedHistoryCount = Number((await d.prepare("SELECT COUNT(*) AS c FROM note_history WHERE note_id=?").get(noteId) as { c: number }).c ?? 0);

  // ① 先写小记（正文 + 行；失败内部回滚，原文未动）。
  await saveQuickNoteContent(d, quickNoteId, { text: content.text, body: content.body, images: content.images }, {
    timestamps: {
      createdAt: times?.created_at || times?.updated_at || new Date().toISOString(),
      updatedAt: times?.updated_at || new Date().toISOString(),
    },
  }).catch(async (error) => {
    // 小记未建成 ⇒ 确保没有半成品行/正文；原文与资产不动。
    await removeUnsyncedQuickNote(d, quickNoteId, async () => undefined).catch(() => undefined);
    throw error;
  });

  // ② 资产目录整体移动（失败 ⇒ 删小记行/正文；源目录由资产层保证完整）。
  try {
    await deps.moveNoteAssetsToQuickNote(noteId, quickNoteId);
  } catch (error) {
    await removeUnsyncedQuickNote(d, quickNoteId, async () => undefined).catch(() => undefined);
    throw error;
  }

  // ③ Lake 侧移除（物理删行/正文/历史 + 删除意图）；失败 ⇒ 资产移回 + 删小记。
  try {
    if (deps.removeSourceNote) await deps.removeSourceNote(d, noteId);
    else await trashRepository.purgeTreeItem(d, noteId, "note");
    if (deps.reconcileIndex) await deps.reconcileIndex(d);
  } catch (error) {
    // 顺序：先把资产移回（原稿重新完整），成功后才删小记行/正文。
    // 移回失败 ⇒ **保留小记**（内容仍在），绝不为了「删干净」丢掉唯一资产副本。
    const restored = await deps.moveQuickNoteAssetsBackToNote(quickNoteId, noteId).then(() => true).catch(() => false);
    if (restored) await removeUnsyncedQuickNote(d, quickNoteId, async () => undefined).catch(() => undefined);
    else console.warn("[diary→quick] 回滚时资产移回失败，保留小记以免丢字节:", quickNoteId);
    throw error;
  }
  return { quickNoteId, movedMediaCount: carriedFilenames.length, removedHistoryCount };
}
