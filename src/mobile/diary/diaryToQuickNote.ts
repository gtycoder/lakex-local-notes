/**
 * 日记条目 → 小记（261113 task-106）：移动端对齐桌面 `electron/diaryQuickNoteConversion.ts`。
 *
 * 语义（AGENTS §3#25 / docs/DIARY.md；261113 用户裁决 = **复制 + 原稿进回收站**）：
 *  · 用日记条目的**原 Lake 正文**创建一条小记（复制新 id），图片/附件卡片**复制**到小记资产作用域
 *    （`/<noteId>/` → `/quick-notes/<newId>/`），**原资产保留**（回收站恢复日记时仍完整）；
 *  · 原文随后**软删进回收站**（可恢复，不 purge、不写墓碑）；
 *  · **卡片零剥离**：同一内核 Lake 正文原样承载（画板/自定义块/公式全部保留；`droppedKinds` 字段保留但恒空）；
 *  · 非 doc 类型（表格/多维表/画板/手写板）整篇拒绝；
 *  · **失败回滚**：小记没建好/资源没搬完就不删日记；软删失败也把小记回滚干净（不留半成品）。
 *
 * 复用：作用域改写 = core `rewriteQuickNoteAssetScope`；内容校验 = core `normalizeQuickNoteContent`；
 * 写库 = 移动 `saveQuickNoteContent`（.qnote 正文 + quick_notes 行）；软删 = 移动 `trashTreeItem`。
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

/** 资产读写依赖（生产 = native/assetFs 三件套；测试注入内存实现）。 */
export interface DiaryToQuickNoteAssetDeps {
  /** 该文档作用域下的资产键（形如 `<noteId>/<filename>`）。 */
  listNoteAssetKeys: (noteId: string) => Promise<string[]>;
  /** 读资产字节；文件缺失返回 null。 */
  loadAssetBytes: (key: string) => Promise<Uint8Array | null>;
  /** 写小记作用域资产（键 `quick-notes/<quickNoteId>/<filename>`）。 */
  saveAssetFile: (key: string, bytes: Uint8Array) => Promise<void>;
  /** 回滚时整目录清理小记资产（`quick-notes/assets/<id>/`）。 */
  removeQuickNoteAssetsDir: (quickNoteId: string) => Promise<void>;
}

export interface ConvertDiaryToQuickNoteDeps extends DiaryToQuickNoteAssetDeps {
  /** 软删原文（缺省 = 移动 trashRepository.trashTreeItem 的 note 分支）。测试可注入失败以验回滚。 */
  trashNote?: (d: MobileDb, noteId: string) => Promise<void>;
  /** 软删后刷新 FTS（与 bridge.trashTreeItem 同口径；不传则跳过）。 */
  reconcileIndex?: (d: MobileDb) => Promise<void>;
  /** 确定性 id（测试用；缺省 crypto.randomUUID）。 */
  newId?: () => string;
}

export interface ConvertDiaryToQuickNoteResult {
  quickNoteId: string;
  /** 保留字段（IPC/文案兼容）：261113 起**恒为空数组**（卡片零剥离）。 */
  droppedKinds: string[];
}

function bodyReferencesAsset(body: string, filename: string): boolean {
  return body.includes(filename) || body.includes(encodeURIComponent(filename));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 正文里引用到本笔记作用域下的资产文件名（原样 + URL-encoded 两种写法）。 */
function referencedAssetNames(body: string, noteId: string): string[] {
  const names = new Set<string>();
  const encodedScope = encodeURIComponent(`/${noteId}/`);
  const patterns = [
    new RegExp(`/${escapeRegExp(noteId)}/([A-Za-z0-9._-]+)`, "g"),
    new RegExp(`${escapeRegExp(encodedScope)}([A-Za-z0-9._-]+)`, "g"),
  ];
  for (const pattern of patterns) {
    for (const match of body.matchAll(pattern)) names.add(match[1]);
  }
  return [...names];
}

/**
 * 日记条目 → 小记。抛错即代表**没有产生半成品**（小记未建或已回滚，原文未被软删）。
 */
export async function convertDiaryToQuickNote(
  d: MobileDb,
  noteId: string,
  deps: ConvertDiaryToQuickNoteDeps,
): Promise<ConvertDiaryToQuickNoteResult> {
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const note = await readNote(d, noteId);
  if (!note) throw new Error(`笔记不存在或已彻底删除: ${noteId}`);
  if (note.kind !== "doc") {
    throw new Error(`该日记是 ${note.kind} 文档（表格/多维表/画板/手写板），正文不是 Lake 文本，不能转为小记；请先转为文档`);
  }
  const sourceBody = note.content;
  const title = note.title;

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

  const quickNoteId = newId();
  // 只搬运正文真正引用的资产（未被引用的留在原日记目录，回收站恢复时仍完整）。
  const rewriteBody = rewriteQuickNoteAssetScope(sourceBody, `/${noteId}/`, `/quick-notes/${quickNoteId}/`);
  // 261113：零剥离 —— 正文原样进小记（画板/自定义块/公式等一并保留）。
  const carriedBody = rewriteBody;
  const carriedFilenames = [...existingFilenames].filter((filename) => bodyReferencesAsset(carriedBody, filename));

  const images: StoredQuickNoteImage[] = [];
  try {
    for (const filename of carriedFilenames) {
      const bytes = await deps.loadAssetBytes(`${noteId}/${filename}`);
      if (!bytes) throw new Error(`资产文件缺失，无法转换：${filename}`);
      const mimeType = mimeTypeForFilename(filename);
      const isImage = mimeType.startsWith("image/");
      const dimensions = isImage ? readImageDimensions(bytes) : null;
      images.push({
        id: newId(),
        filename,
        mimeType,
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
        size: bytes.length,
        hash: sha256Sync(bytes),
      });
      await deps.saveAssetFile(`quick-notes/${quickNoteId}/${filename}`, bytes);
    }

    // 纯文本镜像（预览/搜索/降级显示）：标题 + 原正文纯文本。
    const plain = lakeBodyToPlainText(sourceBody);
    const text = [title.trim(), plain].map((part) => part.trim()).filter(Boolean).join("\n");
    const content = normalizeQuickNoteContent(text, carriedBody.trim() ? carriedBody : "", images);
    await saveQuickNoteContent(d, quickNoteId, { text: content.text, body: content.body, images: content.images });
  } catch (error) {
    // 小记未建成 ⇒ 把已写文件/可能的行清掉；原文不动。
    await removeUnsyncedQuickNote(d, quickNoteId, deps.removeQuickNoteAssetsDir).catch(() => { /* best effort */ });
    throw error;
  }

  try {
    if (deps.trashNote) await deps.trashNote(d, noteId);
    else await trashRepository.trashTreeItem(d, noteId, "note");
    if (deps.reconcileIndex) await deps.reconcileIndex(d);
  } catch (error) {
    // 软删失败 ⇒ 回滚刚建的小记（从未同步：硬删、不写墓碑），原文不动。
    await removeUnsyncedQuickNote(d, quickNoteId, deps.removeQuickNoteAssetsDir).catch(() => { /* best effort */ });
    throw error;
  }
  return { quickNoteId, droppedKinds: [] as string[] };
}
