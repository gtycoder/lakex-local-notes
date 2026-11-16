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
 * - pdf    → **选择时解析一次**（pdfText：32MB / 6 万字符 / 10s / 扫描件明确报错）并缓存在注册表，
 *            发送时作为带文件名与页数的 text 块（不当 image_url、字节不进渲染层）；
 * - unsupported（二进制/未知）→ 发送时明确拒绝。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AI_PASTED_IMAGE_MAX_BYTES } from "../../src/core/aiChatMessages.js";
import type { AiLocalFileRef } from "../../src/core/aiProviders.js";
import { AppError } from "../../src/core/storeErrors.js";
import { extOf, mimeTypeForFilename } from "../../src/core/assetNaming.js";
import { AI_PDF_MAX_BYTES, extractPdfText } from "./pdfText.js";

/**
 * 图片扩展名。**heic/heif 明确不在内**（与 core/assetNaming 的 MIME 表同一裁决，见该文件注释
 * 「heic/heif 未列入（浏览器兼容差）」）：主进程唯一的图像解码器是 sharp，而本机 libvips 的
 * HEIF 输入只支持 AVIF（实测 sharp.format.heif.input.fileSuffix = [".avif"]）⇒ HEIC 会「选得进、
 * 发不出去（toImageDataUrl 抛无法读取图片）、预览破图」。macOS「照片」默认就是 HEIC，
 * 所以在选择/粘贴阶段就拒绝并给「先转 JPEG/PNG」的出口（heicConversionHint）。
 */
const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp"]);
/** 已知但**不支持**的图片容器：只用于给出可执行文案，绝不当图片处理。 */
const UNSUPPORTED_IMAGE_EXTS = new Set(["heic", "heif"]);
const PDF_EXTS = new Set(["pdf"]);
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
export const LOCAL_ATTACHMENT_PDF_EXTS = [...PDF_EXTS];

/** 单个文本附件读取上限（字节）与单次注入总字符上限（与 PDF 的 6 万字符同口径）。 */
export const AI_LOCAL_TEXT_MAX_BYTES = 200 * 1024;
export const AI_LOCAL_TEXT_TOTAL_CHARS = 60_000;

export type LocalAttachmentKind = "image" | "text" | "pdf" | "unsupported";

/**
 * HEIC/HEIF 的专属可执行提示（返回 null = 不是这两种格式）。
 * 主进程解不了 HEIC（见 IMAGE_EXTS 注释），但错误文案必须说清「怎么办」，不能只报「无法读取图片」。
 */
export function heicConversionHint(filename: string): string | null {
  return UNSUPPORTED_IMAGE_EXTS.has(extOf(filename).toLowerCase())
    ? "HEIC/HEIF 暂不支持（" + filename + "），请先转换为 JPEG 或 PNG 再添加"
    : null;
}

export function localAttachmentKindOf(filename: string): LocalAttachmentKind {
  const ext = extOf(filename).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (TEXT_EXTS.has(ext)) return "text";
  if (PDF_EXTS.has(ext)) return "pdf";
  return "unsupported";
}

export interface CachedPdfText {
  text: string;
  pages: number;
  truncated: boolean;
}

interface StoredEntry {
  path: string;
  name: string;
  size: number;
  mimeType: string;
  /** PDF：选择时解析一次并缓存（发送复用，避免选完再解析两遍）。 */
  pdf?: CachedPdfText;
}

/** PDF 解析失败的可执行原因（加密/扫描件/坏文件/过大/超时）。 */
export function pdfAttachmentErrorMessage(name: string, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error ?? "");
  const specific = /password|encrypt/i.test(reason)
    ? "文件已加密（需要密码）"
    : /超时/.test(reason)
      ? "解析超时"
      : /扫描件|没有可提取/.test(reason)
        ? "没有可提取文字（可能是扫描件）"
        : /过大/.test(reason)
          ? "文件超过解析上限"
          : "文件损坏或不是有效的 PDF";
  return "PDF 解析失败：" + name + "（" + specific + "）。请换用可复制文字的 PDF，或取消密码保护后重试。";
}

/** token → 绝对路径（进程内存；重启即失效，这是有意的边界）。 */
const registry = new Map<string, StoredEntry>();

