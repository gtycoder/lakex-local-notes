import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type ImportedNoteAsset, Store } from "./store.js";
import { type QuickNoteDocument, QuickNotesStore } from "./quickNotes.js";
import { emptyLakeBody } from "../src/core/lakeDocForm.js";
import { rewriteQuickNoteAssetScope } from "../src/core/quickNoteModel.js";

/**
 * 小记 → Lake 的单向映射（v2：**搬运**而不是序列化）。
 *
 * v2 起小记正文本身就是内核产出的 Lake 正文（`.qnote.body`），转换只需要：
 *   ① 把小记资源作用域 `/quick-notes/<quickNoteId>/` 改写成目标文档作用域 `/<targetNoteId>/`
 *      （图片文件由既有 journal 流程复制到 `note-assets/<targetNoteId>/`）；
 *   ② 其它什么都不用做 —— 段落/列表/待办/引用/加粗/代码块/图片卡片都是内核自己的形态。
 *
 * 这消掉了旧实现（手拼段落 + 手拼图片卡片）带来的「内核容忍形态」风险：产物字段与内核自产一致。
 * 写入形态约定见 `docs/LAKE-CONTENT-WRITING.md`（媒体必须走卡片容器，绝不能裸 `<img>`）。
 */
export function quickNoteToLakeContent(targetNoteId: string, source: QuickNoteDocument): string {
  const body = rewriteQuickNoteAssetScope(
    source.content.body,
    `/quick-notes/${source.id}/`,
    `/${targetNoteId}/`,
  );
  return body.trim() ? body : emptyLakeBody(targetNoteId);
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
