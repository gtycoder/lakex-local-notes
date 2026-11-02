/**
 * 移动端 PDF 导入适配器 —— **MobileInkPad 手动导入**与**系统分享 → 自动导入**共用一份实现。
 *
 * 分层：
 *  · `importPdfPagesToAssets`：PDF 字节 → 原生 PdfRender 逐页渲染（cacheDir）→ 读字节 → bridge 上传，
 *    返回 `PdfImportOutcome`（不写正文；InkPad 编辑态拿它走可撤销提交）；
 *  · `importPdfIntoInkNote`：把 outcome 合进指定手写板正文并 `bridge.saveNote`（分享冷启动等「已有空文档」场景）；
 *  · `importSharedPdfAsInkNote`：分享编排（标题派生 → 默认笔记本 → createInk → 导入 → 失败 trash 回滚）。
 *
 * 不复制 `features/ink/pdfImport` 的编排（300 页截断/sourcePdf/逐页容错都在那边），这里只做移动端 I/O 适配。
 */
import { parseLocalAssetUrl } from "../../core/assetUrl";
import { createInkDoc, inkToBody, parseInkBody, type InkDoc } from "../../core/inkDoc";
import {
  INK_PDF_MAX_PAGES,
  importPdfPages,
  planPdfPageInsert,
  type PdfImportOutcome,
  type PdfImportRasterPage,
} from "../../features/ink/pdfImport";
import { bridge } from "../bridge";
import {
  cancelPdfRender,
  pdfRenderAvailable,
  readRenderedPdfFileBytes,
  renderPdfPages,
  type PdfRenderPage,
} from "../native/pdfRender";