export interface PickedLocalFile {
  ref: AiLocalFileRef;
  /** 便于调用方做「≤10 个附件」判断前的内部排序/统计；渲染层不接触。 */
  kind: LocalAttachmentKind;
}

/**
 * dialog 选中的绝对路径 → 不透明引用（stat 失败/目录直接跳过）。
 * PDF 在这里**解析一次**（带文件名/页数回渲染层做 chips 提示；解析结果缓存，发送时复用）。
 * 解析失败抛 AppError（中文可执行原因），由 IPC 转成用户可见错误——不静默跳过。
 */
export async function registerPickedLocalFile(absPath: string): Promise<PickedLocalFile | null> {
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile() || stat.size <= 0) return null;
    const name = absPath.split(/[\\/]/).pop() || "文件";
    const token = "loc-" + crypto.randomUUID();
    const mimeType = mimeTypeForFilename(name);
    const kind = localAttachmentKindOf(name);
    const entry: StoredEntry = { path: absPath, name, size: stat.size, mimeType };
    let pages: number | undefined;
    if (kind === "pdf") {
      // P0-1：**先按限额拒绝、再读盘**。读整文件是同步阻塞 + 内存峰值，超大 PDF 不该先被读进来再报错。
      if (stat.size > AI_PDF_MAX_BYTES) {
        throw new AppError("InvalidInput", "PDF 文件过大：" + name + "（上限 " + Math.round(AI_PDF_MAX_BYTES / 1024 / 1024) + "MB）");
      }
      let extracted: CachedPdfText;
      try {
        extracted = await extractPdfText(await fs.promises.readFile(absPath), "local/" + name + "/" + stat.size);
      } catch (error) {
        throw new AppError("InvalidInput", pdfAttachmentErrorMessage(name, error));
      }
      entry.pdf = extracted;
      pages = extracted.pages;
    }
    registry.set(token, entry);
    const ref: AiLocalFileRef = { kind: "local", token, name, size: stat.size, mimeType };
    if (pages) ref.pages = pages;
    return { ref, kind };
  } catch (error) {
    if (error instanceof AppError) throw error;
    return null;
  }
}

/** 附件元数据（**不含字节**）。 */
export interface AiLocalFileStat {
  size: number;
  mimeType: string;
  name: string;
  /** PDF：选择时已解析的文本（有值 ⇒ 发送时连字节都不用读）。 */
  pdf?: CachedPdfText;
}

/**
 * resolver 只通过这个接口取附件（单测可注入内存实现）。
 *
 * **两步是刻意拆开的（P0-1）**：先 `statLocalFile` 拿元数据判限额，超限直接拒 ⇒ 连文件都不读；
 * 通过限额后才 `readLocalFile`（异步）。之前的单步接口先把整文件读进内存再判 10MB/200KB/32MB，
 * 用户随手选个几百 MB 的文件就能让主进程吃满内存并卡死事件循环。
 */
export interface AiLocalFileReader {
  /** 只读元数据（同步 stat，μs 级）。返回 null = token 失效 / 文件被移走。 */
  statLocalFile(ref: AiLocalFileRef): AiLocalFileStat | null;
  /** 读字节（异步）。**调用方必须先 statLocalFile 判过限额。** 返回 null = 读不到。 */
  readLocalFile(ref: AiLocalFileRef): Promise<Buffer | null>;
}

interface ResolvedEntry {
  path: string;
  stat: fs.Stats;
  mimeType: string;
  name: string;
  pdf?: CachedPdfText;
}

/** token → 磁盘条目（注册表优先；粘贴图跨重启按 token 反推粘贴目录文件名）。 */
function resolveEntry(ref: AiLocalFileRef): ResolvedEntry | null {
  const entry = registry.get(ref.token);
  if (entry) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(entry.path);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;
    return { path: entry.path, stat, mimeType: entry.mimeType || ref.mimeType, name: entry.name || ref.name, ...(entry.pdf ? { pdf: entry.pdf } : {}) };
  }
  const persisted = pastedImageSource(ref.token);
  if (!persisted) return null;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(persisted.path);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  return { path: persisted.path, stat, mimeType: ref.mimeType || persisted.mimeType, name: ref.name || persisted.name };
}

