import crypto from "node:crypto";
import fs from "node:fs";
import { mimeTypeForFilename } from "../src/core/assetNaming.js";
import { readImageDimensions } from "../src/core/imageUtils.js";
import { lakeBodyToPlainText } from "../src/core/lakeDocForm.js";
import { normalizeQuickNoteContent, rewriteQuickNoteAssetScope, type StoredQuickNoteContent } from "../src/core/quickNoteModel.js";
import { sha256Sync } from "../src/core/sha256Sync.js";
import { AppError } from "../src/core/storeErrors.js";
import type { QuickNotesStore } from "./quickNotes.js";
import type { Store } from "./store.js";

/**
 * 日记 → 小记（261112 task-92）：用户口径 = 小记本身也是 Lake 文档，转换应**原样承载正文**（含图片/附件卡片），
 * 媒体搬到小记资产作用域。日记原文之后由调用方/本函数软删进回收站（可恢复，原资产不动）。
 *
 * 为什么不是「树移动」：小记是独立空间（独立 DB + `/quick-notes/<id>/` 资产作用域）⇒ 必须复制 + 改写引用。
 * 复用：内容写入走 `quickNotes.createQuickNoteFromContent`（journal 4 态，失败不产生半成品），
 * 与远端导入同一条 promote 路径；反向通道见 `electron/quickNoteConversion.ts`。
 *
 * 能承载的卡片（原样保留 + 资产复制 + 引用改写）：image / file / attachment / audio / video，
 * 以及无资产的普通块（段落/列表/待办/引用/代码块/分隔线/日期/表情等）。
 * **不能承载**的卡片（如画板 customBlock、大纲 toc、素材库 materialLibrary、未知 card 名）会被
 * 整段剥掉并在 `droppedKinds` 里如实上报（不静默丢；原文仍可从回收站恢复）。
 */
export interface ConvertDiaryToQuickNoteResult {
  quickNoteId: string;
  /** 未能搬运的卡片类型（去重；空 = 全部承载）。 */
  droppedKinds: string[];
}

/** 小记正文能承载的卡片名（资产管理 + 内核可渲染）。其它 card 一律剥离并上报。 */
const CARRYABLE_CARD_NAMES = new Set([
  "image", "file", "attachment", "audio", "video",
  // 无本地资产的内联卡/块：日期、表情、分隔线、代码块、待办、视口等。
  "date", "dateCard", "unicodeEmoji", "emoji", "hr", "codeblock", "checkbox", "taskList", "viewport",
]);

/** 段落块切分（Lake 正文的块都是顶层 `<p>`；卡片一定在 `<p>` 里）。 */
const PARAGRAPH_PATTERN = /<p\b[^>]*>[\s\S]*?<\/p>/g;
const CARD_NAME_PATTERN = /<card\b[^>]*\bname="([^"]+)"/;

/** 剥掉小记承载不了的卡片段落，返回新正文 + 被剥掉的 card 类型。 */
function stripUnsupportedCards(body: string): { body: string; droppedKinds: string[] } {
  const dropped = new Set<string>();
  const stripped = body.replace(PARAGRAPH_PATTERN, (paragraph) => {
    const match = CARD_NAME_PATTERN.exec(paragraph);
    if (!match) return paragraph;
    const name = match[1];
    if (CARRYABLE_CARD_NAMES.has(name)) return paragraph;
    dropped.add(name);
    return "";
  });
  return { body: stripped, droppedKinds: [...dropped].sort() };
}