export interface MobilePdfImportInput {
  noteId: string;
  bytes: Uint8Array;
  filename: string;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/**
 * 插件页尺寸 → 导入页尺寸（261102 T2 设备验收修复，纯函数便于单测）。
 * · width/height：**逻辑尺寸**（插件按 pt×96/72 返回，A4=794×1123，与桌面 793.33×1122.67 同口径）；
 * · pixelWidth/pixelHeight：**位图像素**（插件始终缩放到 maxWidth，如 1600×2264）；
 * · 旧 APK（无 pixel 字段）用 width/height 兜底 —— 不要「width 当 pixelWidth」。
 */
export function pdfPageSizes(page: Pick<PdfRenderPage, "width" | "height" | "pixelWidth" | "pixelHeight">): Pick<PdfImportRasterPage, "width" | "height" | "pixelWidth" | "pixelHeight"> {
  return {
    width: page.width,
    height: page.height,
    pixelWidth: page.pixelWidth ?? page.width,
    pixelHeight: page.pixelHeight ?? page.height,
  };
}

/**
 * PDF 字节 → 逐页资产上传（不写正文）。旧 APK / 浏览器无 PdfRender 插件时返回可见错误 outcome。
 * 300 页产品上限的「页边界 cancel」也在这一层（原生 progress 到 maxPages 时请求 cancel）。
 */
export async function importPdfPagesToAssets(input: MobilePdfImportInput): Promise<PdfImportOutcome> {
  if (!pdfRenderAvailable()) {
    return { pages: [], pageCount: 0, importedPageCount: 0, truncated: false, cancelled: false, errors: ["当前版本不支持 PDF 导入（需要更新 App）"] };
  }
  return importPdfPages(
    input.bytes,
    {
      savePdf: (payload) => bridge.uploadResource(payload, input.noteId),
      uploadPage: (payload) => bridge.uploadResource(payload, input.noteId),
      rasterize: async (rasterInput, options) => {
        if (input.signal?.aborted) return { pageCount: 0, pages: [], cancelled: true };
        const ref = parseLocalAssetUrl(rasterInput.pdfUrl);
        if (!ref || ref.space !== "note") throw new Error("PDF 资产地址无效");
        let userAborted = false;
        const onAbort = () => {
          userAborted = true;
          void cancelPdfRender();
        };
        input.signal?.addEventListener("abort", onAbort, { once: true });
        let limitStop = false;
        try {
          const result = await renderPdfPages(
            { noteId: ref.noteId, filename: ref.filename, maxWidth: 1600 },
            (progress) => {
              options.onProgress?.(progress.page, progress.pageCount);
              if (!userAborted && progress.page >= options.maxPages) {
                limitStop = true;
                void cancelPdfRender(); // 300 页上限：页边界停下，后面的页不再渲染
              }
            },
          );
          const rendered = limitStop ? result.pages.slice(0, options.maxPages) : result.pages;
          const pages: PdfImportRasterPage[] = [];
          for (const page of rendered) {
            const pageBytes = await readRenderedPdfFileBytes(page.file);
            pages.push({ page: page.page, ...pdfPageSizes(page), bytes: pageBytes });
          }
          return { pageCount: result.pageCount, pages, cancelled: userAborted };
        } finally {
          input.signal?.removeEventListener("abort", onAbort);
        }
      },
    },
    { fileName: input.filename, onProgress: input.onProgress, signal: input.signal },
  );
}

/**
 * 把 PDF 导入进**已存在**的手写板（分享冷启动建好的空文档）：合并页 + doc.sourcePdf 后 saveNote。
 * 返回 outcome（空页/取消时调用方自己决定回滚）。
 */
export async function importPdfIntoInkNote(input: MobilePdfImportInput): Promise<PdfImportOutcome> {
  const outcome = await importPdfPagesToAssets(input);
  if (outcome.cancelled || outcome.pages.length === 0) return outcome;
  const note = await bridge.readNote(input.noteId);
  if (!note) throw new Error("手写板文档不存在");
  const doc: InkDoc = parseInkBody(note.content) ?? createInkDoc();
  const plan = planPdfPageInsert(doc, outcome.pages, outcome.sourcePdf);
  if (plan) await bridge.saveNote(input.noteId, note.title, inkToBody(plan.next));
  return outcome;
}

/** 分享文件名 → 文档标题：「讲义.pdf」→「讲义」；空/只有扩展名 ⇒「导入的 PDF」。 */
export function sharedPdfTitle(filename: string): string {
  const name = (filename.split(/[\\/]/).pop() ?? "").trim();
  return name.replace(/\.pdf$/i, "").trim() || "导入的 PDF";
}

/** 分享 PDF 落哪个笔记本：优先 `notebook-personal`，否则第一个 type=notebook，否则 null（bridge 再兜底）。 */
export function sharedPdfNotebookId(treeNodes: ReadonlyArray<{ id: string; nodeType?: string }> | null | undefined): string | null {
  if (!treeNodes || treeNodes.length === 0) return null;
  const personal = treeNodes.find((node) => node.id === "notebook-personal");
  if (personal) return personal.id;
  return treeNodes.find((node) => node.nodeType === "notebook")?.id ?? null;
}

export interface SharedPdfImportDeps {
  resolveNotebookId: () => Promise<string | null>;
  createInk: (title: string, parentId: string | null) => Promise<{ id: string; parentId?: string | null }>;
  importIntoNote: (input: MobilePdfImportInput) => Promise<PdfImportOutcome>;
  trashNote: (id: string) => Promise<void>;
}

export interface SharedPdfImportResult {
  noteId: string;
  notebookId: string;
  title: string;
  /** PDF **真实页数**（未截断前；不是导入成功页数）。 */
  pageCount: number;
  /** 成功导入的页数（部分页上传失败时会小于 pageCount）。 */
  importedPageCount: number;
  /** true = 超过 300 页上限，只导入了前 importedPageCount 页。 */
  truncated: boolean;
  /** 逐页失败原因（形如「第 3 页：…」；空 = 全部成功）。 */
  errors: string[];
}

/** 失败原因去掉「第 N 页：」前缀并截断，供一句话 toast 使用。 */
function firstFailureReason(errors: readonly string[]): string {
  const raw = (errors[0] ?? "").replace(/^第\s*\d+\s*页[：:]\s*/, "").trim();
  if (!raw) return "未知原因";
  return raw.length > 80 ? raw.slice(0, 80) + "…" : raw;
}

/**
 * 分享 PDF 导入结果 → **一句话**可见提示（三态可组合；纯函数便于单测）。
 * · 基础：「已导入 N 页 PDF」；
 * · 截断：「PDF 共 M 页，仅导入前 N 页（上限 300 页）」；
 * · 部分失败：「N 页导入成功，K 页失败（第一页失败原因：…）」；
 * · 截断 + 部分失败：两段用「；」连成一句，**只弹一个 toast**。
 */
export function sharedPdfImportToast(result: Pick<SharedPdfImportResult, "pageCount" | "importedPageCount" | "truncated" | "errors">): string {
  const imported = Math.max(0, Math.floor(result.importedPageCount));
  const total = Math.max(imported, Math.floor(result.pageCount));
  const failed = Math.max(0, Math.floor(result.errors.length));
  const truncatedText = "PDF 共 " + total + " 页，仅导入前 " + imported + " 页（上限 " + INK_PDF_MAX_PAGES + " 页）";
  if (failed === 0) return result.truncated ? truncatedText : "已导入 " + imported + " 页 PDF";
  const failedText = imported + " 页导入成功，" + failed + " 页失败（第一页失败原因：" + firstFailureReason(result.errors) + "）";
  return result.truncated ? truncatedText + "；" + failedText : failedText;
}

function defaultDeps(): SharedPdfImportDeps {
  return {
    resolveNotebookId: async () => {
      const snapshot = await bridge.getHomeSnapshot();
      return sharedPdfNotebookId(snapshot.treeNodes as ReadonlyArray<{ id: string; nodeType?: string }>);
    },
    createInk: (title, parentId) => bridge.createInk(title, parentId),
    importIntoNote: importPdfIntoInkNote,
    trashNote: (id) => bridge.trashNote(id),
  };
}

/**
 * 系统分享 PDF 的完整编排：标题派生 → 默认笔记本 → createInk → 导入 → **失败时把刚建的空文档移入回收站**。
 * 失败抛 Error（消息直接给 toast）；成功返回新文档 id/notebookId（调用方 setRoute 打开）。
 */
export async function importSharedPdfAsInkNote(
  input: { bytes: Uint8Array; filename: string; onProgress?: (done: number, total: number) => void; signal?: AbortSignal },
  deps: SharedPdfImportDeps = defaultDeps(),
): Promise<SharedPdfImportResult> {
  const title = sharedPdfTitle(input.filename);
  const notebookId = await deps.resolveNotebookId();
  const note = await deps.createInk(title, notebookId);
  try {
    const outcome = await deps.importIntoNote({
      noteId: note.id,
      bytes: input.bytes,
      filename: input.filename,
      onProgress: input.onProgress,
      signal: input.signal,
    });
    if (outcome.cancelled) throw new Error("已取消 PDF 导入");
    if (outcome.pages.length === 0) throw new Error(outcome.errors.join("；") || "PDF 导入失败");
    return {
      noteId: note.id,
      notebookId: note.parentId ?? notebookId ?? "",
      title,
      pageCount: outcome.pageCount,
      importedPageCount: outcome.importedPageCount,
      truncated: outcome.truncated,
      errors: outcome.errors,
    };
  } catch (reason) {
    // 失败不留空文档：刚建的手写板直接移入回收站（trash 失败不掩盖原始错误）
    try { await deps.trashNote(note.id); } catch { /* 回滚失败只记原始错误 */ }
    throw reason instanceof Error ? reason : new Error(String(reason));
  }
}
