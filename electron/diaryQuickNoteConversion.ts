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
 * 日记 → 小记 = **移动**（261113 用户裁决，覆盖 261112 的「复制 + 原稿进回收站」）。
 *
 * 目标语义：**同一篇内容**从「日记/知识库文档」变成「小记条目」——
 *  · **id 新建**（不是沿用）：v3 的删除意图/「云端已删除」标记按 id 跨空间共享，同 id 会让其他端复活、
 *    并让以后普通软删小记被判成不可恢复 purge（证据见下方 quickNoteId 注释）⇒ 换新 id + 零复制改名移动；
 *  · 正文文本原样（同一内核 Lake 标记），**不剥任何块**（画板/自定义块/大纲/素材库/未知卡片一律保留）；
 *  · 资产目录 `note-assets/{id}/` → `quick-notes/assets/{id}/` **整目录移动**（fs rename，跨盘才 copy+delete），
 *    原位置**不保留副本**；
 *  · 只改写正文里的资产 URL 作用域 `/{noteId}/` → `/quick-notes/{id}/`（原样/单编码/双编码三层）——
 *    这是「改资料配置」，不是复制内容；
 *  · 随后 Lake 侧 notes/tree_nodes 行 + 正文文件 + 资产目录 + **历史快照**移除；**不进回收站、无副本**。
 *
 * ⚠️ 后果（必须如实记录）：**没有可恢复副本**。原红线「复制 + 原稿进回收站可恢复」作废；
 * 小记没有历史快照 ⇒ 原文档 history 快照**删除**（不迁移：迁移后也没有任何入口能读）。
 * 同步侧仍写 `deleted_notes` 删除意图（Store.removeNoteForQuickNoteMove 内），否则 v3 会把「本地缺失」
 * 当成云端恢复把文档拉回来；墓碑只是删除意图，不是可恢复副本。
 *
 * 失败回滚：小记没建好/资产没搬完 ⇒ Lake 原稿原样保留；Lake 侧移除失败 ⇒ 删小记行/正文、资产移回。
 */
export interface ConvertDiaryToQuickNoteResult {
  /** 新小记 id（不是原 note id；见下方「为什么不沿用 id」）。 */
  quickNoteId: string;
  /** 随正文移到小记作用域的媒体数（图片 + 附件；0 = 本篇没有媒体）——提示文案据此说「含图片/附件」。 */
  movedMediaCount: number;
  /** 被删除的原文档历史快照数（小记没有历史快照 ⇒ 不迁移；0 = 原本就没有历史）。 */
  removedHistoryCount: number;
}

/**
 * 资产文件名在正文里的**多形态**（作用域同样多形态）：
 * 原样 / encodeURIComponent 后；再补「百分号解码后」与「解码后再编码」两形态，
 * 覆盖中文、空格、含 `%` 等历史文件名（卡片 value 是 encodeURIComponent(JSON) 时会多一层编码）。
 */
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
  return value.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
}

/**
 * 正文里引用到本笔记作用域下的资产文件名：作用域同样多形态（原样 / URL-encoded）；
 * 文件名截取到「引号/空白/括号等分隔符」为止，再按 URL 解码（中文/空格文件名能正确匹配）。
 */
