/**
 * 261106 Markdown 导入：主进程侧**文件发现 / 读取**（纯 fs，无 Electron 依赖 ⇒ 可直接单测）。
 *
 * 职责边界：
 * - 只负责「扫出 .md/.markdown 文件、stat 大小、读 UTF-8 正文（带 20MB 上限）、读导入图片字节」；
 * - **不**做 md → lake 转换（那是 renderer 侧内核管线，见 src/features/import/markdownImportPipeline.ts）；
 * - 不做落盘（建笔记/分组由 renderer 经既有 IPC 完成）。
 *
 * 约定（与 src/lib/types.ts 的 MarkdownPickedFileShape 一一对应）：
 * - 不支持的文件也返回（supported:false），由调用方计入「跳过数」——用户全选目录时不静默消失；
 * - 用户取消 = 空数组（不抛）；单文件读失败只在该条上给 error，不影响整批；
 * - 目录递归跳过隐藏目录 / node_modules / .git，并限制文件数与正文总量，防止一次导入拖垮进程。
 */
import fs from "node:fs";
import path from "node:path";

/** 单文件正文上限（与渲染层 importMarkdown 同一口径；超限不读正文，标记 tooLarge）。 */
export const MAX_MARKDOWN_IMPORT_BYTES = 20 * 1024 * 1024;
/** 一次「选择文件夹」最多返回的文件数（超出截断并标记 truncated）。 */
export const MAX_MARKDOWN_FOLDER_FILES = 500;
/** 一次目录导入读取的正文总量上限：超过后不再读取（该条给 error，避免主进程内存峰值）。 */
export const MAX_MARKDOWN_FOLDER_TEXT_BYTES = 64 * 1024 * 1024;
/** 目录递归深度上限（防异常深目录/软链环）。 */
export const MAX_MARKDOWN_SCAN_DEPTH = 20;
/** 单张导入图片上限。 */
export const MAX_IMPORT_IMAGE_BYTES = 20 * 1024 * 1024;

export const MARKDOWN_EXTENSIONS = [".md", ".markdown"] as const;
/** 递归时整体跳过的目录名（隐藏目录由 startsWith(".") 统一跳过）。 */
const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "release"]);

/** 该文件名是否是 Markdown（大小写不敏感；只认 .md / .markdown）。 */
export function isSupportedMarkdownFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase();
  return (MARKDOWN_EXTENSIONS as readonly string[]).includes(ext);
}

