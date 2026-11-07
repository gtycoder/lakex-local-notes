/**
 * 261108 通用文件导入落盘（桌面专用）：Markdown / Word(HTML) / Excel/CSV(usheet)。
 *
 * 与 Markdown 专用批量（移动端分享仍用）共用目录分组、标题去重、失败软删与进度；
 * 放在独立模块里，避免 Word/HTML/表格导入代码进入移动端入口包（性能预算）。
 */
import {
  dirnameOfPath,
  errorMessage,
  folderSegmentsOf,
  GroupResolver,
  TitleLedger,
  titleFromMarkdownFileName,
  type MarkdownImportBatchResult,
  type MarkdownImportHost,
  type MarkdownImportItemResult,
  type MarkdownImportProgress,
} from "./markdownBatchImport";
import { parseUsheetBody, usheetToBody, type UsheetWorkbook } from "../../core/usheetDoc.js";

export type FileImportItem =
  | { kind: "markdown"; path: string; name: string; relativePath: string; markdown: string; supported?: boolean }
  | { kind: "docx"; path: string; name: string; relativePath: string; html: string; supported?: boolean }
  | { kind: "sheet"; path: string; name: string; relativePath: string; workbook: UsheetWorkbook; supported?: boolean };

export interface HtmlConvertFn {
  (input: {
    html: string;
    warnings?: string[];
    uploadDataImage: (image: { bytes: Uint8Array; mimeType: string; filename: string }) => Promise<string | null>;
  }): Promise<{ body: string; warnings: string[] }>;
}

export interface FileImportOptions {
  parentNotebookId: string;
  items: readonly FileImportItem[];
  host: MarkdownImportHost;
  convertMarkdown?: (input: {
    markdown: string;
    baseDir: string;
    assetUploader: (absolutePath: string) => Promise<string | null>;
  }) => Promise<{ body: string; warnings: string[] }>;
  convertHtml?: HtmlConvertFn;
  onProgress?: (progress: MarkdownImportProgress) => void;
  signal?: AbortSignal;
}

export async function createNotesFromImportBatch(options: FileImportOptions): Promise<MarkdownImportBatchResult> {
  const { parentNotebookId, items, host } = options;
  const results: MarkdownImportItemResult[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  const nodes = await host.listTreeNodes();
  const titles = new TitleLedger(nodes);
  const groups = new GroupResolver(host, nodes);
  const total = items.length;

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (options.signal?.aborted) {
      results.push({ path: item.path, ok: false, reason: "导入已取消" });
      continue;
    }
    if (item.supported === false) { skipped += 1; continue; }
    let noteId: string | null = null;
    try {
      const parentId = await groups.ensure(parentNotebookId, folderSegmentsOf(item.relativePath));
      const title = titles.next(parentId, titleFromMarkdownFileName(item.name));
      options.onProgress?.({ index: index + 1, total, path: item.path, title });

      let body = "";
      let convertedWarnings: string[] = [];
      if (item.kind === "sheet") {
        if (!host.createUsheetIn) throw new Error("当前平台暂不支持表格导入");
        const note = await host.createUsheetIn(parentId, title);
        noteId = note.id;
        body = usheetToBody(item.workbook);
        if (!parseUsheetBody(body)) throw new Error("表格转换产物无效");
      } else {
        const note = await host.createNoteIn(parentId, title);
        noteId = note.id;
        if (item.kind === "docx") {
          if (!options.convertHtml) throw new Error("当前平台暂不支持 Word 导入");
          const converted = await options.convertHtml({
            html: item.html,
            uploadDataImage: async (image) => {
              const uploaded = await host.uploadResource({ bytes: image.bytes, filename: image.filename }, note.id);
              return uploaded?.url ?? null;
            },
          });
          body = converted.body;
          convertedWarnings = converted.warnings;
        } else {
          if (!options.convertMarkdown) throw new Error("Markdown 转换器未配置");
          const converted = await options.convertMarkdown({
            markdown: item.markdown,
            baseDir: dirnameOfPath(item.path),
            assetUploader: async (absolutePath) => {
              const image = await host.readImportImage(absolutePath);
              const uploaded = await host.uploadResource({ bytes: image.bytes, filename: image.filename }, note.id);
              return uploaded?.url ?? null;
            },
          });
          body = converted.body;
          convertedWarnings = converted.warnings;
        }
        if (!body || !body.includes("data-lake-id")) {
          throw new Error("转换产物无效（缺少 data-lake-id）");
        }
      }
      await host.saveNote(noteId, title, body);
      results.push({ path: item.path, ok: true, noteId, ...(convertedWarnings.length > 0 ? { warnings: convertedWarnings } : {}) });
      for (const warning of convertedWarnings) warnings.push(title + "：" + warning);
    } catch (error) {
      const reason = errorMessage(error);
      if (noteId) {
        try { await host.deleteNote(noteId); } catch (cleanupError) {
          warnings.push("失败后移入回收站也失败：" + errorMessage(cleanupError));
        }
      }
      results.push({ path: item.path, ok: false, ...(noteId ? { noteId } : {}), reason });
      warnings.push((item.name || item.path) + " 导入失败：" + reason);
    }
  }

  const done = results.filter((result) => result.ok).length;
  const failed = results.length - done;
  return { ok: failed === 0, results, summary: { total, done, failed, skipped }, warnings };
}