function referencedAssetNames(body: string, noteId: string): string[] {
  const names = new Set<string>();
  const scopes = [`/${noteId}/`, encodeURIComponent(`/${noteId}/`)];
  for (const scope of scopes) {
    const pattern = new RegExp(`${escapeRegExp(scope)}([^"<>\\s)#&]+)`, "g");
    for (const match of body.matchAll(pattern)) {
      // 编码态里文件名后面紧跟 %22（JSON 引号）⇒ 先截断再解码。
      const raw = match[1].split("%22")[0].split("%2522")[0].replace(/[.,;:!?]+$/, "");
      if (!raw) continue;
      const decoded = decodeChain(raw);
      names.add(decoded.length ? decoded[decoded.length - 1] : raw);
    }
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
  // 261112 task-104（F-04）：只允许「日记空间里的条目」——否则 webApi/自动化可对任意普通文档调用。
  if (!notes.diaryNotebookOfNote(noteId)) {
    throw new AppError("InvalidInput", "只能把日记条目转为小记（该文档不在日记空间中）");
  }
  const sourceBody = notes.readNoteBodyForConversion(noteId);
  const title = notes.noteTitleOf(noteId);
  const times = notes.noteTimesForConversion(noteId);
  const sourceAssets = notes.listNoteAssetsForConversion(noteId);
  const sourceAssetsDir = notes.noteAssetsDirForConversion(noteId);
  // id 不能沿用（尽管少一层接线）：v3 的删除意图与「云端已删除·仅本地」标记都**按 id 跨空间共享**
  //（engineBridge.planWorldOf 同时过滤 lake/quickNotes；planStateOf 把 lake purgeIntents 也交给小记合并）。
  // 若小记与「Lake 删除意图」同 id：① 其他端的回收站副本会因远端小记同 id 存在而清掉 cloud-deleted 标记，
  // 之后被当成 base 缺席重新上传（复活）；② 本端以后**普通软删**这条小记时，lake 删除意图会把
  // planQuickNotesMerge 的第一条分支（purgeIntents + 本地缺席 + 远端仍在）判成不可恢复 purge。
  // ⇒ 最小可行替代（任务书 §6 允许）：换新 id，但正文/资产**零复制**地改名移动（rename 目录 + 作用域改写），
  // 仍是移动、不是复制；协议一行不改。
  const quickNoteId = crypto.randomUUID();

  // 正文引用了、但本地资产文件不在：明确失败（不产生「卡片指向不存在文件」的半成品；原稿与其它资产原样保留）。
  const existingNames = new Set(sourceAssets.map((asset) => asset.filename));
  const missing = referencedAssetNames(sourceBody, noteId).filter((filename) => !existingNames.has(filename));
  if (missing.length > 0) {
    throw new AppError("NotFound", `资源文件缺失，无法转换：${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " 等 " + missing.length + " 个" : ""}`);
  }

  // 作用域改写覆盖「原样 / 单编码 / 双编码」三种形态（卡片 value 常是 encodeURIComponent(JSON)；
  // 内核若把 URL 里文件名也编码过就会多一层转义，只改单层会留下旧 scope ⇒ 卡片指向不存在的资产）。
  const bodyForQuick = rewriteQuickNoteAssetScope(sourceBody, `/${noteId}/`, `/quick-notes/${quickNoteId}/`);
  // 兜底：改写后仍残留原日记作用域（任一形态）= 有引用没被识别（安全失败，不产半成品）。
  // 目标作用域字符串**包含**源作用域（`/quick-notes/<新 id>/` vs `/<旧 id>/` 不一定，但沿用 id 时必然），
  // 所以先把目标作用域整段删掉再查残留（否则可能永远误报）。
  const residual = hasResidualScope(bodyForQuick, noteId, quickNoteId);
  if (residual) {
    throw new AppError("InvalidInput", "正文仍引用未搬运的日记资源作用域，转换已中止（未产生小记）");
  }
  // 资源清单 = 正文真正引用的资产（文件本体按**整个目录**移动，未引用的残留文件也一起走：
  // 移动语义下不留在原目录，避免「原文已消失、资产还挂在 lake 空间」；它们不进清单 = 不参与同步声明）。
  const carried = sourceAssets.filter((asset) => bodyReferencesAsset(bodyForQuick, asset.filename));
  const images: StoredQuickNoteContent["images"] = [];
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
  }

  // 纯文本镜像（小记预览/搜索/降级显示）：标题 + 已有 text_cache（与搜索同源）；正文本身原样。
  const plain = (() => { try { return notes.readNoteCaches(noteId).plain ?? lakeBodyToPlainText(sourceBody); } catch { return lakeBodyToPlainText(sourceBody); } })();
  const text = [title, plain].map((part) => part.trim()).filter(Boolean).join("\n");
  // 正文/标题/时间/大小限制照旧校验（4MB 正文上限在 normalizeQuickNoteContent 内）。
  const content = normalizeQuickNoteContent(text, bodyForQuick.trim() ? bodyForQuick : "", images);

  // ① 先登记小记（写正文 + 插行 + 资产目录整体搬走）；失败时本方法内部回滚，Lake 原稿未动。
  quickNotes.adoptMovedNoteAsQuickNote({
    id: quickNoteId,
    content,
    createdAt: times.createdAt,
    updatedAt: times.updatedAt,
    sourceAssetsDir,
  });
  // ② Lake 侧移除（行 + 正文 + 资产残留 + 历史快照 + 删除意图）；失败 ⇒ 把小记完整回滚（资产移回）。
  try {
    const { removedHistory } = notes.removeNoteForQuickNoteMove(noteId);
    return { quickNoteId, movedMediaCount: carried.length, removedHistoryCount: removedHistory };
  } catch (error) {
    try { quickNotes.rollbackAdoptedQuickNote(quickNoteId, sourceAssetsDir); } catch { /* best effort：最坏留一条可手删的小记，原稿仍在 */ }
    throw error;
  }
}
