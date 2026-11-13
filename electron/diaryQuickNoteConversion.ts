import crypto from "node:crypto";
import fs from "node:fs";
import { mimeTypeForFilename } from "../src/core/assetNaming.js";
import { readImageDimensions } from "../src/core/imageUtils.js";
import { lakeBodyToPlainText } from "../src/core/lakeDocForm.js";
import { normalizeQuickNoteContent, type StoredQuickNoteContent } from "../src/core/quickNoteModel.js";
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
 * 261113 用户裁决：**卡片零剥离** —— 小记与日记是同一个内核的 Lake 文档，正文原样承载（画板/自定义块/
 * 公式等全部保留），不再有白名单/扫描/丢弃；`droppedKinds` 字段保留但**恒为空数组**（IPC 形状兼容）。
 * 原文之后软删进回收站（可恢复，原资产不动）。
 */
export interface ConvertDiaryToQuickNoteResult {
  quickNoteId: string;
  /** 未能搬运的卡片类型（去重；空 = 全部承载）。 */
  droppedKinds: string[];
  /** 实际搬到小记资产作用域的媒体数（图片 + 附件；0 = 本篇没有媒体）——渲染层提示文案据此说「含图片/附件」。 */
  carriedMediaCount: number;
}

/**
 * 资产文件名在正文里的**双形态**（参考 rewriteQuickNoteAssetScope）：
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
  // 多形态：原样 / 单编码 / 双编码（卡片 value 是 encodeURIComponent(JSON)，内核可能先编码过 URL），
  // 以及把文件名先百分号解码后再做同样三种编码（历史中文/空格名在 URL 里通常已是编码态）。
  const bases = [filename, ...decodeChain(filename)];
  const forms = new Set<string>();
  for (const base of bases) for (let depth = 0; depth <= 2; depth += 1) forms.add(encodeDepth(base, depth));
  return [...forms];
}

function bodyReferencesAsset(body: string, filename: string): boolean {
  return assetReferenceForms(filename).some((form) => body.includes(form));
}


function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 正文里引用到本笔记作用域下的资产文件名：作用域同样双形态（原样 / URL-encoded）；
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
  // 261112 task-104（F-04）：只允许「日记空间里的条目」——否则 webApi/自动化可对任意普通文档调用，
  // 成功后把原文软删进回收站（从知识库树里消失），超出产品语义。
  if (!notes.diaryNotebookOfNote(noteId)) {
    throw new AppError("InvalidInput", "只能把日记条目转为小记（该文档不在日记空间中）");
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
  // 作用域改写覆盖「原样 / 单编码 / 双编码」三种形态（卡片 value 常是 encodeURIComponent(JSON)，
  // 若内核把 URL 里文件名也编码过，就会多一层转义；只改单层会留下旧 scope）。
  let rewriteBody = sourceBody;
  for (let depth = 0; depth <= 2; depth += 1) {
    rewriteBody = rewriteBody.split(encodeDepth(`/${noteId}/`, depth)).join(encodeDepth(`/quick-notes/${quickNoteId}/`, depth));
  }
  // 261113：零剥离 —— 正文原样进小记（画板/自定义块/公式等一并保留）。
  const bodyForQuick = rewriteBody;
  const carried = sourceAssets.filter((asset) => bodyReferencesAsset(bodyForQuick, asset.filename));
  // 兜底：改写后仍残留原日记作用域（原样/单/双编码任一形态）= 有引用没被识别（安全失败，不产半成品）。
  const residual = [0, 1, 2].map((depth) => encodeDepth(`/${noteId}/`, depth)).find((scope) => bodyForQuick.includes(scope));
  if (residual !== undefined) {
    throw new AppError("InvalidInput", "正文仍引用未搬运的日记资源作用域，转换已中止（未产生小记）");
  }
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
  const content = normalizeQuickNoteContent(text, bodyForQuick.trim() ? bodyForQuick : "", images);

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
  return { quickNoteId, droppedKinds: [] as string[], carriedMediaCount: carried.length };
}
