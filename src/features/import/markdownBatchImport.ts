/**
 * 261106 Markdown 批量导入**落盘编排**（renderer 侧；桌面与移动端共用）。
 *
 * 流程（每篇）：建文档 → 物化图片（uploadResource）→ 走共享管线转 lake → saveNote。
 * 结构：目标笔记本下按 md 的目录层级建**分组**（同名复用，不新建重复）；文件名 = 标题；
 * 同名冲突追加「 (2)」「 (3)」…（按同父目录内的**现有标题**与本次已用标题一起判）。
 *
 * 失败处理（红线「删除 = 移入回收站」）：任一步失败 ⇒ 把这篇半成品 **软删进回收站**（host.deleteNote），
 * 计入 failed，绝不物理删除；下一篇继续（单文件失败不影响其它）。
 *
 * 平台差异全在注入的 host（桌面 = src/lib/native.ts 的 IPC；移动端由 task-86 注入自己的 bridge）。
 */
import type { TreeNode } from "../../lib/types";

/** 单篇 Markdown 输入（由主进程 picker 读取；relativePath 保留子目录）。 */
export interface MarkdownImportItem {
  /** 绝对路径（图片相对解析用）。 */
  path: string;
  /** 文件名（含扩展名）。 */
  name: string;
  /** 相对所选目录的路径（"a/b.md"；多选文件 = 文件名）。 */
  relativePath: string;
  /** 已读取的 UTF-8 正文。 */
  markdown: string;
  /** 不支持的扩展名（调用方标记；true 时直接计入 skipped）。 */
  supported?: boolean;
}

export interface MarkdownImportItemResult {
  path: string;
  ok: boolean;
  noteId?: string;
  /** 失败原因（可读，中文）。 */
  reason?: string;
  /** 该篇的转换告警（图片降级/frontmatter 等）。 */
  warnings?: string[];
}

export interface MarkdownImportSummary {
  total: number;
  done: number;
  failed: number;
  /** 不支持的文件（直接跳过，不建笔记）。 */
  skipped: number;
}

export interface MarkdownImportBatchResult {
  ok: boolean;
  results: MarkdownImportItemResult[];
  summary: MarkdownImportSummary;
  warnings: string[];
}

/** 转换函数（默认 = markdownImportPipeline.convertMarkdownToLake；测试可注入 stub）。 */
export type MarkdownConvertFn = (input: {
  markdown: string;
  baseDir: string;
  assetUploader: (absolutePath: string) => Promise<string | null>;
}) => Promise<{ body: string; warnings: string[] }>;

/** 平台端口（桌面默认实现见 createDesktopMarkdownImportHost）。 */
export interface MarkdownImportHost {
  listTreeNodes(): Promise<ReadonlyArray<Pick<TreeNode, "id" | "parentId" | "nodeType" | "title">>>;
  createGroup(parentId: string, title: string): Promise<{ id: string }>;
  createNoteIn(parentId: string | null, title: string): Promise<{ id: string }>;
  /** 导入 xlsx/csv 时创建 usheet；缺省 = 该平台暂不支持表格导入。 */
  createUsheetIn?(parentId: string | null, title: string): Promise<{ id: string }>;
  uploadResource(input: { bytes: Uint8Array; filename: string }, noteId: string): Promise<{ url: string }>;
  saveNote(id: string, title: string, body: string): Promise<unknown>;
  /** 失败回滚：软删 = 移入回收站（**绝不**物理删除）。 */
  deleteNote(id: string): Promise<void>;
  readImportImage(absolutePath: string): Promise<{ bytes: Uint8Array; mimeType: string; filename: string }>;
}

export interface MarkdownImportProgress {
  index: number;
  total: number;
  path: string;
  title: string;
}

export interface MarkdownImportOptions {
  /** 目标笔记本 id（新文档/分组都建在它下面）。 */
  parentNotebookId: string;
  items: readonly MarkdownImportItem[];
  host: MarkdownImportHost;
  convert: MarkdownConvertFn;
  onProgress?: (progress: MarkdownImportProgress) => void;
  signal?: AbortSignal;
}

/** 文件名 → 标题（去扩展名；空白归一；保持用户可见的原名）。 */
export function titleFromMarkdownFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, "").trim();
  return base || name.trim() || "未命名文档";
}

/** 目录层级（"a/b/c.md" → ["a","b"]；"c.md" → []）。 */
export function folderSegmentsOf(relativePath: string): string[] {
  const parts = relativePath.replace(/\\/g, "/").split("/").filter(Boolean);
  parts.pop(); // 去掉文件名
  return parts;
}

