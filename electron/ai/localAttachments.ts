/**
 * 本机文件附件（261116 第四稿）· 主进程侧最小注册表。
 *
 * 安全边界：**绝对路径与字节只存在主进程**。
 * - 渲染层通过 Electron dialog（ipc/registerAiWriting）选文件，只拿到 { token, name, size, mimeType }；
 * - token 是本进程内存里的随机不透明 id（Map token → 绝对路径），发送时 resolver 按 token 读；
 * - 应用重启后旧 token 自然失效 ⇒ 明确报「附件已失效，请重新选择」（历史仍按 name 展示）。
 *
 * 类型判据（纯扩展名表，不嗅探内容）：
 * - image  → 主进程读字节 → image_url data URL（体积/格式护栏在 resolver/aiImages）；
 * - text   → 读文本 → 带文件名的 text 块（体积/字符上限在 resolver 兜底）；
 * - unsupported（PDF/二进制/未知）→ 发送时明确拒绝（Phase 2 再支持 PDF）。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import type { AiLocalFileRef } from "../../src/core/aiProviders.js";
import { extOf, mimeTypeForFilename } from "../../src/core/assetNaming.js";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "heic", "heif"]);
const TEXT_EXTS = new Set([
  "txt", "text", "md", "markdown", "mdx", "json", "jsonc", "csv", "tsv", "log", "yaml", "yml",
  "toml", "ini", "cfg", "conf", "xml", "html", "htm", "css", "scss", "less", "js", "jsx", "ts", "tsx",
  "mjs", "cjs", "vue", "svelte", "py", "go", "rs", "java", "kt", "kts", "swift", "c", "h", "cc", "cpp",
  "hpp", "cs", "rb", "php", "sh", "bash", "zsh", "fish", "sql", "tex", "graphql", "gql", "env",
  "gitignore", "dockerfile", "makefile", "properties", "gradle",
]);

/** 选文件对话框的扩展名白名单（不含点；与上面的类型表保持同源导出，避免两处漂移）。 */
export const LOCAL_ATTACHMENT_IMAGE_EXTS = [...IMAGE_EXTS];
export const LOCAL_ATTACHMENT_TEXT_EXTS = [...TEXT_EXTS];

/** 单个文本附件读取上限（字节）与单次注入总字符上限（与 PDF 的 6 万字符同口径）。 */
export const AI_LOCAL_TEXT_MAX_BYTES = 200 * 1024;
export const AI_LOCAL_TEXT_TOTAL_CHARS = 60_000;

export type LocalAttachmentKind = "image" | "text" | "unsupported";

export function localAttachmentKindOf(filename: string): LocalAttachmentKind {
  const ext = extOf(filename).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (TEXT_EXTS.has(ext)) return "text";
  return "unsupported";
}

interface StoredEntry {
  path: string;
  name: string;
  size: number;
  mimeType: string;
}

/** token → 绝对路径（进程内存；重启即失效，这是有意的边界）。 */
const registry = new Map<string, StoredEntry>();

export interface PickedLocalFile {
  ref: AiLocalFileRef;
  /** 便于调用方做「≤10 个附件」判断前的内部排序/统计；渲染层不接触。 */
  kind: LocalAttachmentKind;
}

/** dialog 选中的绝对路径 → 不透明引用（stat 失败/目录直接跳过）。 */
export function registerPickedLocalFile(absPath: string): PickedLocalFile | null {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile() || stat.size <= 0) return null;
    const name = absPath.split(/[\\/]/).pop() || "文件";
    const token = "loc-" + crypto.randomUUID();
    const mimeType = mimeTypeForFilename(name);
    registry.set(token, { path: absPath, name, size: stat.size, mimeType });
    return { ref: { kind: "local", token, name, size: stat.size, mimeType }, kind: localAttachmentKindOf(name) };
  } catch {
    return null;
  }
}

export interface AiLocalFileReader {
  readLocalFile(ref: AiLocalFileRef): { bytes: Buffer; size: number; mimeType: string; name: string } | null;
}

/** resolver 只通过这个接口读字节（单测可注入内存实现）。 */
export function readRegisteredLocalFile(ref: AiLocalFileRef): { bytes: Buffer; size: number; mimeType: string; name: string } | null {
  const entry = registry.get(ref.token);
  if (!entry) return null;
  try {
    const stat = fs.statSync(entry.path);
    if (!stat.isFile()) return null;
    return { bytes: fs.readFileSync(entry.path), size: stat.size, mimeType: entry.mimeType || ref.mimeType, name: entry.name || ref.name };
  } catch {
    return null;
  }
}

/** 仅测试用：清空注册表（避免跨用例串 token）。 */
export function resetLocalAttachmentRegistryForTest(): void {
  registry.clear();
}