/** 资产文件名在正文里的两种形态：原样 / 卡片 value 里 encodeURIComponent 后的形态。 */
function bodyReferencesAsset(body: string, filename: string): boolean {
  return body.includes(filename) || body.includes(encodeURIComponent(filename));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 正文里引用到本笔记作用域下的资产文件名（原样 + URL-encoded 两种写法；文件名白名单字符集）。 */
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

export function convertDiaryNoteToQuickNote(
  quickNotes: QuickNotesStore,
  notes: Store,
  noteId: string,
): ConvertDiaryToQuickNoteResult {
  const kind = notes.noteKindOf(noteId);
  if (kind === null) throw new AppError("NotFound", `笔记不存在或已彻底删除: ${noteId}`);
  if (kind !== "doc") {
    throw new AppError("InvalidInput", `该日记是 ${kind} 文档（表格/多维表/画板/手写板），正文不是 Lake 文本，不能转为小记；请先转为文档`);
  }
  const sourceBody = notes.readNoteBodyForConversion(noteId);
  const title = notes.noteTitleOf(noteId);
  const sourceAssets = notes.listNoteAssetsForConversion(noteId);
  const quickNoteId = crypto.randomUUID();
  // 正文引用了、但本地资产文件不在：明确失败（不产生「卡片指向不存在文件」的半成品；原文与其它资产原样保留）。
  const existingNames = new Set(sourceAssets.map((asset) => asset.filename));
  const missing = referencedAssetNames(sourceBody, noteId).filter((filename) => !existingNames.has(filename));
  if (missing.length > 0) {
    throw new AppError("NotFound", `资源文件缺失，无法转换：${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " 等 " + missing.length + " 个" : ""}`);
  }

  // ① 只搬运正文真正引用的资产（未被引用的留在原日记目录，回收站恢复时仍完整）。
  const rewriteBody = rewriteQuickNoteAssetScope(sourceBody, `/${noteId}/`, `/quick-notes/${quickNoteId}/`);
  const { body: carriedBody, droppedKinds } = stripUnsupportedCards(rewriteBody);
  const carried = sourceAssets.filter((asset) => bodyReferencesAsset(carriedBody, asset.filename));
  const images: StoredQuickNoteContent["images"] = [];
  const files: Array<{ filename: string; bytes: Buffer }> = [];
  for (const asset of carried) {
    const bytes = fs.readFileSync(asset.sourcePath);
    const mimeType = mimeTypeForFilename(asset.filename);
    const isImage = mimeType.startsWith("image/");
    const dimensions = isImage ? readImageDimensions(bytes) : null;
    images.push({
      id: crypto.randomUUID(),
      filename: asset.filename,
      mimeType,
      width: dimensions?.width ?? null,
      height: dimensions?.height ?? null,
      size: bytes.length,
      hash: sha256Sync(bytes),
    });
    files.push({ filename: asset.filename, bytes });
  }

  // ② 纯文本镜像（小记预览/搜索/降级显示）：标题 + 已有 text_cache；正文本身原样。
  // 优先用已建好的 text_cache（与搜索同源）；没有再退化到正文纯文本抽取。
  const plain = (() => { try { return notes.readNoteCaches(noteId).plain ?? lakeBodyToPlainText(sourceBody); } catch { return lakeBodyToPlainText(sourceBody); } })();
  const text = [title, plain].map((part) => part.trim()).filter(Boolean).join("\n");
  const content = normalizeQuickNoteContent(text, carriedBody.trim() ? carriedBody : "", images);

  // ③ 先建小记（journal 原子：失败不留行/文件），成功后再软删日记。
  // 261112 发版复核 F-03：创建本身失败（例如 promote 失败）也必须回滚，否则重启 recoverImports 会把半成品补出来。
  try {
    quickNotes.createQuickNoteFromContent({ id: quickNoteId, content, assets: files });
  } catch (error) {
    try { quickNotes.removeUnsyncedQuickNote(quickNoteId); } catch { /* best effort */ }
    throw error;
  }
  try {
    notes.deleteTreeNode(noteId);
  } catch (error) {
    // 软删失败 ⇒ 回滚刚建的小记（这条从未同步，直接清掉、不写墓碑）。
    try { quickNotes.removeUnsyncedQuickNote(quickNoteId); } catch { /* best effort：最多留一条可手删的小记 */ }
    throw error;
  }
  return { quickNoteId, droppedKinds };
}