/** 只读元数据（**不读字节**）：resolver 用它判限额，超限不读盘。 */
export function statRegisteredLocalFile(ref: AiLocalFileRef): AiLocalFileStat | null {
  const entry = resolveEntry(ref);
  if (!entry) return null;
  return { size: entry.stat.size, mimeType: entry.mimeType, name: entry.name, ...(entry.pdf ? { pdf: entry.pdf } : {}) };
}

/** 异步读字节（调用方必须先判限额，见 AiLocalFileReader 注释）。 */
export async function readRegisteredLocalFile(ref: AiLocalFileRef): Promise<Buffer | null> {
  const entry = resolveEntry(ref);
  if (!entry) return null;
  try {
    return await fs.promises.readFile(entry.path);
  } catch {
    return null;
  }
}

/** IPC 装配用的默认 reader（真实文件系统）；单测注入内存实现。 */
export const registeredLocalFileReader: AiLocalFileReader = {
  statLocalFile: statRegisteredLocalFile,
  readLocalFile: readRegisteredLocalFile,
};

/** 仅测试用：清空注册表（避免跨用例串 token）。 */
export function resetLocalAttachmentRegistryForTest(): void {
  registry.clear();
}

/**
 * 本机图片附件的「预览/缩略图」取用口（261116 用户反馈：本机选的图片不能预览）。
 *
 * 只放行 image 类附件，且**只回路径与类型**（字节仍由 assetServer 直接读文件流式返回，不进渲染层）；
 * token 仍是进程内不透明 id ⇒ 重启后旧 token 404，与发送时的失效语义一致。
 */
export function localAttachmentImageSource(token: string): { path: string; mimeType: string; size: number; name: string } | null {
  const entry = registry.get(token);
  if (entry) {
    if (localAttachmentKindOf(entry.name) !== "image") return null;
    return { path: entry.path, mimeType: entry.mimeType, size: entry.size, name: entry.name };
  }
  // 粘贴图片跨重启：注册表 miss 时按 token 回落到粘贴目录读盘（历史缩略图仍可用）。
  const persisted = pastedImageSource(token);
  return persisted;
}

// ---------------------------------------------------------------------------
// 粘贴图片（261116 用户需求：第三方剪贴板图片 → 落盘临时文件 → 跟随历史）
// ---------------------------------------------------------------------------

/** 粘贴图片目录（单一来源：<userData>/ai-attachments；设备本地，不进 S3/同步）。 */
export function pastedAttachmentDir(userDataDir: string): string {
  return path.join(userDataDir, "ai-attachments");
}

/**
 * 粘贴图片：单张 ≤10MB、只允许图片（单次 ≤10 张由渲染层/附件上限兜住）。
 * **上限的单一来源 = `src/core/aiChatMessages.ts`**（渲染层 useAiWriting 与服务端校验读同一份常量，
 * 261116 P2-5 常量单源）；这里 re-export 只为保持既有 import 路径（registerAiWriting 仍从本模块取）。
 */
export { AI_PASTED_IMAGE_MAX_BYTES };

/** 粘贴文件保留期：启动时清理「未被任何历史引用且超过该时长」的文件。 */
export const AI_PASTED_IMAGE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

const PASTE_PREFIX = "paste-";
/** 允许粘贴的 MIME → 落盘扩展名（**不含 heic/heif**：主进程解不了，见 IMAGE_EXTS 注释）。 */
const IMAGE_MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
};
const PASTE_TOKEN_RE = /^paste-[0-9a-fA-F-]{36}\.(png|jpg|jpeg|webp|gif|bmp)$/;

/** 运行时粘贴目录（IPC 注册时配置；单测可指到临时目录）。 */
let pastedDir: string | null = null;

export function configurePastedImageDir(dir: string): void {
  pastedDir = dir;
}

function pastedImageSource(token: string): { path: string; mimeType: string; size: number; name: string } | null {
  if (!pastedDir || !PASTE_TOKEN_RE.test(token)) return null;
  const file = path.join(pastedDir, token.slice(PASTE_PREFIX.length));
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return null;
    const name = token.slice(PASTE_PREFIX.length);
    return { path: file, mimeType: mimeTypeForFilename(name), size: stat.size, name };
  } catch {
    return null;
  }
}

export interface SavePastedImageInput {
  bytes: Buffer;
  mimeType: string;
  name?: string;
}