export interface MarkdownPickedFile {
  /** 绝对路径。 */
  path: string;
  /** 文件名（含扩展名）。 */
  name: string;
  /** 相对所选目录的路径（多选文件时 = 文件名）；分隔符统一为 "/"。 */
  relativePath: string;
  /** 字节数（stat 失败 = 0）。 */
  size: number;
  /** .md / .markdown。 */
  supported: boolean;
  /** > MAX_MARKDOWN_IMPORT_BYTES：不读正文（调用方按跳过处理）。 */
  tooLarge?: boolean;
  /** UTF-8 正文（去 BOM）；tooLarge / 读失败时缺省。 */
  text?: string;
  /** 读失败的可读原因（文件消失 / 无权限 / 非文本等）。 */
  error?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 描述单个文件：stat 大小 + （可选）读正文。
 * read = false 用于只要元数据的场景（如仅统计）。
 */
export function describeMarkdownFile(absPath: string, options: { readText?: boolean; textBudget?: number } = {}): MarkdownPickedFile {
  const readText = options.readText !== false;
  const name = path.basename(absPath);
  const entry: MarkdownPickedFile = {
    path: absPath,
    name,
    relativePath: name,
    size: 0,
    supported: isSupportedMarkdownFile(name),
  };
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch (error) {
    entry.error = "无法读取文件：" + errorMessage(error);
    return entry;
  }
  if (!stat.isFile()) {
    entry.error = "不是普通文件";
    return entry;
  }
  entry.size = stat.size;
  if (!readText) return entry;
  if (stat.size > MAX_MARKDOWN_IMPORT_BYTES) {
    entry.tooLarge = true;
    return entry;
  }
  if (typeof options.textBudget === "number" && stat.size > options.textBudget) {
    entry.error = "本次批量导入的正文总量已达上限，该文件未读取";
    return entry;
  }
  try {
    entry.text = fs.readFileSync(absPath, "utf8").replace(/^\uFEFF/, "");
  } catch (error) {
    entry.error = "读取正文失败：" + errorMessage(error);
  }
  return entry;
}

export interface MarkdownFolderScan {
  files: MarkdownPickedFile[];
  /** 命中 MAX_MARKDOWN_FOLDER_FILES 上限（后面还有文件未列出）。 */
  truncated: boolean;
}

/**
 * 递归扫描目录：只收 .md/.markdown（其它文件忽略，不算 skipped —— 目录里通常有大量非 md 文件），
 * 保留子目录结构（relativePath）。按名字排序保证结果稳定；隐藏目录 / node_modules / .git 跳过。
 */
export function listMarkdownFilesInDir(root: string, options: { maxFiles?: number; maxTextBytes?: number; readText?: boolean } = {}): MarkdownFolderScan {
  const maxFiles = Math.max(1, options.maxFiles ?? MAX_MARKDOWN_FOLDER_FILES);
  const maxTextBytes = options.maxTextBytes ?? MAX_MARKDOWN_FOLDER_TEXT_BYTES;
  const readText = options.readText !== false;
  const files: MarkdownPickedFile[] = [];
  let truncated = false;
  let textBudget = maxTextBytes;
  /** 先收集路径（按目录顺序稳定排序），再逐个 stat/read，避免在递归中长时间持有句柄。 */
  const paths: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (truncated || depth > MAX_MARKDOWN_SCAN_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 读不到的目录跳过（权限/软链断裂），不阻断整批
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (truncated) return;
      if (entry.name.startsWith(".")) continue; // 隐藏文件/目录（.git/.obsidian/…）
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(abs, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue; // 软链/设备文件等一律跳过
      if (!isSupportedMarkdownFile(entry.name)) continue;
      if (paths.length >= maxFiles) { truncated = true; return; }
      paths.push(abs);
    }
  };
  walk(root, 0);
  for (const abs of paths) {
    const entry = describeMarkdownFile(abs, { readText, textBudget });
    if (entry.text !== undefined) textBudget -= entry.size;
    entry.relativePath = path.relative(root, abs).split(path.sep).join("/");
    files.push(entry);
  }
  return { files, truncated };
}

/** 导入图片可接受的 MIME（按扩展名 + 魔数双重校验）。 */
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export interface ImportImageBytes {
  bytes: Uint8Array;
  mimeType: string;
  /** 原始文件名（uploadResource 的展示名）。 */
  filename: string;
}

/** 魔数校验：扩展名可伪造，字节头不会（只认我们要支持的 5 种）。 */
function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

/**
 * 读一张本地图片，供渲染层物化为文档资产（Markdown 导入用）。
 * 校验：扩展名白名单 + 大小上限 + **魔数**（防扩展名欺骗读到任意文件当作图片）。
 */
export function readImportImage(absPath: string): ImportImageBytes {
  if (typeof absPath !== "string" || !absPath) throw new Error("图片路径无效");
  const ext = path.extname(absPath).toLowerCase();
  const expected = IMAGE_MIME_BY_EXT[ext];
  if (!expected) throw new Error("不支持的图片类型：" + ext + "（仅 png/jpg/jpeg/gif/webp）");
  const stat = fs.statSync(absPath);
  if (!stat.isFile()) throw new Error("不是文件：" + absPath);
  if (stat.size > MAX_IMPORT_IMAGE_BYTES) throw new Error("图片超过 " + Math.round(MAX_IMPORT_IMAGE_BYTES / 1024 / 1024) + "MB 上限");
  if (stat.size === 0) throw new Error("图片文件为空");
  const buffer = fs.readFileSync(absPath);
  const bytes = new Uint8Array(buffer);
  const sniffed = sniffImageMime(bytes);
  if (!sniffed) throw new Error("文件内容不是有效图片（魔数校验失败）");
  if (sniffed !== expected) throw new Error("图片扩展名与内容不一致：" + ext + " ≠ " + sniffed);
  return { bytes, mimeType: sniffed, filename: path.basename(absPath) };
}