/** 同名去重：base → base (2) → base (3)…（只在该父目录的名称集合里判重）。 */
export class TitleLedger {
  private readonly used = new Map<string, Set<string>>();
  constructor(nodes: ReadonlyArray<Pick<TreeNode, "id" | "parentId" | "nodeType" | "title">>) {
    for (const node of nodes) {
      if (node.nodeType !== "note") continue;
      this.add(node.parentId, node.title);
    }
  }
  private bucket(parentId: string | null): Set<string> {
    const key = parentId ?? "";
    let set = this.used.get(key);
    if (!set) { set = new Set<string>(); this.used.set(key, set); }
    return set;
  }
  private add(parentId: string | null, title: string): void {
    this.bucket(parentId).add(title);
  }
  next(parentId: string | null, base: string): string {
    const set = this.bucket(parentId);
    if (!set.has(base)) { set.add(base); return base; }
    for (let index = 2; index < 10_000; index += 1) {
      const candidate = base + " (" + index + ")";
      if (!set.has(candidate)) { set.add(candidate); return candidate; }
    }
    const fallback = base + " (" + Date.now() + ")";
    set.add(fallback);
    return fallback;
  }
}

/** 分组解析：按 (父 id, 标题) 复用已有分组，缺的逐级创建。 */
export class GroupResolver {
  private readonly byKey = new Map<string, string>();
  constructor(private readonly host: MarkdownImportHost, nodes: ReadonlyArray<Pick<TreeNode, "id" | "parentId" | "nodeType" | "title">>) {
    for (const node of nodes) {
      if (node.nodeType !== "group") continue;
      this.byKey.set(this.key(node.parentId, node.title), node.id);
    }
  }
  private key(parentId: string | null, title: string): string {
    return (parentId ?? "") + "\u0000" + title;
  }
  async ensure(parentId: string, segments: readonly string[]): Promise<string> {
    let current = parentId;
    for (const segment of segments) {
      const key = this.key(current, segment);
      const existing = this.byKey.get(key);
      if (existing) { current = existing; continue; }
      const created = await this.host.createGroup(current, segment);
      this.byKey.set(key, created.id);
      current = created.id;
    }
    return current;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 批量导入：逐篇建文档并落盘；失败的那篇移入回收站并计入 failed。
 * **串行**执行（转换本身也是串行队列；这里不并发建库，避免写域抖动）。
 */
export async function createNotesFromMarkdownBatch(options: MarkdownImportOptions): Promise<MarkdownImportBatchResult> {
  const { parentNotebookId, items, host, convert } = options;
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
    if (item.supported === false) {
      skipped += 1;
      continue;
    }
    let noteId: string | null = null;
    try {
      const parentId = await groups.ensure(parentNotebookId, folderSegmentsOf(item.relativePath));
      const title = titles.next(parentId, titleFromMarkdownFileName(item.name));
      options.onProgress?.({ index: index + 1, total, path: item.path, title });
      const note = await host.createNoteIn(parentId, title);
      noteId = note.id;
      // 图片物化：读字节 → uploadResource 到本篇资产目录 → 用返回的 canonical URL 重写 md
      const assetUploader = async (absolutePath: string): Promise<string | null> => {
        const image = await host.readImportImage(absolutePath);
        const uploaded = await host.uploadResource({ bytes: image.bytes, filename: image.filename }, note.id);
        return uploaded?.url ?? null;
      };
      const converted = await convert({ markdown: item.markdown, baseDir: dirnameOfPath(item.path), assetUploader });
      if (!converted.body || !converted.body.includes("data-lake-id")) {
        throw new Error("转换产物无效（缺少 data-lake-id）");
      }
      await host.saveNote(note.id, title, converted.body);
      results.push({ path: item.path, ok: true, noteId: note.id, ...(converted.warnings.length > 0 ? { warnings: converted.warnings } : {}) });
      for (const warning of converted.warnings) warnings.push(title + "：" + warning);
    } catch (error) {
      const reason = errorMessage(error);
      // 红线：删除 = 移入回收站（软删），绝不物理删除
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
  return {
    ok: failed === 0,
    results,
    summary: { total, done, failed, skipped },
    warnings,
  };
}

/** 渲染层没有 node:path：取绝对路径的目录部分（Windows 反斜杠也认）。 */
export function dirnameOfPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index < 0) return "";
  return normalized.slice(0, index) || "/";
}
