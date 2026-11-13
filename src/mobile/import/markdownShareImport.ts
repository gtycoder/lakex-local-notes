/**
 * 分享 Markdown → 文档 的导入编排（261106 task-86）。
 *
 * 流程（与桌面共享同一份 md→lake 管线）：
 *   共享内容(inbox 临时文件) → 读 UTF-8 文本 → convertMarkdownToLake（注入移动端内核创建器）
 *   → 在**默认笔记本**下 createNote + saveNote(body)。
 *
 * 失败/半成品约定：
 * - 单文件失败只影响该文件（逐条汇总），其它文件继续；
 * - createNote 之后 saveNote 失败 ⇒ 立刻把刚建的空文档移入回收站（软删回滚），**不留半成品**；
 * - 本地图片路径在移动端分享场景不可达 ⇒ 不传 assetUploader，管线会把图片降级为链接并写 warnings（导入后提示数量）。
 */
import {
  convertMarkdownToLake,
  type MarkdownKernelHandle,
  type MarkdownKernelLike,
  type MarkdownConvertResult,
} from "../../features/import/markdownImportPipeline";
import { getNativeErrorMessage } from "../../lib/nativeErrors";
import type { SharedMarkdownFile } from "../native/sharedContent";
import { readSharedContentText } from "../native/sharedContent";
import { bridge } from "../bridge";

/** 单个共享 Markdown 的正文上限（与管线 MAX_MARKDOWN_IMPORT_BYTES 同口径）。 */
export const MARKDOWN_SHARE_MAX_BYTES = 20 * 1024 * 1024;

/** 从文件名/显示名推导文档标题（去掉目录与 .md 后缀）。 */
export function markdownTitleOf(filename: string, displayName?: string): string {
  const stripName = (raw: string): string => {
    const base = raw.split(/[\\/]/).pop() ?? raw;
    return base.replace(/\.(md|markdown)$/i, "").trim();
  };
  const fromDisplay = stripName((displayName ?? "").trim());
  if (fromDisplay) return fromDisplay;
  return stripName(filename) || "未命名文档";
}

/**
 * 移动端内核创建器：**动态 import** 内核（不进移动端入口包；管线负责创建容器/销毁）。
 * 返回结构型 kernel（setDocument/getDocument/on/off）给共享管线用。
 */
export async function createMobileMarkdownKernel(container: HTMLElement): Promise<MarkdownKernelHandle> {
  const { createLakeDocument, destroyLakeEditor } = await import("../../features/editor/lakeRuntime");
  const editor = createLakeDocument(container, "editor", () => { /* 导入期不需要脏回调 */ }, false, "markdown-import");
  const kernel: MarkdownKernelLike = {
    setDocument: (type: string, content: string) => editor.setDocument(type as "text/lake", content),
    getDocument: (type: string) => editor.getDocument(type as "text/lake" | "text/markdown" | "text/plain"),
    on: (event: string, listener: () => void) => editor.on(event, listener),
    off: (event: string, listener: () => void) => editor.off?.(event, listener),
    renderer: editor.renderer,
    // dispose 已统一走 destroyLakeEditor；这里保持空实现，避免二次销毁。
    destroy: () => undefined,
  };
  return { kernel, dispose: () => destroyLakeEditor(editor) };
}

export interface MarkdownShareDeps {
  readText?: (filename: string) => Promise<string | null>;
  convert?: (markdown: string) => Promise<MarkdownConvertResult>;
  createNote?: (title: string, notebookId: string) => Promise<{ id: string }>;
  saveNote?: (id: string, title: string, body: string, notebookId: string) => Promise<void>;
  trashNote?: (id: string) => Promise<void>;
}

export interface MarkdownShareImportInput {
  files: readonly SharedMarkdownFile[];
  /** 目标笔记本（默认笔记本；调用方已确保存在）。 */
  notebookId: string;
  /** 进度回调（i 从 1 开始；用于「正在导入 N/M」toast）。 */
  onProgress?: (index: number, total: number, file: SharedMarkdownFile) => void;
  deps?: MarkdownShareDeps;
}

export interface MarkdownShareImportSummary {
  imported: Array<{ filename: string; noteId: string; title: string }>;
  failed: Array<{ filename: string; reason: string }>;
  /** 降级/丢弃类告警（图片不可达、frontmatter 丢弃…），按「标题: 原因」聚合。 */
  warnings: string[];
}

/** 逐条导入共享的 Markdown（串行；每条的失败互不影响）。 */
export async function importSharedMarkdown(input: MarkdownShareImportInput): Promise<MarkdownShareImportSummary> {
  const deps: Required<MarkdownShareDeps> = {
    readText: input.deps?.readText ?? ((filename) => readSharedContentText(filename)),
    convert: input.deps?.convert ?? ((markdown) => convertMarkdownToLake({ markdown, createKernel: createMobileMarkdownKernel })),
    createNote: input.deps?.createNote ?? (async (title, notebookId) => bridge.createNote(title, notebookId)),
    saveNote: input.deps?.saveNote ?? (async (id, title, body, notebookId) => bridge.saveNote(id, title, body, notebookId)),
    trashNote: input.deps?.trashNote ?? (async (id) => { await bridge.trashNote(id); }),
  };
  const summary: MarkdownShareImportSummary = { imported: [], failed: [], warnings: [] };
  const total = input.files.length;
  for (let index = 0; index < total; index += 1) {
    const file = input.files[index];
    input.onProgress?.(index + 1, total, file);
    const title = markdownTitleOf(file.filename, file.displayName);
    let noteId: string | null = null;
    try {
      const text = await deps.readText(file.filename);
      if (text === null) {
        summary.failed.push({ filename: file.filename, reason: "读取分享文件失败（文件已保留，可重试）" });
        continue;
      }
      if (text.length > MARKDOWN_SHARE_MAX_BYTES) {
        summary.failed.push({ filename: file.filename, reason: "Markdown 超过 20MB 上限" });
        continue;
      }
      const converted = await deps.convert(text);
      const created = await deps.createNote(title, input.notebookId);
      noteId = created.id;
      await deps.saveNote(created.id, title, converted.body, input.notebookId);
      for (const warning of converted.warnings) summary.warnings.push(title + ": " + warning);
      summary.imported.push({ filename: file.filename, noteId: created.id, title });
    } catch (error) {
      // 已建文档 ⇒ 软删回滚，不留半成品（失败文件本身在 shared-inbox 保留可重试）。
      if (noteId) {
        try { await deps.trashNote(noteId); } catch { /* 回滚失败只记在 reason 里 */ }
      }
      const reason = error instanceof Error ? error.message : getNativeErrorMessage(error);
      summary.failed.push({ filename: file.filename, reason: reason || "导入失败" });
    }
  }
  return summary;
}
