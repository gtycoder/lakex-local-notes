/**
 * 261106 Markdown 导入：主进程侧**文件发现 / 读取**（纯 fs，无 Electron 依赖 ⇒ 可直接单测）。
 *
 * 职责边界：
 * - 只负责「描述一个 .md/.markdown 文件（stat 大小 + 读 UTF-8 正文，带 20MB 上限）、读导入图片字节」；
 *   （261106 task-91：目录递归扫描随「文件夹导入」入口一起移除）
 * - **不**做 md → lake 转换（那是 renderer 侧内核管线，见 src/features/import/markdownImportPipeline.ts）；
 * - 不做落盘（建笔记/分组由 renderer 经既有 IPC 完成）。
 *
 * 约定（与 src/lib/types.ts 的 MarkdownPickedFileShape 一一对应）：
 * - 不支持的文件也返回（supported:false），由调用方计入「跳过数」——用户全选时不能静默消失；
 * - 用户取消 = 空数组（不抛）；单文件读失败只在该条上给 error，不影响整批。
 */
import fs from "node:fs";
import path from "node:path";

/** 单文件正文上限（与渲染层 importMarkdown 同一口径；超限不读正文，标记 tooLarge）。 */
export const MAX_MARKDOWN_IMPORT_BYTES = 20 * 1024 * 1024;
/** 单张导入图片上限。 */
export const MAX_IMPORT_IMAGE_BYTES = 20 * 1024 * 1024;

export const MARKDOWN_EXTENSIONS = [".md", ".markdown"] as const;

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
  try {
    entry.text = fs.readFileSync(absPath, "utf8").replace(/^\uFEFF/, "");
  } catch (error) {
    entry.error = "读取正文失败：" + errorMessage(error);
  }
  return entry;
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