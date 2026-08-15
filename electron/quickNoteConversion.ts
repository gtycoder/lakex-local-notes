import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type ImportedNoteAsset, Store } from "./store.js";
import { type QuickNoteDocument, QuickNotesStore } from "./quickNotes.js";
import { ASSET_PORT } from "./assetServer.js";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function lakeId(prefix = "u"): string { return `${prefix}${crypto.randomBytes(5).toString("hex")}`; }

/**
 * 小记 V1 → Lake 的单向映射。
 * V1 只有纯文本与图片：每个物理换行保留为独立普通段落（空行保留为空段落），每张图片生成一张
 * Lake inline image card。这里是唯一允许了解 Lake 内部 image card 序列化的隔离模块。
 */
export function quickNoteToLakeContent(targetNoteId: string, source: QuickNoteDocument): string {
  const blocks: string[] = [];
  if (source.content.text) {
    // 每个物理换行都落为独立 Lake 段落，而不是同一段中的 <br>。这样用户在
    // 转换后应用 Lake 的有序/无序列表时，每一行都会成为单独列表项，符合编辑器语义。
    for (const line of source.content.text.split(/\r?\n/)) {
      const paragraphId = lakeId();
      if (line) {
        const textId = lakeId();
        blocks.push(`<p data-lake-id="${paragraphId}" id="${paragraphId}" class="ne-p"><span data-lake-id="${textId}" id="${textId}">${escapeHtml(line)}</span></p>`);
      } else {
        blocks.push(`<p data-lake-id="${paragraphId}" id="${paragraphId}" class="ne-p"><br /></p>`);
      }
    }
  }
  for (const image of source.content.images) {
    const cardId = lakeId();
    const paragraphId = lakeId();
    const sourceUrl = `http://127.0.0.1:${ASSET_PORT}/${targetNoteId}/${image.filename}`;
    const cardValue = {
      src: sourceUrl,
      taskId: lakeId(),
      clientId: targetNoteId,
      originalType: "url",
      linkTarget: "_blank",
      name: image.filename,
      size: image.size,
      from: "quick-note",
      originWidth: image.width ?? undefined,
      originHeight: image.height ?? undefined,
      ratio: 1,
      status: "done",
      style: "none",
      showTitle: false,
      title: "",
      rotation: 0,
      crop: [0, 0, 1, 1],
      id: cardId,
      margin: { top: true, bottom: true },
    };
    blocks.push(`<p data-lake-id="${paragraphId}" id="${paragraphId}" class="ne-p"><card type="inline" name="image" value="data:${encodeURIComponent(JSON.stringify(cardValue))}"></card></p>`);
  }
  return blocks.join("") || `<p id="${targetNoteId}-body" class="ne-p"><br></p>`;
}

function titleForQuickNote(source: QuickNoteDocument): string {
  // 小记不隐式把首行升级为正式标题；转入 Lake 后由用户在正式编辑器中补充主题。
  // 不用 locale 字符串，避免不同系统显示成 2026/8/4、含秒数或使用不同分隔符。
  const date = new Date(source.createdAt);
  const pad = (value: number) => String(value).padStart(2, "0");
  const formatted = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `未命名文档 · ${formatted}`;
}

/**
 * 两个 SQLite 的原子性边界由 journal 跨越：
 * 1) 小记库 prepared；2) 正式库创建+校验；3) journal target_created；4) 删除源小记，
 * tombstone 先保持 ready_to_sync=0；5) 正式 Lake 成功上传后才放行小记 tombstone。
 */
export function convertQuickNoteToLake(quickNotes: QuickNotesStore, notes: Store, quickNoteId: string, notebookId: string) {
  const targetNoteId = crypto.randomUUID();
  const source = quickNotes.beginConversion(quickNoteId, targetNoteId, notebookId);
  const assets: ImportedNoteAsset[] = source.content.images.map((image) => {
    const sourcePath = path.join(quickNotes.quickNoteAssetsPathFor(source.id), image.filename);
    if (!fs.existsSync(sourcePath)) throw new Error(`小记图片不存在: ${image.filename}`);
    return { filename: image.filename, sourcePath };
  });
  try {
    const target = notes.createNoteInAtTopWithContent(notebookId, titleForQuickNote(source), quickNoteToLakeContent(targetNoteId, source), assets, targetNoteId);
    // 真实读取文件与元数据，确认目标并非仅“函数未抛错”。
    notes.readNote(target.id);
    quickNotes.markConversionTargetCreated(source.id);
    quickNotes.finalizeConversion(source.id);
    return target;
  } catch (error) {
    // prepared journal 不立即删除；下一次启动据此判断目标是否已创建，并继续或清理残留。
    throw error;
  }
}