/**
 * 剪贴板图片 → 稳定临时文件 + 注册表引用。
 * 校验：必须 image/*（png/jpeg/webp/gif/bmp/heic/heif）、非空、≤10MB；写盘用 tmp+rename（原子）。
 * token 形如 paste-<uuid>.<ext>，路径可由 token 反推 ⇒ 重启后历史缩略图/发送仍可用。
 */
export async function savePastedImage(input: SavePastedImageInput): Promise<AiLocalFileRef> {
  if (!pastedDir) throw new AppError("InvalidInput", "粘贴图片目录未初始化");
  const mime = String(input.mimeType || "").toLowerCase();
  const ext = IMAGE_MIME_EXT[mime];
  if (!ext) {
    const hint = mime.includes("heic") || mime.includes("heif") ? "；HEIC/HEIF 请先转换为 JPEG/PNG" : "";
    throw new AppError("InvalidInput", "不支持的粘贴类型：" + (input.mimeType || "未知") + "（只支持 PNG/JPEG/WebP/GIF/BMP）" + hint);
  }
  const bytes = input.bytes;
  if (!bytes || bytes.length === 0) throw new AppError("InvalidInput", "粘贴图片为空");
  if (bytes.length > AI_PASTED_IMAGE_MAX_BYTES) {
    throw new AppError("InvalidInput", "粘贴图片过大（上限 " + Math.round(AI_PASTED_IMAGE_MAX_BYTES / 1024 / 1024) + "MB）");
  }
  const token = PASTE_PREFIX + crypto.randomUUID() + "." + ext;
  const file = path.join(pastedDir, token.slice(PASTE_PREFIX.length));
  const name = (input.name || "").trim() || "粘贴图片." + ext;
  const tmp = file + ".tmp";
  try {
    // 异步写盘：连粘多张时不占主进程事件循环（同步 writeFile 8×10MB 会排队阻塞 UI）。
    // 原子性不变：tmp（同目录，同卷）+ rename。
    await fs.promises.mkdir(pastedDir, { recursive: true });
    await fs.promises.writeFile(tmp, bytes);
    await fs.promises.rename(tmp, file);
  } catch {
    // 失败清理：别把半个 .tmp 留在粘贴目录（startup 的 .tmp 老化清理是第二道兜底）。
    try {
      await fs.promises.rm(tmp, { force: true });
    } catch { /* 清理失败不影响错误语义 */ }
    throw new AppError("InvalidInput", "粘贴图片写盘失败（磁盘空间或权限），请重试");
  }
  registry.set(token, { path: file, name, size: bytes.length, mimeType: mime });
  return { kind: "local", token, name, size: bytes.length, mimeType: mime };
}

/**
 * 启动清理：删除粘贴目录里「未被任何 AI 历史引用」且超过 7 天的文件。
 * 调用方（主进程启动注册 IPC 时）传入当前所有历史 attach_refs 里的 paste token。
 * 返回删除文件数。失败静默（清理不该阻断启动）。
 */
export function cleanupPastedImages(referencedTokens: ReadonlySet<string>, now: number = Date.now()): number {
  if (!pastedDir || !fs.existsSync(pastedDir)) return 0;
  let removed = 0;
  try {
    for (const name of fs.readdirSync(pastedDir)) {
      const file = path.join(pastedDir, name);
      // 写盘中崩掉的半成品（<uuid>.<ext>.tmp）：不匹配 PASTE_TOKEN_RE，单独按年龄回收。
      const isTmp = name.endsWith(".tmp");
      const isPaste = PASTE_TOKEN_RE.test(PASTE_PREFIX + name);
      if (!isTmp && !isPaste) continue;
      if (isPaste && referencedTokens.has(PASTE_TOKEN_PREFIX_TOKEN(name))) continue;
      try {
        const stat = fs.statSync(file);
        if (now - stat.mtimeMs < AI_PASTED_IMAGE_MAX_AGE_MS) continue;
        fs.rmSync(file, { force: true });
        removed += 1;
      } catch { /* 单文件失败跳过 */ }
    }
  } catch { /* 目录不可读：跳过 */ }
  return removed;
}

function PASTE_TOKEN_PREFIX_TOKEN(filename: string): string {
  return PASTE_PREFIX + filename;
}

/** 仅测试：清空粘贴目录配置（避免串用例）。 */
export function resetPastedImageDirForTest(): void {
  pastedDir = null;
}
